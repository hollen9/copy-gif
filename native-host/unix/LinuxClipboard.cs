using System.Diagnostics;

internal static class LinuxClipboard
{
    internal static void Write(string path)
    {
        var candidates = new List<(string Tool, string[] Arguments)>();
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WAYLAND_DISPLAY")))
            candidates.Add(("wl-copy", ["--type", "image/gif"]));
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DISPLAY")))
            candidates.Add(("xclip", ["-selection", "clipboard", "-target", "image/gif", "-in"]));
        if (candidates.Count == 0)
            throw new InvalidOperationException("No desktop clipboard session. Run the browser in your Wayland or X11 session.");
        var errors = new List<string>();
        foreach (var candidate in candidates)
        {
            string errorFile = Path.GetTempFileName();
            try
            {
                // Clipboard helpers fork to serve future pastes. Disconnect their
                // standard handles from the browser's native messaging pipes.
                var start = new ProcessStartInfo("/bin/sh") { UseShellExecute = false };
                start.ArgumentList.Add("-c");
                start.ArgumentList.Add("exec \"$@\" <\"$COPY_GIF_INPUT\" >/dev/null 2>\"$COPY_GIF_ERROR\"");
                start.ArgumentList.Add("copy-gif");
                start.ArgumentList.Add(candidate.Tool);
                foreach (string argument in candidate.Arguments) start.ArgumentList.Add(argument);
                start.Environment["COPY_GIF_INPUT"] = path;
                start.Environment["COPY_GIF_ERROR"] = errorFile;
                using var process = Process.Start(start) ?? throw new InvalidOperationException("Unable to start clipboard helper.");
                if (!process.WaitForExit(10000))
                {
                    process.Kill(entireProcessTree: true);
                    throw new TimeoutException("Clipboard helper timed out.");
                }
                if (process.ExitCode == 0) return;
                errors.Add(candidate.Tool + ": " + File.ReadAllText(errorFile).Trim());
            }
            finally { File.Delete(errorFile); }
        }
        throw new InvalidOperationException("Clipboard copy failed. Install wl-clipboard (Wayland) or xclip (X11). " + string.Join("; ", errors));
    }
}

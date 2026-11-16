using System.Security.Cryptography;
using System.Text.Json;

internal static class Installation
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    internal static int Run(string[] args)
    {
        try
        {
            if (args[0] == "--version") { Console.WriteLine("Copy GIF 1.2.0 (.NET 10)"); return 0; }
            if (args.Length < 2 || args[0] is not ("--register" or "--unregister"))
                throw new ArgumentException("Usage: copy-gif-host --register INSTALL_DIR [all|chrome,edge,brave,chromium,vivaldi,opera]");
            string root = Path.GetFullPath(args[1]);
            string launcher = Path.Combine(root, "copy-gif-host");
            string statePath = Path.Combine(root, "registration-backup.json");
            var backups = File.Exists(statePath)
                ? JsonSerializer.Deserialize<List<Backup>>(File.ReadAllText(statePath)) ?? throw new InvalidDataException("Invalid registration backup.")
                : new List<Backup>();
            if (args[0] == "--unregister")
            {
                foreach (var backup in backups)
                {
                    if (!File.Exists(backup.Path)) continue;
                    using var existing = JsonDocument.Parse(File.ReadAllText(backup.Path));
                    if (existing.RootElement.GetProperty("path").GetString() != launcher) continue;
                    if (backup.Previous is null) File.Delete(backup.Path);
                    else File.WriteAllText(backup.Path, backup.Previous);
                    Console.WriteLine("Restored: " + backup.Path);
                }
                return 0;
            }
            using var extension = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "Extension", "manifest.json")));
            byte[] key = Convert.FromBase64String(extension.RootElement.GetProperty("key").GetString()!);
            string id = string.Concat(Convert.ToHexString(SHA256.HashData(key)).Take(32)
                .Select(c => (char)('a' + Convert.ToInt32(c.ToString(), 16))));
            string home = Environment.GetEnvironmentVariable("HOME") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            bool mac = OperatingSystem.IsMacOS();
            if (!mac && !OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Use install-windows.ps1 on Windows.");
            string config = mac ? Path.Combine(home, "Library", "Application Support")
                : Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") ?? Path.Combine(home, ".config");
            var directories = new Dictionary<string, string> {
                ["chrome"] = mac ? "Google/Chrome" : "google-chrome",
                ["edge"] = mac ? "Microsoft Edge" : "microsoft-edge",
                ["brave"] = "BraveSoftware/Brave-Browser",
                ["chromium"] = mac ? "Chromium" : "chromium",
                ["vivaldi"] = mac ? "Vivaldi" : "vivaldi",
                ["opera"] = mac ? "com.operasoftware.Opera" : "opera"
            };
            string selection = args.Length > 2 ? args[2] : "all";
            string[] browsers = selection == "all" ? directories.Keys.ToArray() : selection.Split(',');
            if (browsers.Length == 0 || browsers.Any(name => !directories.ContainsKey(name)))
                throw new ArgumentException("Unknown browser. Choose all, chrome, edge, brave, chromium, vivaldi, or opera.");
            string manifest = JsonSerializer.Serialize(new {
                name = "com.copygif.host", description = "Copy GIF native host", path = launcher,
                type = "stdio", allowed_origins = new[] { "chrome-extension://" + id + "/" }
            }, Json);
            foreach (string browser in browsers.Distinct())
            {
                string directory = Path.Combine(config, directories[browser], "NativeMessagingHosts");
                string path = Path.Combine(directory, "com.copygif.host.json");
                Directory.CreateDirectory(directory);
                if (!backups.Any(entry => entry.Path == path))
                    backups.Add(new Backup(path, File.Exists(path) ? File.ReadAllText(path) : null));
                File.WriteAllText(statePath, JsonSerializer.Serialize(backups, Json));
                File.WriteAllText(path, manifest);
                Console.WriteLine("Registered " + browser + ": " + path);
            }
            Console.WriteLine("Load unpacked: " + Path.Combine(root, "Extension"));
            Console.WriteLine("Extension ID: " + id);
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    private sealed record Backup(string Path, string? Previous);
}

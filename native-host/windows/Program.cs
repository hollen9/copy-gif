using System.Buffers.Binary;
using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text;
using System.Windows.Media.Imaging;

internal static class Program
{
    private const int MaxGifBytes = 25 * 1024 * 1024;
    private const int MaxMessageBytes = 36 * 1024 * 1024;
    private static readonly string CacheDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CopyGIF", "Cache");
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [STAThread]
    private static int Main()
    {
        // stdout is exclusively the binary Native Messaging protocol, including on errors.
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        try
        {
            while (true)
            {
                byte[] header = new byte[4];
                if (input.Read(header, 0, 1) == 0) return 0;
                input.ReadExactly(header.AsSpan(1));
                int length = BinaryPrimitives.ReadInt32LittleEndian(header);
                if (length <= 0 || length > MaxMessageBytes)
                    throw new InvalidDataException("Native message is empty or exceeds 36 MiB.");
                byte[] message = new byte[length];
                input.ReadExactly(message);
                object response;
                try
                {
                    var request = JsonSerializer.Deserialize<Request>(message, JsonOptions)
                        ?? throw new InvalidDataException("Request is empty.");
                    response = request.Action switch
                    {
                        "ping" => new { success = true, version = "1.3.0", platform = "windows-dotnet" },
                        "copyGif" => CopyGif(request),
                        _ => throw new InvalidDataException("Unsupported action.")
                    };
                }
                catch (Exception ex) { response = new { success = false, error = ex.Message }; }
                WriteResponse(output, response);
            }
        }
        catch (Exception ex)
        {
            try { WriteResponse(output, new { success = false, error = ex.Message }); } catch { }
            return 1;
        }
    }

    private static object CopyGif(Request request)
    {
        byte[] bytes;
        if (request.Data is not null)
        {
            if (request.Data.Length > ((MaxGifBytes + 2L) / 3) * 4)
                throw new InvalidDataException("GIF exceeds 25 MiB.");
            bytes = Convert.FromBase64String(request.Data);
        }
        else
        {
            if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo))
                throw new InvalidDataException("Only HTTP(S) image URLs are supported.");
            bytes = Download(uri);
        }
        ValidateGif(bytes);
        Directory.CreateDirectory(CacheDirectory);
        string path = Path.Combine(CacheDirectory, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() + ".gif");
        // CF_HDROP stores a path, not its contents: retain the GIF after this process exits.
        File.WriteAllBytes(path, bytes);
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
        SetClipboard(path, bytes);
        CleanOldFiles(path);
        return new { success = true, method = "native-file", bytes = bytes.Length, fileName = Path.GetFileName(path) };
    }

    private static byte[] Download(Uri uri)
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CopyGIF/1.1");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        for (int redirect = 0; redirect <= 5; redirect++)
        {
            using var response = client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token).GetAwaiter().GetResult();
            int status = (int)response.StatusCode;
            if (status is 301 or 302 or 303 or 307 or 308)
            {
                uri = new Uri(uri, response.Headers.Location ?? throw new InvalidDataException("Redirect has no URL."));
                if ((uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo))
                    throw new InvalidDataException("Unsafe image redirect.");
                continue;
            }
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > MaxGifBytes)
                throw new InvalidDataException("GIF exceeds 25 MiB.");
            using var stream = response.Content.ReadAsStream(timeout.Token);
            using var data = new MemoryStream();
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = stream.ReadAsync(buffer, timeout.Token).AsTask().GetAwaiter().GetResult()) > 0)
            {
                if (data.Length + count > MaxGifBytes) throw new InvalidDataException("GIF exceeds 25 MiB.");
                data.Write(buffer, 0, count);
            }
            return data.ToArray();
        }
        throw new InvalidDataException("Too many image redirects.");
    }

    private static void ValidateGif(byte[] bytes)
    {
        if (bytes.Length < 14 || bytes.Length > MaxGifBytes ||
            (!bytes.AsSpan(0, 6).SequenceEqual("GIF87a"u8) && !bytes.AsSpan(0, 6).SequenceEqual("GIF89a"u8)))
            throw new InvalidDataException("The image is not a GIF. Use the original GIF, not a WebP/MP4 preview.");
        int width = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(6, 2));
        int height = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(8, 2));
        if (width == 0 || height == 0 || (long)width * height > 40_000_000)
            throw new InvalidDataException("GIF dimensions are invalid or too large.");
        using var stream = new MemoryStream(bytes, false);
        var decoder = new GifBitmapDecoder(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnDemand);
        if (decoder.Frames.Count == 0) throw new InvalidDataException("GIF has no image frames.");
    }

    private static void SetClipboard(string path, byte[] bytes)
    {
        // Supply real HGLOBAL payloads eagerly. Windows owns these buffers after
        // SetClipboardData, so no OLE owner, message pump or running process is needed.
        byte[] names = Encoding.Unicode.GetBytes(path + "\0\0");
        byte[] drop = new byte[20 + names.Length];
        BinaryPrimitives.WriteInt32LittleEndian(drop, 20); // DROPFILES.pFiles
        BinaryPrimitives.WriteInt32LittleEndian(drop.AsSpan(16), 1); // fWide
        names.CopyTo(drop, 20);
        uint effectFormat = Native.RegisterClipboardFormatW("Preferred DropEffect");
        uint gifFormat = Native.RegisterClipboardFormatW("image/gif");
        uint gifAliasFormat = Native.RegisterClipboardFormatW("GIF");
        if (effectFormat == 0 || gifFormat == 0 || gifAliasFormat == 0) throw new Win32Exception();
        var payloads = new (uint Format, byte[] Bytes)[] {
            (15, drop), (effectFormat, new byte[] { 1, 0, 0, 0 }), (gifFormat, bytes), (gifAliasFormat, bytes)
        };
        var buffers = new List<(uint Format, nint Handle)>();
        nint window = Native.CreateWindowExW(0, "STATIC", "Copy GIF Clipboard", 0, 0, 0, 0, 0, new nint(-3), 0, 0, 0);
        if (window == 0) throw new Win32Exception();
        bool opened = false;
        try
        {
            foreach (var payload in payloads)
            {
                nint memory = Native.GlobalAlloc(0x0042, (nuint)payload.Bytes.Length);
                if (memory == 0) throw new OutOfMemoryException();
                buffers.Add((payload.Format, memory));
                nint pointer = Native.GlobalLock(memory);
                if (pointer == 0) throw new Win32Exception();
                try { Marshal.Copy(payload.Bytes, 0, pointer, payload.Bytes.Length); }
                finally { Native.GlobalUnlock(memory); }
            }
            for (int attempt = 0; attempt < 20; attempt++)
            {
                if (Native.OpenClipboard(window)) { opened = true; break; }
                Thread.Sleep(50);
            }
            if (!opened) throw new Win32Exception(Marshal.GetLastWin32Error(), "Clipboard is busy; try copying again.");
            if (!Native.EmptyClipboard()) throw new Win32Exception();
            for (int i = 0; i < buffers.Count; i++)
            {
                var buffer = buffers[i];
                if (Native.SetClipboardData(buffer.Format, buffer.Handle) == 0) throw new Win32Exception();
                buffers[i] = (buffer.Format, 0); // Ownership transferred to Windows.
            }
        }
        finally
        {
            if (opened) Native.CloseClipboard();
            foreach (var buffer in buffers) if (buffer.Handle != 0) Native.GlobalFree(buffer.Handle);
            Native.DestroyWindow(window);
        }
    }

    private static void CleanOldFiles(string current)
    {
        // Only our hash-named cache files older than 30 days, after a successful copy.
        try
        {
            var protectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { current };
            if (!Native.OpenClipboard(0)) return;
            try
            {
                nint drop = Native.GetClipboardData(15);
                if (drop != 0)
                {
                    uint count = Native.DragQueryFileW(drop, uint.MaxValue, null, 0);
                    for (uint i = 0; i < count; i++)
                    {
                        var name = new StringBuilder(32768);
                        Native.DragQueryFileW(drop, i, name, (uint)name.Capacity);
                        protectedFiles.Add(name.ToString());
                    }
                }
            }
            finally { Native.CloseClipboard(); }
            foreach (string file in Directory.EnumerateFiles(CacheDirectory, "*.gif"))
            {
                string stem = Path.GetFileNameWithoutExtension(file);
                if (stem.Length == 64 && stem.All(Uri.IsHexDigit) && !protectedFiles.Contains(file) &&
                    File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddDays(-30))
                {
                    try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
        }
        catch { /* Cache maintenance must not turn a successful copy into an error. */ }
    }

    private static void WriteResponse(Stream output, object response)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        Span<byte> header = stackalloc byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        output.Write(header);
        output.Write(bytes);
        output.Flush();
    }

    private sealed record Request(string Action, string? Url = null, string? Data = null);

    private static class Native
    {
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool OpenClipboard(nint window);
        [DllImport("user32.dll")] internal static extern bool CloseClipboard();
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool EmptyClipboard();
        [DllImport("user32.dll", SetLastError = true)] internal static extern nint SetClipboardData(uint format, nint data);
        [DllImport("user32.dll")] internal static extern nint GetClipboardData(uint format);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern uint RegisterClipboardFormatW(string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern nint CreateWindowExW(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
        [DllImport("user32.dll")] internal static extern bool DestroyWindow(nint window);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint GlobalAlloc(uint flags, nuint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint GlobalLock(nint memory);
        [DllImport("kernel32.dll")] internal static extern bool GlobalUnlock(nint memory);
        [DllImport("kernel32.dll")] internal static extern nint GlobalFree(nint memory);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] internal static extern uint DragQueryFileW(nint drop, uint index, StringBuilder? name, uint length);
    }
}

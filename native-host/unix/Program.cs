using System.Buffers.Binary;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text;

internal static class Program
{
    private const int MaxGifBytes = 25 * 1024 * 1024;
    private const int MaxMessageBytes = 36 * 1024 * 1024;
    private static readonly string UserHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string CacheDirectory = OperatingSystem.IsMacOS()
        ? Path.Combine(UserHome, "Library", "Caches", "CopyGIF")
        : Path.Combine(Environment.GetEnvironmentVariable("XDG_CACHE_HOME") ?? Path.Combine(UserHome, ".cache"), "copy-gif");
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0].StartsWith("--", StringComparison.Ordinal))
            return Installation.Run(args);
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
                        "ping" => new { success = true, version = "1.2.0", platform = OperatingSystem.IsMacOS() ? "macos-dotnet" : "linux-dotnet" },
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
        if (bytes.Length > MaxGifBytes) throw new InvalidDataException("GIF exceeds 25 MiB.");
        GifValidator.Validate(bytes);
        Directory.CreateDirectory(CacheDirectory);
        string path = Path.Combine(CacheDirectory, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() + ".gif");
        // Retain file URLs after the native messaging process exits.
        File.WriteAllBytes(path, bytes);
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
        if (OperatingSystem.IsMacOS()) MacClipboard.Write(path, bytes);
        else if (OperatingSystem.IsLinux()) LinuxClipboard.Write(path);
        else throw new PlatformNotSupportedException("Use the Windows native host on Windows.");
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

    private static void CleanOldFiles(string current)
    {
        try
        {
            string? clipboardFile = OperatingSystem.IsMacOS() ? MacClipboard.CurrentFile() : null;
            foreach (string file in Directory.EnumerateFiles(CacheDirectory, "*.gif"))
            {
                string stem = Path.GetFileNameWithoutExtension(file);
                if (stem.Length == 64 && stem.All(Uri.IsHexDigit) && file != current && file != clipboardFile &&
                    File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddDays(-30))
                {
                    try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
        }
        catch { }
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
}

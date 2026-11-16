# Copy GIF

Copy animated GIFs from your browser to the Windows clipboard, then paste them
into apps such as Discord or LINE.

## Install

Build the native host with the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0):

~~~powershell
dotnet publish native-host\windows\CopyGif.Host.csproj -c Release -o native-host\windows\publish
.\install-windows.ps1
~~~

In Edge, open `edge://extensions`, enable **Developer mode**, and choose
**Load unpacked**. Select:

~~~text
C:\Program Files (Portable)\Copy GIF\Extension
~~~

Refresh any pages that were already open. See [Windows setup](WINDOWS.md) for
other install locations, Chrome support, and troubleshooting.

## Usage

Right-click a GIF, select **Copy GIF (preserve animation)**, then press **Ctrl+V**
in the destination app.

Supports GIF files up to 25 MiB. For WebP or MP4 previews, open the original GIF first.

## Development

~~~powershell
node tests/extension.test.cjs
python -m pip install Pillow
python tests/test_native_host.py
~~~

The native host test replaces the clipboard with a test GIF.
`python tests/probe_edge.py` checks Edge connectivity in a separate browser profile.

## Credits

Fork of [picasocro1/copy-gif](https://github.com/picasocro1/copy-gif).

## License

MIT

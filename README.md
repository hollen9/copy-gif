# Copy GIF

Copy animated GIFs from Chromium browsers to the clipboard, then paste them into
apps such as Discord or LINE.

Supports Windows, macOS 14+, Debian 12+, and Ubuntu 22.04+ with Chrome, Edge,
Brave, Chromium, Vivaldi, or Opera. Safari and Firefox are not supported.

## Install

### Windows

Run in PowerShell:

~~~powershell
Invoke-WebRequest https://raw.githubusercontent.com/hollen9/copy-gif/main/install.ps1 -OutFile install.ps1
.\install.ps1
~~~

### macOS / Debian / Ubuntu

~~~bash
curl -fsSL https://raw.githubusercontent.com/hollen9/copy-gif/main/install.sh -o install.sh
bash install.sh
~~~

The script selects Arm64 or x64, downloads the host, and registers it for the
supported browsers. On Linux it also installs clipboard tools and system libraries
through apt.

Then open `chrome://extensions`, enable **Developer mode**, and **Load unpacked**
from the folder printed by the installer. Refresh existing pages.

Setup: [Windows](WINDOWS.md) · [macOS](MACOS.md) · [Linux](LINUX.md)

## Runtime

Release packages include .NET 10; no separate runtime is needed.
The smaller `-framework` packages require **.NET Runtime 10.0** on macOS/Linux.
Use `bash install.sh --framework-dependent --install-runtime` to install both.
See the platform guides for manual runtime installation.

## Usage

Right-click a GIF, select **Copy GIF (preserve animation)**, then paste with
**Ctrl+V** (**Cmd+V** on macOS).

Supports GIF files up to 25 MiB. For WebP or MP4 previews, open the original GIF first.

## Development

Build with the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0):

~~~powershell
# Windows
dotnet publish native-host/windows/CopyGif.Host.csproj -c Release -o native-host/windows/publish
.\install-windows.ps1
~~~

~~~bash
# macOS / Debian / Ubuntu
bash install.sh --build
~~~

Tests:

~~~bash
node tests/extension.test.cjs
python -m pip install Pillow
python tests/test_native_host.py                       # Windows
python tests/test_unix_host.py /path/to/copy-gif-host  # macOS/Linux desktop session
~~~

Clipboard tests replace the current clipboard with a test GIF.

## Credits

Fork of [picasocro1/copy-gif](https://github.com/picasocro1/copy-gif).

## License

MIT

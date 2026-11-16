# Windows

## Install

~~~powershell
Invoke-WebRequest https://raw.githubusercontent.com/hollen9/copy-gif/main/install.ps1 -OutFile install.ps1
.\install.ps1
~~~

The default folder is `C:\Program Files (Portable)\Copy GIF`.
Open `chrome://extensions` in your Chromium browser, enable **Developer mode**,
and load the installed `Extension` folder.

Options:

~~~powershell
.\install.ps1 -InstallDirectory "$env:LOCALAPPDATA\Copy GIF"
.\install.ps1 -Browser Chrome
~~~

Chrome, Edge, Chromium, Brave, Vivaldi, and Opera use the registered host.
Other Chromium distributions need to support the standard Native Messaging locations.

## .NET runtime

The Windows release includes .NET 10; no separate runtime is required.

If you build a framework-dependent Windows host, install **.NET Desktop Runtime
10.0 (x64)** from [Microsoft](https://dotnet.microsoft.com/download/dotnet/10.0).
Choose the Desktop Runtime, not just the standard .NET Runtime.
Building from source requires the **.NET 10 SDK**.

## Troubleshooting

Click the extension icon to check the connection. The badge shows **OK** or **ERR**;
hover over it for details.

For `Specified native messaging host not found`, rerun the installer.
It registers the Chrome and Chromium locations plus Edge's own location.

Diagnostics:

~~~text
chrome-extension://pmnfojbhacedcbalilnjofnnnalccmpo/diagnostics.html
~~~

Refresh web pages after installing or reloading the extension.

## Cache

GIFs are kept in `%LOCALAPPDATA%\CopyGIF\Cache` for pasting after the host exits.
Copies older than 30 days are cleaned up, except files still on the clipboard.

## Uninstall

Remove the extension, run `uninstall-windows.ps1` in the installation folder,
then delete that folder. Delete the cache separately when it is no longer needed.

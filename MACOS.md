# macOS

Requires macOS 14 or newer. Apple Silicon (Arm64) and Intel (x64) packages are available.

## Install

~~~bash
curl -fsSL https://raw.githubusercontent.com/hollen9/copy-gif/main/install.sh -o install.sh
bash install.sh
~~~

Load `~/Library/Application Support/Copy GIF/Extension` through **Developer mode →
Load unpacked** at `chrome://extensions`. Restart the browser if the host is not found.

Options:

~~~bash
bash install.sh --browser chrome,brave
bash install.sh --install-dir "$HOME/Applications/Copy GIF"
~~~

Chrome, Edge, Brave, Chromium, Vivaldi, and Opera are registered by default.
For another Chromium distribution or a browser channel, place the generated
`com.copygif.host.json` in that browser's NativeMessagingHosts directory.

## .NET runtime

The standard package includes .NET 10. No runtime installation is required.

The smaller framework-dependent package requires **.NET Runtime 10.0**, matching
your Mac's architecture. Install the package and runtime together:

~~~bash
bash install.sh --framework-dependent --install-runtime
~~~

For manual setup, install the macOS **.NET Runtime 10** package from
[Microsoft](https://dotnet.microsoft.com/download/dotnet/10.0): choose Arm64 for
Apple Silicon or x64 for Intel. The SDK is only needed to build from source.

## Clipboard and cache

Paste with **Cmd+V**. GIF bytes and a file URL are placed on the clipboard.
Cached files are kept in `~/Library/Caches/CopyGIF`; copies older than 30 days
are cleaned up unless still on the clipboard.

Click the extension icon to check the host connection.

## Uninstall

~~~bash
bash "$HOME/Library/Application Support/Copy GIF/uninstall.sh"
~~~

Remove the extension from the browser, then delete the installation folder.
Delete the cache separately when it is no longer needed.

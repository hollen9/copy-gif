# Debian / Ubuntu

Requires Debian 12+ or Ubuntu 22.04+, Arm64 or x64, in a Wayland or X11 desktop session.

## Install

~~~bash
curl -fsSL https://raw.githubusercontent.com/hollen9/copy-gif/main/install.sh -o install.sh
bash install.sh
~~~

Run as your desktop user. The script uses sudo for apt dependencies, then installs
Copy GIF under `~/.local/share/copy-gif` and registers Chrome, Edge, Brave,
Chromium, Vivaldi, and Opera.

Open `chrome://extensions`, enable **Developer mode**, and load the installed
`Extension` folder.

Options:

~~~bash
bash install.sh --browser chromium,brave
bash install.sh --install-dir "$HOME/Applications/Copy GIF"
bash install.sh --skip-deps
~~~

The installer honors XDG_DATA_HOME and XDG_CONFIG_HOME. For Snap/Flatpak browsers,
host access and configuration paths depend on the sandbox; use a native browser
package if Native Messaging is unavailable.

## .NET runtime

Standard packages include .NET 10. Framework-dependent packages require
**.NET Runtime 10.0**:

~~~bash
bash install.sh --framework-dependent --install-runtime
~~~

To install the runtime manually for the current user:

~~~bash
curl -fsSL https://dot.net/v1/dotnet-install.sh -o dotnet-install.sh
bash dotnet-install.sh --channel 10.0 --runtime dotnet --install-dir "$HOME/.dotnet"
~~~

System libraries are still required; the Copy GIF installer installs them through apt.
See [Microsoft's Linux installation guide](https://learn.microsoft.com/dotnet/core/install/linux)
for distribution packages.

## Clipboard

Wayland uses `wl-copy` from `wl-clipboard`; X11 uses `xclip`.
Both are installed by default. For manual setup:

~~~bash
sudo apt-get install wl-clipboard xclip
~~~

Keep WAYLAND_DISPLAY / XDG_RUNTIME_DIR (Wayland) or DISPLAY (X11) available to the
browser. A headless or SSH session without a desktop clipboard cannot copy images.

GIFs remain in `~/.cache/copy-gif` (or `$XDG_CACHE_HOME/copy-gif`); old copies
are cleaned up after 30 days. Click the extension icon to check the host connection.

## Uninstall

~~~bash
bash "$HOME/.local/share/copy-gif/uninstall.sh"
~~~

Remove the extension, then delete the installation folder and any unneeded cache.

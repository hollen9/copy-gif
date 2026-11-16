# Windows setup

The installer uses `C:\Program Files (Portable)\Copy GIF` by default.
The published native host includes the .NET runtime.

## Install options

Choose another location:

~~~powershell
.\install-windows.ps1 -InstallDirectory C:\Tools\CopyGIF
~~~

Register for Chrome:

~~~powershell
.\install-windows.ps1 -Browser Chrome
~~~

Load the installed `Extension` folder from `chrome://extensions` or
`edge://extensions` using **Developer mode → Load unpacked**.
Keep that folder in place after installation.

## Troubleshooting

Click the extension icon to check the native host connection. The badge shows
**OK** or **ERR**; hover over it for details.

For `Specified native messaging host not found`, rerun `install-windows.ps1`.
The Edge installer registers both the Edge host location and its Chrome fallback.

You can also open the diagnostics page:

~~~text
chrome-extension://pmnfojbhacedcbalilnjofnnnalccmpo/diagnostics.html
~~~

Refresh existing web pages after installing or reloading the extension.

## Cache

GIF files are kept in `%LOCALAPPDATA%\CopyGIF\Cache` so they remain available for
pasting after the host exits. Copies older than 30 days are cleaned up, except
files referenced by the current clipboard.

## Uninstall

1. Remove Copy GIF from the browser.
2. Run `uninstall-windows.ps1` in the installation folder to restore the previous registrations.
3. Delete the installation folder.

Delete the cache separately when you no longer need to paste those files.

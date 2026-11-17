# Packages

Build a macOS or Linux archive with .NET 10 SDK:

~~~bash
bash installers/unix/package.sh osx-arm64 release
bash installers/unix/package.sh osx-x64 release
bash installers/unix/package.sh linux-x64 release
bash installers/unix/package.sh linux-arm64 release
~~~

Append `true` to produce a framework-dependent archive. Standard archives include
the runtime; framework-dependent archives require .NET Runtime 10.0.

Each archive contains the native host, extension, installer, and uninstaller.
Install a downloaded archive with:

~~~bash
bash install.sh --package /path/to/copy-gif-osx-arm64.tar.gz
~~~

CI builds Windows and Linux packages. GitHub macOS jobs are available through
the manual `build_macos` workflow option.

Build the extension-only ZIP and tar.gz with Python 3:

~~~bash
python installers/package-extension.py release
~~~

Include both extension archives, `install-extension.ps1`, and
`install-extension.sh` in each release, with their hashes in `SHA256SUMS`.
Downloads are published under [Releases](https://github.com/hollen9/copy-gif/releases).

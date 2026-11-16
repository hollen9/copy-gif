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

The Build and test workflow builds and tests both architectures on macOS and
Ubuntu and produces a Windows x64 package. Downloads are published under
[Releases](https://github.com/hollen9/copy-gif/releases).

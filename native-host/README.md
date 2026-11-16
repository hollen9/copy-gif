# Native host

The .NET hosts support Windows, macOS, and Debian/Ubuntu:

- `windows/`: Windows clipboard and WPF host.
- `unix/`: macOS pasteboard, Linux clipboard helpers, and browser registration.

Build with .NET 10 SDK. See [Windows](../WINDOWS.md), [macOS](../MACOS.md), or
[Linux](../LINUX.md) for installation and runtime requirements.

The host uses Chromium's length-prefixed JSON protocol. Requests are
`ping` or `copyGif` with an HTTP(S) `url` or base64 `data`.

The original Rust implementation remains under `src/`. Release packages use
the .NET implementation.

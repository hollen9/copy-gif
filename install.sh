#!/bin/bash
set -euo pipefail

VERSION=1.3.1
REPOSITORY=hollen9/copy-gif
BROWSERS=all
INSTALL_DIR=
PACKAGE=
BUILD=false
FRAMEWORK_DEPENDENT=false
INSTALL_RUNTIME=false
INSTALL_DEPS=true

usage() {
    cat <<'EOF'
Usage: bash install.sh [options]
  --browser LIST          all (default), or chrome,edge,brave,chromium,vivaldi,opera
  --install-dir PATH      Override the per-user installation directory
  --package PATH          Install a downloaded release archive
  --build                 Build from this source checkout (.NET 10 SDK)
  --framework-dependent   Use the smaller package; requires .NET Runtime 10
  --install-runtime       Install a private .NET Runtime 10 if needed
  --skip-deps             Do not install Debian/Ubuntu system packages
  --version VERSION       Release version (default: 1.3.1)
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --browser|--install-dir|--package|--version)
            [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; exit 1; }
            case "$1" in
                --browser) BROWSERS=$2;; --install-dir) INSTALL_DIR=$2;;
                --package) PACKAGE=$2;; --version) VERSION=$2;;
            esac
            shift 2;;
        --build) BUILD=true; shift;;
        --framework-dependent) FRAMEWORK_DEPENDENT=true; shift;;
        --install-runtime) INSTALL_RUNTIME=true; shift;;
        --skip-deps) INSTALL_DEPS=false; shift;;
        --help|-h) usage; exit 0;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

[ "$(id -u)" -ne 0 ] || { echo 'Run as your desktop user, not root.' >&2; exit 1; }
case "$(uname -s)" in
    Darwin)
        PLATFORM=osx
        [ "$(sw_vers -productVersion | cut -d. -f1)" -ge 14 ] || { echo 'macOS 14 or newer is required.' >&2; exit 1; }
        INSTALL_DIR=${INSTALL_DIR:-"$HOME/Library/Application Support/Copy GIF"};;
    Linux)
        PLATFORM=linux
        [ -r /etc/os-release ] || { echo 'Cannot detect Linux distribution.' >&2; exit 1; }
        . /etc/os-release
        case "${ID:-}:${ID_LIKE:-}" in
            debian:*|ubuntu:*|*:debian*|*:ubuntu*) ;;
            *) echo 'This installer supports Debian and Ubuntu.' >&2; exit 1;;
        esac
        INSTALL_DIR=${INSTALL_DIR:-"${XDG_DATA_HOME:-$HOME/.local/share}/copy-gif"}
        if $INSTALL_DEPS; then
            sudo apt-get update
            ICU=$(apt-cache pkgnames | grep -E '^libicu[0-9]+$' | sort -V | tail -1)
            SSL=$(apt-cache pkgnames | grep -E '^libssl3(t64)?$' | sort | tail -1)
            [ -n "$ICU" ] && [ -n "$SSL" ] || { echo 'Use Debian 12+ or Ubuntu 22.04+.' >&2; exit 1; }
            sudo apt-get install -y ca-certificates curl libc6 libgcc-s1 libgssapi-krb5-2 "$ICU" "$SSL" libstdc++6 zlib1g xclip wl-clipboard
        fi;;
    *) echo 'Use install-windows.ps1 on Windows.' >&2; exit 1;;
esac

case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64;; x86_64|amd64) ARCH=x64;;
    *) echo 'Only Arm64 and x64 are supported.' >&2; exit 1;;
esac
if [ "$PLATFORM" = osx ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
RID="$PLATFORM-$ARCH"
case "$INSTALL_DIR" in /*) ;; *) echo '--install-dir must be an absolute path.' >&2; exit 1;; esac
case "$BROWSERS" in *[!a-z,]*|'') echo 'Invalid browser list.' >&2; exit 1;; esac
IFS=',' read -r -a SELECTED <<< "$BROWSERS"
for BROWSER in "${SELECTED[@]}"; do
    case "$BROWSER" in all|chrome|edge|brave|chromium|vivaldi|opera) ;; *) echo "Unknown browser: $BROWSER" >&2; exit 1;; esac
done

WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]:-.}")" && pwd)
if $BUILD; then
    command -v dotnet >/dev/null 2>&1 || { echo 'Building requires .NET 10 SDK: https://dotnet.microsoft.com/download/dotnet/10.0' >&2; exit 1; }
    bash "$SOURCE_DIR/installers/unix/package.sh" "$RID" "$WORK" "$FRAMEWORK_DEPENDENT"
    PACKAGE="$WORK/copy-gif-$RID$($FRAMEWORK_DEPENDENT && printf -- '-framework' || true).tar.gz"
elif [ -z "$PACKAGE" ] && [ -d "$SOURCE_DIR/host" ] && [ -d "$SOURCE_DIR/Extension" ]; then
    tar -czf "$WORK/local-package.tar.gz" -C "$SOURCE_DIR" .
    PACKAGE="$WORK/local-package.tar.gz"
elif [ -z "$PACKAGE" ]; then
    SUFFIX=
    $FRAMEWORK_DEPENDENT && SUFFIX=-framework
    ASSET="copy-gif-$RID$SUFFIX.tar.gz"
    BASE="https://github.com/$REPOSITORY/releases/download/v$VERSION"
    curl -fL --retry 3 "$BASE/$ASSET" -o "$WORK/$ASSET"
    curl -fL --retry 3 "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"
    EXPECTED=$(awk -v name="$ASSET" '$2 == name { print $1 }' "$WORK/SHA256SUMS")
    [ -n "$EXPECTED" ] || { echo 'Missing package checksum.' >&2; exit 1; }
    if [ "$PLATFORM" = osx ]; then ACTUAL=$(shasum -a 256 "$WORK/$ASSET" | awk '{print $1}');
    else ACTUAL=$(sha256sum "$WORK/$ASSET" | awk '{print $1}'); fi
    [ "$ACTUAL" = "$EXPECTED" ] || { echo 'Package checksum mismatch.' >&2; exit 1; }
    PACKAGE="$WORK/$ASSET"
fi

mkdir -p "$WORK/package"
tar -xzf "$PACKAGE" -C "$WORK/package"
[ "$(cat "$WORK/package/platform.txt")" = "$RID" ] || { echo "Package does not match $RID." >&2; exit 1; }
[ -f "$WORK/package/host/copy-gif-host.dll" ] || [ -x "$WORK/package/host/copy-gif-host" ] || { echo 'Invalid Copy GIF package.' >&2; exit 1; }
mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/host" ]; then
    [ -f "$INSTALL_DIR/copy-gif-host" ] || { echo 'The target contains an unrelated host directory.' >&2; exit 1; }
    mv "$INSTALL_DIR/host" "$WORK/previous-host"
fi
cp -R "$WORK/package/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/copy-gif-host" "$INSTALL_DIR/uninstall.sh"
if [ ! -x "$INSTALL_DIR/host/copy-gif-host" ]; then
    if ! "$INSTALL_DIR/copy-gif-host" --version >/dev/null 2>&1; then
        if ! $INSTALL_RUNTIME; then
            echo 'Install .NET Runtime 10, or rerun with --install-runtime.' >&2; exit 1
        fi
        curl -fL --retry 3 https://dot.net/v1/dotnet-install.sh -o "$WORK/dotnet-install.sh"
        bash "$WORK/dotnet-install.sh" --channel 10.0 --runtime dotnet --architecture "$ARCH" --install-dir "$INSTALL_DIR/runtime" --no-path
    fi
fi
"$INSTALL_DIR/copy-gif-host" --version
"$INSTALL_DIR/copy-gif-host" --register "$INSTALL_DIR" "$BROWSERS"
printf '\nOpen chrome://extensions, enable Developer mode, then load: %s/Extension\n' "$INSTALL_DIR"

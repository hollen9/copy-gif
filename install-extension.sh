#!/bin/bash
set -euo pipefail

VERSION=latest
EXTENSION_DIR=
PACKAGE=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --version|--extension-dir|--package)
            [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; exit 1; }
            case "$1" in
                --version) VERSION=$2;; --extension-dir) EXTENSION_DIR=$2;; --package) PACKAGE=$2;;
            esac
            shift 2;;
        --help|-h)
            echo 'Usage: bash install-extension.sh [--extension-dir PATH] [--version latest|VERSION] [--package ARCHIVE]'
            exit 0;;
        *) echo "Unknown option: $1" >&2; exit 1;;
    esac
done

[ "$(id -u)" -ne 0 ] || { echo 'Run as your desktop user, not root.' >&2; exit 1; }
case "$(uname -s)" in
    Darwin) EXTENSION_DIR=${EXTENSION_DIR:-"$HOME/Library/Application Support/Copy GIF/Extension"};;
    Linux) EXTENSION_DIR=${EXTENSION_DIR:-"${XDG_DATA_HOME:-$HOME/.local/share}/copy-gif/Extension"};;
    *) echo 'Use install-extension.ps1 on Windows.' >&2; exit 1;;
esac
case "$EXTENSION_DIR" in /*) ;; *) echo '--extension-dir must be an absolute path.' >&2; exit 1;; esac
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
if [ -z "$PACKAGE" ]; then
    BASE=https://github.com/hollen9/copy-gif/releases
    if [ "$VERSION" = latest ]; then BASE="$BASE/latest/download";
    elif [[ "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then BASE="$BASE/download/v${VERSION#v}";
    else echo 'Version must be latest or a release number such as 1.3.1.' >&2; exit 1; fi
    PACKAGE="$WORK/copy-gif-extension.tar.gz"
    curl -fL --retry 3 "$BASE/copy-gif-extension.tar.gz" -o "$PACKAGE"
    curl -fL --retry 3 "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"
    EXPECTED=$(awk '{ sub(/\r$/, "") } $2 == "copy-gif-extension.tar.gz" { print $1 }' "$WORK/SHA256SUMS")
    if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$PACKAGE" | awk '{print $1}');
    else ACTUAL=$(shasum -a 256 "$PACKAGE" | awk '{print $1}'); fi
    [ -n "$EXPECTED" ] && [ "$ACTUAL" = "$EXPECTED" ] || { echo 'Package checksum mismatch.' >&2; exit 1; }
fi
mkdir -p "$WORK/package"
tar -xzf "$PACKAGE" -C "$WORK/package"
FILES=(manifest.json background.js content.js gif-video.js twitter-context.js diagnostics.html diagnostics.js
    vendor/gifenc.js vendor/gifenc.LICENSE.txt icons/icon16.png icons/icon48.png icons/icon128.png)
for FILE in "${FILES[@]}"; do
    [ -f "$WORK/package/$FILE" ] || { echo "Invalid extension package: missing $FILE" >&2; exit 1; }
done
MANIFEST="$WORK/package/manifest.json"
grep -Eq '"name"[[:space:]]*:[[:space:]]*"Copy GIF"' "$MANIFEST" || { echo 'Invalid Copy GIF extension manifest.' >&2; exit 1; }
grep -Eq '"manifest_version"[[:space:]]*:[[:space:]]*3' "$MANIFEST" || { echo 'Unsupported extension manifest.' >&2; exit 1; }
KEY=$(sed -n 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST")
[ -n "$KEY" ] || { echo 'Missing extension public key.' >&2; exit 1; }
if [ -e "$EXTENSION_DIR" ]; then
    if [ -f "$EXTENSION_DIR/manifest.json" ]; then
        CURRENT_KEY=$(sed -n 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXTENSION_DIR/manifest.json")
        grep -Eq '"name"[[:space:]]*:[[:space:]]*"Copy GIF"' "$EXTENSION_DIR/manifest.json" && [ "$CURRENT_KEY" = "$KEY" ] || {
            echo 'The target contains a different extension.' >&2; exit 1;
        }
    elif [ -n "$(ls -A "$EXTENSION_DIR")" ]; then
        echo 'The target is not an empty folder or an existing Copy GIF extension.' >&2; exit 1
    fi
fi
mkdir -p "$EXTENSION_DIR"
for FILE in "${FILES[@]}"; do
    [ "$FILE" != manifest.json ] || continue
    mkdir -p "$(dirname -- "$EXTENSION_DIR/$FILE")"
    cp "$WORK/package/$FILE" "$EXTENSION_DIR/$FILE"
done
cp "$MANIFEST" "$EXTENSION_DIR/manifest.json"
printf 'Copy GIF extension: %s\n' "$EXTENSION_DIR"
echo 'Open chrome://extensions and load this folder, or reload the existing extension. Refresh open pages.'
echo 'GIF copying also requires the native host from the full installer.'

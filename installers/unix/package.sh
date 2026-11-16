#!/bin/bash
set -euo pipefail
RID=${1:?Usage: package.sh RID OUTPUT_DIR [true|false]}
OUTPUT=${2:?Missing output directory}
FRAMEWORK=${3:-false}
case "$RID" in osx-arm64|osx-x64|linux-arm64|linux-x64) ;; *) echo 'Unsupported runtime identifier.' >&2; exit 1;; esac
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
mkdir -p "$OUTPUT"
OUTPUT=$(CDPATH= cd -- "$OUTPUT" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
SUFFIX=
FLAGS=(--self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true)
if [ "$FRAMEWORK" = true ]; then
    SUFFIX=-framework
    FLAGS=(--self-contained false -p:UseAppHost=false)
fi
dotnet publish "$ROOT/native-host/unix/CopyGif.Host.csproj" -c Release -r "$RID" "${FLAGS[@]}" -o "$WORK/host"
mkdir -p "$WORK/Extension/icons"
for FILE in manifest.json background.js content.js diagnostics.html diagnostics.js; do cp "$ROOT/$FILE" "$WORK/Extension/"; done
cp "$ROOT/icons/"*.png "$WORK/Extension/icons/"
cp "$ROOT/installers/unix/copy-gif-host" "$ROOT/installers/unix/uninstall.sh" "$ROOT/install.sh" "$WORK/"
cp "$ROOT/README.md" "$WORK/README.md"
printf '%s\n' "$RID" > "$WORK/platform.txt"
chmod +x "$WORK/copy-gif-host" "$WORK/uninstall.sh" "$WORK/install.sh"
tar -czf "$OUTPUT/copy-gif-$RID$SUFFIX.tar.gz" -C "$WORK" .

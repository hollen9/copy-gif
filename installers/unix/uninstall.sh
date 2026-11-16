#!/bin/sh
set -eu
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$INSTALL_DIR/copy-gif-host" --unregister "$INSTALL_DIR"
printf 'Browser registrations restored. Remove Copy GIF from your browser, then delete: %s\n' "$INSTALL_DIR"

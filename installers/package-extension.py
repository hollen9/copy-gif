"""Build extension-only archives without native hosts or installer state."""
import argparse
import json
from pathlib import Path
import tarfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
args.output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((root / "manifest.json").read_text())
files = {"manifest.json", "diagnostics.html", "diagnostics.js", "vendor/gifenc.LICENSE.txt"}
files.add(manifest["background"]["service_worker"])
files.update(manifest["icons"].values())
for script in manifest["content_scripts"]:
    files.update(script.get("js", []))
    files.update(script.get("css", []))
with zipfile.ZipFile(args.output / "copy-gif-extension.zip", "w", zipfile.ZIP_DEFLATED) as package:
    for name in sorted(files):
        package.write(root / name, name)
with tarfile.open(args.output / "copy-gif-extension.tar.gz", "w:gz") as package:
    for name in sorted(files):
        package.add(root / name, arcname=name)
print(f"Packaged {len(files)} extension files in {args.output}")

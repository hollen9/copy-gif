"""Check extension-only installation without changing the host or registration."""
import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("package", type=Path)
parser.add_argument("--powershell", default=shutil.which("pwsh") or "powershell")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
archive = args.package.resolve()
windows = os.name == "nt"
if windows:
    command = [args.powershell, "-NoProfile", "-NonInteractive", "-File", str(root / "install-extension.ps1")]
else:
    command = ["bash", str(root / "install-extension.sh")]

def run(package, target, success=True):
    options = ["-Package", str(package), "-ExtensionDirectory", str(target)] if windows else [
        "--package", str(package), "--extension-dir", str(target)]
    result = subprocess.run(command + options, capture_output=True, text=True, errors="replace")
    assert (result.returncode == 0) == success, result.stdout + result.stderr

with tempfile.TemporaryDirectory(prefix="copy-gif-extension-test-") as temporary:
    directory = Path(temporary)
    installation = directory / "Copy GIF's & tests"
    target = installation / "Extension"
    installation.mkdir()
    for name in ("copy-gif-host.exe", "com.copygif.host.json", "registration-backup.json", "runtime/keep"):
        path = installation / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"existing native host state")
    protected = {path: path.read_bytes() for path in installation.rglob("*") if path.is_file()}
    run(archive, target)
    manifest = json.loads((target / "manifest.json").read_text())
    assert manifest["key"] == json.loads((root / "manifest.json").read_text())["key"]
    for script in manifest["content_scripts"]:
        for name in script["js"]:
            assert (target / name).read_bytes() == (root / name).read_bytes()
    assert not (target / "copy-gif-host.exe").exists()
    (target / "notes.txt").write_text("custom file")
    (target / "background.js").write_text("old extension code")
    run(archive, target)
    assert (target / "background.js").read_bytes() == (root / "background.js").read_bytes()
    assert (target / "notes.txt").read_text() == "custom file"

    unrelated = directory / "unrelated"
    unrelated.mkdir()
    (unrelated / "keep.txt").write_text("leave alone")
    run(archive, unrelated, success=False)
    assert list(unrelated.iterdir()) == [unrelated / "keep.txt"]

    other = directory / "other-extension"
    other.mkdir()
    (other / "manifest.json").write_text(json.dumps(dict(manifest, key="different public key")))
    before = (other / "manifest.json").read_bytes()
    run(archive, other, success=False)
    assert (other / "manifest.json").read_bytes() == before
    assert len(list(other.iterdir())) == 1

    incomplete = directory / ("incomplete.zip" if windows else "incomplete.tar.gz")
    data = json.dumps(manifest).encode()
    if windows:
        with zipfile.ZipFile(incomplete, "w") as package:
            package.writestr("manifest.json", data)
    else:
        with tarfile.open(incomplete, "w:gz") as package:
            entry = tarfile.TarInfo("manifest.json")
            entry.size = len(data)
            package.addfile(entry, io.BytesIO(data))
    run(incomplete, target, success=False)
    assert (target / "background.js").read_bytes() == (root / "background.js").read_bytes()
    assert all(path.read_bytes() == data for path, data in protected.items())

print("PASS: install, update, quoted paths, stable ID, unrelated folders, incomplete package, unchanged native host state")

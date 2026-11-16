"""Install, reinstall and unregister in an isolated home directory."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repository=Path(__file__).resolve().parents[1]
archive=Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="copy-gif-install-") as temporary:
    home=Path(temporary)
    install=home/"Copy GIF's & tests"
    config=home/"Library/Application Support" if sys.platform=="darwin" else home/".config"
    chrome=config/("Google/Chrome" if sys.platform=="darwin" else "google-chrome")/"NativeMessagingHosts/com.copygif.host.json"
    chrome.parent.mkdir(parents=True)
    previous='{"name":"previous registration","path":"/previous/host"}'
    chrome.write_text(previous)
    environment=dict(os.environ,HOME=str(home),XDG_CONFIG_HOME=str(config))
    command=["bash",str(repository/"install.sh"),"--package",str(archive),"--install-dir",str(install),"--browser","all","--skip-deps"]
    subprocess.run(command,env=environment,check=True)
    entries=json.loads((install/"registration-backup.json").read_text())
    assert len(entries)==6
    for entry in entries:
        manifest=json.loads(Path(entry["Path"]).read_text())
        assert manifest["path"]==str(install/"copy-gif-host")
        assert manifest["allowed_origins"]==["chrome-extension://pmnfojbhacedcbalilnjofnnnalccmpo/"]
    subprocess.run(command,env=environment,check=True)
    assert json.loads((install/"registration-backup.json").read_text())==entries
    version=subprocess.check_output([str(install/"copy-gif-host"),"--version"],env=dict(environment,PATH="/usr/bin:/bin"))
    assert b"1.2.0" in version
    # A registration replaced by another application must not be removed.
    changed=next(Path(entry["Path"]) for entry in entries if Path(entry["Path"])!=chrome)
    changed.write_text('{"path":"/another/application"}')
    subprocess.run([str(install/"uninstall.sh")],env=environment,check=True)
    assert chrome.read_text()==previous
    assert changed.exists()
    for entry in entries:
        path=Path(entry["Path"])
        if path not in (chrome,changed): assert not path.exists()
print("PASS: six browsers, quoted paths, reinstall backup, GUI-style PATH, uninstall restore, changed registration")

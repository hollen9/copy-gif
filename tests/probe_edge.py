from pathlib import Path
import base64, hashlib, http.server, json, subprocess, threading
root = Path(__file__).resolve().parent
event = threading.Event()
received = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path.startswith('/done?'):
            import urllib.parse
            received.append(json.loads(urllib.parse.unquote(self.path.split('?',1)[1])))
            event.set()
        else:
            event.wait(12)
        self.send_response(200); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
        self.wfile.write(b'')
server = http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
port = server.server_port
probe_root = root/'edge-probe'
probe_root.mkdir(exist_ok=True)
source_manifest = json.loads((root.parent/'manifest.json').read_text(encoding='utf-8-sig'))
manifest = {'manifest_version':3, 'name':'Copy GIF Native Messaging Probe',
            'version':'1.0', 'key':source_manifest['key'],
            'permissions':['nativeMessaging'], 'host_permissions':['http://127.0.0.1/*']}
digest = hashlib.sha256(base64.b64decode(manifest['key'])).digest()[:16]
extension_id = ''.join(chr(97+int(n,16)) for n in digest.hex())
(probe_root/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
(probe_root/'probe.html').write_text(f'<!doctype html><meta charset="utf-8"><title>Native Host Probe</title><pre id="result">pending</pre><script src="probe.js"></script><img src="http://127.0.0.1:{port}/hold">',encoding='utf-8')
(probe_root/'probe.js').write_text("""
const result = document.getElementById('result');
chrome.runtime.sendNativeMessage('com.copygif.host', {action:'ping'}, response => {
  const error = chrome.runtime.lastError;
  const value = error ? {success:false,error:error.message} : response;
  result.textContent = JSON.stringify(value);
  fetch('http://127.0.0.1:PORT/done?'+encodeURIComponent(JSON.stringify(value)));
});
""".replace('PORT',str(port)),encoding='utf-8')
args = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '--headless=new','--no-first-run','--no-default-browser-check',
    '--user-data-dir='+str(root/'edge-probe-profile'),
    '--load-extension='+str(probe_root),
    '--enable-logging=stderr','--vmodule=*native*=2,*launch_context*=2',
    '--timeout=18000','--dump-dom',
    'chrome-extension://'+extension_id+'/probe.html'
]
try:
    p = subprocess.run(args,capture_output=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
    (root/'edge-probe-stderr.log').write_bytes(p.stderr)
    print('Edge exit:',p.returncode)
    print('Native response:',json.dumps(received))
    print(p.stdout.decode(errors='replace')[:1500])
    for line in p.stderr.decode(errors='replace').splitlines():
        if 'copygif' in line.lower() or 'launch_context' in line.lower(): print(line[:1200])
    assert received and received[0].get('success'), 'Edge native ping did not succeed'
finally:
    event.set();server.shutdown();server.server_close()

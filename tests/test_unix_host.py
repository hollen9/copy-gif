"""Protocol and clipboard integration tests. Replaces the desktop clipboard."""
import base64
import ctypes
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
from PIL import Image

host = Path(sys.argv[1]).resolve()
fixture = io.BytesIO()
Image.new("RGB", (8, 8), "red").save(fixture, format="GIF", save_all=True,
    append_images=[Image.new("RGB", (8, 8), "blue")], duration=200, loop=0)
gif = fixture.getvalue()

def packet(value):
    data = json.dumps(value).encode()
    return struct.pack("<I", len(data)) + data

def unpack(data):
    result = []
    while data:
        assert len(data) >= 4
        length = struct.unpack("<I", data[:4])[0]
        assert len(data) >= length + 4
        result.append(json.loads(data[4:4+length]))
        data = data[4+length:]
    return result

def invoke(value):
    process = subprocess.run([host], input=packet(value), capture_output=True, timeout=45)
    response = unpack(process.stdout)
    assert process.returncode == 0 and len(response) == 1, (process.stderr, response)
    return response[0]

assert invoke({"action":"ping"})["success"]
for request in (
    {"action":"unknown"},
    {"action":"copyGif", "url":"file:///etc/passwd"},
    {"action":"copyGif", "url":"https://user:pass@example.com/image.gif"},
    {"action":"copyGif", "data":"%%%"},
    {"action":"copyGif", "data":base64.b64encode(gif[:-1]).decode()},
    {"action":"copyGif", "data":base64.b64encode(b"GIF89a"+bytes(30)).decode()},
):
    assert not invoke(request)["success"], request
process = subprocess.run([host], input=struct.pack("<I",37*1024*1024), capture_output=True, timeout=10)
assert process.returncode == 1 and not unpack(process.stdout)[0]["success"]
process = subprocess.Popen([host], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
wire = packet({"action":"ping"})
for byte in wire:
    process.stdin.write(bytes([byte])); process.stdin.flush()
process.stdin.write(wire); process.stdin.close()
assert len(unpack(process.stdout.read())) == 2
assert process.wait(timeout=10) == 0

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302); self.send_header("Location","/gif"); self.end_headers()
        elif self.path == "/gif":
            self.send_response(200); self.end_headers(); self.wfile.write(gif)
        elif self.path == "/oversize":
            self.send_response(200); self.send_header("Content-Length",str(26*1024*1024)); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

server = http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    url = "http://127.0.0.1:"+str(server.server_port)
    assert not invoke({"action":"copyGif","url":url+"/missing"})["success"]
    assert not invoke({"action":"copyGif","url":url+"/oversize"})["success"]
    copied = invoke({"action":"copyGif","url":url+"/redirect"})
    assert copied["success"], copied
finally:
    server.shutdown();server.server_close()
copied = invoke({"action":"copyGif","data":base64.b64encode(gif).decode()})
assert copied["success"], copied

if sys.platform == "darwin":
    cache = Path.home()/"Library/Caches/CopyGIF"/copied["fileName"]
    ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
    objc = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
    objc.objc_getClass.argtypes=[ctypes.c_char_p];objc.objc_getClass.restype=ctypes.c_void_p
    objc.sel_registerName.argtypes=[ctypes.c_char_p];objc.sel_registerName.restype=ctypes.c_void_p
    send = ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p)(('objc_msgSend',objc))
    send1 = ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p)(('objc_msgSend',objc))
    string = ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_char_p)(('objc_msgSend',objc))
    sel=objc.sel_registerName
    board=send(objc.objc_getClass(b"NSPasteboard"),sel(b"generalPasteboard"))
    def text(value): return string(objc.objc_getClass(b"NSString"),sel(b"stringWithUTF8String:"),value)
    def read_clipboard():
        data=send1(board,sel(b"dataForType:"),text(b"com.compuserve.gif"))
        assert data
        return ctypes.string_at(send(data,sel(b"bytes")),send(data,sel(b"length")))
    uri=send1(board,sel(b"stringForType:"),text(b"public.file-url"))
    from urllib.parse import unquote,urlparse
    assert Path(unquote(urlparse(ctypes.string_at(send(uri,sel(b"UTF8String"))).decode()).path)) == cache
else:
    cache=Path(os.environ.get("XDG_CACHE_HOME",str(Path.home()/".cache")))/"copy-gif"/copied["fileName"]
    def read_clipboard():
        command = ["wl-paste","--type","image/gif"] if os.environ.get("WAYLAND_DISPLAY") else ["xclip","-selection","clipboard","-target","image/gif","-out"]
        return subprocess.check_output(command,timeout=10)

assert cache.read_bytes() == gif
assert hashlib.sha256(read_clipboard()).digest() == hashlib.sha256(gif).digest()
assert read_clipboard() == gif, "Second paste must also work after host exit"
with Image.open(cache) as image: assert image.n_frames == 2
print("PASS: protocol, download, GIF validation, persistent file, two frames, clipboard after exit, repeated paste")

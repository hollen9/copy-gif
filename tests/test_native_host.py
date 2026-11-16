"""Integration tests; writes a small two-frame test GIF to the Windows clipboard."""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import http.server
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
from PIL import Image

HOST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "native-host/windows/publish/copy-gif-host.exe"
fixture = io.BytesIO()
Image.new("RGB", (8, 8), "red").save(fixture, format="GIF", save_all=True,
    append_images=[Image.new("RGB", (8, 8), "blue")], duration=200, loop=0)
GIF = fixture.getvalue()
DATA = base64.b64encode(GIF).decode()
count = 0

def packet(request):
    body = json.dumps(request).encode()
    return struct.pack("<I", len(body)) + body

def responses(raw):
    output = []
    while raw:
        assert len(raw) >= 4, "unframed stdout"
        size = struct.unpack("<I", raw[:4])[0]
        assert len(raw) >= size + 4, "truncated response"
        output.append(json.loads(raw[4:size+4]))
        raw = raw[size+4:]
    return output

def invoke(request):
    proc = subprocess.run([str(HOST)], input=packet(request), capture_output=True, timeout=50,
                          creationflags=subprocess.CREATE_NO_WINDOW)
    result = responses(proc.stdout)
    assert proc.returncode == 0, (proc.returncode, proc.stderr.decode(errors="replace"), result)
    assert len(result) == 1
    return result[0]

def check(label, condition):
    global count
    assert condition, label
    count += 1
    print("PASS", label)

check("ping", invoke({"action": "ping"})["platform"] == "windows-dotnet")
check("unknown action", not invoke({"action": "deleteEverything"})["success"])
check("reject local file URLs", not invoke({"action": "copyGif", "url": "file:///C:/Windows/win.ini"})["success"])
check("reject executable URL schemes", not invoke({"action": "copyGif", "url": "javascript:alert(1)"})["success"])
check("reject non-GIF bytes", not invoke({"action": "copyGif", "data": base64.b64encode(b"<html>GIF89a</html>").decode()})["success"])
check("reject invalid base64", not invoke({"action": "copyGif", "data": "%%%bad%%%"})["success"])
check("reject header-only fake GIF", not invoke({"action": "copyGif", "data": base64.b64encode(b"GIF89a" + b"\x01\x00\x01\x00" + b"\x00"*20).decode()})["success"])
proc = subprocess.run([str(HOST)], input=struct.pack("<I", 37*1024*1024), capture_output=True,
                      timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
check("bound message size", proc.returncode == 1 and not responses(proc.stdout)[0]["success"])
proc = subprocess.Popen([str(HOST)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        creationflags=subprocess.CREATE_NO_WINDOW)
wire = packet({"action": "ping"})
proc.stdin.write(wire[:2]); proc.stdin.flush()
time.sleep(.03)
proc.stdin.write(wire[2:7]); proc.stdin.flush()
time.sleep(.03)
proc.stdin.write(wire[7:] + packet({"action": "ping"})); proc.stdin.close()
raw = proc.stdout.read()
proc.wait(timeout=20)
check("fragmented protocol and multiple requests", len(responses(raw)) == 2 and proc.returncode == 0)

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302); self.send_header("Location", "/animation"); self.end_headers()
        elif self.path == "/animation":
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream"); self.end_headers()
            self.wfile.write(GIF)
        elif self.path == "/too-large":
            self.send_response(200); self.send_header("Content-Length", str(26*1024*1024)); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:" + str(server.server_port)
try:
    check("reject HTTP errors", not invoke({"action": "copyGif", "url": base+"/404"})["success"])
    check("bound download size", not invoke({"action": "copyGif", "url": base+"/too-large"})["success"])
    check("download extensionless GIF with redirect", invoke({"action": "copyGif", "url": base+"/redirect"})["success"])
finally:
    server.shutdown(); server.server_close()
result = invoke({"action": "copyGif", "data": DATA})
check("copy animated GIF", result["success"])
cache = Path.home() / "AppData/Local/CopyGIF/Cache" / result["fileName"]
check("file survives host exit with identical bytes", cache.read_bytes() == GIF)
with Image.open(cache) as image:
    check("both animation frames retained", image.n_frames == 2)

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)
user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.OpenClipboard.restype = wintypes.BOOL
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.GetClipboardData.restype = wintypes.HANDLE
user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
user32.RegisterClipboardFormatW.restype = wintypes.UINT
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalSize.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalSize.restype = ctypes.c_size_t
shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
shell32.DragQueryFileW.restype = wintypes.UINT
for attempt in range(20):
    if user32.OpenClipboard(None): break
    time.sleep(.1)
else: raise AssertionError("clipboard stayed locked")
try:
    drop = user32.GetClipboardData(15)
    check("CF_HDROP persists after host exit", bool(drop) and shell32.DragQueryFileW(drop, 0xffffffff, None, 0) == 1)
    path_buffer = ctypes.create_unicode_buffer(32768)
    shell32.DragQueryFileW(drop, 0, path_buffer, len(path_buffer))
    check("clipboard points at retained .gif", Path(path_buffer.value) == cache)
    for name in ("image/gif", "GIF", "Preferred DropEffect"):
        handle = user32.GetClipboardData(user32.RegisterClipboardFormatW(name))
        check(name+" format exists", bool(handle))
        pointer = kernel32.GlobalLock(handle)
        assert pointer
        try: data = ctypes.string_at(pointer, kernel32.GlobalSize(handle))
        finally: kernel32.GlobalUnlock(handle)
        if name == "Preferred DropEffect":
            check("copy instead of move", struct.unpack("<I", data[:4])[0] == 1)
        else:
            check(name+" raw bytes unchanged", data[:len(GIF)] == GIF)
finally: user32.CloseClipboard()
print(f"{count} checks passed; test animation is now on the clipboard.")

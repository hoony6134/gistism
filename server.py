#!/usr/bin/env python3
"""포토부스 로컬 서버 (Mac / 라즈베리파이 / 개발용).

Windows에서는 server.ps1을 쓴다. 두 서버는 같은 API를 제공한다.

  GET  /api/frames        프레임 목록 {"images": [{"path", "type"}], "folders": [...]}
                          images: frames/normal, frames/character 안의 jpg/png
                          folders: frame.json이 있는 frames/<폴더> (예전 방식)
  POST /api/save?name=..  요청 본문(이미지)을 output/YYYY-MM-DD/<name> 으로 저장
  POST /api/log           요청 본문(JSON 한 줄)을 logs/YYYY-MM-DD.jsonl 에 추가
  GET  /api/printers      프린터 목록 {"printers": [...], "default": "..."}
  POST /api/print?printer=..&copies=..  요청 본문(JPG)을 그 프린터로 바로 인쇄
  GET  그 외              정적 파일
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
IMAGE_TYPES = ("normal", "character")
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def today():
    return datetime.date.today().isoformat()


def list_printers():
    run = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout
    names = run("lpstat", "-e").split()
    m = re.search(r":\s*(\S+)\s*$", run("lpstat", "-d").strip())
    return names, (m.group(1) if m else "")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (str(args[0]) if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def do_GET(self):
        if urlparse(self.path).path == "/api/frames":
            frames_dir = os.path.join(ROOT, "frames")
            images = []
            for kind in IMAGE_TYPES:
                folder = os.path.join(frames_dir, kind)
                if not os.path.isdir(folder):
                    continue
                for n in sorted(os.listdir(folder)):
                    if n.lower().endswith(IMAGE_EXTS) and not n.startswith("."):
                        images.append({"path": f"{kind}/{n}", "type": kind})
            folders = sorted(
                n for n in os.listdir(frames_dir)
                if os.path.isfile(os.path.join(frames_dir, n, "frame.json"))
            )
            return self.send_json({"images": images, "folders": folders})
        if urlparse(self.path).path == "/api/printers":
            names, default = list_printers()
            return self.send_json({"printers": names, "default": default})
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/save":
            name = parse_qs(url.query).get("name", [""])[0]
            if not SAFE_NAME.match(name):
                return self.send_json({"error": "bad name"}, 400)
            folder = os.path.join(ROOT, "output", today())
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, name), "wb") as f:
                f.write(self.read_body())
            return self.send_json({"ok": True})
        if url.path == "/api/log":
            line = self.read_body().decode("utf-8").replace("\n", " ").strip()
            folder = os.path.join(ROOT, "logs")
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, today() + ".jsonl"), "a", encoding="utf-8") as f:
                f.write(line + "\n")
            return self.send_json({"ok": True})
        if url.path == "/api/print":
            q = parse_qs(url.query)
            printer = q.get("printer", [""])[0]
            copies = max(1, min(10, int(q.get("copies", ["1"])[0] or 1)))
            if printer not in list_printers()[0]:
                return self.send_json({"error": "printer not found"}, 400)
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                f.write(self.read_body())
            r = subprocess.run(["lp", "-d", printer, "-n", str(copies), "-o", "fit-to-page", f.name],
                               capture_output=True, text=True)
            os.unlink(f.name)
            if r.returncode != 0:
                return self.send_json({"error": r.stderr.strip() or "print failed"}, 500)
            return self.send_json({"ok": True})
        return self.send_json({"error": "not found"}, 404)


class Server(ThreadingHTTPServer):
    # 기본 server_bind는 컴퓨터 이름을 DNS로 조회(getfqdn)하는데,
    # 네트워크에 따라 이 조회가 멈춰 서버가 안 켜지는 일이 있어 건너뛴다.
    def server_bind(self):
        import socketserver
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


if __name__ == "__main__":
    server = Server(("127.0.0.1", PORT), Handler)
    print(f"포토부스 서버: http://localhost:{PORT}/booth/", file=sys.stderr)
    server.serve_forever()

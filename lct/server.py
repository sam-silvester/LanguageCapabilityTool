"""HTTP server: a small JSON API over the store, plus the static web app. Standard library only."""
from __future__ import annotations

import datetime
import json
import mimetypes
import os
import sys
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, sheets
from .store import Store, StoreError

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_BODY = 30 * 1024 * 1024
TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
         ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon"}


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def make_handler(store: Store, verbose: bool = False):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LCT/" + __version__

        def log_message(self, fmt, *args):
            if verbose:
                super().log_message(fmt, *args)

        # ---------------------------------------------------------------- helpers
        def _send(self, status, body: bytes, ctype: str, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, status=200):
            self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def _body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise HttpError(413, "That file is larger than 30 MB.")
            return self.rfile.read(length) if length else b""

        def _json_body(self) -> dict:
            raw = self._body()
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except ValueError:
                raise HttpError(400, "The request body isn't valid JSON.")
            if not isinstance(data, dict):
                raise HttpError(400, "The request body must be a JSON object.")
            return data

        def _user(self) -> str:
            return urllib.parse.unquote(self.headers.get("X-User") or "").strip()[:80]

        # ---------------------------------------------------------------- routing
        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_PUT(self):
            self._route("PUT")

        def do_DELETE(self):
            self._route("DELETE")

        def _route(self, method):
            parsed = urllib.parse.urlsplit(self.path)
            query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
            try:
                if parsed.path.startswith("/api/"):
                    # A custom header keeps other websites from changing data through the reader's browser.
                    if method != "GET" and self.headers.get("X-Requested-With") != "lct":
                        raise HttpError(403, "Send the header X-Requested-With: lct with every change.")
                    self._api(method, [urllib.parse.unquote(s) for s in parsed.path[5:].split("/") if s], query)
                elif method == "GET":
                    self._static(parsed.path)
                else:
                    raise HttpError(405, "Method not allowed.")
            except HttpError as exc:
                self._json({"error": str(exc)}, exc.status)
            except (StoreError, sheets.SheetError) as exc:
                self._json({"error": str(exc)}, 400)
            except Exception as exc:  # last resort: report it, keep serving
                traceback.print_exc(file=sys.stderr)
                self._json({"error": "Server error: %s" % exc}, 500)

        def _static(self, path):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = os.path.normpath(os.path.join(STATIC, rel))
            if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
                raise HttpError(404, "Not found.")
            ext = os.path.splitext(full)[1].lower()
            ctype = TYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as fh:
                self._send(200, fh.read(), ctype)

        def _api(self, method, seg, q):
            user = self._user()
            route = (method, seg[0] if seg else "", len(seg))
            if route == ("GET", "state", 1):
                return self._json(store.state())
            if route == ("GET", "changes", 1):
                return self._json({"changes": store.changes(min(int(q.get("limit", 300)), 2000), int(q.get("before", 0)))})
            if route == ("GET", "snapshots", 1):
                return self._json({"snapshots": store.snapshots()})
            if route == ("GET", "export", 1):
                return self._export(q)
            if route == ("POST", "capabilities", 1):
                return self._json(store.create_capability(self._json_body(), user))
            if route == ("PUT", "capabilities", 2):
                return self._json(store.update_capability(seg[1], self._json_body(), user, q.get("source", "tool")))
            if route == ("DELETE", "capabilities", 2):
                return self._json(store.delete_capability(seg[1], user))
            if route == ("POST", "paint", 1):
                b = self._json_body()
                return self._json(store.paint(b.get("language"), b.get("content_type"), b.get("side"), b.get("status"), user))
            if route == ("POST", "languages", 1):
                return self._json(store.create_language(self._json_body(), user))
            if route == ("PUT", "languages", 2):
                return self._json(store.update_language(seg[1], self._json_body(), user))
            if route == ("DELETE", "languages", 2):
                return self._json(store.delete_language(seg[1], user))
            if route == ("PUT", "lists", 2):
                return self._json(store.set_list(seg[1], self._json_body().get("items"), user))
            if route == ("PUT", "meta", 1):
                return self._json(store.set_meta(self._json_body(), user))
            if route == ("POST", "undo", 1):
                return self._json(store.undo(self._json_body().get("batch"), user))
            if route == ("POST", "import", 1):
                payload = sheets.parse_upload(q.get("filename", ""), self._body(), q.get("sheet", "capabilities"))
                return self._json(store.import_payload(payload, q.get("strategy", "merge"), user, q.get("apply") == "1"))
            raise HttpError(404, "No such API route.")

        def _export(self, q):
            fmt = q.get("format", "xlsx")
            state = store.state()
            stamp = datetime.date.today().isoformat()
            if fmt == "xlsx":
                body, ctype = sheets.export_xlsx(state), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            elif fmt == "csv":
                entity = "language" if q.get("sheet") == "languages" else "capability"
                body, ctype = sheets.export_csv(state, entity), "text/csv; charset=utf-8"
            elif fmt == "json":
                body, ctype = sheets.export_json(state), "application/json; charset=utf-8"
            else:
                raise HttpError(400, "Format must be xlsx, csv or json.")
            name = "language-capability-%s.%s" % (stamp, fmt)
            self._send(200, body, ctype, {"Content-Disposition": 'attachment; filename="%s"' % name})

    return Handler


def make_server(store: Store, host="127.0.0.1", port=8765, verbose=False) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(store, verbose))
    server.daemon_threads = True
    return server


def serve(db_path: str, host="127.0.0.1", port=8765, sample=True, verbose=False):
    store = Store(db_path, sample=sample)
    server = make_server(store, host, port, verbose)
    shown = "localhost" if host in ("127.0.0.1", "0.0.0.0", "") else host
    print("Language Capability Tool %s" % __version__)
    print("  Data file: %s" % os.path.abspath(db_path))
    print("  Open:      http://%s:%d" % (shown, server.server_address[1]))
    if host == "0.0.0.0":
        print("  Listening on every network interface. There is no sign-in: anyone who can reach this port can edit.")
    print("  Stop with Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()

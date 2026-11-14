"""Command line: run the web app, or import, export and set capability without opening it.

    python -m lct                       start the web app on http://localhost:8765
    python -m lct import workbook.xlsx  bring a spreadsheet in (add --replace to make the tool match it)
    python -m lct export out.xlsx       write the current data to .xlsx, .csv or .json
    python -m lct set ID FIELD VALUE    change one field on one row
    python -m lct paint LANGUAGE CONTENT_TYPE ft|ix STATUS
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from . import __version__, sheets
from .store import Store, StoreError


def default_db() -> str:
    return os.environ.get("LCT_DATA") or os.path.join("data", "lct.db")


def _user(args) -> str:
    if getattr(args, "user", None):
        return args.user
    try:
        return getpass.getuser()
    except Exception:
        return ""


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m lct", description="Language Capability Tool")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--data", default=default_db(), help="path of the data file (default: data/lct.db, or $LCT_DATA)")
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("serve", help="start the web app (the default)")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on; 0.0.0.0 shares it on your network")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT") or 8765))
    p.add_argument("--no-sample", action="store_true", help="start empty instead of with the sample rows")
    p.add_argument("--verbose", action="store_true", help="log every request")

    p = sub.add_parser("import", help="import an .xlsx, .csv or .json file")
    p.add_argument("file")
    p.add_argument("--replace", action="store_true", help="also delete rows that are missing from the file")
    p.add_argument("--sheet", choices=("capabilities", "languages"), default="capabilities", help="what a .csv holds")
    p.add_argument("--dry-run", action="store_true", help="show what would change and keep nothing")
    p.add_argument("--user", help="name recorded in History")

    p = sub.add_parser("export", help="export to .xlsx, .csv or .json (chosen by the file's extension)")
    p.add_argument("file")
    p.add_argument("--sheet", choices=("capabilities", "languages"), default="capabilities", help="what a .csv holds")

    p = sub.add_parser("set", help="change one field on one row")
    p.add_argument("id")
    p.add_argument("field", help="field label or key, for example 'Index status'")
    p.add_argument("value")
    p.add_argument("--user")

    p = sub.add_parser("paint", help="set the status of a heatmap cell")
    p.add_argument("language")
    p.add_argument("content_type")
    p.add_argument("side", choices=("ft", "ix"), help="ft for full text, ix for index")
    p.add_argument("status")
    p.add_argument("--user")

    args = parser.parse_args(argv)
    command = args.command or "serve"
    try:
        if command == "serve":
            from .server import serve
            serve(args.data, getattr(args, "host", "127.0.0.1"), getattr(args, "port", 8765),
                  sample=not getattr(args, "no_sample", False), verbose=getattr(args, "verbose", False))
            return 0
        store = Store(args.data, sample=False)
        if command == "import":
            with open(args.file, "rb") as fh:
                payload = sheets.parse_upload(os.path.basename(args.file), fh.read(), args.sheet)
            report = store.import_payload(payload, "replace" if args.replace else "merge", _user(args), apply=not args.dry_run, source="cli")
            for entity in ("capabilities", "languages"):
                r = report[entity]
                print("%-13s added %d, changed %d, unchanged %d, removed %d" % (entity + ":", r["added"], r["changed"], r["unchanged"], r["removed"]))
            if report["new_fields"]:
                print("new fields:   %s" % ", ".join(f["label"] for f in report["new_fields"]))
            if report["lists"]:
                print("lists set:    %s" % ", ".join(report["lists"]))
            for warning in report["warnings"]:
                print("warning:      %s" % warning)
            print("Nothing was kept (dry run)." if args.dry_run else "Imported.")
        elif command == "export":
            state = store.state()
            ext = args.file.lower().rsplit(".", 1)[-1]
            if ext == "xlsx":
                body = sheets.export_xlsx(state)
            elif ext == "csv":
                body = sheets.export_csv(state, "language" if args.sheet == "languages" else "capability")
            elif ext == "json":
                body = sheets.export_json(state)
            else:
                raise StoreError("Export to a file ending in .xlsx, .csv or .json.")
            with open(args.file, "wb") as fh:
                fh.write(body)
            print("Wrote %s (%d rows, %d languages)." % (args.file, len(state["capabilities"]), len(state["languages"])))
        elif command == "set":
            fields = store.state()["fields"]["capability"]
            wanted = args.field.strip().lower()
            key = next((f["key"] for f in fields if f["key"] == args.field or f["label"].lower() == wanted), None)
            if not key:
                raise StoreError("No field called '%s'." % args.field)
            print(store.update_capability(args.id, {key: args.value}, _user(args), source="cli")["message"])
        elif command == "paint":
            print(store.paint(args.language, args.content_type, args.side, args.status, _user(args), source="cli")["message"])
        return 0
    except (StoreError, sheets.SheetError, OSError) as exc:
        print("Error: %s" % exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

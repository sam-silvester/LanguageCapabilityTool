"""Spreadsheet in and out: .xlsx (needs openpyxl), .csv and .json."""
from __future__ import annotations

import csv
import datetime
import io
import json

from . import schema

# Light-theme status colours by rank, shared with the heatmap.
STATUS_COLOURS = ["7A8699", "A7B0BE", "D5DAE1", "E5484D", "F0883E", "F2C94C", "4F9CE8", "8ED8AE", "2FA66A", "146C43"]
STATUS_TEXT = ["17212B", "17212B", "17212B", "FFFFFF", "17212B", "17212B", "17212B", "17212B", "17212B", "FFFFFF"]


class SheetError(Exception):
    """The file can't be read as capability data."""


def _openpyxl():
    try:
        import openpyxl  # noqa: F401
        return openpyxl
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise SheetError("Excel files need the openpyxl package. Run: pip install openpyxl (CSV and JSON work without it).") from exc


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat() if value.time() == datetime.time(0, 0) else value.isoformat(sep=" ")
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, float) and value == int(value):
        return int(value)
    if isinstance(value, str):
        return value.strip()
    return value


def _table(rows, need=("language",)):
    """Find the header row (the first one naming every column in `need`) and return headers and row dicts."""
    rows = [[_cell(v) for v in row] for row in rows]
    for i, row in enumerate(rows[:25]):
        names = {schema.norm(v) for v in row if isinstance(v, str)}
        if all(n in names for n in need) and sum(1 for v in row if v != "") >= 2:
            headers = [v if isinstance(v, str) else str(v) for v in row]
            out = []
            for raw in rows[i + 1:]:
                item = {h: raw[j] for j, h in enumerate(headers) if h != "" and j < len(raw)}
                if any(v != "" for v in item.values()):
                    out.append(item)
            return {"headers": [h for h in headers if h != ""], "rows": out}
    return None


def _lists_from_rows(rows):
    rows = [[_cell(v) for v in row] for row in rows]
    for i, row in enumerate(rows[:15]):
        names = {schema.norm(v) for v in row if isinstance(v, str)}
        if ("status" in names or "content type" in names) and sum(1 for v in row if v != "") >= 2:
            lists, current = {}, None
            cols = []  # (kind, list name)
            for header in row:
                n = schema.norm(header)
                if header == "":
                    cols.append((None, None))
                elif n in schema.DESCRIPTION_HEADERS or n.endswith(": description"):
                    cols.append(("desc", current))
                else:
                    current = str(header).strip()
                    lists[current] = []
                    cols.append(("name", current))
            for raw in rows[i + 1:]:
                for j, (kind, name) in enumerate(cols):
                    if kind == "name" and j < len(raw) and raw[j] != "":
                        desc = ""
                        if j + 1 < len(cols) and cols[j + 1] == ("desc", name) and j + 1 < len(raw):
                            desc = str(raw[j + 1])
                        lists[name].append({"name": str(raw[j]), "description": desc})
            return {k: v for k, v in lists.items() if v}
    return {}


def _parse_xlsx(raw: bytes) -> dict:
    openpyxl = _openpyxl()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as exc:
        raise SheetError("That file couldn't be opened as an Excel workbook.") from exc
    by_name = {ws.title.strip().lower(): ws for ws in wb.worksheets}
    payload = {"capabilities": None, "languages": None, "lists": {}}
    cap_ws = by_name.get("matrix") or by_name.get("capabilities")
    if cap_ws is not None:
        payload["capabilities"] = _table(cap_ws.iter_rows(values_only=True), need=("language", "content type"))
    if "languages" in by_name:
        payload["languages"] = _table(by_name["languages"].iter_rows(values_only=True))
    if "lists" in by_name:
        payload["lists"] = _lists_from_rows(by_name["lists"].iter_rows(values_only=True))
    if payload["capabilities"] is None and cap_ws is None:
        for ws in wb.worksheets:  # fall back to the first sheet that looks like capability rows
            if ws.title.strip().lower() in ("languages", "lists"):
                continue
            table = _table(ws.iter_rows(values_only=True), need=("language", "content type"))
            if table:
                payload["capabilities"] = table
                break
    if not payload["capabilities"] and not payload["languages"] and not payload["lists"]:
        raise SheetError("No sheet with 'Language' and 'Content type' columns was found. Name the sheet 'Matrix', or export "
                         "a workbook from this tool to see the layout.")
    return payload


def _parse_csv(raw: bytes, sheet: str) -> dict:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = list(csv.reader(io.StringIO(text)))
    languages = sheet == "languages"
    table = _table(rows, need=("language",) if languages else ("language", "content type"))
    if not table:
        raise SheetError("The CSV needs a header row with %s." % ("a 'Language' column" if languages else "'Language' and 'Content type' columns"))
    return {"capabilities": None if languages else table, "languages": table if languages else None, "lists": {}}


def _parse_json(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise SheetError("That file isn't valid JSON.") from exc
    if not isinstance(data, dict) or not ("capabilities" in data or "languages" in data):
        raise SheetError("The JSON needs 'capabilities' or 'languages', as in this tool's JSON export.")

    def table(rows):
        rows = [r for r in rows or [] if isinstance(r, dict)]
        headers = []
        for r in rows:
            for k in r:
                if k not in headers:
                    headers.append(k)
        return {"headers": headers, "rows": rows} if rows else None

    defs = {}
    for entity, fields in (data.get("fields") or {}).items():
        defs[entity] = {f["key"]: f for f in fields if isinstance(f, dict) and f.get("key")}
    return {"capabilities": table(data.get("capabilities")), "languages": table(data.get("languages")),
            "lists": data.get("lists") or {}, "field_defs": defs}


def parse_upload(filename: str, raw: bytes, sheet: str = "capabilities") -> dict:
    ext = (filename or "").lower().rsplit(".", 1)[-1]
    if ext in ("xlsx", "xlsm"):
        return _parse_xlsx(raw)
    if ext == "csv":
        return _parse_csv(raw, sheet)
    if ext == "json":
        return _parse_json(raw)
    raise SheetError("Use an .xlsx, .csv or .json file.")


# ---------------------------------------------------------------------------- export
def export_json(state: dict) -> bytes:
    return json.dumps(state, ensure_ascii=False, indent=2).encode("utf-8")


def export_csv(state: dict, entity: str = "capability") -> bytes:
    fields = state["fields"][entity]
    rows = state["capabilities"] if entity == "capability" else state["languages"]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow([f["label"] for f in fields])
    for row in rows:
        writer.writerow([row.get(f["key"], "") for f in fields])
    return out.getvalue().encode("utf-8-sig")


def export_xlsx(state: dict) -> bytes:
    openpyxl = _openpyxl()
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter as col
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = openpyxl.Workbook()
    head_font, head_fill = Font(name="Arial", size=10, bold=True), PatternFill("solid", start_color="EAECF0", end_color="EAECF0")
    body = Font(name="Arial", size=10)
    lists = state["lists"]
    list_names = list(lists)

    # Lists sheet first, so the dropdowns on the other sheets can point at it.
    wl = wb.active
    wl.title = "Lists"
    list_range, c = {}, 1
    for name in list_names:
        items = lists[name]
        wl.cell(row=1, column=c, value=name).font = head_font
        wl.cell(row=1, column=c).fill = head_fill
        wl.column_dimensions[col(c)].width = max(14, min(40, max([len(i["name"]) for i in items] + [len(name)]) + 2))
        for r, item in enumerate(items, start=2):
            wl.cell(row=r, column=c, value=item["name"]).font = body
        list_range[name] = "Lists!$%s$2:$%s$%d" % (col(c), col(c), max(2, len(items) + 1) + 20)
        if any(i.get("description") for i in items):
            c += 1
            wl.cell(row=1, column=c, value=name + ": description").font = head_font
            wl.cell(row=1, column=c).fill = head_fill
            wl.column_dimensions[col(c)].width = 60
            for r, item in enumerate(items, start=2):
                wl.cell(row=r, column=c, value=item.get("description", "")).font = body
        c += 1
    wl.freeze_panes = "A2"

    statuses = [i["name"] for i in lists.get(schema.STATUS_LIST, [])]

    def sheet(title, fields, rows, freeze):
        ws = wb.create_sheet(title)
        last = max(len(rows) + 1, 2) + 300
        for j, f in enumerate(fields, start=1):
            h = ws.cell(row=1, column=j, value=f["label"])
            h.font, h.fill, h.alignment = head_font, head_fill, Alignment(wrap_text=True, vertical="center")
            width = {"long": 44, "int": 14, "id": 12, "language": 16, "status": 20}.get(f["type"], 18)
            ws.column_dimensions[col(j)].width = width
            lst = f.get("list")
            if f["type"] in ("list", "status") and lst in list_range:
                dv = DataValidation(type="list", formula1=list_range[lst], allow_blank=True)
                dv.showErrorMessage = False
                ws.add_data_validation(dv)
                dv.add("%s2:%s%d" % (col(j), col(j), last))
            if f["type"] == "status":
                rng = "%s2:%s%d" % (col(j), col(j), last)
                for k, name in enumerate(statuses[:len(STATUS_COLOURS)]):
                    fill = PatternFill("solid", start_color=STATUS_COLOURS[k], end_color=STATUS_COLOURS[k])
                    ws.conditional_formatting.add(rng, FormulaRule(
                        formula=['%s2="%s"' % (col(j), name.replace('"', '""'))], fill=fill, font=Font(color=STATUS_TEXT[k])))
            for i, row in enumerate(rows, start=2):
                cell = ws.cell(row=i, column=j, value=row.get(f["key"], "") or None)
                cell.font, cell.alignment = body, Alignment(wrap_text=True, vertical="top")
                if f["type"] == "int" and isinstance(cell.value, int):
                    cell.number_format = "#,##0"
        ws.row_dimensions[1].height = 32
        ws.freeze_panes = freeze
        ws.auto_filter.ref = "A1:%s%d" % (col(len(fields)), max(len(rows) + 1, 2))
        return ws

    sheet("Matrix", state["fields"]["capability"], state["capabilities"], "D2")
    sheet("Languages", state["fields"]["language"], state["languages"], "B2")

    wr = wb.create_sheet("Read me")
    notes = [
        "%s: exported from the Language Capability Tool on %s." % (state["meta"].get("name") or "Capability data", datetime.date.today().isoformat()),
        "",
        "Edit the Matrix sheet, then use Import in the tool to bring the changes back.",
        "Rows are matched by ID. Leave ID empty on a new row and the tool assigns one.",
        "Merge updates matching rows and adds new ones. Replace also deletes rows that are missing from the file.",
        "A new column becomes a new field. Values on the Lists sheet replace the tool's dropdown values.",
        "The order of the Status list is the ranking the heatmap uses, from least to most advanced.",
    ]
    for r, line in enumerate(notes, start=1):
        wr.cell(row=r, column=1, value=line).font = Font(name="Arial", size=10, bold=(r == 1))
    wr.column_dimensions["A"].width = 110
    wb._sheets = [wb["Matrix"], wb["Languages"], wb["Lists"], wb["Read me"]]
    wb.active = 0
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()

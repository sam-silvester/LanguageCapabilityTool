#!/usr/bin/env python3
"""Turn the 2027 "Content To Key" workbook into data/priorities_2027.json.

Usage, from the ace_matrix folder:

    pip install openpyxl
    python3 tools/convert_workbook.py ~/Downloads/Content_To_Key_Sep_2026.xlsx

The first sheet must have these column headings in row 1:
Homeland, Country, Record Type, Natural Groups Count, Priority Band, Notes
"""
import datetime
import json
import pathlib
import sys

EXPECTED = ["Homeland", "Country", "Record Type", "Natural Groups Count", "Priority Band", "Notes"]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    try:
        from openpyxl import load_workbook
    except ImportError:
        print("openpyxl is not installed. Run:  pip install openpyxl")
        return 1

    source = pathlib.Path(sys.argv[1]).expanduser()
    here = pathlib.Path(__file__).resolve().parent.parent
    sheet = load_workbook(source, data_only=True).worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = [str(v).strip() if v is not None else "" for v in next(rows)][: len(EXPECTED)]
    if header != EXPECTED:
        print("The first sheet does not have the expected headings.")
        print("  expected:", EXPECTED)
        print("  found:   ", header)
        return 1

    out = []
    for number, row in enumerate(rows, start=1):
        if all(v is None for v in row):
            continue
        homeland, country, record_type, groups, band, notes = (list(row) + [None] * 6)[:6]
        out.append({
            "id": "K27-%02d" % number,
            "order": number,
            "homeland": str(homeland or "").strip(),
            "country": str(country or "").strip(),
            "record_type": str(record_type or "").strip(),
            "natural_groups": int(groups or 0),
            "priority_band": str(band or "").strip(),
            "notes": str(notes or "").strip(),
        })

    document = {"rows": out, "meta": [
        {"label": "Source", "value": "First sheet of " + source.name},
        {"label": "Copied", "value": datetime.date.today().isoformat()},
    ]}
    target = here / "data" / "priorities_2027.json"
    target.write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")

    known = {r["country"] for r in json.loads((here / "data" / "country_languages.json").read_text(encoding="utf-8"))["rows"]}
    missing = sorted({r["country"] for r in out} - known)
    print("Wrote %d rows, %s natural groups, to %s" % (len(out), format(sum(r["natural_groups"] for r in out), ","), target))
    if missing:
        print("Add these countries to data/country_languages.json, or they show as 'Not set':", ", ".join(missing))
    print("The country counts match list rows by row number, country and record type,")
    print("so rerun the country query if rows were added, removed or reordered.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

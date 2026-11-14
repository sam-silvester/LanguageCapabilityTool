#!/usr/bin/env python3
"""Fill data/source_lists_2027.csv from the engineering source list workbooks.

Usage, from the ace_matrix folder:

    python3 tools/read_source_list_summaries.py "/path/to/2027 Source Lists"

It looks under that folder for files named <name>-by-indexing-status.xlsx, reads only the
small "summary" tab of each one (so a workbook of several hundred MB takes a second or two),
and writes the groups and images for all, unindexed, ACE-indexed and human-indexed into the
row of data/source_lists_2027.csv whose source_list is <name>.

Nothing needs installing: it uses Python's standard library only.
"""
import csv
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
SUFFIX = "-by-indexing-status.xlsx"
# rows of the summary tab, in the order the workbooks write them
ORDER = ["all", "unindexed", "ace_indexed", "human_indexed"]
COUNT_COLUMNS = [kind + "_" + unit for kind in ORDER for unit in ("groups", "images")]


def column_number(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def read_summary(path: pathlib.Path):
    """Return {kind: (groups, images)} from the summary tab, or a text saying why not."""
    with zipfile.ZipFile(path) as z:
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        rel_id = None
        for sheet in workbook.iter(MAIN + "sheet"):
            if (sheet.get("name") or "").strip().lower() == "summary":
                rel_id = sheet.get(REL + "id")
        if rel_id is None:
            return "it has no tab named summary"
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = next((r.get("Target") for r in rels if r.get("Id") == rel_id), None)
        if not target:
            return "its summary tab could not be located"
        member = target.lstrip("/")
        if not member.startswith("xl/"):
            member = "xl/" + member
        sheet = ET.fromstring(z.read(member))

    numbers = {}  # row number -> {column number: value}
    for row_index, row in enumerate(sheet.iter(MAIN + "row"), start=1):
        row_number = int(row.get("r") or row_index)
        for cell_index, cell in enumerate(row.iter(MAIN + "c"), start=1):
            ref = cell.get("r") or ""
            letters = re.match(r"[A-Z]+", ref)
            col = column_number(letters.group(0)) if letters else cell_index
            value = cell.find(MAIN + "v")
            if value is None or cell.get("t") not in (None, "n"):
                continue
            try:
                numbers.setdefault(row_number, {})[col] = int(round(float(value.text)))
            except (TypeError, ValueError):
                pass

    out = {}
    for offset, kind in enumerate(ORDER):
        cells = numbers.get(2 + offset, {})
        if 2 not in cells or 3 not in cells:
            return "its summary tab is not laid out as expected (row %d has no groups and images)" % (2 + offset)
        out[kind] = (cells[2], cells[3])
    for unit in (0, 1):
        if out["all"][unit] != out["unindexed"][unit] + out["ace_indexed"][unit] + out["human_indexed"][unit]:
            return "its summary rows do not add up to the all row, so the layout may have changed"
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    folder = pathlib.Path(sys.argv[1]).expanduser()
    if not folder.is_dir():
        print("Not a folder:", folder)
        return 1
    target = pathlib.Path(__file__).resolve().parent.parent / "data" / "source_lists_2027.csv"
    with target.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        rows = list(reader)
    by_name = {row["source_list"]: row for row in rows}

    workbooks = sorted(folder.rglob("*" + SUFFIX))
    if not workbooks:
        print("No files ending in %s were found under %s" % (SUFFIX, folder))
        return 1
    filled = 0
    for path in workbooks:
        name = path.name[: -len(SUFFIX)]
        try:
            result = read_summary(path)
        except (zipfile.BadZipFile, KeyError, ET.ParseError) as err:
            result = "it could not be opened (%s)" % err
        if isinstance(result, str):
            print("skipped  %-32s %s" % (name, result))
            continue
        row = by_name.get(name)
        if row is None:
            row = {key: "" for key in header}
            row.update({"source_list": name, "workstream": "Index",
                        "note": "New list: add its country and the list rows it covers (plan_rows)"})
            rows.append(row)
            by_name[name] = row
        elif row.get("note", "").startswith("Workbook"):
            row["note"] = ""
        for kind, (groups, images) in result.items():
            row[kind + "_groups"] = groups
            row[kind + "_images"] = images
        filled += 1
        print("read     %-32s unindexed %s groups, %s images" % (name, format(result["unindexed"][0], ","), format(result["unindexed"][1], ",")))

    with target.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    still = [row["source_list"] for row in rows if row.get("unindexed_groups", "") == ""]
    print("\nFilled %d of %d workbooks into %s" % (filled, len(workbooks), target))
    if still:
        print("Still without a summary:", ", ".join(still))
    print("Reload the page in the browser to see the change.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

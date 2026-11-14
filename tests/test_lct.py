"""Unit tests. Standard library only; the Excel test is skipped when openpyxl isn't installed.

    python -m unittest discover -s tests -v
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lct import sheets  # noqa: E402
from lct.server import make_server  # noqa: E402
from lct.store import Store, StoreError  # noqa: E402

try:
    import openpyxl  # noqa: F401
    HAVE_XLSX = True
except ImportError:
    HAVE_XLSX = False


def table(rows):
    headers = []
    for row in rows:
        for key in row:
            if key not in headers:
                headers.append(key)
    return {"headers": headers, "rows": rows}


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "lct.db"), sample=False)

    def tearDown(self):
        self.tmp.cleanup()

    def caps(self):
        return {r["id"]: r for r in self.store.state()["capabilities"]}


class TestRows(StoreCase):
    def test_sample_data_is_flagged(self):
        sample = Store(os.path.join(self.tmp.name, "sample.db"))
        state = sample.state()
        self.assertTrue(state["meta"]["sample"])
        self.assertGreater(len(state["capabilities"]), 10)
        self.assertFalse(self.store.state()["meta"]["sample"])
        self.assertEqual(self.store.state()["capabilities"], [])

    def test_create_fills_defaults_and_adds_language(self):
        res = self.store.create_capability({"language": "Welsh", "content_type": "Land records"}, "ana")
        row = self.caps()["CAP-001"]
        self.assertEqual(row["ft_status"], "Not assessed")
        self.assertEqual(row["ix_status"], "Not assessed")
        self.assertTrue(row["as_of"])
        self.assertIn("Welsh", [l["language"] for l in res["state"]["languages"]])

    def test_create_needs_a_language_and_known_fields(self):
        with self.assertRaises(StoreError):
            self.store.create_capability({"content_type": "Land records"})
        with self.assertRaises(StoreError):
            self.store.create_capability({"language": "Welsh", "no_such_field": "x"})

    def test_update_logs_changes_and_touches_as_of(self):
        self.store.create_capability({"language": "Welsh", "as_of": "2020-01"})
        res = self.store.update_capability("CAP-001", {"ix_status": "Pilot / validation", "est_images": "1,250,000"}, "ana")
        row = self.caps()["CAP-001"]
        self.assertEqual(row["ix_status"], "Pilot / validation")
        self.assertEqual(row["est_images"], 1250000)
        self.assertNotEqual(row["as_of"], "2020-01")
        fields = {c["field"] for c in self.store.changes() if c["batch"] == res["batch"]}
        self.assertEqual(fields, {"ix_status", "est_images", "as_of"})
        self.assertIsNone(self.store.update_capability("CAP-001", {"ix_status": "Pilot / validation"})["batch"])

    def test_undo_reverts_update_delete_and_create(self):
        made = self.store.create_capability({"language": "Welsh", "owner": "Ana"})
        changed = self.store.update_capability("CAP-001", {"owner": "Ben"})
        self.store.undo(changed["batch"])
        self.assertEqual(self.caps()["CAP-001"]["owner"], "Ana")
        gone = self.store.delete_capability("CAP-001")
        self.assertEqual(self.caps(), {})
        self.store.undo(gone["batch"])
        self.assertEqual(self.caps()["CAP-001"]["owner"], "Ana")
        self.store.undo(made["batch"])
        self.assertEqual(self.caps(), {})
        self.assertEqual(self.store.state()["languages"], [])

    def test_paint_creates_then_updates_every_row_in_the_cell(self):
        first = self.store.paint("Welsh", "Land records", "ft", "Pilot / validation")
        self.assertEqual(len(first["state"]["capabilities"]), 1)
        self.store.create_capability({"language": "Welsh", "content_type": "Land records"})
        self.store.paint("Welsh", "Land records", "ix", "Gap (no capability)")
        rows = self.caps().values()
        self.assertEqual({r["ix_status"] for r in rows}, {"Gap (no capability)"})
        self.assertEqual(sorted(r["ft_status"] for r in rows), ["Not assessed", "Pilot / validation"])
        with self.assertRaises(StoreError):
            self.store.paint("Welsh", "Land records", "ft", "Not a status")

    def test_language_rename_cascades_and_delete_is_guarded(self):
        self.store.create_capability({"language": "Welsh"})
        self.store.update_language("Welsh", {"language": "Welsh (Cymraeg)", "code": "cy"})
        self.assertEqual(self.caps()["CAP-001"]["language"], "Welsh (Cymraeg)")
        with self.assertRaises(StoreError):
            self.store.delete_language("Welsh (Cymraeg)")
        self.store.delete_capability("CAP-001")
        self.store.delete_language("Welsh (Cymraeg)")
        self.assertEqual(self.store.state()["languages"], [])

    def test_history_can_be_read_for_one_row(self):
        self.store.create_capability({"language": "Welsh"})
        self.store.create_capability({"language": "Irish"})
        self.store.update_capability("CAP-002", {"owner": "Ana"})
        mine = self.store.changes(entity="capability", entity_id="CAP-002")
        self.assertEqual({c["entity_id"] for c in mine}, {"CAP-002"})
        self.assertEqual([c["action"] for c in mine], ["update", "create"])
        self.assertGreater(len(self.store.changes()), len(mine))

    def test_lists_and_snapshots(self):
        self.store.set_list("Priority", [{"name": "Now"}, "Later", "", "Now"])
        self.assertEqual([i["name"] for i in self.store.state()["lists"]["Priority"]], ["Now", "Later"])
        with self.assertRaises(StoreError):
            self.store.set_list("Status", [])
        self.store.create_capability({"language": "Welsh", "ft_status": "Production (at scale)"})
        snap = self.store.snapshots()[-1]
        self.assertEqual(snap["rows"], 1)
        self.assertEqual(snap["ft"], {"Production (at scale)": 1})


class TestImport(StoreCase):
    ROWS = [
        {"ID": "X-001", "Language": "Welsh", "Content type": "Land records", "Full-text status": "Pilot / validation", "Est. images": "12,000"},
        {"ID": "X-002", "Language": "Irish", "Content type": "Census & population registers", "Index status": "Gap (no capability)"},
    ]

    def test_preview_keeps_nothing_and_apply_does(self):
        payload = {"capabilities": table(self.ROWS)}
        preview = self.store.import_payload(payload, "merge", "ana", apply=False)
        self.assertEqual(preview["capabilities"]["added"], 2)
        self.assertEqual(self.caps(), {})
        done = self.store.import_payload(payload, "merge", "ana", apply=True)
        self.assertEqual(set(self.caps()), {"X-001", "X-002"})
        self.assertEqual(self.caps()["X-001"]["est_images"], 12000)
        self.assertEqual({l["language"] for l in done["state"]["languages"]}, {"Welsh", "Irish"})
        again = self.store.import_payload(payload, "merge", "ana", apply=False)
        self.assertEqual(again["capabilities"]["unchanged"], 2)

    def test_merge_updates_and_replace_deletes(self):
        self.store.import_payload({"capabilities": table(self.ROWS)}, "merge", apply=True)
        edited = [dict(self.ROWS[0], **{"Full-text status": "Production (partial)"}), {"Language": "Manx", "Content type": "Land records"}]
        merged = self.store.import_payload({"capabilities": table(edited)}, "merge", apply=True)
        self.assertEqual((merged["capabilities"]["changed"], merged["capabilities"]["added"], merged["capabilities"]["removed"]), (1, 1, 0))
        self.assertEqual(len(self.caps()), 3)
        replaced = self.store.import_payload({"capabilities": table(edited[:1])}, "replace", apply=True)
        self.assertEqual(replaced["capabilities"]["removed"], 2)
        self.assertEqual(set(self.caps()), {"X-001"})
        self.assertEqual(self.store.state()["meta"]["id_prefix"], "X-")
        self.store.undo(replaced["batch"])
        self.assertEqual(len(self.caps()), 3)

    def test_new_columns_become_fields_and_unknown_statuses_warn(self):
        rows = [dict(self.ROWS[0], **{"Reviewer": "Ana", "Pages (2025)": 40, "Full-text status": "Nearly there"})]
        report = self.store.import_payload({"capabilities": table(rows)}, "merge", apply=True)
        self.assertEqual([f["label"] for f in report["new_fields"]], ["Reviewer", "Pages (2025)"])
        fields = {f["label"]: f for f in self.store.state()["fields"]["capability"]}
        self.assertEqual(fields["Pages (2025)"]["type"], "int")
        self.assertEqual(self.caps()["X-001"]["reviewer"], "Ana")
        self.assertTrue(any("Nearly there" in w for w in report["warnings"]))

    def test_csv_and_json_round_trip(self):
        self.store.import_payload({"capabilities": table(self.ROWS)}, "merge", apply=True)
        state = self.store.state()
        for name, body in (("out.csv", sheets.export_csv(state)), ("out.json", sheets.export_json(state))):
            report = self.store.import_payload(sheets.parse_upload(name, body), "replace", apply=False)
            self.assertEqual((report["capabilities"]["unchanged"], report["capabilities"]["changed"], report["capabilities"]["removed"]), (2, 0, 0), name)

    @unittest.skipUnless(HAVE_XLSX, "openpyxl not installed")
    def test_xlsx_round_trip_and_title_rows(self):
        self.store.import_payload({"capabilities": table(self.ROWS)}, "merge", apply=True)
        body = sheets.export_xlsx(self.store.state())
        report = self.store.import_payload(sheets.parse_upload("out.xlsx", body), "replace", apply=False)
        self.assertEqual((report["capabilities"]["unchanged"], report["languages"]["unchanged"]), (2, 2))
        self.assertEqual((report["lists"], report["new_fields"]), ([], []))
        # a workbook with title rows above the header, like a hand-built one
        import io
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Matrix"
        ws.append(["My capability matrix"])
        ws.append([])
        ws.append(["ID", "Language", "Content type", "Index status"])
        ws.append(["X-009", "Scots", "Land records", "In development"])
        out = io.BytesIO()
        wb.save(out)
        parsed = sheets.parse_upload("hand.xlsx", out.getvalue())
        self.assertEqual(parsed["capabilities"]["rows"][0]["Language"], "Scots")

    def test_bad_files_are_refused(self):
        with self.assertRaises(sheets.SheetError):
            sheets.parse_upload("notes.txt", b"hello")
        with self.assertRaises(sheets.SheetError):
            sheets.parse_upload("rows.csv", b"a,b\n1,2\n")


class TestApi(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "lct.db"), sample=False)
        self.server = make_server(self.store, "127.0.0.1", 0)
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        for key, value in dict({"X-Requested-With": "lct", "X-User": "ana"}, **(headers or {})).items():
            if value is not None:
                req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, res.read(), res.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    def test_pages_and_state(self):
        status, body, headers = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Language Capability Tool", body)
        self.assertEqual(self.call("GET", "/js/main.js")[0], 200)
        self.assertEqual(self.call("GET", "/../store.py")[0], 404)
        status, body, _ = self.call("GET", "/api/state")
        self.assertEqual(json.loads(body)["capabilities"], [])

    def test_changes_need_the_header(self):
        status, body, _ = self.call("POST", "/api/capabilities", {"language": "Welsh"}, {"X-Requested-With": None})
        self.assertEqual(status, 403)
        status, body, _ = self.call("POST", "/api/capabilities", {"language": "Welsh"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["state"]["capabilities"][0]["_updated_by"], "ana")

    def test_edit_paint_undo_and_errors(self):
        self.call("POST", "/api/capabilities", {"language": "Welsh", "content_type": "Land records"})
        status, body, _ = self.call("PUT", "/api/capabilities/CAP-001", {"owner": "Ana"})
        self.assertEqual(json.loads(body)["state"]["capabilities"][0]["owner"], "Ana")
        status, body, _ = self.call("POST", "/api/paint", {"language": "Welsh", "content_type": "Land records", "side": "ix", "status": "In development"})
        batch = json.loads(body)["batch"]
        status, body, _ = self.call("POST", "/api/undo", {"batch": batch})
        self.assertEqual(json.loads(body)["state"]["capabilities"][0]["ix_status"], "Not assessed")
        status, body, _ = self.call("PUT", "/api/capabilities/NOPE", {"owner": "Ana"})
        self.assertEqual(status, 400)
        self.assertIn("NOPE", json.loads(body)["error"])
        self.assertEqual(self.call("GET", "/api/nothing")[0], 404)

    def test_import_and_export_over_http(self):
        csv_body = "ID,Language,Content type,Index status\r\nX-1,Welsh,Land records,Pilot / validation\r\n".encode()
        status, body, _ = self.call("POST", "/api/import?filename=rows.csv&strategy=merge", raw=csv_body)
        self.assertEqual(json.loads(body)["capabilities"]["added"], 1)
        self.assertEqual(json.loads(self.call("GET", "/api/state")[1])["capabilities"], [])
        status, body, _ = self.call("POST", "/api/import?filename=rows.csv&strategy=merge&apply=1", raw=csv_body)
        self.assertEqual(len(json.loads(body)["state"]["capabilities"]), 1)
        status, body, headers = self.call("GET", "/api/export?format=csv")
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn(b"X-1", body)
        status, body, _ = self.call("GET", "/api/changes")
        self.assertTrue(json.loads(body)["changes"])
        status, body, _ = self.call("GET", "/api/changes?entity=capability&entity_id=X-1")
        self.assertEqual({c["entity_id"] for c in json.loads(body)["changes"]}, {"X-1"})
        self.assertEqual(self.call("GET", "/api/export?format=pdf")[0], 400)


if __name__ == "__main__":
    unittest.main()

"""SQLite store: capability rows, languages, lists, change log, undo and import.

Every write goes through one transaction and records what changed, so any action,
including a whole spreadsheet import, can be reviewed in History and reverted.
"""
from __future__ import annotations

import contextlib
import datetime
import json
import os
import re
import sqlite3
import threading
import uuid

from . import schema

DDL = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS fields(entity TEXT, key TEXT, label TEXT, type TEXT, list TEXT, grp TEXT, pos INTEGER,
                                  core INTEGER DEFAULT 0, PRIMARY KEY(entity, key));
CREATE TABLE IF NOT EXISTS lists(name TEXT PRIMARY KEY, pos INTEGER, items TEXT);
CREATE TABLE IF NOT EXISTS capabilities(id TEXT PRIMARY KEY, pos INTEGER, data TEXT, updated_at TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS languages(name TEXT PRIMARY KEY, pos INTEGER, data TEXT, updated_at TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, user TEXT, source TEXT, batch TEXT,
                                   entity TEXT, entity_id TEXT, action TEXT, field TEXT, old TEXT, new TEXT);
CREATE INDEX IF NOT EXISTS changes_batch ON changes(batch);
CREATE TABLE IF NOT EXISTS snapshots(day TEXT PRIMARY KEY, data TEXT);
"""


class StoreError(Exception):
    """A problem the caller can fix: bad input, unknown row, and so on."""


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def this_month() -> str:
    return datetime.date.today().strftime("%Y-%m")


def to_int(value):
    """Whole number from a spreadsheet or form value; anything else is kept as typed."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value == int(value) else value
    text = str(value).strip().replace(",", "").replace("\u00a0", "").replace(" ", "")
    if re.fullmatch(r"-?\d+(\.0+)?", text):
        return int(float(text))
    return str(value).strip()


def clean_value(ftype, value):
    if value is None:
        return ""
    if ftype == "int":
        return "" if str(value).strip() == "" else to_int(value)
    if isinstance(value, float) and value == int(value):
        value = int(value)
    return str(value).strip()


def clean_items(items):
    """List items as [{name, description}] with blanks and duplicates removed."""
    out, seen = [], set()
    for item in items or []:
        if isinstance(item, dict):
            name, desc = str(item.get("name") or "").strip(), str(item.get("description") or "").strip()
        else:
            name, desc = str(item or "").strip(), ""
        if name and name not in seen:
            seen.add(name)
            out.append({"name": name, "description": desc})
    return out


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _text(value) -> str:
    return "" if value is None else str(value)


class Store:
    def __init__(self, path: str, sample: bool = True):
        self.path = path
        self.lock = threading.RLock()
        folder = os.path.dirname(os.path.abspath(path))
        os.makedirs(folder, exist_ok=True)
        with self._tx() as c:
            c.executescript(DDL)
            if not c.execute("SELECT 1 FROM meta WHERE key='initialised'").fetchone():
                self._seed_schema(c)
                if sample:
                    from .sample import load_sample
                    load_sample(self, c)
                self._snapshot(c)

    # ------------------------------------------------------------------ plumbing
    @contextlib.contextmanager
    def _tx(self, commit: bool = True):
        with self.lock:
            c = sqlite3.connect(self.path, timeout=30)
            c.row_factory = sqlite3.Row
            try:
                yield c
                if commit:
                    c.commit()
                else:
                    c.rollback()
            except Exception:
                c.rollback()
                raise
            finally:
                c.close()

    def _seed_schema(self, c):
        for entity, rows in (("capability", schema.CAP_FIELDS), ("language", schema.LANG_FIELDS)):
            for pos, (key, label, group, ftype, lst) in enumerate(rows):
                c.execute("INSERT INTO fields(entity,key,label,type,list,grp,pos,core) VALUES(?,?,?,?,?,?,?,1)",
                          (entity, key, label, ftype, lst, group, pos))
        for pos, (name, items) in enumerate(schema.DEFAULT_LISTS):
            c.execute("INSERT INTO lists(name,pos,items) VALUES(?,?,?)", (name, pos, _dumps(items)))
        for key, value in (("initialised", "1"), ("name", "Language capability"), ("id_prefix", "CAP-"), ("sample", "0")):
            c.execute("INSERT INTO meta(key,value) VALUES(?,?)", (key, value))

    def _meta(self, c) -> dict:
        return {r["key"]: r["value"] for r in c.execute("SELECT key,value FROM meta")}

    def _set_meta(self, c, key, value, batch=None, user="", source=""):
        old = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        old_value = old["value"] if old else ""
        if old_value == value:
            return
        c.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        if batch:
            self._log(c, batch, user, source, "meta", key, "update", key, old_value, value)

    def _fields(self, c, entity) -> list:
        return [{"key": r["key"], "label": r["label"], "group": r["grp"], "type": r["type"], "list": r["list"],
                 "core": bool(r["core"])}
                for r in c.execute("SELECT * FROM fields WHERE entity=? ORDER BY pos", (entity,))]

    def _lists(self, c) -> dict:
        return {r["name"]: json.loads(r["items"]) for r in c.execute("SELECT name,items FROM lists ORDER BY pos")}

    def _statuses(self, c) -> list:
        return [i["name"] for i in self._lists(c).get(schema.STATUS_LIST, [])]

    def _caps(self, c) -> list:
        out = []
        for r in c.execute("SELECT * FROM capabilities ORDER BY pos, id"):
            row = json.loads(r["data"])
            row.update(id=r["id"], _updated_at=r["updated_at"], _updated_by=r["updated_by"])
            out.append(row)
        return out

    def _langs(self, c) -> list:
        out = []
        for r in c.execute("SELECT * FROM languages ORDER BY pos, name"):
            row = json.loads(r["data"])
            row.update(language=r["name"], _updated_at=r["updated_at"], _updated_by=r["updated_by"])
            out.append(row)
        return out

    def _log(self, c, batch, user, source, entity, entity_id, action, field, old, new):
        c.execute("INSERT INTO changes(ts,user,source,batch,entity,entity_id,action,field,old,new) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (now_iso(), user or "", source or "", batch, entity, entity_id, action, field or "", _text(old), _text(new)))

    def _state(self, c) -> dict:
        meta = self._meta(c)
        return {
            "meta": {"name": meta.get("name", ""), "id_prefix": meta.get("id_prefix", "CAP-"),
                     "sample": meta.get("sample") == "1"},
            "fields": {"capability": self._fields(c, "capability"), "language": self._fields(c, "language")},
            "lists": self._lists(c),
            "capabilities": self._caps(c),
            "languages": self._langs(c),
        }

    def _snapshot(self, c):
        """Today's status counts, kept one per day so History can chart progress."""
        caps = self._caps(c)
        ft, ix = {}, {}
        for row in caps:
            ft[row.get("ft_status") or ""] = ft.get(row.get("ft_status") or "", 0) + 1
            ix[row.get("ix_status") or ""] = ix.get(row.get("ix_status") or "", 0) + 1
        data = {"rows": len(caps), "languages": len({r.get("language") for r in caps}), "ft": ft, "ix": ix}
        c.execute("INSERT INTO snapshots(day,data) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET data=excluded.data",
                  (datetime.date.today().isoformat(), _dumps(data)))

    @staticmethod
    def _batch() -> str:
        return uuid.uuid4().hex[:12]

    # ------------------------------------------------------------------ reads
    def state(self) -> dict:
        with self._tx(commit=False) as c:
            return self._state(c)

    def changes(self, limit: int = 300, before: int = 0, entity: str = "", entity_id: str = "") -> list:
        """Newest changes first. Pass entity and entity_id for the history of one row or one language."""
        where, args = [], []
        if before:
            where.append("id < ?")
            args.append(before)
        if entity and entity_id:
            where.append("entity = ? AND entity_id = ?")
            args += [entity, entity_id]
        sql = "SELECT * FROM changes" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC LIMIT ?"
        with self._tx(commit=False) as c:
            return [dict(r) for r in c.execute(sql, args + [limit])]

    def snapshots(self) -> list:
        with self._tx(commit=False) as c:
            return [dict(json.loads(r["data"]), day=r["day"]) for r in c.execute("SELECT * FROM snapshots ORDER BY day")]

    # ------------------------------------------------------------------ capability rows
    def _field_map(self, c, entity) -> dict:
        return {f["key"]: f for f in self._fields(c, entity)}

    def _clean_patch(self, c, entity, patch) -> dict:
        fields = self._field_map(c, entity)
        out = {}
        for key, value in (patch or {}).items():
            if key.startswith("_"):
                continue
            if key not in fields:
                raise StoreError("Unknown field: %s" % key)
            out[key] = clean_value(fields[key]["type"], value)
        return out

    def _next_id(self, c) -> str:
        prefix = self._meta(c).get("id_prefix") or "CAP-"
        top = 0
        for r in c.execute("SELECT id FROM capabilities"):
            m = re.fullmatch(re.escape(prefix) + r"(\d+)", r["id"])
            if m:
                top = max(top, int(m.group(1)))
        return "%s%03d" % (prefix, top + 1)

    def _get_cap(self, c, cap_id):
        r = c.execute("SELECT * FROM capabilities WHERE id=?", (cap_id,)).fetchone()
        if not r:
            return None
        row = json.loads(r["data"])
        row["id"] = r["id"]
        return row

    def _put_cap(self, c, row, user, pos=None):
        data = {k: v for k, v in row.items() if k != "id" and not k.startswith("_") and v not in ("", None)}
        if c.execute("SELECT 1 FROM capabilities WHERE id=?", (row["id"],)).fetchone():
            c.execute("UPDATE capabilities SET data=?, updated_at=?, updated_by=? WHERE id=?",
                      (_dumps(data), now_iso(), user or "", row["id"]))
        else:
            if pos is None:
                pos = (c.execute("SELECT COALESCE(MAX(pos),0) m FROM capabilities").fetchone()["m"] or 0) + 1
            c.execute("INSERT INTO capabilities(id,pos,data,updated_at,updated_by) VALUES(?,?,?,?,?)",
                      (row["id"], pos, _dumps(data), now_iso(), user or ""))

    def _ensure_language(self, c, name, script, batch, user, source):
        if not name or c.execute("SELECT 1 FROM languages WHERE name=?", (name,)).fetchone():
            return
        pos = (c.execute("SELECT COALESCE(MAX(pos),0) m FROM languages").fetchone()["m"] or 0) + 1
        data = {"script": script} if script else {}
        c.execute("INSERT INTO languages(name,pos,data,updated_at,updated_by) VALUES(?,?,?,?,?)",
                  (name, pos, _dumps(data), now_iso(), user or ""))
        self._log(c, batch, user, source, "language", name, "create", "", "", _dumps(dict(data, language=name)))

    def _ensure_list_value(self, c, list_name, value, batch, user, source):
        if not value:
            return
        lists = self._lists(c)
        if list_name not in lists or any(i["name"] == value for i in lists[list_name]):
            return
        self._set_list(c, list_name, lists[list_name] + [{"name": value, "description": ""}], batch, user, source)

    def _create_cap(self, c, data, batch, user, source) -> dict:
        row = dict(data)
        if not row.get("language"):
            raise StoreError("A row needs a language.")
        statuses = self._statuses(c)
        default_status = schema.NOT_ASSESSED if schema.NOT_ASSESSED in statuses else ""
        if not row.get("content_type"):
            row["content_type"] = "Not yet scoped"
        for key in ("ft_status", "ix_status"):
            if not row.get(key):
                row[key] = default_status
        if not row.get("as_of"):
            row["as_of"] = this_month()
        lang = c.execute("SELECT data FROM languages WHERE name=?", (row["language"],)).fetchone()
        if not row.get("script") and lang:
            row["script"] = json.loads(lang["data"]).get("script", "")
        cap_id = str(row.get("id") or "").strip()
        if cap_id and self._get_cap(c, cap_id):
            raise StoreError("ID %s is already in use." % cap_id)
        row["id"] = cap_id or self._next_id(c)
        self._ensure_language(c, row["language"], row.get("script"), batch, user, source)
        self._ensure_list_value(c, schema.CONTENT_TYPE_LIST, row["content_type"], batch, user, source)
        self._put_cap(c, row, user)
        stored = self._get_cap(c, row["id"])
        self._log(c, batch, user, source, "capability", row["id"], "create", "", "", _dumps(stored))
        return stored

    def _update_cap(self, c, cap_id, patch, batch, user, source, touch_as_of=True) -> list:
        row = self._get_cap(c, cap_id)
        if not row:
            raise StoreError("No row with ID %s." % cap_id)
        changed = []
        for key, value in patch.items():
            if key == "id":
                continue
            old = row.get(key, "")
            if _text(old) == _text(value):
                continue
            if key == "language" and not value:
                raise StoreError("A row needs a language.")
            row[key] = value
            changed.append({"field": key, "old": old, "new": value})
            self._log(c, batch, user, source, "capability", cap_id, "update", key, old, value)
        keys = {ch["field"] for ch in changed}
        if touch_as_of and keys & {"ft_status", "ix_status"} and "as_of" not in patch and row.get("as_of") != this_month():
            self._log(c, batch, user, source, "capability", cap_id, "update", "as_of", row.get("as_of", ""), this_month())
            row["as_of"] = this_month()
        if changed:
            if "language" in keys:
                self._ensure_language(c, row["language"], row.get("script"), batch, user, source)
            if "content_type" in keys:
                self._ensure_list_value(c, schema.CONTENT_TYPE_LIST, row.get("content_type"), batch, user, source)
            self._put_cap(c, row, user)
        return changed

    def _delete_cap(self, c, cap_id, batch, user, source):
        row = self._get_cap(c, cap_id)
        if not row:
            raise StoreError("No row with ID %s." % cap_id)
        c.execute("DELETE FROM capabilities WHERE id=?", (cap_id,))
        self._log(c, batch, user, source, "capability", cap_id, "delete", "", _dumps(row), "")

    def _done(self, c, batch, message) -> dict:
        self._snapshot(c)
        return {"state": self._state(c), "batch": batch, "message": message}

    def create_capability(self, data, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            row = self._create_cap(c, self._clean_patch(c, "capability", data), batch, user, source)
            return self._done(c, batch, "Added %s: %s / %s" % (row["id"], row["language"], row.get("content_type", "")))

    def update_capability(self, cap_id, patch, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            changed = self._update_cap(c, cap_id, self._clean_patch(c, "capability", patch), batch, user, source)
            labels = {f["key"]: f["label"] for f in self._fields(c, "capability")}
            if not changed:
                return {"state": self._state(c), "batch": None, "message": "No change."}
            if len(changed) == 1:
                ch = changed[0]
                message = "%s: %s set to %s" % (cap_id, labels.get(ch["field"], ch["field"]), ch["new"] if ch["new"] != "" else "blank")
            else:
                message = "%s: %d fields updated" % (cap_id, len(changed))
            return self._done(c, batch, message)

    def delete_capability(self, cap_id, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            self._delete_cap(c, cap_id, batch, user, source)
            return self._done(c, batch, "Deleted %s" % cap_id)

    def paint(self, language, content_type, side, status, user="", source="paint") -> dict:
        """Set the full-text or index status of a heatmap cell: every row in it, or a new row if it has none."""
        if side not in ("ft", "ix"):
            raise StoreError("Side must be 'ft' or 'ix'.")
        with self._tx() as c:
            if status not in self._statuses(c):
                raise StoreError("Unknown status: %s" % status)
            if not language or not content_type:
                raise StoreError("Paint needs a language and a content type.")
            key = side + "_status"
            label = "Full text" if side == "ft" else "Index"
            batch = self._batch()
            rows = [r for r in self._caps(c) if r.get("language") == language and r.get("content_type") == content_type]
            if not rows:
                row = self._create_cap(c, {"language": language, "content_type": content_type, key: status}, batch, user, source)
                return self._done(c, batch, "%s / %s: new row %s, %s set to %s" % (language, content_type, row["id"], label, status))
            touched = sum(1 for r in rows if self._update_cap(c, r["id"], {key: status}, batch, user, source))
            if not touched:
                return {"state": self._state(c), "batch": None, "message": "Already %s." % status}
            where = "%d rows" % touched if touched > 1 else rows[0]["id"]
            return self._done(c, batch, "%s / %s: %s set to %s (%s)" % (language, content_type, label, status, where))

    # ------------------------------------------------------------------ languages
    def _get_lang(self, c, name):
        r = c.execute("SELECT * FROM languages WHERE name=?", (name,)).fetchone()
        if not r:
            return None
        row = json.loads(r["data"])
        row["language"] = r["name"]
        return row

    def _put_lang(self, c, row, user, pos=None):
        data = {k: v for k, v in row.items() if k != "language" and not k.startswith("_") and v not in ("", None)}
        if c.execute("SELECT 1 FROM languages WHERE name=?", (row["language"],)).fetchone():
            c.execute("UPDATE languages SET data=?, updated_at=?, updated_by=? WHERE name=?",
                      (_dumps(data), now_iso(), user or "", row["language"]))
        else:
            if pos is None:
                pos = (c.execute("SELECT COALESCE(MAX(pos),0) m FROM languages").fetchone()["m"] or 0) + 1
            c.execute("INSERT INTO languages(name,pos,data,updated_at,updated_by) VALUES(?,?,?,?,?)",
                      (row["language"], pos, _dumps(data), now_iso(), user or ""))

    def _create_lang(self, c, data, batch, user, source) -> dict:
        name = str(data.get("language") or "").strip()
        if not name:
            raise StoreError("A language needs a name.")
        if self._get_lang(c, name):
            raise StoreError("%s is already in the list." % name)
        self._put_lang(c, dict(data, language=name), user)
        stored = self._get_lang(c, name)
        self._log(c, batch, user, source, "language", name, "create", "", "", _dumps(stored))
        return stored

    def _rename_lang(self, c, old, new, user):
        if self._get_lang(c, new):
            raise StoreError("%s is already in the list." % new)
        c.execute("UPDATE languages SET name=? WHERE name=?", (new, old))
        for r in c.execute("SELECT id, data FROM capabilities").fetchall():
            data = json.loads(r["data"])
            if data.get("language") == old:
                data["language"] = new
                c.execute("UPDATE capabilities SET data=?, updated_at=?, updated_by=? WHERE id=?",
                          (_dumps(data), now_iso(), user or "", r["id"]))

    def _update_lang(self, c, name, patch, batch, user, source) -> list:
        row = self._get_lang(c, name)
        if not row:
            raise StoreError("No language called %s." % name)
        changed = []
        new_name = str(patch.get("language") or name).strip()
        if new_name != name:
            self._rename_lang(c, name, new_name, user)
            self._log(c, batch, user, source, "language", new_name, "update", "language", name, new_name)
            changed.append({"field": "language", "old": name, "new": new_name})
            row["language"] = name = new_name
        for key, value in patch.items():
            if key == "language":
                continue
            old = row.get(key, "")
            if _text(old) == _text(value):
                continue
            row[key] = value
            changed.append({"field": key, "old": old, "new": value})
            self._log(c, batch, user, source, "language", name, "update", key, old, value)
        if changed:
            self._put_lang(c, row, user)
        return changed

    def _delete_lang(self, c, name, batch, user, source):
        row = self._get_lang(c, name)
        if not row:
            raise StoreError("No language called %s." % name)
        used = sum(1 for r in self._caps(c) if r.get("language") == name)
        if used:
            raise StoreError("%s still has %d row%s. Move or delete them first." % (name, used, "" if used == 1 else "s"))
        c.execute("DELETE FROM languages WHERE name=?", (name,))
        self._log(c, batch, user, source, "language", name, "delete", "", _dumps(row), "")

    def create_language(self, data, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            row = self._create_lang(c, self._clean_patch(c, "language", data), batch, user, source)
            return self._done(c, batch, "Added language %s" % row["language"])

    def update_language(self, name, patch, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            changed = self._update_lang(c, name, self._clean_patch(c, "language", patch), batch, user, source)
            if not changed:
                return {"state": self._state(c), "batch": None, "message": "No change."}
            return self._done(c, batch, "%s updated" % (patch.get("language") or name))

    def delete_language(self, name, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            self._delete_lang(c, name, batch, user, source)
            return self._done(c, batch, "Deleted language %s" % name)

    # ------------------------------------------------------------------ lists and settings
    def _set_list(self, c, name, items, batch, user, source):
        items = clean_items(items)
        old = c.execute("SELECT items FROM lists WHERE name=?", (name,)).fetchone()
        if old:
            if json.loads(old["items"]) == items:
                return False
            c.execute("UPDATE lists SET items=? WHERE name=?", (_dumps(items), name))
            self._log(c, batch, user, source, "list", name, "update", "", old["items"], _dumps(items))
        else:
            pos = (c.execute("SELECT COALESCE(MAX(pos),0) m FROM lists").fetchone()["m"] or 0) + 1
            c.execute("INSERT INTO lists(name,pos,items) VALUES(?,?,?)", (name, pos, _dumps(items)))
            self._log(c, batch, user, source, "list", name, "create", "", "", _dumps(items))
        return True

    def set_list(self, name, items, user="", source="tool") -> dict:
        with self._tx() as c:
            if name == schema.STATUS_LIST and not clean_items(items):
                raise StoreError("The status scale needs at least one status.")
            batch = self._batch()
            if not self._set_list(c, name, items, batch, user, source):
                return {"state": self._state(c), "batch": None, "message": "No change."}
            return self._done(c, batch, "List '%s' saved" % name)

    def set_meta(self, patch, user="", source="tool") -> dict:
        with self._tx() as c:
            batch = self._batch()
            for key in ("name", "id_prefix"):
                if key in (patch or {}):
                    value = str(patch[key]).strip()
                    if key == "id_prefix" and not value:
                        raise StoreError("The ID prefix can't be empty.")
                    self._set_meta(c, key, value, batch, user, source)
            return self._done(c, batch, "Settings saved")

    # ------------------------------------------------------------------ undo
    def undo(self, batch, user="") -> dict:
        """Revert every change recorded under one batch, newest first."""
        with self._tx() as c:
            rows = c.execute("SELECT * FROM changes WHERE batch=? ORDER BY id DESC", (batch,)).fetchall()
            if not rows:
                raise StoreError("Nothing to revert.")
            new_batch, source = self._batch(), "undo"
            for ch in rows:
                entity, eid, action = ch["entity"], ch["entity_id"], ch["action"]
                if entity == "capability":
                    if action == "create" and self._get_cap(c, eid):
                        self._delete_cap(c, eid, new_batch, user, source)
                    elif action == "delete" and not self._get_cap(c, eid):
                        row = json.loads(ch["old"])
                        self._put_cap(c, row, user)
                        self._log(c, new_batch, user, source, "capability", eid, "create", "", "", ch["old"])
                    elif action == "update" and self._get_cap(c, eid):
                        ftype = self._field_map(c, "capability").get(ch["field"], {}).get("type", "text")
                        self._update_cap(c, eid, {ch["field"]: clean_value(ftype, ch["old"])}, new_batch, user, source,
                                         touch_as_of=False)
                elif entity == "language":
                    if action == "create" and self._get_lang(c, eid):
                        if not any(r.get("language") == eid for r in self._caps(c)):
                            self._delete_lang(c, eid, new_batch, user, source)
                    elif action == "delete" and not self._get_lang(c, eid):
                        self._put_lang(c, json.loads(ch["old"]), user)
                        self._log(c, new_batch, user, source, "language", eid, "create", "", "", ch["old"])
                    elif action == "update":
                        current = ch["new"] if ch["field"] == "language" else eid
                        if self._get_lang(c, current):
                            ftype = self._field_map(c, "language").get(ch["field"], {}).get("type", "text")
                            self._update_lang(c, current, {ch["field"]: clean_value(ftype, ch["old"])}, new_batch, user, source)
                elif entity == "list" and action == "update":
                    self._set_list(c, eid, json.loads(ch["old"]), new_batch, user, source)
                elif entity == "meta" and action == "update":
                    self._set_meta(c, eid, ch["old"], new_batch, user, source)
            return self._done(c, new_batch, "Reverted")

    # ------------------------------------------------------------------ import
    def _map_headers(self, c, entity, headers, rows, defs, report) -> dict:
        """Match spreadsheet headers to fields; a header nobody knows becomes a new field."""
        fields = self._fields(c, entity)
        by_label = {schema.norm(f["label"]): f["key"] for f in fields}
        by_key = {f["key"]: f["key"] for f in fields}
        mapping = {}
        for header in headers:
            n = schema.norm(header)
            if not n or n in schema.IGNORED_HEADERS or str(header).startswith("_"):
                continue
            key = by_label.get(n) or by_key.get(str(header).strip())
            if not key:
                key, base, i = schema.slug(header), schema.slug(header), 2
                while key in by_key:
                    key, i = "%s_%d" % (base, i), i + 1
                given = (defs or {}).get(str(header).strip(), {})
                values = [r.get(header) for r in rows if r.get(header) not in ("", None)]
                if given.get("type"):
                    ftype = given["type"]
                elif values and all(isinstance(to_int(v), int) and not isinstance(v, bool) for v in values):
                    ftype = "int"
                elif any(len(str(v)) > 60 for v in values):
                    ftype = "long"
                else:
                    ftype = "text"
                label = given.get("label") or str(header).strip()
                list_name = given.get("list")
                if not list_name and label in self._lists(c):
                    list_name, ftype = label, "list"
                pos = (c.execute("SELECT COALESCE(MAX(pos),0) m FROM fields WHERE entity=?", (entity,)).fetchone()["m"] or 0) + 1
                c.execute("INSERT INTO fields(entity,key,label,type,list,grp,pos,core) VALUES(?,?,?,?,?,?,?,0)",
                          (entity, key, label, ftype, list_name, given.get("group") or "More", pos))
                by_key[key] = key
                by_label[schema.norm(label)] = key
                report["new_fields"].append({"entity": entity, "label": label})
            mapping[header] = key
        return mapping

    def import_payload(self, payload, strategy="merge", user="", apply=False, source="import") -> dict:
        """Bring spreadsheet content in. With apply=False nothing is kept and the report is a preview."""
        if strategy not in ("merge", "replace"):
            raise StoreError("Strategy must be 'merge' or 'replace'.")
        caps_in, langs_in = payload.get("capabilities"), payload.get("languages")
        if not caps_in and not langs_in and not payload.get("lists"):
            raise StoreError("Nothing to import: no capability rows, languages or lists were found in the file.")
        report = {"strategy": strategy, "applied": bool(apply), "new_fields": [], "lists": [], "warnings": [], "details": [],
                  "capabilities": {"added": 0, "changed": 0, "unchanged": 0, "removed": 0},
                  "languages": {"added": 0, "changed": 0, "unchanged": 0, "removed": 0}}

        def detail(entity, eid, action, changes=None):
            if len(report["details"]) < 300:
                report["details"].append({"entity": entity, "id": eid, "action": action, "changes": changes or []})

        with self._tx(commit=apply) as c:
            batch = self._batch()
            for name, items in (payload.get("lists") or {}).items():
                if clean_items(items) and self._set_list(c, name, items, batch, user, source):
                    report["lists"].append(name)
            defs = payload.get("field_defs") or {}

            seen_langs = []
            if langs_in:
                mapping = self._map_headers(c, "language", langs_in["headers"], langs_in["rows"], defs.get("language"), report)
                fields = self._field_map(c, "language")
                for raw in langs_in["rows"]:
                    data = {mapping[h]: clean_value(fields[mapping[h]]["type"], v) for h, v in raw.items() if h in mapping}
                    name = str(data.get("language") or "").strip()
                    if not name:
                        continue
                    seen_langs.append(name)
                    if self._get_lang(c, name):
                        changed = self._update_lang(c, name, data, batch, user, source)
                        report["languages"]["changed" if changed else "unchanged"] += 1
                        if changed:
                            detail("language", name, "changed", changed)
                    else:
                        self._create_lang(c, data, batch, user, source)
                        report["languages"]["added"] += 1
                        detail("language", name, "added")

            seen_caps = []
            if caps_in:
                mapping = self._map_headers(c, "capability", caps_in["headers"], caps_in["rows"], defs.get("capability"), report)
                fields = self._field_map(c, "capability")
                statuses = set(self._statuses(c))
                unknown = set()
                skipped = 0
                for raw in caps_in["rows"]:
                    data = {mapping[h]: clean_value(fields[mapping[h]]["type"], v) for h, v in raw.items() if h in mapping}
                    if not data.get("language"):
                        skipped += 1 if any(v != "" for v in data.values()) else 0
                        continue
                    for key in ("ft_status", "ix_status"):
                        if data.get(key) and data[key] not in statuses:
                            unknown.add(data[key])
                    cap_id = str(data.get("id") or "").strip()
                    if cap_id and self._get_cap(c, cap_id):
                        changed = self._update_cap(c, cap_id, data, batch, user, source, touch_as_of=False)
                        report["capabilities"]["changed" if changed else "unchanged"] += 1
                        if changed:
                            detail("capability", cap_id, "changed", changed)
                    else:
                        row = self._create_cap(c, data, batch, user, source)
                        cap_id = row["id"]
                        report["capabilities"]["added"] += 1
                        detail("capability", cap_id, "added")
                    seen_caps.append(cap_id)
                if skipped:
                    report["warnings"].append("%d row%s without a language skipped." % (skipped, " was" if skipped == 1 else "s were"))
                if unknown:
                    report["warnings"].append("Statuses not on the Status list (shown as 'No status' until fixed): %s."
                                              % ", ".join(sorted(unknown)))

            if strategy == "replace":
                if caps_in:
                    keep = set(seen_caps)
                    for row in self._caps(c):
                        if row["id"] not in keep:
                            self._delete_cap(c, row["id"], batch, user, source)
                            report["capabilities"]["removed"] += 1
                            detail("capability", row["id"], "removed")
                    for pos, cap_id in enumerate(seen_caps):
                        c.execute("UPDATE capabilities SET pos=? WHERE id=?", (pos, cap_id))
                    prefixes = {}
                    for cap_id in seen_caps:
                        m = re.fullmatch(r"(.*?)(\d+)", cap_id)
                        if m:
                            prefixes[m.group(1)] = prefixes.get(m.group(1), 0) + 1
                    if prefixes:
                        self._set_meta(c, "id_prefix", max(prefixes, key=prefixes.get), batch, user, source)
                if langs_in:
                    used = {r.get("language") for r in self._caps(c)}
                    keep = set(seen_langs)
                    for row in self._langs(c):
                        if row["language"] not in keep and row["language"] not in used:
                            self._delete_lang(c, row["language"], batch, user, source)
                            report["languages"]["removed"] += 1
                            detail("language", row["language"], "removed")
                    for pos, name in enumerate(seen_langs):
                        c.execute("UPDATE languages SET pos=? WHERE name=?", (pos, name))
                if caps_in:
                    self._set_meta(c, "sample", "0", batch, user, source)
            for row in self._caps(c):
                self._ensure_language(c, row.get("language"), row.get("script"), batch, user, source)
            self._snapshot(c)
            report["batch"] = batch if apply else None
            if apply:
                report["state"] = self._state(c)
                a, l = report["capabilities"], report["languages"]
                report["message"] = "Import applied: %d rows added, %d changed, %d removed; %d languages added, %d changed" % (
                    a["added"], a["changed"], a["removed"], l["added"], l["changed"])
        return report

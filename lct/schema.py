"""Default fields and dropdown lists.

Everything here is only a starting point: fields and lists live in the database once it
exists, and a spreadsheet import can add columns and replace list values.
"""
from __future__ import annotations

import re

# Keys the application logic depends on. Every other field is display-only.
CORE_CAP_KEYS = ("id", "language", "content_type", "tier", "script", "ft_status", "ix_status", "est_images", "as_of")
CORE_LANG_KEYS = ("language", "script", "mid_tier_unindexed", "top_tier_unindexed")
STATUS_LIST = "Status"
CONTENT_TYPE_LIST = "Content type"
NOT_ASSESSED = "Not assessed"

# (key, label, group, type, list). Types: id, text, long, int, list, status.
CAP_FIELDS = [
    ("id", "ID", "Capability cell", "id", None),
    ("language", "Language", "Capability cell", "language", None),
    ("content_type", "Content type", "Capability cell", "list", "Content type"),
    ("record_type", "Record type / scope", "Scope and script", "long", None),
    ("tier", "Tier", "Scope and script", "list", "Tier"),
    ("script", "Script", "Scope and script", "list", "Script"),
    ("direction", "Direction", "Scope and script", "list", "Direction"),
    ("hand", "Hand / print", "Scope and script", "list", "Hand / print"),
    ("layout", "Layout", "Scope and script", "list", "Layout"),
    ("other_languages", "Other languages on image", "Scope and script", "text", None),
    ("place", "Place / collection focus", "Scope and script", "text", None),
    ("est_images", "Est. images", "Demand", "int", None),
    ("volume_basis", "Volume basis", "Demand", "long", None),
    ("priority", "Priority", "Demand", "list", "Priority"),
    ("driver", "Driver", "Demand", "text", None),
    ("ft_status", "Full-text status", "Full text", "status", "Status"),
    ("tr_engine", "TR engine", "Full text", "list", "TR engine"),
    ("candidate_engine", "Candidate engine", "Full text", "text", None),
    ("ft_gate", "FT quality gate", "Full text", "list", "FT quality gate"),
    ("ft_evidence", "Full-text evidence and issues", "Full text", "long", None),
    ("ft_truth", "Full-text truth / test sets", "Full text", "long", None),
    ("ix_status", "Index status", "Index", "status", "Status"),
    ("ix_approach", "Index approach", "Index", "list", "Index approach"),
    ("cai_capability", "CAI capability ID (legacy)", "Index", "text", None),
    ("cai_state", "CAI state (legacy)", "Index", "list", "CAI state"),
    ("ix_evidence", "Index evidence and quality", "Index", "long", None),
    ("ix_truth", "Index truth / test sets", "Index", "long", None),
    ("ix_gaps", "Index gaps and structuring needs", "Index", "long", None),
    ("language_id_needed", "Language ID needed", "Enablers", "list", "Yes / Partial / No"),
    ("standards_ready", "Standards ready (names, dates, places)", "Enablers", "list", "Yes / Partial / No"),
    ("labelers_available", "Labelers and auditors available", "Enablers", "list", "Yes / Partial / No"),
    ("rights", "Rights and restrictions", "Enablers", "long", None),
    ("redaction_needed", "Redaction needed", "Enablers", "list", "Yes / Partial / No"),
    ("publication_ready", "Collection and publication ready", "Enablers", "list", "Yes / Partial / No"),
    ("metadata_reliable", "RMS metadata reliable", "Enablers", "list", "Yes / Partial / No"),
    ("next_step", "Next step / decision", "Plan and evidence", "long", None),
    ("owner", "Owner", "Plan and evidence", "text", None),
    ("target", "Target", "Plan and evidence", "text", None),
    ("blockers", "Blockers / dependencies", "Plan and evidence", "long", None),
    ("evidence", "Evidence", "Plan and evidence", "list", "Evidence"),
    ("sources", "Sources", "Plan and evidence", "text", None),
    ("as_of", "As of", "Plan and evidence", "text", None),
    ("notes", "Notes", "Plan and evidence", "long", None),
]

LANG_FIELDS = [
    ("language", "Language", "Language", "id", None),
    ("code", "Code", "Language", "text", None),
    ("script", "Script", "Language", "list", "Script"),
    ("direction", "Direction", "Language", "list", "Direction"),
    ("ft_gate", "FT quality gate", "Text recognition", "list", "FT quality gate"),
    ("word_accuracy", "Word accuracy", "Text recognition", "text", None),
    ("images_single_language", "Images in single-language groups", "Volume", "int", None),
    ("mid_tier_unindexed", "Mid-tier unindexed", "Volume", "int", None),
    ("top_tier_unindexed", "Top-tier unindexed", "Volume", "int", None),
    ("notes", "Gaps and notes", "Notes", "long", None),
    ("sources", "Sources", "Notes", "text", None),
]

# Spreadsheet columns that are calculated in the workbook and never imported.
IGNORED_HEADERS = {"matrix rows", "ft rank (formula)", "index rank (formula)"}

# Headers on a Lists sheet that describe the list to their left.
DESCRIPTION_HEADERS = {"what it means", "what it covers", "meaning", "iso 15924 name", "description"}


def _items(*pairs):
    out = []
    for p in pairs:
        if isinstance(p, tuple):
            out.append({"name": p[0], "description": p[1]})
        else:
            out.append({"name": p, "description": ""})
    return out


# The Status list is an ordered scale: its position is the rank the heatmap uses.
DEFAULT_LISTS = [
    ("Status", _items(
        ("Out of scope", "Deliberately not pursued here, or handled by another channel."),
        ("Cancelled / abandoned", "Work was planned or started, then stopped."),
        ("Not assessed", "No one has evaluated this cell yet."),
        ("Gap (no capability)", "Known need with no usable model, pipeline or record structure."),
        ("Planning / research", "Being scoped, sampled or tested in experiments."),
        ("In development", "Model, prompts or pipeline are being built."),
        ("Pilot / validation", "A sample or first cohort is running against a truth set, gate or audit."),
        ("Production (partial)", "In production with limits: yellow quality, restricted scope or gated cohorts."),
        ("Production (at scale)", "Proven at volume and passing its quality gate."),
        ("Mature / maintenance", "Stable; only upkeep expected."),
    )),
    ("Content type", _items(
        ("Church records (BMD)", "Baptisms, christenings, religious marriages, deaths and burials."),
        ("Civil registration (BMD)", "Civil births, marriages and deaths, and their certificates."),
        ("Census & population registers", "Census forms and population registers."),
        ("Marriage packets & supplements", "Dispensations, investigation files, marriage supplements, correction files."),
        ("Notarial records", "Notarial acts."),
        ("Probate, wills & estates", "Probate records, estate files and wills."),
        ("Land records", "Land and property records."),
        ("Court & legal records", "Court records and divorces."),
        ("Military records", "Military records, including draft registrations."),
        ("Migration records", "Migration records."),
        ("Government & ID records", "Government records, identification and background checks."),
        ("Mid-tier, mixed record classes", "Runs that take the mid-tier record classes together."),
        ("Top-tier, mixed (unindexed)", "Runs scoped as top-tier unindexed images, whatever the record type."),
        ("Newspapers & periodicals", "Newspaper images and partner text: obituaries and notices."),
        ("Books, genealogies & lineage books", "Printed genealogies, locality books and lineage books."),
        ("Cards & small forms", "Prayer cards, index cards, registration cards."),
        ("Manuscripts & narrative documents", "Journals, letters and other running handwriting."),
        ("Not yet scoped", "Language-level placeholder until content is sampled."),
    )),
    ("Tier", _items(
        ("Top-tier", "Records normally indexed, such as births, marriages and deaths."),
        ("Mid-tier", "Record classes targeted for full text rather than index."),
        ("Other", "Outside both tiers."),
        ("TBD", "Tier not confirmed."),
    )),
    ("Script", _items(
        ("Latn", "Latin"), ("Cyrl", "Cyrillic"), ("Grek", "Greek"), ("Armn", "Armenian"), ("Arab", "Arabic"),
        ("Hebr", "Hebrew"), ("Deva", "Devanagari"), ("Hani", "Han (Chinese)"), ("Jpan", "Japanese (Han and kana)"),
        ("Kore", "Korean (hangul and hanja)"), ("Mong", "Mongolian script"), ("Thai", "Thai"), ("Geor", "Georgian"),
        ("Other", "Add the ISO 15924 code in Notes"),
    )),
    ("Direction", _items("LTR", "RTL", "Vertical", "Mixed")),
    ("Hand / print", _items("Handwritten", "Printed form + handwriting", "Typeset / printed", "Typewritten",
                            "Digital-born text", "Mixed")),
    ("Layout", _items("Paragraph", "Form paragraph", "Key value", "Modern form", "Table / register", "Index", "Card",
                      "Newspaper columns", "Book page", "Mixed")),
    ("Priority", _items("Committed", "Stretch", "Planned", "Requested", "Backlog", "On hold", "Closed")),
    ("TR engine", _items("In-house model", "LLM transcription", "Cloud OCR", "Partner text (no TR)", "None")),
    ("FT quality gate", _items("Go", "Yellow", "No-go", "Not measured")),
    ("Index approach", _items("LLM extraction pipeline", "Fine-tuned model", "Template / field finding",
                              "Commercial keying", "None")),
    ("CAI state", _items("Maintenance", "Maturing", "Development", "Planning", "Cancelled", "Abandoned")),
    ("Yes / Partial / No", _items("Yes", "Partial", "No")),
    ("Evidence", _items("Documented", "Partly documented", "Placeholder")),
]


def norm(text) -> str:
    """Normalise a header for matching: lower case, no '(2025)'-style suffix, single spaces."""
    s = "" if text is None else str(text)
    s = re.sub(r"\(\s*\d{4}\s*\)\s*$", "", s.strip())
    return re.sub(r"\s+", " ", s).strip().lower()


def slug(text) -> str:
    """Field key for a header that the schema doesn't know yet."""
    s = re.sub(r"[^a-z0-9]+", "_", norm(text)).strip("_")
    return s or "field"


def field_dicts(rows):
    return [{"key": k, "label": lab, "group": grp, "type": typ, "list": lst, "core": True}
            for (k, lab, grp, typ, lst) in rows]

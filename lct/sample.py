"""A small invented dataset so the tool has something to show on first run.

None of it describes a real system. Import your own workbook with "Replace" to clear it.
"""
from __future__ import annotations

# name, code, script, direction, gate, mid-tier unindexed, top-tier unindexed
LANGUAGES = [
    ("English", "en", "Latn", "LTR", "Go", 50_000_000, 40_000_000),
    ("Spanish", "es", "Latn", "LTR", "Go", 120_000_000, 90_000_000),
    ("Portuguese", "pt", "Latn", "LTR", "Go", 80_000_000, 60_000_000),
    ("French", "fr", "Latn", "LTR", "Yellow", 40_000_000, 100_000_000),
    ("German", "de", "Latn", "LTR", "Yellow", 100_000_000, 60_000_000),
    ("Italian", "it", "Latn", "LTR", "Yellow", 20_000_000, 150_000_000),
    ("Dutch", "nl", "Latn", "LTR", "Yellow", 40_000_000, 30_000_000),
    ("Swedish", "sv", "Latn", "LTR", "Not measured", 50_000_000, 0),
    ("Russian", "ru", "Cyrl", "LTR", "Not measured", 25_000_000, 8_000_000),
    ("Chinese", "zh", "Hani", "Mixed", "Yellow", 60_000_000, 0),
    ("Japanese", "ja", "Jpan", "Mixed", "Yellow", 9_000_000, 0),
    ("Korean", "ko", "Kore", "Mixed", "Yellow", 3_000_000, 0),
    ("Arabic", "ar", "Arab", "RTL", "Not measured", 1_000_000, 0),
    ("Polish", "pl", "Latn", "LTR", "Not measured", 4_000_000, 0),
]

S = {"oos": "Out of scope", "na": "Not assessed", "gap": "Gap (no capability)", "plan": "Planning / research",
     "dev": "In development", "pilot": "Pilot / validation", "part": "Production (partial)",
     "scale": "Production (at scale)", "mature": "Mature / maintenance"}

# language, content type, tier, full text, index, est. images
ROWS = [
    ("English", "Probate, wills & estates", "Mid-tier", "scale", "na", 30_000_000),
    ("English", "Civil registration (BMD)", "Top-tier", "scale", "part", 12_000_000),
    ("English", "Census & population registers", "TBD", "pilot", "gap", 8_000_000),
    ("English", "Newspapers & periodicals", "TBD", "na", "scale", None),
    ("Spanish", "Church records (BMD)", "Top-tier", "scale", "mature", 45_000_000),
    ("Spanish", "Civil registration (BMD)", "Top-tier", "scale", "part", 30_000_000),
    ("Spanish", "Notarial records", "Mid-tier", "scale", "pilot", 20_000_000),
    ("Spanish", "Census & population registers", "TBD", "pilot", "gap", 2_000_000),
    ("Portuguese", "Church records (BMD)", "Top-tier", "scale", "mature", 25_000_000),
    ("Portuguese", "Probate, wills & estates", "Mid-tier", "scale", "na", 35_000_000),
    ("French", "Notarial records", "Mid-tier", "part", "na", 16_000_000),
    ("French", "Church records (BMD)", "Top-tier", "part", "plan", None),
    ("German", "Mid-tier, mixed record classes", "Mid-tier", "pilot", "na", 100_000_000),
    ("German", "Books, genealogies & lineage books", "TBD", "plan", "gap", None),
    ("Italian", "Civil registration (BMD)", "Top-tier", "pilot", "pilot", 4_000_000),
    ("Italian", "Church records (BMD)", "Top-tier", "pilot", "part", None),
    ("Dutch", "Marriage packets & supplements", "TBD", "part", "dev", 8_000_000),
    ("Swedish", "Church records (BMD)", "Top-tier", "plan", "plan", None),
    ("Russian", "Mid-tier, mixed record classes", "Mid-tier", "plan", "na", 3_000_000),
    ("Chinese", "Books, genealogies & lineage books", "TBD", "pilot", "gap", None),
    ("Japanese", "Mid-tier, mixed record classes", "Mid-tier", "plan", "na", 9_000_000),
    ("Korean", "Books, genealogies & lineage books", "TBD", "plan", "gap", None),
    ("Arabic", "Not yet scoped", "TBD", "na", "na", 1_000_000),
    ("Polish", "Not yet scoped", "TBD", "gap", "na", 4_000_000),
]


def load_sample(store, c):
    batch, user, source = store._batch(), "", "sample"
    for name, code, script, direction, gate, mid, top in LANGUAGES:
        store._create_lang(c, {"language": name, "code": code, "script": script, "direction": direction, "ft_gate": gate,
                               "mid_tier_unindexed": mid, "top_tier_unindexed": top or "",
                               "notes": "Sample language. Replace with your own baseline."}, batch, user, source)
    for language, ctype, tier, ft, ix, images in ROWS:
        store._create_cap(c, {"language": language, "content_type": ctype, "tier": tier, "ft_status": S[ft],
                              "ix_status": S[ix], "est_images": images or "", "evidence": "Placeholder",
                              "ft_evidence": "Sample row. Replace with your own evidence.",
                              "next_step": "Sample row. Import your workbook to replace it."}, batch, user, source)
    store._set_meta(c, "sample", "1")

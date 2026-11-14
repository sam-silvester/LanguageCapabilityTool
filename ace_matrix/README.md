# ACE capability matrix (local copy)

A copy of the hosted ACE capability matrix as it stood on 14 November 2026. It has two views:

- **Capability today**: the language by content type matrix and unindexed images by language.
- **2027 priorities**: the index workstream (content to key, from the 2027 list and the Databricks
  country counts) and the full text transcription (FTT) workstream.

It runs in a browser from this folder. Python 3 serves the files; nothing needs installing.

## Run it

```
cd ~/Projects/LanguageCapabilityTool/ace_matrix
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Press Ctrl+C in that Terminal window to stop it.

Opening `index.html` by double-clicking does not work: the browser will not let the page read the
data files that way, and the page says so.

## Update the data

Replace a file in `data/`, keep its name and column names, then reload the page in the browser.
The server does not need restarting.

| File | What it holds | Where a new one comes from |
|---|---|---|
| `data/image_counts.csv` | Images by language, tier, indexed status, full-text status and PIPA | Run `sql/ace_matrix_feed.sql` in Databricks and download the result as CSV |
| `data/country_counts_2027.csv` | Groups and images for each row of the 2027 list | Run the country query in Databricks and download the result as CSV |
| `data/priorities_2027.json` | The 2027 list: country, record type, groups, priority band, notes | `python3 tools/convert_workbook.py path/to/workbook.xlsx` (needs `pip install openpyxl`) |
| `data/country_languages.json` | The language each country is counted under | Edit by hand |
| `data/capabilities.json` | Matrix rows: statuses, engines, evidence, estimated images | Edit by hand |
| `data/languages.json` | Language baseline: models, quality gate, word accuracy | Edit by hand |

Country counts attach to a list row only when the row number, country and record type all match.
If the list changes, rerun the country query too.

If a file is missing or has the wrong columns, a message at the top of the page names it and the
charts that depend on it show a dash.

## Check it after an update

1. Open **2027 priorities**. The headline numbers are the sums of `unindexed_images`,
   `unindexed_groups` and `plan_natural_groups` in `data/country_counts_2027.csv`.
2. "For 41 of them" should match the number of rows on the list. A lower number means some rows of
   the counts file no longer match the list.
3. Open **Capability today**. The date under "Unindexed images by language" is the `run_date` in
   `data/image_counts.csv`.

With the files in this folder the headline reads 417,264,816 unindexed images in 3,786,180 natural
groups, against 3,991,395 groups on the list.

## Put it on GitHub

```
cd ~/Projects/LanguageCapabilityTool
git add ace_matrix
git commit -m "Update ACE matrix data"
git push
```

The data files hold internal counts and the notes from the 2027 list. Keep the repository private.

## What is in this folder

- `index.html`: the page and a small script that loads the data files.
- `data/`: the six data files above.
- `sql/`: the Databricks queries behind `image_counts.csv`, and the General Query with a settings block.
- `tools/convert_workbook.py`: turns the 2027 workbook into `data/priorities_2027.json`.
- `vendor/d3.min.js`: the D3 charting library, version 7.9.0, under the ISC licence in `vendor/D3-LICENSE.txt`.

This copy and the hosted matrix are separate. A change made in one does not reach the other.

# ACE capability matrix (local copy)

A copy of the hosted ACE capability matrix as it stood on 14 November 2026. It has two views:

- **Capability today**: where capability stands (with rows and languages rolled up by stage), the
  language by content type matrix and unindexed images by language.
- **2027 priorities**: a capability heatmap for the countries on the 2027 list, the index workstream
  (content to key, from the 2027 list and the Databricks country counts) and the full text
  transcription (FTT) workstream, each with totals, the cost of the 2027 content processing plan,
  and the engineering source lists set against the 2027 list.

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
| `data/source_lists_2027.csv` | Groups and images on each engineering source list: all, unindexed, ACE-indexed, human-indexed | `python3 tools/read_source_list_summaries.py "/path/to/2027 Source Lists"`, or type the numbers in |
| `data/priorities_2027.json` | The 2027 list: country, record type, groups, priority band, notes | `python3 tools/convert_workbook.py path/to/workbook.xlsx` (needs `pip install openpyxl`) |
| `data/country_languages.json` | The language each country is counted under | Edit by hand |
| `data/record_type_content_types.json` | The content type each 2027 record type is shown under in the heatmap | Edit by hand |
| `data/cost_plan_2027.json` | Cost of each collection by phase, copied from the 2027 Content Processing Plan slide | Edit by hand when the slide changes |
| `data/cost_quarters_2027.json` | The slide's cost by quarter, the 2027 total and the optional amount | Edit by hand when the slide changes |
| `data/capabilities.json` | Matrix rows: statuses, engines, evidence, estimated images | Edit by hand |
| `data/languages.json` | Language baseline: models, quality gate, word accuracy | Edit by hand |

Country counts attach to a list row only when the row number, country and record type all match.
If the list changes, rerun the country query too.

If a file is missing or has the wrong columns, a message at the top of the page names it and the
charts that depend on it show a dash.

## Costs

The cost section shows the slide's figures as they stand. In `data/cost_plan_2027.json` each figure
appears twice: as text exactly as on the slide (`phase1`, `total`, and so on), which the table and
the headline show, and as a number in millions (`phase1_musd`, `total_musd`), which sizes the bars.
Change both when a figure changes. Nothing in this section is worked out from the image counts.

## Fill in the engineering source lists

`data/source_lists_2027.csv` has one row for each source list engineering pulled. Each
`<name>-by-indexing-status.xlsx` workbook has a small `summary` tab with groups and images for all,
unindexed, ace-indexed and human-indexed. Five summaries are filled in. The other workbooks were too
large to read from the hosted app's side.

To fill in the rest, download or sync the "2027 Source Lists" folder, then run:

```
cd ~/Projects/LanguageCapabilityTool/ace_matrix
python3 tools/read_source_list_summaries.py "/path/to/2027 Source Lists"
```

It reads only the `summary` tab of each workbook and needs nothing installed. You can also open
`data/source_lists_2027.csv` in Excel and type the eight numbers into a row. Leave a row's counts
blank while its summary is unknown. `plan_rows` lists the rows of the 2027 list a source list
covers, separated by spaces.

`italy-ftt` has one sheet and no summary tab, so only its group count is filled in.

## Check it after an update

1. Open **2027 priorities**. The headline numbers are the sums of `unindexed_images`,
   `unindexed_groups` and `plan_natural_groups` in `data/country_counts_2027.csv`.
2. "For 41 of them" should match the number of rows on the list. A lower number means some rows of
   the counts file no longer match the list.
3. Under "Engineering source lists against the 2027 list", the first sentence says how many
   summaries are filled in, and each row's numbers match its workbook's `summary` tab.
4. Open **Capability today**. The date under "Unindexed images by language" is the `run_date` in
   `data/image_counts.csv`.

With the files in this folder the headline reads 417,264,816 unindexed images in 3,786,180 natural
groups, against 3,991,395 groups on the list.

## Put it on GitHub

```
cd ~/Projects/LanguageCapabilityTool
git add ace_matrix
git commit -m "Update ACE matrix data"
git push origin HEAD:main
```

The data files hold internal counts and the notes from the 2027 list. Keep the repository private.

## What is in this folder

- `index.html`: the page and a small script that loads the data files.
- `data/`: the ten data files above.
- `sql/`: the Databricks queries behind `image_counts.csv`, and the General Query with a settings block.
- `tools/convert_workbook.py`: turns the 2027 workbook into `data/priorities_2027.json`.
- `tools/read_source_list_summaries.py`: fills `data/source_lists_2027.csv` from the source list workbooks.
- `vendor/d3.min.js`: the D3 charting library, version 7.9.0, under the ISC licence in `vendor/D3-LICENSE.txt`.

This copy and the hosted matrix are separate. A change made in one does not reach the other.

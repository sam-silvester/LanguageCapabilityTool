// Pivot: any field down the side, any field across the top, and a choice of what each cell shows.
import {$, el, app, refresh, fmtInt, fmtShort, plural, dimensions, rowsInView, cellValue, shown, orderValues, labelOf, rankOf, statuses,
  swatch, onSwatch, thresholds, toggleSlice} from './core.js';
import {rowTable} from './drawer.js';

const SHOWS = [['count', 'Number of rows'], ['images', 'Est. images (sum)'], ['ft', 'Most advanced full-text status'],
  ['ix', 'Most advanced index status'], ['ftprod', 'Share in production: full text'], ['ixprod', 'Share in production: index']];
const pv = {rows: 'content_type', cols: 'tier', show: 'count', sel: null};

function measure(list) {
  const {prod} = thresholds();
  const out = {n: list.length, images: 0, ft: -1, ix: -1, ftp: 0, ixp: 0};
  for (const row of list) {
    const ft = rankOf(row.ft_status), ix = rankOf(row.ix_status);
    out.images += Number(row.est_images) || 0;
    out.ft = Math.max(out.ft, ft);
    out.ix = Math.max(out.ix, ix);
    if (ft >= prod) out.ftp += 1;
    if (ix >= prod) out.ixp += 1;
  }
  return out;
}

function cell(list, max, onclick, strong) {
  if (!list.length) return el('td', {class: 'lct-pv lct-pv-none', text: '·'});
  const m = measure(list), names = statuses();
  const td = el('td', {class: 'lct-pv' + (strong ? ' lct-pv-total' : ''), tabindex: 0, role: 'button', onclick,
    onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onclick(); } }});
  if (pv.show === 'ft' || pv.show === 'ix') {
    const rank = m[pv.show];
    td.textContent = names[rank - 1] || 'No status';
    td.style.backgroundColor = swatch(rank);
    td.style.color = onSwatch(rank);
    return td;
  }
  let ratio, text;
  if (pv.show === 'count') { ratio = m.n / max.n; text = fmtInt(m.n); }
  else if (pv.show === 'images') { ratio = max.images ? m.images / max.images : 0; text = m.images ? fmtShort(m.images) : '0'; }
  else { const share = (pv.show === 'ftprod' ? m.ftp : m.ixp) / m.n; ratio = share; text = Math.round(share * 100) + '%'; }
  td.textContent = text;
  if (!strong) {
    td.style.backgroundColor = 'color-mix(in srgb, var(--tier-mid) ' + Math.round(6 + ratio * 70) + '%, transparent)';
    if (ratio > 0.55) td.style.color = 'var(--paper)';
  }
  return td;
}

export function initPivot() {
  $('#pv-swap').addEventListener('click', () => { [pv.rows, pv.cols] = [pv.cols, pv.rows]; pv.sel = null; refresh(); });
}

export function renderPivot() {
  const dims = dimensions();
  if (!dims.some((d) => d.key === pv.rows)) pv.rows = (dims[0] || {}).key;
  if (!dims.some((d) => d.key === pv.cols)) pv.cols = (dims[1] || dims[0] || {}).key;
  const fill = (id, options, value, set) => {
    const sel = $(id);
    sel.replaceChildren(...options.map(([v, label]) => new Option(label, v)));
    sel.value = value;
    sel.onchange = () => { set(sel.value); pv.sel = null; refresh(); };
  };
  fill('#pv-rows', dims.map((d) => [d.key, d.label]), pv.rows, (v) => { pv.rows = v; });
  fill('#pv-cols', dims.map((d) => [d.key, d.label]), pv.cols, (v) => { pv.cols = v; });
  fill('#pv-show', SHOWS, pv.show, (v) => { pv.show = v; });

  const rows = rowsInView();
  const box = $('#pv-table'), drill = $('#pv-drill');
  if (!rows.length || !pv.rows || pv.rows === pv.cols) {
    box.replaceChildren(el('p', {class: 'lct-cap', text: rows.length ? 'Choose two different fields.' : 'No rows match the current filters.'}));
    drill.replaceChildren();
    return;
  }
  const rv = orderValues(pv.rows, new Set(rows.map((r) => cellValue(r, pv.rows))));
  const cv = orderValues(pv.cols, new Set(rows.map((r) => cellValue(r, pv.cols))));
  const pick = (r, c) => rows.filter((row) => (r === null || cellValue(row, pv.rows) === r) && (c === null || cellValue(row, pv.cols) === c));
  const max = {n: 1, images: 0};
  rv.forEach((r) => cv.forEach((c) => { const m = measure(pick(r, c)); max.n = Math.max(max.n, m.n); max.images = Math.max(max.images, m.images); }));
  const choose = (r, c) => () => { pv.sel = pv.sel && pv.sel.r === r && pv.sel.c === c ? null : {r, c}; refresh(); };
  const headBtn = (key, v) => el('button', {type: 'button', class: 'lct-linkbtn' + ((app.slice[key] || []).includes(v) ? ' lct-linkbtn-on' : ''),
    title: 'Filter every page to ' + shown(v), text: shown(v), onclick: () => toggleSlice(key, v)});
  const isSel = (r, c) => pv.sel && pv.sel.r === r && pv.sel.c === c;
  const mark = (td, r, c) => { if (isSel(r, c)) td.classList.add('lct-pv-sel'); return td; };
  box.replaceChildren(el('table', {class: 'lct-grid lct-pivot'},
    el('thead', {}, el('tr', {},
      el('th', {scope: 'col', class: 'lct-noclick', text: labelOf(pv.rows) + ' \\ ' + labelOf(pv.cols)}),
      ...cv.map((c) => el('th', {scope: 'col', class: 'lct-noclick'}, headBtn(pv.cols, c))),
      el('th', {scope: 'col', class: 'lct-noclick', text: 'All'}))),
    el('tbody', {},
      ...rv.map((r) => el('tr', {}, el('td', {}, headBtn(pv.rows, r)),
        ...cv.map((c) => mark(cell(pick(r, c), max, choose(r, c)), r, c)),
        mark(cell(pick(r, null), max, choose(r, null), true), r, null))),
      el('tr', {}, el('td', {text: 'All'}),
        ...cv.map((c) => mark(cell(pick(null, c), max, choose(null, c), true), null, c)),
        mark(cell(rows, max, choose(null, null), true), null, null)))));

  if (!pv.sel) {
    drill.replaceChildren(el('p', {class: 'lct-cap', text: 'Select a cell to list the rows behind it. Select a heading to filter every page to that value.'}));
    return;
  }
  const list = pick(pv.sel.r, pv.sel.c);
  const parts = [pv.sel.r !== null ? labelOf(pv.rows) + ': ' + shown(pv.sel.r) : null, pv.sel.c !== null ? labelOf(pv.cols) + ': ' + shown(pv.sel.c) : null].filter(Boolean);
  drill.replaceChildren(el('h3', {class: 'lct-h3', text: plural(list.length, 'row') + (parts.length ? ' where ' + parts.join(' and ') : ' in view')}), rowTable(list));
}

// Explore: one bar chart per field. Clicking a bar filters every page to that value.
import {$, $$, el, app, refresh, fmtInt, fmtShort, plural, remember, recall, dimensions, inView, rowsInView, cellValue, shown, fieldOf,
  rankOf, statuses, swatch, toggleSlice, summary} from './core.js';
import {rowTable} from './drawer.js';

const DEFAULT = ['tier', 'script', 'priority', 'ft_status', 'ix_status', 'content_type', 'language', 'ft_gate'];
const ex = {measure: 'rows', facets: [], open: new Set()};

function facet(f) {
  const amount = (row) => (ex.measure === 'rows' ? 1 : Number(row.est_images) || 0);
  const sums = new Map();
  for (const row of app.data.capabilities) {
    if (!inView(row, f.key)) continue;            // every other filter applies, so the bars show this field's alternatives
    const v = cellValue(row, f.key);
    sums.set(v, (sums.get(v) || 0) + amount(row));
  }
  const picked = app.slice[f.key] || [];
  picked.forEach((v) => { if (!sums.has(v)) sums.set(v, 0); });
  const scale = statuses();
  const values = Array.from(sums.keys()).sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0)
    || (f.type === 'status' ? scale.indexOf(b) - scale.indexOf(a) : sums.get(b) - sums.get(a)) || a.localeCompare(b));
  const max = Math.max(1, ...sums.values());
  const open = ex.open.has(f.key);
  const visible = open ? values : values.slice(0, 10);
  const bars = visible.map((v) => {
    const on = picked.includes(v), n = sums.get(v);
    return el('button', {type: 'button', class: 'lct-fbar' + (picked.length && !on ? ' lct-fbar-dim' : ''), 'aria-pressed': String(on),
      title: on ? 'Remove this filter' : 'Filter every page to ' + shown(v), onclick: () => toggleSlice(f.key, v)},
      el('span', {class: 'lct-fbar-l', text: shown(v)}),
      el('span', {class: 'lct-fbar-t'}, el('i', {class: 'lct-fbar-f',
        style: 'width:' + (n / max) * 100 + '%;background-color:' + (f.type === 'status' ? swatch(rankOf(v)) : 'var(--tier-mid)')})),
      el('span', {class: 'lct-fbar-n', text: ex.measure === 'rows' ? fmtInt(n) : fmtShort(n)}));
  });
  return el('article', {class: 'lct-card'}, el('h3', {class: 'lct-h3', text: f.label}), el('div', {class: 'lct-fbars'}, ...bars),
    values.length > 10 ? el('button', {type: 'button', class: 'lct-linkbtn', text: open ? 'Show fewer' : 'Show all ' + values.length,
      onclick: () => { if (open) ex.open.delete(f.key); else ex.open.add(f.key); refresh(); }}) : null);
}

export function initExplore() {
  ex.facets = recall('lct-facets').split(',').filter(Boolean);
  $$('[data-measure]').forEach((b) => b.addEventListener('click', () => { ex.measure = b.dataset.measure; refresh(); }));
  $('#ex-search').addEventListener('input', (event) => { app.search = event.target.value.trim().toLowerCase(); refresh(); });
  document.addEventListener('click', (event) => { if (!$('#ex-menu').contains(event.target)) $('#ex-menu').open = false; });
}

export function renderExplore() {
  const dims = dimensions();
  const wanted = ex.facets.length ? ex.facets : DEFAULT;
  const chosen = dims.map((d) => d.key).filter((k) => wanted.includes(k));      // always in field order, so cards don't jump
  $$('[data-measure]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.measure === ex.measure)));
  if (document.activeElement !== $('#ex-search')) $('#ex-search').value = app.search;
  $('#ex-menu-list').replaceChildren(...dims.map((d) => el('label', {class: 'lct-check'},
    el('input', {type: 'checkbox', checked: chosen.includes(d.key), onchange: (event) => {
      const next = dims.map((x) => x.key).filter((k) => (k === d.key ? event.target.checked : chosen.includes(k)));
      ex.facets = next;
      remember('lct-facets', next.join(','));
      refresh();
    }}), d.label)));
  const s = summary();
  $('#ex-summary').textContent = plural(s.rows, 'row') + ' in view across ' + plural(s.languages, 'language')
    + (s.images ? ', ' + fmtShort(s.images) + ' est. images' : '') + '.';
  $('#ex-facets').replaceChildren(...chosen.map((k) => facet(fieldOf('capability', k))));
  $('#ex-rows').replaceChildren(rowTable(rowsInView()));
}

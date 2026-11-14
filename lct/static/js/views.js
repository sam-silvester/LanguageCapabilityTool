// Table, Languages, History and Settings views, and the import dialog.
import {$, $$, el, app, api, mutate, refresh, toast, fmtInt, plural, idPath, fields, listNames, statuses, thresholds, swatch, inView,
  sliceActive} from './core.js';
import {openEditor, grid, sortRows} from './editor.js';
import {openRow, openLanguage, changeLine} from './drawer.js';

const matches = (row, q) => !q || Object.entries(row).some(([k, v]) => !k.startsWith('_') && String(v).toLowerCase().includes(q));
const toggleSort = (sort, key) => { if (sort.key === key) sort.dir = -sort.dir; else { sort.key = key; sort.dir = 1; } };
const rowButtons = (entity, row, path, key) => [
  el('button', {type: 'button', class: 'lct-btn lct-btn-quiet', text: 'View', title: 'Details and history',
    onclick: () => (entity === 'capability' ? openRow(row.id) : openLanguage(row.language))}),
  el('button', {type: 'button', class: 'lct-btn lct-btn-quiet', text: 'Edit', onclick: () => openEditor(entity, row)}),
  el('button', {type: 'button', class: 'lct-btn lct-btn-quiet', text: 'Delete', onclick: () => mutate(() => api.del(idPath(path, key)))})];

// ---- Table ---------------------------------------------------------------------------------------
const DEFAULT_COLS = ['id', 'language', 'content_type', 'record_type', 'tier', 'ft_status', 'ix_status', 'priority', 'est_images',
  'next_step', 'owner', 'target', 'as_of'];
const FILTERS = [['language', 'All languages'], ['content_type', 'All content types'], ['tier', 'All tiers'],
  ['ft_status', 'Any full-text status'], ['ix_status', 'Any index status']];
const tv = {q: '', all: false, sort: {key: '', dir: 1}, language: '', content_type: '', tier: '', ft_status: '', ix_status: ''};

export function initTable() {
  const tools = $('#table-tools');
  tools.append(
    el('input', {class: 'lct-input', id: 'tv-q', type: 'search', placeholder: 'Search every field', 'aria-label': 'Search rows',
      oninput: (e) => { tv.q = e.target.value.trim().toLowerCase(); drawTable(); }}),
    ...FILTERS.map(([key, label]) => el('select', {class: 'lct-select', id: 'tv-' + key, 'aria-label': label,
      onchange: (e) => { tv[key] = e.target.value; drawTable(); }})),
    el('label', {class: 'lct-check'}, el('input', {type: 'checkbox', id: 'tv-all', onchange: (e) => { tv.all = e.target.checked; drawTable(); }}), 'Show every column'),
    el('span', {class: 'lct-count', id: 'tv-count'}));
  $('#table-add').addEventListener('click', () => openEditor('capability', null, {language: tv.language, content_type: tv.content_type}));
}

function drawTable() {
  const all = app.data.capabilities;
  const rows = sortRows(all.filter((r) => inView(r) && matches(r, tv.q) && FILTERS.every(([key]) => !tv[key] || r[key] === tv[key])), tv.sort, 'capability');
  const columns = tv.all ? fields('capability') : DEFAULT_COLS.map((k) => fields('capability').find((f) => f.key === k)).filter(Boolean);
  $('#tv-count').textContent = (rows.length === all.length ? plural(all.length, 'row') : rows.length + ' of ' + plural(all.length, 'row'))
    + (sliceActive() ? ' (the filters shown at the top apply here too)' : '');
  grid($('#table-grid'), {
    entity: 'capability', rows, columns, sort: tv.sort,
    onSort: (key) => { toggleSort(tv.sort, key); drawTable(); },
    edit: (row, key, value) => mutate(() => api.put(idPath('/api/capabilities', row.id), {[key]: value})),
    rerender: drawTable,
    actions: (row) => rowButtons('capability', row, '/api/capabilities', row.id),
  });
}

export function renderTable() {
  for (const [key, label] of FILTERS) {
    const sel = $('#tv-' + key);
    const values = key.endsWith('_status') ? statuses()
      : Array.from(new Set(app.data.capabilities.map((r) => r[key]).filter(Boolean))).sort();
    if (tv[key] && !values.includes(tv[key])) tv[key] = '';
    sel.replaceChildren(new Option(label, ''), ...values.map((v) => new Option(v)));
    sel.value = tv[key];
  }
  drawTable();
}

// ---- Languages -----------------------------------------------------------------------------------
const lv = {q: '', sort: {key: '', dir: 1}};

export function initLanguages() {
  $('#lang-tools').append(
    el('input', {class: 'lct-input', type: 'search', placeholder: 'Search languages', 'aria-label': 'Search languages',
      oninput: (e) => { lv.q = e.target.value.trim().toLowerCase(); renderLanguages(); }}),
    el('span', {class: 'lct-count', id: 'lv-count'}));
  $('#lang-add').addEventListener('click', () => openEditor('language', null));
}

export function renderLanguages() {
  const counts = new Map();
  app.data.capabilities.forEach((r) => counts.set(r.language, (counts.get(r.language) || 0) + 1));
  const all = app.data.languages;
  const rows = sortRows(all.filter((r) => matches(r, lv.q)), lv.sort, 'language');
  $('#lv-count').textContent = rows.length === all.length ? plural(all.length, 'language') : rows.length + ' of ' + plural(all.length, 'language');
  grid($('#lang-grid'), {
    entity: 'language', rows, columns: fields('language'), sort: lv.sort,
    onSort: (key) => { toggleSort(lv.sort, key); renderLanguages(); },
    edit: (row, key, value) => mutate(() => api.put(idPath('/api/languages', row.language), {[key]: value})),
    rerender: renderLanguages,
    computed: [{label: 'Capability rows', value: (row) => counts.get(row.language) || 0}],
    actions: (row) => rowButtons('language', row, '/api/languages', row.language),
  });
}

// ---- History -------------------------------------------------------------------------------------
const hv = {changes: [], more: false, token: 0};
const SOURCE = {tool: 'Edited in the tool', paint: 'Painted on the heatmap', import: 'Spreadsheet import', cli: 'Command line',
  undo: 'Reverted', sample: 'Sample data'};
function drawChanges() {
  const batches = [];
  const byId = new Map();
  for (const ch of hv.changes) {
    let b = byId.get(ch.batch);
    if (!b) { b = {batch: ch.batch, ts: ch.ts, user: ch.user, source: ch.source, items: []}; byId.set(ch.batch, b); batches.push(b); }
    b.items.push(ch);
  }
  const out = batches.map((b) => {
    const first = b.items.slice(0, 6), rest = b.items.slice(6);
    return el('article', {class: 'lct-batch'},
      el('div', {class: 'lct-batch-h'},
        el('strong', {text: SOURCE[b.source] || b.source || 'Change'}),
        el('span', {class: 'lct-meta', text: new Date(b.ts).toLocaleString()}),
        el('span', {class: 'lct-meta', text: (b.user ? 'by ' + b.user + ', ' : '') + plural(b.items.length, 'change')}),
        b.source === 'sample' ? null : el('button', {type: 'button', class: 'lct-btn', text: 'Revert',
          onclick: () => mutate(() => api.post('/api/undo', {batch: b.batch}))})),
      el('ul', {class: 'lct-batch-list'}, ...first.map((ch) => changeLine(ch, true))),
      rest.length ? el('details', {}, el('summary', {class: 'lct-cap', text: plural(rest.length, 'more change')}),
        el('ul', {class: 'lct-batch-list'}, ...rest.map((ch) => changeLine(ch, true)))) : null);
  });
  $('#changes').replaceChildren(...(out.length ? out : [el('p', {class: 'lct-cap', text: 'No changes yet.'})]));
  $('#changes-more').hidden = !hv.more;
}

function drawProgress(snaps) {
  const box = $('#progress');
  const {prod, gap} = thresholds();
  const names = statuses();
  const total = (counts, test) => Object.entries(counts || {}).reduce((sum, [name, n]) => sum + (test(names.indexOf(name) + 1) ? n : 0), 0);
  const series = [
    {label: 'Full text in production', color: 'var(--tier-mid)', value: (s) => total(s.ft, (r) => r >= prod)},
    {label: 'Index in production', color: 'var(--tier-top)', value: (s) => total(s.ix, (r) => r >= prod)},
    {label: 'Gap statuses recorded', color: 'var(--s4)', value: (s) => total(s.ft, (r) => gap && r === gap) + total(s.ix, (r) => gap && r === gap)},
  ];
  $('#progress-legend').replaceChildren(...series.map((s) => el('span', {class: 'lct-key'}, el('i', {class: 'lct-sw', style: 'background-color:' + s.color}), s.label)));
  if (!snaps.length) { box.textContent = '—'; return; }
  const W = Math.max(box.clientWidth, 280), H = 200, m = {t: 14, r: 44, b: 26, l: 36};
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('class', 'lct-svg').attr('aria-hidden', 'true').attr('viewBox', '0 0 ' + W + ' ' + H).attr('width', '100%').attr('height', H);
  const x = d3.scalePoint().domain(snaps.map((s) => s.day)).range([m.l, W - m.r]).padding(0.5);
  const y = d3.scaleLinear().domain([0, d3.max(snaps, (s) => d3.max(series, (se) => se.value(s))) || 1]).nice().range([H - m.b, m.t]);
  const step = Math.max(1, Math.ceil(snaps.length / Math.max(2, Math.floor((W - m.l - m.r) / 80))));
  svg.append('g').attr('class', 'lct-axis').attr('transform', 'translate(0,' + (H - m.b) + ')')
    .call(d3.axisBottom(x).tickValues(snaps.map((s) => s.day).filter((d, i) => i % step === 0)).tickSizeOuter(0));
  svg.append('g').attr('class', 'lct-axis').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
  series.forEach((se) => {
    svg.append('path').attr('class', 'lct-line2').style('stroke', se.color).attr('d', d3.line().x((s) => x(s.day)).y((s) => y(se.value(s)))(snaps));
    svg.append('g').selectAll('circle').data(snaps).join('circle').attr('r', 3).style('fill', se.color).attr('cx', (s) => x(s.day)).attr('cy', (s) => y(se.value(s)));
    const last = snaps[snaps.length - 1];
    svg.append('text').attr('class', 'lct-endlab').attr('x', x(last.day) + 8).attr('y', y(se.value(last))).attr('dy', '0.35em').text(se.value(last));
  });
}

async function loadHistory(older) {
  const token = ++hv.token;
  try {
    const before = older && hv.changes.length ? hv.changes[hv.changes.length - 1].id : 0;
    const [ch, sn] = await Promise.all([api.get('/api/changes?limit=400' + (before ? '&before=' + before : '')), api.get('/api/snapshots')]);
    if (token !== hv.token) return;
    hv.changes = older ? hv.changes.concat(ch.changes) : ch.changes;
    hv.more = ch.changes.length === 400;
    drawProgress(sn.snapshots);
    drawChanges();
  } catch (err) {
    toast(err.message, null, true);
  }
}
export function initHistory() { $('#changes-more').addEventListener('click', () => loadHistory(true)); }
export function renderHistory() { loadHistory(false); }

// ---- Settings ------------------------------------------------------------------------------------
const itemsToText = (items) => items.map((i) => (i.description ? i.name + ' | ' + i.description : i.name)).join('\n');
const textToItems = (text) => text.split('\n').map((line) => {
  const at = line.indexOf('|');
  return at < 0 ? {name: line.trim(), description: ''} : {name: line.slice(0, at).trim(), description: line.slice(at + 1).trim()};
}).filter((i) => i.name);

export function initSettings() {
  $('#set-save').addEventListener('click', () => mutate(() => api.put('/api/meta', {name: $('#set-name').value, id_prefix: $('#set-prefix').value})));
}

export function renderSettings() {
  if (document.activeElement !== $('#set-name')) $('#set-name').value = app.data.meta.name || '';
  if (document.activeElement !== $('#set-prefix')) $('#set-prefix').value = app.data.meta.id_prefix || '';
  const box = $('#lists');
  const names = Object.keys(app.data.lists);
  if ($$('.lct-card', box).map((c) => c.dataset.list).join('\n') !== names.join('\n')) {
    box.replaceChildren(...names.map((name) => {
      const area = el('textarea', {class: 'lct-textarea', rows: 8, 'aria-label': name + ' values', oninput: () => { area.dataset.dirty = '1'; }});
      return el('article', {class: 'lct-card', dataset: {list: name}}, el('h3', {class: 'lct-h3', text: name}), area,
        el('div', {}, el('button', {type: 'button', class: 'lct-btn', text: 'Save list', onclick: async () => {
          const res = await mutate(() => api.put(idPath('/api/lists', name), {items: textToItems(area.value)}));
          if (res) { delete area.dataset.dirty; area.value = itemsToText(app.data.lists[name] || []); }
        }})));
    }));
  }
  $$('.lct-card', box).forEach((card) => {
    const area = $('textarea', card);
    if (!area.dataset.dirty) area.value = itemsToText(app.data.lists[card.dataset.list] || []);
  });
}

// ---- Import --------------------------------------------------------------------------------------
function importUrl(apply) {
  const file = $('#imp-file').files[0];
  const strategy = $('input[name="imp-strategy"]:checked').value;
  return '/api/import?filename=' + encodeURIComponent(file.name) + '&strategy=' + strategy + '&sheet=' + $('#imp-sheet').value + (apply ? '&apply=1' : '');
}

function showReport(rep) {
  const row = (label, r) => [el('span', {text: label}), el('span', {text: r.added + ' added'}), el('span', {text: r.changed + ' changed'}),
    el('span', {text: r.unchanged + ' unchanged'}), el('span', {text: r.removed + ' removed'})];
  const fieldLabel = (entity, key) => { const f = (app.data.fields[entity] || []).find((x) => x.key === key); return f ? f.label : key; };
  const lines = rep.details.slice(0, 60).map((d) => {
    const what = (d.entity === 'language' ? 'Language ' : '') + d.id;
    if (d.action !== 'changed') return el('li', {text: what + ': ' + d.action});
    return el('li', {text: what + ': ' + d.changes.map((c) => fieldLabel(d.entity, c.field) + ' ' + (c.old === '' ? 'blank' : c.old) + ' → ' + (c.new === '' ? 'blank' : c.new)).join('; ')});
  });
  $('#imp-report').replaceChildren(
    el('strong', {text: rep.strategy === 'replace' ? 'Preview of Replace' : 'Preview of Merge'}),
    el('div', {class: 'lct-report-counts'}, ...row('Capability rows', rep.capabilities), ...row('Languages', rep.languages)),
    rep.new_fields.length ? el('p', {class: 'lct-p', text: 'New fields: ' + rep.new_fields.map((f) => f.label).join(', ') + '.'}) : null,
    rep.lists.length ? el('p', {class: 'lct-p', text: 'Dropdown lists replaced from the file: ' + rep.lists.join(', ') + '.'}) : null,
    ...rep.warnings.map((w) => el('p', {class: 'lct-error', text: w})),
    lines.length ? el('ul', {class: 'lct-report-list'}, ...lines, rep.details.length > 60 ? el('li', {text: 'and more'}) : null) : null);
}

export function openImport() {
  $('#imp-file').value = '';
  $('#imp-report').replaceChildren();
  $('#imp-error').textContent = '';
  $('#imp-apply').disabled = true;
  $('#imp-sheet-wrap').hidden = true;
  $('input[name="imp-strategy"][value="' + (app.data.meta.sample ? 'replace' : 'merge') + '"]').checked = true;
  $('#dlg-import').showModal();
}

export function initImport() {
  const stale = () => { $('#imp-apply').disabled = true; $('#imp-report').replaceChildren(); $('#imp-error').textContent = ''; };
  $('#imp-file').addEventListener('change', () => {
    const file = $('#imp-file').files[0];
    $('#imp-sheet-wrap').hidden = !(file && /\.csv$/i.test(file.name));
    stale();
  });
  $('#imp-sheet').addEventListener('change', stale);
  $$('input[name="imp-strategy"]').forEach((r) => r.addEventListener('change', stale));
  $('#imp-cancel').addEventListener('click', () => $('#dlg-import').close());
  $('#imp-preview').addEventListener('click', async () => {
    const file = $('#imp-file').files[0];
    if (!file) { $('#imp-error').textContent = 'Choose a file first.'; return; }
    stale();
    try {
      showReport(await api.upload(importUrl(false), file));
      $('#imp-apply').disabled = false;
    } catch (err) {
      $('#imp-error').textContent = err.message;
    }
  });
  $('#imp-apply').addEventListener('click', async () => {
    const file = $('#imp-file').files[0];
    if (!file) return;
    $('#imp-apply').disabled = true;
    try {
      const rep = await api.upload(importUrl(true), file);
      app.data = rep.state;
      app.sel = {lang: '', ctype: ''};
      $('#dlg-import').close();
      refresh();
      toast(rep.message, rep.batch);
    } catch (err) {
      $('#imp-error').textContent = err.message;
    }
  });
}

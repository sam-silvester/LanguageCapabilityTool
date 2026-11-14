// Two ways to edit a record: the dialog with every field, and the click-to-edit table.
import {$, el, app, api, refresh, toast, fields, listNames, statuses, idPath, slug, fmtInt, statusChip} from './core.js';

const PATH = {capability: '/api/capabilities', language: '/api/languages'};
const keyOf = (entity, row) => (entity === 'capability' ? row.id : row.language);
let ctx = null;

function control(f, value, entity, isNew, datalist) {
  const shown = value === undefined || value === null ? '' : String(value);
  let input;
  if (f.type === 'status') {
    const names = statuses();
    input = el('select', {class: 'lct-select'});
    if (shown && !names.includes(shown)) input.append(new Option(shown));
    names.forEach((name) => input.append(new Option(name)));
    input.value = shown || (names.includes('Not assessed') ? 'Not assessed' : names[0] || '');
  } else if (f.type === 'long') {
    input = el('textarea', {class: 'lct-textarea', rows: 3, value: shown});
  } else {
    input = el('input', {class: 'lct-input', type: 'text', value: shown});
    if (f.type === 'int') input.inputMode = 'numeric';
    if (f.type === 'list' && f.list) input.setAttribute('list', datalist(f.list, listNames(f.list)));
    if (f.type === 'language') input.setAttribute('list', datalist('languages', app.data.languages.map((l) => l.language)));
    if (f.type === 'id' && entity === 'capability') {
      if (isNew) input.placeholder = 'Assigned when you save';
      else input.readOnly = true;
    }
  }
  input.name = f.key;
  ctx.controls.set(f.key, input);
  return el('label', {class: 'lct-field' + (f.type === 'long' ? ' lct-field-wide' : '')}, f.label, input);
}

/** Open the dialog for a capability row or a language. `preset` pre-fills a new record. */
export function openEditor(entity, row, preset) {
  const isNew = !row;
  ctx = {entity, original: row || {}, isNew, controls: new Map()};
  const values = Object.assign({}, preset || {}, row || {});
  $('#edit-title').textContent = entity === 'capability'
    ? (isNew ? 'Add a capability row' : 'Edit ' + row.id)
    : (isNew ? 'Add a language' : 'Edit ' + row.language);
  $('#edit-error').textContent = '';
  $('#edit-save').textContent = isNew ? (entity === 'capability' ? 'Add row' : 'Add language') : 'Save changes';
  const lists = el('div', {hidden: true}), made = new Set();
  const datalist = (name, values) => {
    const id = 'dl-' + slug(name);
    if (!made.has(id)) { made.add(id); lists.append(el('datalist', {id}, ...values.map((v) => el('option', {value: v})))); }
    return id;
  };
  const groups = new Map();
  fields(entity).forEach((f) => { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); });
  const body = $('#edit-body');
  body.replaceChildren();
  for (const [group, list] of groups) {
    body.append(el('fieldset', {class: 'lct-fieldset'}, el('legend', {text: group || 'More'}),
      ...list.map((f) => control(f, values[f.key], entity, isNew, datalist))));
  }
  body.append(lists);
  $('#dlg-edit').showModal();
}

export function initEditor() {
  $('#edit-cancel').addEventListener('click', () => $('#dlg-edit').close());
  $('#edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const {entity, original, isNew, controls} = ctx;
    const data = {};
    for (const f of fields(entity)) {
      const input = controls.get(f.key);
      if (!input) continue;
      const value = input.value.trim();
      const before = original[f.key] === undefined || original[f.key] === null ? '' : String(original[f.key]);
      if (isNew) { if (value !== '') data[f.key] = value; }
      else if (value !== before && !(f.type === 'id' && entity === 'capability')) data[f.key] = value;
    }
    if (!isNew && !Object.keys(data).length) { $('#dlg-edit').close(); return; }
    try {
      const res = isNew ? await api.post(PATH[entity], data) : await api.put(idPath(PATH[entity], keyOf(entity, original)), data);
      app.data = res.state;
      $('#dlg-edit').close();
      refresh();
      toast(res.message, res.batch);
    } catch (err) {
      $('#edit-error').textContent = err.message;
    }
  });
}

// ---- click-to-edit table -------------------------------------------------------------------------
function startEdit(td, row, f, cfg) {
  if (td.classList.contains('lct-editing')) return;
  const before = row[f.key] === undefined || row[f.key] === null ? '' : String(row[f.key]);
  let input, extra = null;
  if (f.type === 'status') {
    const names = statuses();
    input = el('select', {class: 'lct-select'});
    if (!names.includes(before)) input.append(new Option(before || 'No status', before));
    names.forEach((name) => input.append(new Option(name)));
    input.value = before;
  } else if (f.type === 'long') {
    input = el('textarea', {class: 'lct-textarea', rows: 4, value: before});
  } else {
    input = el('input', {class: 'lct-input', type: 'text', value: before});
    const options = f.type === 'language' ? app.data.languages.map((l) => l.language) : (f.type === 'list' && f.list ? listNames(f.list) : null);
    if (options) {
      extra = el('datalist', {id: 'dl-cell'}, ...options.map((v) => el('option', {value: v})));
      input.setAttribute('list', 'dl-cell');
    }
  }
  input.setAttribute('aria-label', f.label);
  td.classList.add('lct-editing');
  td.replaceChildren(input, extra);
  input.focus();
  if (input.select) input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value !== before) cfg.edit(row, f.key, value);
    else cfg.rerender();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    else if (event.key === 'Enter' && !(f.type === 'long' && event.shiftKey)) { event.preventDefault(); finish(true); }
  });
  input.addEventListener('blur', () => finish(true));
  if (f.type === 'status') input.addEventListener('change', () => finish(true));
}

/**
 * Draw an editable table into `box`.
 * cfg: {entity, rows, columns, sort: {key, dir}, onSort(key), edit(row, key, value), rerender(), actions(row), computed: [{label, value(row)}]}
 */
export function grid(box, cfg) {
  const top = box.scrollTop, left = box.scrollLeft;
  const head = el('tr', {},
    ...cfg.columns.map((f) => el('th', {scope: 'col', title: 'Sort by ' + f.label, onclick: () => cfg.onSort(f.key)},
      f.label + (cfg.sort.key === f.key ? (cfg.sort.dir > 0 ? ' ▲' : ' ▼') : ''))),
    ...(cfg.computed || []).map((c) => el('th', {scope: 'col', class: 'lct-noclick', text: c.label})),
    el('th', {scope: 'col', class: 'lct-noclick', text: 'Actions'}));
  const body = cfg.rows.map((row) => el('tr', {},
    ...cfg.columns.map((f) => {
      const value = row[f.key];
      const locked = f.type === 'id' && cfg.entity === 'capability';
      const td = el('td', {class: (locked ? '' : 'lct-edit') + (f.type === 'int' ? ' lct-num' : '') + (f.type === 'long' ? ' lct-long' : '')});
      if (f.type === 'status') td.append(statusChip(value));
      else td.textContent = value === undefined || value === null ? '' : (f.type === 'int' && typeof value === 'number' ? fmtInt(value) : String(value));
      if (!locked) td.addEventListener('click', () => startEdit(td, row, f, cfg));
      return td;
    }),
    ...(cfg.computed || []).map((c) => el('td', {class: 'lct-num', text: c.value(row)})),
    el('td', {class: 'lct-rowacts'}, ...cfg.actions(row))));
  box.replaceChildren(el('table', {class: 'lct-grid'}, el('thead', {}, head), el('tbody', {}, ...body)));
  box.scrollTop = top;
  box.scrollLeft = left;
}

export function sortRows(rows, sort, entity) {
  if (!sort.key) return rows;
  const f = fields(entity).find((x) => x.key === sort.key);
  const rank = f && f.type === 'status' ? (v) => statuses().indexOf(v) : null;
  return rows.slice().sort((a, b) => {
    let x = a[sort.key], y = b[sort.key];
    if (rank) { x = rank(x); y = rank(y); }
    const ex = x === undefined || x === '' || x === null, ey = y === undefined || y === '' || y === null;
    if (ex || ey) return ex === ey ? 0 : (ex ? 1 : -1);           // blanks last, whichever way the sort runs
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
    return String(x).localeCompare(String(y), undefined, {numeric: true}) * sort.dir;
  });
}

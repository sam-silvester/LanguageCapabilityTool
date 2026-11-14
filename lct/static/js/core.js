// Shared pieces: DOM helpers, API calls, app state, filters ("the slice"), the undo toast and derived tables.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Build an element. Data always goes in as text, never as HTML. */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key !== 'list' && key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const fmtInt = (n) => Number(n).toLocaleString('en-US');
export const fmtShort = (n) => d3.format('.3~s')(n).replace('G', 'B');
export const plural = (n, one, many) => (n === 1 ? '1 ' + one : n + ' ' + (many || one + 's'));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (err) { /* private mode */ } };
export const recall = (key) => { try { return localStorage.getItem(key) || ''; } catch (err) { return ''; } };

// ---- state -------------------------------------------------------------------------------
export const app = {
  data: null,                       // everything the server holds: rows, languages, fields, lists
  view: 'heatmap',
  slice: {},                        // filters shared by every page: field key -> selected values ('' means blank)
  search: '',                       // free-text part of the slice, lower case
  hideEmpty: false,                 // heatmap: drop languages with no rows in view
  cellView: 'both',                 // both | ft | ix
  sel: {lang: '', ctype: ''},
  paint: {on: false, side: 'ft', status: ''},
  drawer: null,                     // {type: 'capability', id} or {type: 'language', name}
  user: '',
};
const listeners = [];
export const onChange = (fn) => listeners.push(fn);
export const refresh = () => listeners.forEach((fn) => fn());
export function goto(view) {
  app.view = view;
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  refresh();
  window.scrollTo(0, 0);
}

// ---- API ---------------------------------------------------------------------------------
async function request(method, path, body, file) {
  const headers = {'X-Requested-With': 'lct', 'X-User': encodeURIComponent(app.user || '')};
  let payload;
  if (file) {
    payload = file;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(path, {method, headers, body: payload});
  } catch (err) {
    throw new Error('Can’t reach the server. Check that it is still running.');
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* not JSON */ }
  if (!res.ok) throw new Error((data && data.error) || 'The request failed (' + res.status + ').');
  return data;
}
export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body === undefined ? {} : body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, file) => request('POST', path, undefined, file),
};
export const idPath = (base, id) => base + '/' + encodeURIComponent(id);

export async function loadState() {
  app.data = await api.get('/api/state');
  refresh();
}

/** Run a change, take the new state from the answer and offer Undo. Returns null when it failed. */
export async function mutate(call, quiet) {
  try {
    const res = await call();
    if (res.state) app.data = res.state;
    refresh();
    if (res.message && !quiet) toast(res.message, res.batch);
    return res;
  } catch (err) {
    toast(err.message, null, true);
    refresh();
    return null;
  }
}

// ---- toast -------------------------------------------------------------------------------
let toastTimer = 0;
export function toast(message, batch, bad) {
  const box = $('#toast');
  $('#toast-text').textContent = message;
  box.classList.toggle('lct-toast-bad', !!bad);
  const undo = $('#toast-undo');
  undo.hidden = !batch;
  undo.onclick = batch ? () => { box.hidden = true; mutate(() => api.post('/api/undo', {batch})); } : null;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, bad ? 12000 : 9000);
}

// ---- lookups -----------------------------------------------------------------------------
export const fields = (entity) => app.data.fields[entity];
export const fieldOf = (entity, key) => fields(entity).find((f) => f.key === key);
export const labelOf = (key, entity) => { const f = fieldOf(entity || 'capability', key); return f ? f.label : key; };
export const listNames = (name) => ((app.data.lists || {})[name] || []).map((i) => i.name);
export const statuses = () => listNames('Status');
export const rankOf = (status) => statuses().indexOf(status) + 1;         // 0 = not on the scale
export const swatch = (rank) => 'var(--s' + (rank >= 1 && rank <= 10 ? rank : 0) + ')';
export const onSwatch = (rank) => (rank >= 1 && rank <= 10 ? 'var(--on-s' + rank + ')' : 'var(--ink)');
export const cellValue = (row, key) => { const v = row[key]; return v === undefined || v === null ? '' : String(v); };
export const shown = (value) => (value === '' ? '(blank)' : value);

/** Rank from which a row counts as "in production", and the rank that marks a gap. */
export function thresholds() {
  const names = statuses();
  const prod = names.indexOf('Production (partial)') + 1 || Math.max(1, Math.ceil(names.length * 0.8));
  const gap = names.indexOf('Gap (no capability)') + 1;
  return {prod, gap};
}

// ---- the slice: one set of filters that every page respects ----------------------------------------
/** Does a capability row pass the slice? `except` leaves one field out, so a breakdown can show its own alternatives. */
export function inView(row, except) {
  for (const key of Object.keys(app.slice)) {
    if (key !== except && !app.slice[key].includes(cellValue(row, key))) return false;
  }
  if (app.search && !Object.entries(row).some(([k, v]) => !k.startsWith('_') && String(v).toLowerCase().includes(app.search))) return false;
  return true;
}
export const rowsInView = () => app.data.capabilities.filter((r) => inView(r));
export const langInView = (l) => (!app.slice.script || app.slice.script.includes(l.script || ''))
  && (!app.slice.language || app.slice.language.includes(l.language));
export function setSlice(key, values) {
  if (values && values.length) app.slice[key] = values.slice(); else delete app.slice[key];
  refresh();
}
export function toggleSlice(key, value) {
  const current = app.slice[key] || [];
  setSlice(key, current.includes(value) ? current.filter((v) => v !== value) : current.concat([value]));
}
export function clearSlice() { app.slice = {}; app.search = ''; refresh(); }
export const sliceActive = () => Object.keys(app.slice).length > 0 || !!app.search;

/** Fields worth slicing by: not free text, not numbers, and with a manageable number of values in use. */
export function dimensions() {
  return fields('capability').filter((f) => !['id', 'long', 'int'].includes(f.type)).filter((f) => {
    const seen = new Set();
    for (const row of app.data.capabilities) {
      const v = cellValue(row, f.key);
      if (v) seen.add(v);
      if (seen.size > 80) return false;
    }
    return seen.size >= 1;
  });
}
/** A sensible order for a field's values: the status scale, the list order, the language order, else A to Z. Blank last. */
export function orderValues(key, values) {
  const f = fieldOf('capability', key);
  let order = [];
  if (f && f.type === 'status') order = statuses().slice().reverse();
  else if (f && f.type === 'language') order = app.data.languages.map((l) => l.language);
  else if (f && f.list) order = listNames(f.list);
  const pos = new Map(order.map((v, i) => [v, i]));
  const at = (v) => (pos.has(v) ? pos.get(v) : 1e6);
  return Array.from(values).sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || at(a) - at(b) || a.localeCompare(b, undefined, {numeric: true}));
}

// ---- derived tables ----------------------------------------------------------------------
export function contentTypes() {
  // Content types that have at least one row, in list order; ones missing from the list go last.
  const order = new Map(listNames('Content type').map((n, i) => [n, i]));
  const used = Array.from(new Set(app.data.capabilities.map((r) => r.content_type).filter(Boolean)));
  return used.sort((a, b) => (order.has(a) ? order.get(a) : 1e6) - (order.has(b) ? order.get(b) : 1e6) || a.localeCompare(b));
}

export function coverage() {
  const cells = new Map();
  for (const row of app.data.capabilities) {
    if (!inView(row)) continue;
    const key = row.language + '|' + row.content_type;
    let cell = cells.get(key);
    if (!cell) {
      cell = {rows: 0, est_images: 0, ft_rank: -1, ft_status: '', ix_rank: -1, ix_status: ''};
      cells.set(key, cell);
    }
    cell.rows += 1;
    cell.est_images += Number(row.est_images) || 0;
    const ft = rankOf(row.ft_status), ix = rankOf(row.ix_status);
    if (ft > cell.ft_rank) { cell.ft_rank = ft; cell.ft_status = row.ft_status || ''; }
    if (ix > cell.ix_rank) { cell.ix_rank = ix; cell.ix_status = row.ix_status || ''; }
  }
  return cells;
}

export function statusCounts() {
  const byRank = new Map();
  const bump = (status, field) => {
    const rank = rankOf(status);
    let entry = byRank.get(rank);
    if (!entry) { entry = {rank, status: rank ? status : 'No status', ft: 0, ix: 0}; byRank.set(rank, entry); }
    entry[field] += 1;
  };
  for (const row of app.data.capabilities) {
    if (!inView(row)) continue;
    bump(row.ft_status, 'ft');
    bump(row.ix_status, 'ix');
  }
  return Array.from(byRank.values()).sort((a, b) => b.rank - a.rank);
}

export function summary() {
  const {prod, gap} = thresholds();
  const out = {rows: 0, ft: 0, ix: 0, gap: 0, images: 0, languages: 0};
  const langs = new Set();
  for (const row of app.data.capabilities) {
    if (!inView(row)) continue;
    const ft = rankOf(row.ft_status), ix = rankOf(row.ix_status);
    out.rows += 1;
    out.images += Number(row.est_images) || 0;
    langs.add(row.language);
    if (ft >= prod) out.ft += 1;
    if (ix >= prod) out.ix += 1;
    if (gap && (ft === gap || ix === gap)) out.gap += 1;
  }
  out.languages = langs.size;
  return out;
}

export function backlog() {
  return app.data.languages
    .filter(langInView)
    .map((l) => {
      const mid = Number(l.mid_tier_unindexed) || 0, top = Number(l.top_tier_unindexed) || 0;
      return {language: l.language, mid, top, total: mid + top};
    })
    .filter((l) => l.total > 0)
    .sort((a, b) => b.total - a.total);
}

export const selectedRows = () => app.data.capabilities.filter((r) => (!app.sel.lang || r.language === app.sel.lang)
  && (!app.sel.ctype || r.content_type === app.sel.ctype) && inView(r));

// ---- small shared widgets ----------------------------------------------------------------------
/** A tooltip that lives inside a chart box. show() takes the nodes to display. */
export function makeTip(box) {
  const tip = el('div', {class: 'lct-tip', hidden: true});
  box.appendChild(tip);
  return {
    show(event, nodes) {
      tip.replaceChildren(...nodes.filter(Boolean));
      tip.hidden = false;
      const pt = d3.pointer(event, box);
      const w = tip.offsetWidth, h = tip.offsetHeight, W = box.clientWidth, H = box.clientHeight;
      tip.style.left = Math.max(0, Math.min(pt[0] + 12, W - w - 2)) + 'px';
      tip.style.top = (pt[1] + 16 + h > H && pt[1] - h - 8 > 0 ? pt[1] - h - 8 : pt[1] + 16) + 'px';
    },
    hide() { tip.hidden = true; },
  };
}

export const statusChip = (status) => {
  const rank = rankOf(status);
  return el('span', {class: 'lct-cellstatus'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(rank)}), status || '—');
};

/** A status dropdown that saves as soon as it changes. */
export function statusPick(row, key) {
  const current = row[key] || '';
  const names = statuses();
  const sel = el('select', {class: 'lct-select', 'aria-label': (key === 'ft_status' ? 'Full-text' : 'Index') + ' status of ' + row.id});
  if (!names.includes(current)) sel.append(new Option(current || 'No status', current));
  names.forEach((name) => sel.append(new Option(name)));
  sel.value = current;
  sel.onchange = () => mutate(() => api.put(idPath('/api/capabilities', row.id), {[key]: sel.value}));
  return el('span', {class: 'lct-status-pick'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(rankOf(current))}), sel);
}

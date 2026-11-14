// The details drawer: everything known about one capability row or one language, with its history
// and links to related rows. Also the clickable row list that the analysis pages share.
import {$, el, app, api, mutate, refresh, goto, fmtInt, fmtShort, plural, idPath, fields, labelOf, rankOf, swatch, statusChip,
  statusPick, setSlice, contentTypes} from './core.js';
import {openEditor} from './editor.js';

let token = 0;

export function openDrawer(target) {
  app.drawer = target;
  renderDrawer();
}
export function closeDrawer() {
  app.drawer = null;
  $('#drawer').hidden = true;
}
const openRow = (id) => openDrawer({type: 'capability', id});
const openLanguage = (name) => openDrawer({type: 'language', name});
const linkButton = (text, onclick, cls) => el('button', {type: 'button', class: cls || 'lct-linkbtn', text, onclick});
const twoTone = (row) => el('span', {class: 'lct-split', 'aria-hidden': 'true'},
  el('i', {class: 'lct-split-l', style: 'background-color:' + swatch(rankOf(row.ft_status))}),
  el('i', {class: 'lct-split-r', style: 'background-color:' + swatch(rankOf(row.ix_status))}));

// ---- change history lines (also used by the History page) ----------------------------------------
const META = {name: 'Dataset name', id_prefix: 'ID prefix', sample: 'Sample data'};
export function changeLine(ch, withLinks, bare) {
  const parse = (text) => { try { return JSON.parse(text); } catch (err) { return {}; } };
  const exists = ch.entity === 'capability' ? app.data.capabilities.some((r) => r.id === ch.entity_id)
    : ch.entity === 'language' && app.data.languages.some((l) => l.language === ch.entity_id);
  const name = ch.entity === 'language' ? 'Language ' + ch.entity_id : ch.entity_id;
  const what = bare ? '' : (withLinks && exists
    ? linkButton(name, () => (ch.entity === 'language' ? openLanguage(ch.entity_id) : openRow(ch.entity_id)))
    : name);
  if (ch.entity === 'list') return el('li', {text: 'List “' + ch.entity_id + '” ' + (ch.action === 'create' ? 'created' : 'changed')});
  if (ch.entity === 'meta') {
    const say = (value) => (ch.entity_id === 'sample' ? (value === '1' ? 'on' : 'off') : (value || 'blank'));
    return el('li', {}, (META[ch.entity_id] || ch.entity_id) + ': ', el('span', {class: 'lct-old', text: say(ch.old)}), ' → ' + say(ch.new));
  }
  if (ch.action === 'create' || ch.action === 'delete') {
    const row = parse(ch.action === 'create' ? ch.new : ch.old);
    const about = ch.entity === 'capability' && row.language ? ' (' + row.language + ' / ' + (row.content_type || '') + ')' : '';
    return el('li', {}, ch.action === 'create' ? 'Added' : 'Deleted', bare ? '' : ' ', what, bare ? '' : about);
  }
  return el('li', {}, what, (bare ? '' : ' ') + labelOf(ch.field, ch.entity) + ': ', el('span', {class: 'lct-old', text: ch.old || 'blank'}), ' → ' + (ch.new || 'blank'));
}

// ---- the clickable row list ----------------------------------------------------------------------
const LIST_COLS = [['id', 'ID'], ['language', 'Language'], ['content_type', 'Content type'], ['tier', 'Tier'], ['ft_status', 'Full text'],
  ['ix_status', 'Index'], ['est_images', 'Est. images'], ['priority', 'Priority'], ['next_step', 'Next step']];

/** A read-only table of capability rows. Selecting a row opens its details. */
export function rowTable(rows, limit) {
  const max = limit || 150;
  if (!rows.length) return el('p', {class: 'lct-cap', text: 'No rows match.'});
  const body = rows.slice(0, max).map((row) => {
    const go = () => openRow(row.id);
    return el('tr', {class: 'lct-rowlink', tabindex: 0, role: 'button', 'aria-label': 'Details for ' + row.id, onclick: go,
      onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } }},
      ...LIST_COLS.map(([key]) => {
        const v = row[key];
        if (key.endsWith('_status')) return el('td', {}, statusChip(v));
        if (key === 'est_images') return el('td', {class: 'lct-num', text: typeof v === 'number' ? fmtInt(v) : (v || '')});
        return el('td', {class: key === 'next_step' ? 'lct-long' : '', text: v === undefined || v === null ? '' : String(v)});
      }));
  });
  return el('div', {class: 'lct-sec'},
    el('div', {class: 'lct-gridwrap lct-gridwrap-free'}, el('table', {class: 'lct-grid'},
      el('thead', {}, el('tr', {}, ...LIST_COLS.map(([, label]) => el('th', {scope: 'col', class: 'lct-noclick', text: label})))),
      el('tbody', {}, ...body))),
    rows.length > max ? el('p', {class: 'lct-cap', text: 'Showing the first ' + max + ' of ' + rows.length + ' rows. Narrow the filters to see the rest.'}) : null);
}

// ---- drawer content ------------------------------------------------------------------------------
function fieldSections(entity, row, skip) {
  const groups = new Map();
  for (const f of fields(entity)) {
    const v = row[f.key];
    if (skip.includes(f.key) || v === undefined || v === null || v === '') continue;
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(el('div', {class: 'lct-kv'}, el('dt', {text: f.label}),
      el('dd', {text: f.type === 'int' && typeof v === 'number' ? fmtInt(v) : String(v)})));
  }
  return Array.from(groups, ([group, items]) => el('section', {class: 'lct-drawer-sec'}, el('h3', {class: 'lct-h3', text: group || 'More'}), el('dl', {class: 'lct-dl'}, ...items)));
}

function historyBox(entity, id) {
  const list = el('ul', {class: 'lct-batch-list'}, el('li', {text: 'Loading…'}));
  const mine = ++token;
  api.get('/api/changes?limit=60&entity=' + entity + '&entity_id=' + encodeURIComponent(id)).then((res) => {
    if (mine !== token) return;
    const items = res.changes.map((ch) => el('li', {},
      el('span', {class: 'lct-meta', text: new Date(ch.ts).toLocaleDateString() + (ch.user ? ' ' + ch.user : '') + ': '}),
      ...Array.from(changeLine(ch, false, true).childNodes)));
    list.replaceChildren(...(items.length ? items : [el('li', {text: 'No changes recorded.'})]));
  }).catch(() => { if (mine === token) list.replaceChildren(el('li', {text: 'History couldn’t be loaded.'})); });
  return el('section', {class: 'lct-drawer-sec'}, el('h3', {class: 'lct-h3', text: 'History'}), list);
}

const related = (title, rows, label) => (rows.length ? el('section', {class: 'lct-drawer-sec'}, el('h3', {class: 'lct-h3', text: title}),
  el('div', {class: 'lct-related'}, ...rows.slice(0, 14).map((r) => el('button', {type: 'button', class: 'lct-relbtn', onclick: () => openRow(r.id)},
    twoTone(r), el('span', {class: 'lct-id', text: r.id}), label(r))),
  rows.length > 14 ? el('span', {class: 'lct-cap', text: 'and ' + (rows.length - 14) + ' more'}) : null)) : null);

function capabilityView(row) {
  const all = app.data.capabilities;
  const showOnMap = () => { app.sel = {lang: row.language, ctype: row.content_type || ''}; closeDrawer(); goto('heatmap'); };
  return [
    el('div', {class: 'lct-drawer-head'},
      el('div', {class: 'lct-drawer-title'},
        el('span', {class: 'lct-id', text: row.id + (row.tier ? '  ' + row.tier : '')}),
        el('h2', {class: 'lct-h2'}, linkButton(row.language, () => openLanguage(row.language), 'lct-linkbtn lct-linkbtn-h'), ' ', row.content_type || ''),
        row.record_type ? el('p', {class: 'lct-rt', text: row.record_type}) : null),
      el('button', {type: 'button', class: 'lct-btn', text: 'Close', onclick: closeDrawer})),
    el('div', {class: 'lct-drawer-status'},
      el('div', {class: 'lct-st'}, el('span', {class: 'lct-k', text: 'Full text'}), statusPick(row, 'ft_status')),
      el('div', {class: 'lct-st'}, el('span', {class: 'lct-k', text: 'Index'}), statusPick(row, 'ix_status'))),
    el('div', {class: 'lct-entry-actions'},
      el('button', {type: 'button', class: 'lct-btn', text: 'Edit all fields', onclick: () => openEditor('capability', row)}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Show on heatmap', onclick: showOnMap}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Duplicate',
        onclick: () => { const copy = Object.assign({}, row); delete copy.id; openEditor('capability', null, copy); }}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Delete', onclick: () => { closeDrawer(); mutate(() => api.del(idPath('/api/capabilities', row.id))); }})),
    ...fieldSections('capability', row, ['id', 'language', 'content_type', 'record_type', 'ft_status', 'ix_status']),
    related('Other rows for ' + row.language, all.filter((r) => r.language === row.language && r.id !== row.id), (r) => r.content_type || ''),
    related('Other languages with ' + (row.content_type || 'this content type'),
      all.filter((r) => r.content_type === row.content_type && r.language !== row.language), (r) => r.language),
    historyBox('capability', row.id),
    row._updated_at ? el('p', {class: 'lct-cap', text: 'Last saved ' + new Date(row._updated_at).toLocaleString() + (row._updated_by ? ' by ' + row._updated_by : '') + '.'}) : null,
  ];
}

function languageView(lang) {
  const rows = app.data.capabilities.filter((r) => r.language === lang.language);
  const images = rows.reduce((sum, r) => sum + (Number(r.est_images) || 0), 0);
  const byType = contentTypes().map((t) => [t, rows.filter((r) => r.content_type === t)]).filter(([, list]) => list.length);
  const showOnMap = () => { app.sel = {lang: lang.language, ctype: ''}; closeDrawer(); goto('heatmap'); };
  return [
    el('div', {class: 'lct-drawer-head'},
      el('div', {class: 'lct-drawer-title'},
        el('span', {class: 'lct-id', text: 'Language' + (lang.code ? '  ' + lang.code : '')}),
        el('h2', {class: 'lct-h2', text: lang.language}),
        el('p', {class: 'lct-cap', text: plural(rows.length, 'capability row') + (images ? ', ' + fmtShort(images) + ' est. images across them' : '')})),
      el('button', {type: 'button', class: 'lct-btn', text: 'Close', onclick: closeDrawer})),
    el('div', {class: 'lct-entry-actions'},
      el('button', {type: 'button', class: 'lct-btn', text: 'Edit language', onclick: () => openEditor('language', lang)}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Filter every page to this language', onclick: () => setSlice('language', [lang.language])}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Show on heatmap', onclick: showOnMap}),
      el('button', {type: 'button', class: 'lct-btn', text: 'Add a row', onclick: () => openEditor('capability', null, {language: lang.language, script: lang.script})})),
    byType.length ? el('section', {class: 'lct-drawer-sec'}, el('h3', {class: 'lct-h3', text: 'Capability by content type'}),
      el('div', {class: 'lct-related'}, ...byType.flatMap(([type, list]) => list.map((r) => el('button', {type: 'button', class: 'lct-relbtn', onclick: () => openRow(r.id)},
        twoTone(r), el('span', {class: 'lct-id', text: r.id}), type,
        el('span', {class: 'lct-meta', text: (r.ft_status || 'No status') + ' / ' + (r.ix_status || 'No status')})))))) : null,
    ...fieldSections('language', lang, ['language']),
    historyBox('language', lang.language),
  ];
}

/** Redraw the drawer for whatever it points at; close it when that record no longer exists. */
export function renderDrawer() {
  const box = $('#drawer');
  if (!app.drawer || !app.data) { box.hidden = true; return; }
  const target = app.drawer;
  const record = target.type === 'capability' ? app.data.capabilities.find((r) => r.id === target.id)
    : app.data.languages.find((l) => l.language === target.name);
  if (!record) { closeDrawer(); return; }
  const keep = box.dataset.key === target.type + ':' + (target.id || target.name) ? $('#drawer-body').scrollTop : 0;
  box.dataset.key = target.type + ':' + (target.id || target.name);
  $('#drawer-body').replaceChildren(...(target.type === 'capability' ? capabilityView(record) : languageView(record)).filter(Boolean));
  box.hidden = false;
  $('#drawer-body').scrollTop = keep;
}

export function initDrawer() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.drawer && !document.querySelector('dialog[open]')) closeDrawer();
  });
}
export {openRow, openLanguage};

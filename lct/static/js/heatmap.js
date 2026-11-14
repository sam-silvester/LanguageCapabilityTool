// The heatmap view: summary, status bars, the language-by-content-type matrix, paint mode,
// the panel of rows behind a selection, and the backlog chart.
import {$, $$, el, app, api, mutate, refresh, fmtInt, fmtShort, plural, idPath, fields, listNames, statuses, rankOf, swatch,
  onSwatch, contentTypes, coverage, statusCounts, summary, backlog, selectedRows, makeTip} from './core.js';
import {openEditor} from './editor.js';

const dash = (box) => box.replaceChildren(document.createTextNode('—'));
const smooth = () => (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const sideLabel = (side) => (side === 'ft' ? 'Full text' : 'Index');

function select(sel, clear) {
  app.sel = clear ? {lang: '', ctype: ''} : sel;
  refresh();
  if (clear) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const panel = $('#panel'), r = panel.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.75) panel.scrollIntoView({behavior: smooth(), block: 'start'});
  }));
}
const onKey = (fn) => (event, d) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fn(event, d); }
};

// ---- header: summary, filters, bars, legend ------------------------------------------------------
function fillSelect(sel, first, values, key) {
  sel.replaceChildren(new Option(first, ''), ...values.map((v) => new Option(v)));
  sel.value = app.filters[key];
  sel.onchange = () => { app.filters[key] = sel.value; refresh(); };
}

function drawHeader() {
  const s = summary();
  $('#data-name').textContent = app.data.meta.name || 'Language capability';
  $('#sum-rows').textContent = fmtInt(s.rows);
  $('#sum-ft').textContent = fmtInt(s.ft);
  $('#sum-ix').textContent = fmtInt(s.ix);
  $('#sum-gap').textContent = fmtInt(s.gap);
  const uniq = (rows, key) => Array.from(new Set(rows.map((r) => r[key]).filter(Boolean))).sort();
  fillSelect($('#f-tier'), 'All tiers', uniq(app.data.capabilities, 'tier'), 'tier');
  fillSelect($('#f-script'), 'All scripts', uniq(app.data.languages, 'script'), 'script');
  const names = statuses();
  $('#legend').replaceChildren(
    ...names.map((name, i) => el('li', {class: 'lct-key'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(i + 1)}), name)).reverse(),
    el('li', {class: 'lct-key'}, el('i', {class: 'lct-sw lct-sw-none'}), 'No row yet'));
}

function drawBar(box, field) {
  const rows = statusCounts().filter((r) => r[field] > 0);
  if (!rows.length) { dash(box); return; }
  const W = Math.max(box.clientWidth, 120), H = 26, total = d3.sum(rows, (r) => r[field]);
  let x = 0;
  const segs = rows.map((r) => { const w = (r[field] / total) * W; const seg = {r, x, w}; x += w; return seg; });
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('class', 'lct-svg').attr('aria-hidden', 'true')
    .attr('viewBox', '0 0 ' + W + ' ' + H).attr('width', '100%').attr('height', H);
  const tip = makeTip(box);
  const g = svg.selectAll('g').data(segs).join('g').attr('transform', (s) => 'translate(' + s.x + ',0)');
  g.append('rect').attr('width', (s) => Math.max(s.w - 1.5, 1)).attr('height', H).attr('rx', 3)
    .style('fill', (s) => swatch(s.r.rank))
    .on('pointerenter pointermove', (event, s) => tip.show(event, [
      el('div', {class: 'lct-tip-r'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(s.r.rank)}), el('span', {class: 'lct-tip-h', text: s.r.status})),
      el('div', {class: 'lct-tip-f', text: plural(s.r[field], 'row')})]))
    .on('pointerleave', () => tip.hide());
  g.filter((s) => s.w >= 22).append('text').attr('class', 'lct-seg-t').style('fill', (s) => onSwatch(s.r.rank))
    .attr('x', (s) => (s.w - 1.5) / 2).attr('y', H / 2).attr('dy', '0.35em').attr('text-anchor', 'middle').text((s) => s.r[field]);
}

// ---- paint ---------------------------------------------------------------------------------------
function drawPaint() {
  const names = statuses();
  if (!names.includes(app.paint.status)) app.paint.status = names[Math.min(4, names.length - 1)] || '';
  $('#paint-toggle').setAttribute('aria-pressed', String(app.paint.on));
  $('#paint-toggle').textContent = app.paint.on ? 'Stop painting' : 'Paint statuses';
  $('#paint-tools').hidden = !app.paint.on;
  $$('#paint-tools [data-side]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === app.paint.side)));
  $('#paint-palette').replaceChildren(...names.map((name, i) => el('button', {
    type: 'button', class: 'lct-brush', title: name, 'aria-label': name, 'aria-pressed': String(name === app.paint.status),
    style: 'background-color:' + swatch(i + 1), onclick: () => { app.paint.status = name; refresh(); }})));
  $('#paint-label').textContent = app.paint.on
    ? 'Click a cell to set ' + sideLabel(app.paint.side) + ' to ' + app.paint.status + '. Esc stops painting.' : '';
}

function paintCell(language, contentType) {
  return mutate(() => api.post('/api/paint', {language, content_type: contentType, side: app.paint.side, status: app.paint.status}));
}

// ---- matrix --------------------------------------------------------------------------------------
function drawMatrix(box) {
  const types = contentTypes();
  const langs = app.data.languages.filter((l) => !app.filters.script || l.script === app.filters.script);
  if (!langs.length) { box.replaceChildren(el('p', {class: 'lct-cap', text: 'No languages yet. Add one on the Languages tab, or import a workbook.'})); return; }
  // With no rows at all there are no columns; paint and "Add a row" need at least the list to click on.
  const cols = types.length ? types : listNames('Content type').slice(0, 12);
  const cellOf = coverage();
  const W = Math.max(box.clientWidth, 260), narrow = W < 620;
  const rowH = narrow ? 18 : 22, gap = 2, n = cols.length;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('width', '100%')
    .attr('class', 'lct-svg' + (narrow ? ' lct-narrow' : '') + (app.paint.on ? ' lct-painting' : ''));
  const rl = svg.append('g').selectAll('text').data(langs).join('text').attr('class', 'lct-rowlab').text((l) => l.language);
  let labelW = 0;
  rl.each(function () { labelW = Math.max(labelW, this.getComputedTextLength()); });
  labelW = Math.min(labelW + 12, W * 0.4);
  const short = (s) => (narrow && s.length > 24 ? s.slice(0, 23) + '…' : s);
  const cl = svg.append('g').selectAll('text').data(cols).join('text').attr('class', 'lct-collab').text(short);
  const lens = [];
  cl.each(function () { lens.push(this.getComputedTextLength()); });
  const ang = narrow ? 90 : 42, rad = (ang * Math.PI) / 180;
  let cw = (W - labelW) / n;
  if (!narrow) {
    lens.forEach((len, j) => { cw = Math.min(cw, (W - labelW - len * Math.cos(rad) - 6) / (j + 0.5)); });
    cw = Math.min(cw, 46);
  }
  cw = Math.max(cw, 6);
  const headH = (d3.max(lens) || 0) * Math.sin(rad) + 14;
  const H = headH + langs.length * rowH + 4;
  svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('height', H);
  const x0 = labelW, y0 = headH, w = Math.max(cw - gap, 2), h = rowH - gap;
  const tip = makeTip(box);
  const covers = new Map((app.data.lists['Content type'] || []).map((i) => [i.name, i.description]));

  const pickLang = (event, l) => select({lang: l.language, ctype: ''}, app.sel.lang === l.language && !app.sel.ctype);
  const pickType = (event, t) => select({lang: '', ctype: t}, app.sel.ctype === t && !app.sel.lang);
  rl.attr('x', x0 - 8).attr('y', (l, i) => y0 + i * rowH + h / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
    .classed('lct-sel', (l) => l.language === app.sel.lang).attr('tabindex', 0).attr('role', 'button')
    .on('click', pickLang).on('keydown', onKey(pickLang));
  cl.attr('transform', (t, j) => 'translate(' + (x0 + j * cw + w / 2 + (narrow ? 4 : 0)) + ',' + (y0 - 6) + ') rotate(' + -ang + ')')
    .classed('lct-sel', (t) => t === app.sel.ctype).attr('tabindex', 0).attr('role', 'button')
    .on('click', pickType).on('keydown', onKey(pickType))
    .on('pointerenter pointermove', (event, t) => tip.show(event, [el('div', {class: 'lct-tip-h', text: t}), covers.get(t) ? el('div', {text: covers.get(t)}) : null]))
    .on('pointerleave', () => tip.hide());

  const cells = [];
  langs.forEach((l, i) => cols.forEach((t, j) => cells.push({l, t, i, j, c: cellOf.get(l.language + '|' + t)})));
  const g = svg.append('g').selectAll('g').data(cells).join('g')
    .attr('transform', (d) => 'translate(' + (x0 + d.j * cw) + ',' + (y0 + d.i * rowH) + ')');
  g.filter((d) => !d.c).append('circle').attr('class', 'lct-dot').attr('cx', w / 2).attr('cy', h / 2).attr('r', 1.3);
  const full = g.filter((d) => !!d.c);
  if (app.cellView === 'both') {
    const half = Math.max(w / 2 - 0.5, 1);
    full.append('rect').attr('width', half).attr('height', h).attr('rx', 2).style('fill', (d) => swatch(d.c.ft_rank));
    full.append('rect').attr('x', w - half).attr('width', half).attr('height', h).attr('rx', 2).style('fill', (d) => swatch(d.c.ix_rank));
  } else {
    const key = app.cellView === 'ft' ? 'ft_rank' : 'ix_rank';
    full.append('rect').attr('width', w).attr('height', h).attr('rx', 2).style('fill', (d) => swatch(d.c[key]));
  }
  const li = langs.findIndex((l) => l.language === app.sel.lang), ti = cols.indexOf(app.sel.ctype);
  if (li >= 0) svg.append('rect').attr('class', 'lct-band').attr('x', x0 - 2).attr('y', y0 + li * rowH - 2).attr('width', n * cw + 2).attr('height', rowH + 2).attr('rx', 4);
  if (ti >= 0) svg.append('rect').attr('class', 'lct-band').attr('x', x0 + ti * cw - 2).attr('y', y0 - 2).attr('width', cw + 2).attr('height', langs.length * rowH + 2).attr('rx', 4);

  const statusLine = (label, rank, status) => el('div', {class: 'lct-tip-r'},
    el('i', {class: 'lct-sw', style: 'background-color:' + swatch(rank)}), el('span', {class: 'lct-k2', text: label}), status || 'No status');
  g.append('rect').attr('class', 'lct-hit').attr('width', cw).attr('height', rowH)
    .on('pointerenter pointermove', (event, d) => {
      const action = app.paint.on
        ? 'Click to set ' + sideLabel(app.paint.side) + ' to ' + app.paint.status + (d.c && d.c.rows > 1 ? ' on all ' + d.c.rows + ' rows' : '')
        : (d.c ? '' : 'No row yet. Select to add one.');
      tip.show(event, [
        el('div', {class: 'lct-tip-h', text: d.l.language}), el('div', {text: d.t}),
        d.c ? statusLine('Full text', d.c.ft_rank, d.c.ft_status) : null,
        d.c ? statusLine('Index', d.c.ix_rank, d.c.ix_status) : null,
        d.c ? el('div', {class: 'lct-tip-f'}, el('span', {text: plural(d.c.rows, 'row')}), d.c.est_images ? el('span', {text: fmtShort(d.c.est_images) + ' images (est.)'}) : null) : null,
        action ? el('div', {class: 'lct-tip-f', text: action}) : null]);
    })
    .on('pointerleave', () => tip.hide())
    .on('click', (event, d) => {
      if (app.paint.on) paintCell(d.l.language, d.t);
      else select({lang: d.l.language, ctype: d.t}, app.sel.lang === d.l.language && app.sel.ctype === d.t);
    });
}

// ---- panel ---------------------------------------------------------------------------------------
const SHORT = {tr_engine: 'Engine', ft_gate: 'Gate', ix_approach: 'Approach', cai_capability: 'Legacy capability', ix_gaps: 'Gaps',
  est_images: 'Est. images', priority: 'Priority', target: 'Target', owner: 'Owner', next_step: 'Next step',
  blockers: 'Blockers', sources: 'Sources', as_of: 'As of'};
const pair = (row, key, entity) => {
  const value = row[key];
  if (value === undefined || value === '' || value === null) return null;
  const f = fields(entity || 'capability').find((x) => x.key === key);
  const shown = f && f.type === 'int' && typeof value === 'number' ? fmtInt(value) : String(value);
  return el('span', {}, el('span', {class: 'lct-k2', text: (SHORT[key] || (f ? f.label : key)) + ' '}), shown);
};
const line = (cls, ...parts) => (parts.some(Boolean) ? el('p', {class: cls}, ...parts) : null);

function statusPick(row, key) {
  const current = row[key] || '';
  const names = statuses();
  const sel = el('select', {class: 'lct-select', 'aria-label': (key === 'ft_status' ? 'Full-text' : 'Index') + ' status of ' + row.id});
  if (!names.includes(current)) sel.append(new Option(current || 'No status', current));
  names.forEach((name) => sel.append(new Option(name)));
  sel.value = current;
  sel.onchange = () => mutate(() => api.put(idPath('/api/capabilities', row.id), {[key]: sel.value}));
  return el('span', {class: 'lct-status-pick'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(rankOf(current))}), sel);
}

function entry(row) {
  const shown = new Set(['id', 'language', 'content_type', 'tier', 'record_type', 'ft_status', 'ix_status', 'ft_evidence', 'ix_evidence', ...Object.keys(SHORT)]);
  const extra = fields('capability').filter((f) => !f.core && !shown.has(f.key)).map((f) => pair(row, f.key));
  return el('article', {class: 'lct-entry'},
    el('div', {class: 'lct-tab', 'aria-hidden': 'true'},
      el('i', {class: 'lct-tab-i', style: 'background-color:' + swatch(rankOf(row.ft_status))}),
      el('i', {class: 'lct-tab-i', style: 'background-color:' + swatch(rankOf(row.ix_status))})),
    el('div', {class: 'lct-entry-b'},
      el('div', {class: 'lct-entry-top'}, el('span', {class: 'lct-id', text: row.id}), el('span', {class: 'lct-lang', text: row.language}),
        el('span', {text: row.content_type || ''}), el('span', {class: 'lct-meta', text: row.tier || ''})),
      row.record_type ? el('p', {class: 'lct-rt', text: row.record_type}) : null,
      el('div', {class: 'lct-pair'},
        el('div', {class: 'lct-side'},
          el('div', {class: 'lct-st'}, el('span', {class: 'lct-k', text: 'Full text'}), statusPick(row, 'ft_status')),
          line('lct-line', pair(row, 'tr_engine'), pair(row, 'ft_gate')),
          row.ft_evidence ? el('p', {class: 'lct-text', text: row.ft_evidence}) : null),
        el('div', {class: 'lct-side'},
          el('div', {class: 'lct-st'}, el('span', {class: 'lct-k', text: 'Index'}), statusPick(row, 'ix_status')),
          line('lct-line', pair(row, 'ix_approach'), pair(row, 'cai_capability')),
          row.ix_evidence ? el('p', {class: 'lct-text', text: row.ix_evidence}) : null,
          line('lct-text', pair(row, 'ix_gaps')))),
      line('lct-line', pair(row, 'est_images'), pair(row, 'priority'), pair(row, 'target'), pair(row, 'owner')),
      line('lct-text', pair(row, 'next_step')),
      line('lct-text', pair(row, 'blockers')),
      line('lct-line', ...extra),
      line('lct-src', pair(row, 'sources'), pair(row, 'as_of'),
        row._updated_by ? el('span', {}, el('span', {class: 'lct-k2', text: 'Last edit '}), row._updated_by) : null),
      el('div', {class: 'lct-entry-actions'},
        el('button', {type: 'button', class: 'lct-btn', text: 'Edit all fields', onclick: () => openEditor('capability', row)}),
        el('button', {type: 'button', class: 'lct-btn', text: 'Duplicate', title: 'Copy this row so you can split it',
          onclick: () => { const copy = Object.assign({}, row); delete copy.id; openEditor('capability', null, copy); }}),
        el('button', {type: 'button', class: 'lct-btn', text: 'Delete',
          onclick: () => mutate(() => api.del(idPath('/api/capabilities', row.id)))}))));
}

function languageCard(lang) {
  const parts = fields('language').filter((f) => f.key !== 'language').map((f) => pair(lang, f.key, 'language')).filter(Boolean);
  return el('article', {class: 'lct-entry lct-entry-lang'}, el('div', {class: 'lct-entry-b'},
    el('div', {class: 'lct-entry-top'}, el('span', {class: 'lct-lang', text: lang.language})),
    line('lct-line', ...parts),
    el('div', {class: 'lct-entry-actions'},
      el('button', {type: 'button', class: 'lct-btn', text: 'Edit language', onclick: () => openEditor('language', lang)}))));
}

function drawPanel() {
  const {lang, ctype} = app.sel, picked = !!(lang || ctype);
  $('#panel-hint').hidden = picked;
  $('#panel-wrap').hidden = !picked;
  if (!picked) return;
  const rows = selectedRows();
  $('#panel-title').replaceChildren(lang ? el('strong', {text: lang}) : null, ctype ? el('span', {text: ctype}) : null);
  $('#panel-count').textContent = plural(rows.length, 'row');
  const out = [];
  const language = lang && app.data.languages.find((l) => l.language === lang);
  if (language) out.push(languageCard(language));
  rows.forEach((r) => out.push(entry(r)));
  if (!rows.length) out.push(el('p', {class: 'lct-cap', text: 'No rows here yet. Add a row to start tracking this cell, or paint it.'}));
  $('#panel-body').replaceChildren(...out);
}

// ---- backlog -------------------------------------------------------------------------------------
function drawBacklog(box) {
  const rows = backlog();
  if (!rows.length) { box.replaceChildren(el('p', {class: 'lct-cap', text: 'No volume figures yet. Add mid-tier and top-tier counts on the Languages tab.'})); return; }
  const W = Math.max(box.clientWidth, 240), rowH = 24;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('class', 'lct-svg').attr('aria-hidden', 'true').attr('width', '100%');
  const lab = svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'lct-rowlab').text((r) => r.language);
  let lw = 0;
  lab.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
  lw = Math.min(lw + 12, W * 0.4);
  const end = svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'lct-endlab').text((r) => fmtShort(r.total));
  let ew = 0;
  end.each(function () { ew = Math.max(ew, this.getComputedTextLength()); });
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total) || 1]).range([0, Math.max(W - lw - ew - 10, 40)]);
  const H = rows.length * rowH + 2;
  svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('height', H);
  lab.attr('x', lw - 8).attr('y', (r, i) => i * rowH + rowH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').classed('lct-sel', (r) => r.language === app.sel.lang);
  end.attr('x', (r) => lw + x(r.total) + 6).attr('y', (r, i) => i * rowH + rowH / 2).attr('dy', '0.35em');
  const tip = makeTip(box);
  const both = (r) => (r.mid && r.top ? 1 : 0);
  const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r, i) => 'translate(' + lw + ',' + (i * rowH + 4) + ')');
  g.append('rect').attr('class', 'lct-mid').attr('height', rowH - 8).attr('rx', 2).attr('width', (r) => x(r.mid));
  g.append('rect').attr('class', 'lct-top').attr('height', rowH - 8).attr('rx', 2).attr('x', (r) => x(r.mid) + both(r)).attr('width', (r) => Math.max(x(r.top) - both(r), 0));
  svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', 'lct-hit').attr('x', 0).attr('y', (r, i) => i * rowH).attr('width', W).attr('height', rowH)
    .on('pointerenter pointermove', (event, r) => tip.show(event, [el('div', {class: 'lct-tip-h', text: r.language}),
      el('div', {class: 'lct-tip-r'}, el('i', {class: 'lct-sw lct-sw-mid'}), el('span', {class: 'lct-k2', text: 'Mid-tier'}), fmtInt(r.mid)),
      el('div', {class: 'lct-tip-r'}, el('i', {class: 'lct-sw lct-sw-top'}), el('span', {class: 'lct-k2', text: 'Top-tier'}), fmtInt(r.top))]))
    .on('pointerleave', () => tip.hide())
    .on('click', (event, r) => select({lang: r.language, ctype: ''}, app.sel.lang === r.language && !app.sel.ctype));
}

// ---- wiring --------------------------------------------------------------------------------------
export function initHeatmap() {
  $$('[data-cellview]').forEach((b) => b.addEventListener('click', () => { app.cellView = b.dataset.cellview; refresh(); }));
  $$('#paint-tools [data-side]').forEach((b) => b.addEventListener('click', () => { app.paint.side = b.dataset.side; refresh(); }));
  $('#paint-toggle').addEventListener('click', () => { app.paint.on = !app.paint.on; refresh(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.paint.on && !document.querySelector('dialog[open]')) { app.paint.on = false; refresh(); }
  });
  $('#panel-clear').addEventListener('click', () => select(null, true));
  $('#panel-back').addEventListener('click', () => $('#sec-matrix').scrollIntoView({behavior: smooth(), block: 'start'}));
  $('#panel-add').addEventListener('click', () => openEditor('capability', null, {language: app.sel.lang, content_type: app.sel.ctype}));
}

export function renderHeatmap() {
  drawHeader();
  drawBar($('#bar-ft'), 'ft');
  drawBar($('#bar-ix'), 'ix');
  $$('[data-cellview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cellview === app.cellView)));
  drawPaint();
  drawPanel();            // before the matrix: showing or hiding the panel changes the matrix width
  drawMatrix($('#matrix'));
  drawBacklog($('#backlog'));
}

// Start-up: load the data, wire the header and switch between views.
import {$, $$, el, app, onChange, refresh, goto, loadState, toast, remember, recall, plural, labelOf, shown, rowsInView, sliceActive,
  toggleSlice, clearSlice} from './core.js';
import {initHeatmap, renderHeatmap} from './heatmap.js';
import {initEditor} from './editor.js';
import {initDrawer, renderDrawer} from './drawer.js';
import {initExplore, renderExplore} from './explore.js';
import {initPivot, renderPivot} from './pivot.js';
import {initGaps, renderGaps} from './gaps.js';
import {initTable, renderTable, initLanguages, renderLanguages, initHistory, renderHistory, initSettings, renderSettings,
  initImport, openImport} from './views.js';

const VIEWS = {heatmap: renderHeatmap, explore: renderExplore, pivot: renderPivot, gaps: renderGaps, table: renderTable,
  languages: renderLanguages, history: renderHistory, settings: renderSettings};

/** The filters in force, shown on every page with one-click removal. */
function drawSliceBar() {
  const bar = $('#slicebar');
  bar.hidden = !sliceActive();
  if (bar.hidden) return;
  const chips = [];
  Object.keys(app.slice).forEach((key) => app.slice[key].forEach((value) => chips.push(el('button', {type: 'button', class: 'lct-chipbtn',
    title: 'Remove this filter', onclick: () => toggleSlice(key, value)},
    el('span', {class: 'lct-k2', text: labelOf(key) + ' '}), shown(value), el('span', {'aria-hidden': 'true', text: ' ×'})))));
  if (app.search) {
    chips.push(el('button', {type: 'button', class: 'lct-chipbtn', title: 'Remove this filter', onclick: () => { app.search = ''; refresh(); }},
      el('span', {class: 'lct-k2', text: 'Search '}), app.search, el('span', {'aria-hidden': 'true', text: ' ×'})));
  }
  bar.replaceChildren(
    el('span', {class: 'lct-slice-n', text: rowsInView().length + ' of ' + plural(app.data.capabilities.length, 'row') + ' in view'}),
    ...chips, el('button', {type: 'button', class: 'lct-btn', text: 'Clear filters', onclick: clearSlice}));
}

function render() {
  if (!app.data) return;
  $('#banner').hidden = !app.data.meta.sample;
  document.title = (app.data.meta.name || 'Language capability') + ' · Language Capability Tool';
  $$('.lct-tab-b').forEach((b) => { if (b.dataset.view === app.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('main.lct-view').forEach((m) => { m.hidden = m.id !== 'view-' + app.view; });
  drawSliceBar();
  document.documentElement.style.setProperty('--top-h', $('.lct-top').offsetHeight + 'px');   // sticky parts sit below the header
  VIEWS[app.view]();
  renderDrawer();
}

async function start() {
  app.user = recall('lct-user');
  $('#who').value = app.user;
  $('#who').addEventListener('change', () => { app.user = $('#who').value.trim(); remember('lct-user', app.user); });
  $$('.lct-tab-b').forEach((b) => b.addEventListener('click', () => goto(b.dataset.view)));
  window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (VIEWS[view] && view !== app.view) { app.view = view; refresh(); } });
  $('#btn-refresh').addEventListener('click', () => loadState().then(() => toast('Up to date.')).catch((err) => toast(err.message, null, true)));
  $('#btn-import').addEventListener('click', openImport);
  $('#banner-import').addEventListener('click', openImport);
  $('#toast-close').addEventListener('click', () => { $('#toast').hidden = true; });
  $$('#export-menu a').forEach((a) => a.addEventListener('click', () => { $('#export-menu').open = false; }));
  document.addEventListener('click', (event) => { if (!$('#export-menu').contains(event.target)) $('#export-menu').open = false; });
  initHeatmap(); initEditor(); initDrawer(); initExplore(); initPivot(); initGaps();
  initTable(); initLanguages(); initHistory(); initSettings(); initImport();
  onChange(render);
  let lastW = window.innerWidth, timer = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => { if (['heatmap', 'history', 'gaps'].includes(app.view)) render(); }, 120);
  });
  try {
    await loadState();
    const first = location.hash.slice(1);
    app.view = VIEWS[first] ? first : 'heatmap';
    refresh();
  } catch (err) {
    toast(err.message, null, true);
  }
}
start();

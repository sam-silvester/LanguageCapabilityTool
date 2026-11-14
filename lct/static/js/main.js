// Start-up: load the data, wire the header and switch between views.
import {$, $$, app, onChange, refresh, loadState, toast} from './core.js';
import {initHeatmap, renderHeatmap} from './heatmap.js';
import {initEditor} from './editor.js';
import {initTable, renderTable, initLanguages, renderLanguages, initHistory, renderHistory, initSettings, renderSettings,
  initImport, openImport} from './views.js';

const VIEWS = {heatmap: renderHeatmap, table: renderTable, languages: renderLanguages, history: renderHistory, settings: renderSettings};
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (err) { /* private mode */ } };
const recall = (key) => { try { return localStorage.getItem(key) || ''; } catch (err) { return ''; } };

function render() {
  if (!app.data) return;
  $('#banner').hidden = !app.data.meta.sample;
  document.title = (app.data.meta.name || 'Language capability') + ' · Language Capability Tool';
  $$('.lct-tab-b').forEach((b) => { if (b.dataset.view === app.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('main.lct-view').forEach((m) => { m.hidden = m.id !== 'view-' + app.view; });
  VIEWS[app.view]();
}

function show(view) {
  app.view = VIEWS[view] ? view : 'heatmap';
  if (location.hash !== '#' + app.view) history.replaceState(null, '', '#' + app.view);
  refresh();
}

async function start() {
  app.user = recall('lct-user');
  $('#who').value = app.user;
  $('#who').addEventListener('change', () => { app.user = $('#who').value.trim(); remember('lct-user', app.user); });
  $$('.lct-tab-b').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  $('#btn-refresh').addEventListener('click', () => loadState().then(() => toast('Up to date.')).catch((err) => toast(err.message, null, true)));
  $('#btn-import').addEventListener('click', openImport);
  $('#banner-import').addEventListener('click', openImport);
  $('#toast-close').addEventListener('click', () => { $('#toast').hidden = true; });
  $$('#export-menu a').forEach((a) => a.addEventListener('click', () => { $('#export-menu').open = false; }));
  document.addEventListener('click', (event) => { if (!$('#export-menu').contains(event.target)) $('#export-menu').open = false; });
  initHeatmap(); initEditor(); initTable(); initLanguages(); initHistory(); initSettings(); initImport();
  onChange(render);
  let lastW = window.innerWidth, timer = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => { if (app.view === 'heatmap' || app.view === 'history') render(); }, 120);
  });
  try {
    await loadState();
    show(location.hash.slice(1) || 'heatmap');
  } catch (err) {
    toast(err.message, null, true);
  }
}
start();

// Gaps: where the volume sits against capability, the biggest volumes not yet in production, and rows that need attention.
import {$, $$, el, app, refresh, fmtInt, fmtShort, plural, rowsInView, rankOf, statuses, swatch, thresholds, makeTip} from './core.js';
import {rowTable, openRow} from './drawer.js';

const gp = {side: 'ft', check: ''};
const sideLabel = () => (gp.side === 'ft' ? 'full text' : 'index');

function monthsOld(asOf) {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(asOf || '');
  if (!m) return null;
  const now = new Date();
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - (Number(m[2]) || 12));
}
const CHECKS = [
  ['owner', 'No owner', (r) => !r.owner],
  ['next', 'No next step', (r) => !r.next_step],
  ['target', 'No target', (r) => !r.target],
  ['volume', 'No volume estimate', (r) => !(Number(r.est_images) > 0)],
  ['stale', 'Not updated in six months', (r) => { const m = monthsOld(r.as_of); return m === null || m > 6; }],
  ['tier', 'Tier still to confirm', (r) => !r.tier || r.tier === 'TBD'],
  ['evidence', 'Placeholder evidence', (r) => r.evidence === 'Placeholder'],
  ['status', 'Status not on the scale', (r) => !rankOf(r.ft_status) || !rankOf(r.ix_status)],
];

function hash(text) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 9973;
  return h / 9973;
}

function drawStrip(box, rows) {
  const key = gp.side + '_status';
  const pts = rows.filter((r) => Number(r.est_images) > 0).map((r) => ({r, rank: rankOf(r[key]), images: Number(r.est_images)}));
  if (!pts.length) { box.replaceChildren(el('p', {class: 'lct-cap', text: 'No rows in view have a volume estimate.'})); return; }
  const names = statuses();
  const ranks = Array.from(new Set(pts.map((p) => p.rank))).sort((a, b) => b - a);
  const W = Math.max(box.clientWidth, 280), bandH = 36, top = 8, bottom = 30;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('class', 'lct-svg').attr('aria-hidden', 'true').attr('width', '100%');
  const lab = svg.append('g').selectAll('text').data(ranks).join('text').attr('class', 'lct-rowlab lct-plain').text((k) => names[k - 1] || 'No status');
  let lw = 0;
  lab.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
  lw = Math.min(lw + 14, W * 0.45);
  const H = top + ranks.length * bandH + bottom;
  svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('height', H);
  const lo = d3.min(pts, (p) => p.images), hi = d3.max(pts, (p) => p.images);
  const x = d3.scaleLog().domain([Math.max(1, lo * 0.7), Math.max(hi * 1.3, lo * 2)]).range([lw + 10, W - 18]);
  const mid = (k) => top + ranks.indexOf(k) * bandH + bandH / 2;
  lab.attr('x', lw).attr('y', mid).attr('dy', '0.35em').attr('text-anchor', 'end');
  svg.append('g').selectAll('line').data(ranks).join('line').attr('class', 'lct-guide').attr('x1', lw + 10).attr('x2', W - 18).attr('y1', mid).attr('y2', mid);
  svg.append('g').attr('class', 'lct-axis').attr('transform', 'translate(0,' + (H - bottom + 4) + ')').call(d3.axisBottom(x).ticks(5, '~s').tickSizeOuter(0));
  const tip = makeTip(box);
  svg.append('g').selectAll('circle').data(pts).join('circle').attr('class', 'lct-dotlink').attr('r', 5.5)
    .attr('cx', (p) => x(p.images)).attr('cy', (p) => mid(p.rank) + (hash(p.r.id) - 0.5) * (bandH - 14))
    .style('fill', (p) => swatch(p.rank))
    .on('pointerenter pointermove', (event, p) => tip.show(event, [
      el('div', {class: 'lct-tip-h', text: p.r.language}), el('div', {text: p.r.content_type || ''}),
      el('div', {class: 'lct-tip-r'}, el('i', {class: 'lct-sw', style: 'background-color:' + swatch(p.rank)}), names[p.rank - 1] || 'No status'),
      el('div', {class: 'lct-tip-f', text: fmtInt(p.images) + ' images (est.)'})]))
    .on('pointerleave', () => tip.hide())
    .on('click', (event, p) => openRow(p.r.id));
}

export function initGaps() {
  $$('[data-gapside]').forEach((b) => b.addEventListener('click', () => { gp.side = b.dataset.gapside; refresh(); }));
}

export function renderGaps() {
  const rows = rowsInView();
  const {prod} = thresholds();
  $$('[data-gapside]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gapside === gp.side)));
  drawStrip($('#gp-strip'), rows);

  const open = rows.filter((r) => rankOf(r[gp.side + '_status']) < prod && Number(r.est_images) > 0)
    .sort((a, b) => Number(b.est_images) - Number(a.est_images));
  const volume = open.reduce((sum, r) => sum + Number(r.est_images), 0);
  $('#gp-top-title').textContent = 'Largest volumes not yet in production for ' + sideLabel();
  $('#gp-top-cap').textContent = open.length
    ? plural(open.length, 'row') + ' with a volume estimate sit below Production (partial) for ' + sideLabel() + ', ' + fmtShort(volume) + ' images in all. The largest come first.'
    : 'Every row in view with a volume estimate is in production for ' + sideLabel() + '.';
  $('#gp-top').replaceChildren(open.length ? rowTable(open, 15) : '');

  const found = CHECKS.map(([key, label, test]) => ({key, label, list: rows.filter(test)}));
  if (!found.some((c) => c.key === gp.check)) gp.check = '';
  $('#gp-checks').replaceChildren(...found.map((c) => el('button', {type: 'button', class: 'lct-check-card', 'aria-pressed': String(c.key === gp.check),
    onclick: () => { gp.check = gp.check === c.key ? '' : c.key; refresh(); }},
    el('span', {class: 'lct-check-n', text: fmtInt(c.list.length)}), el('span', {text: c.label}))));
  const current = found.find((c) => c.key === gp.check);
  $('#gp-check-rows').replaceChildren(current
    ? el('div', {class: 'lct-sec'}, el('h3', {class: 'lct-h3', text: current.label + ': ' + plural(current.list.length, 'row')}), rowTable(current.list))
    : el('p', {class: 'lct-cap', text: 'Select a check to list its rows.'}));
}

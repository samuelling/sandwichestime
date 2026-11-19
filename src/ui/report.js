// End-of-trial report: quick descriptive metrics + an SVG timeline (hands,
// gaze, subgoals). Planner-based optimality lives in analysis/ (Python).

const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const col = (s, taskSet) => s == null ? '#e9e2d6' : taskSet.has(groupOf(s)) ? `hsl(${hue(groupOf(s))} 62% 52%)` : `hsl(${hue(s)} 8% 72%)`;
export const groupOf = id => id == null ? null : id.startsWith('slice_') ? 'slice' : id.replace(/_lid$/, '_jar').replace('bread_clip', 'bread_bag');
const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : (+x).toFixed(d));

export function quickMetrics(log, taskObjects) {
  const ev = log.events, fix = ev.filter(e => e.type === 'fixation'), grasps = ev.filter(e => e.type === 'grasp');
  const taskSet = new Set(taskObjects);
  const rel = fix.filter(f => taskSet.has(groupOf(f.aoi)));
  // Land & Hayhoe style: just-in-time (<1 s before grasp of same object) and look-ahead (>1 s, interleaved) fixations
  let jit = 0, ahead = 0; const lat = [];
  for (const g of grasps) {
    const G = groupOf(g.obj), prior = fix.filter(f => groupOf(f.aoi) === G && f.t0 < g.t && f.t0 > g.t - 6);
    if (!prior.length) continue;
    const last = prior[prior.length - 1];
    if (g.t - last.t0 <= 1.0) jit++;
    // look-ahead: an earlier fixation on G separated from the grasp by fixations elsewhere
    const firstRun = prior.find(f => g.t - f.t0 > 1.0 && fix.some(o => o.t0 > f.t1 && o.t0 < g.t && groupOf(o.aoi) !== G));
    if (firstRun) ahead++;
    lat.push(g.t - prior[0].t0);
  }
  lat.sort((a, b) => a - b);
  const F = log.frames, n = F.t.length;
  let both = 0; for (let i = 0; i < n; i++) if (F.hands.L.holding[i] && F.hands.R.holding[i]) both++;
  return {
    nFix: fix.length, pctTaskFix: fix.length ? 100 * rel.length / fix.length : null,
    meanFixDur: fix.length ? 1000 * fix.reduce((s, f) => s + f.dur, 0) / fix.length : null,
    jit, ahead, eyeHandLead: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    bimanualPct: n ? 100 * both / n : 0, grasps: grasps.length,
  };
}

export function renderReport(el, log, summary, hands, taskObjects, { onDownload, onUpload, onAgain }) {
  const m = quickMetrics(log, taskObjects), S = summary, taskSet = new Set(taskObjects);
  const T = Math.max(1, S.duration), W = 1040, rowH = 22, x = t => 90 + (t / T) * (W - 110);
  const F = log.frames, rows = [];
  // holding bars per hand
  for (const side of ['L', 'R']) {
    const H = F.hands[side].holding; let cur = null, t0 = 0;
    const bars = [];
    for (let i = 0; i <= F.t.length; i++) { const v = i < F.t.length ? H[i] : '__end'; if (v !== cur) { if (cur) bars.push([t0, F.t[i - 1], cur]); cur = v; t0 = F.t[i]; } }
    rows.push({ label: `${side} hand`, bars });
  }
  // gaze label strip
  { const L = F.gaze.label; let cur, t0 = 0; const bars = [];
    for (let i = 0; i <= F.t.length; i++) { const v = i < F.t.length ? L[i] : '__end'; if (v !== cur) { if (cur !== undefined && cur !== null) bars.push([t0, F.t[i - 1], cur]); cur = v; t0 = F.t[i]; } }
    rows.push({ label: 'gaze', bars }); }
  rows.push({ label: 'fixations', bars: log.events.filter(e => e.type === 'fixation').map(f => [f.t0, f.t1, f.aoi]) });
  const H = 40 + rows.length * (rowH + 8) + 60;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif,system-ui" font-size="11">`;
  rows.forEach((r, k) => {
    const y = 30 + k * (rowH + 8);
    svg += `<text x="8" y="${y + 15}" fill="#5c5245">${r.label}</text><rect x="90" y="${y}" width="${W - 110}" height="${rowH}" fill="#f3ede3" rx="3"/>`;
    for (const [a, b, id] of r.bars) svg += `<rect x="${x(a).toFixed(1)}" y="${y}" width="${Math.max(0.8, x(b) - x(a)).toFixed(1)}" height="${rowH}" fill="${col(id, taskSet)}"><title>${id} ${fmt(a, 2)}–${fmt(b, 2)} s</title></rect>`;
  });
  const ys = 30 + rows.length * (rowH + 8) + 8;
  for (const [id, t] of Object.entries(S.subgoals)) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="24" y2="${ys}" stroke="#1f1b16" stroke-opacity=".25"/><circle cx="${x(t)}" cy="${ys + 4}" r="3" fill="#b5652a"/><text x="${x(t) + 3}" y="${ys + 18 + (Object.keys(S.subgoals).indexOf(id) % 3) * 11}" fill="#1f1b16">${id}</text>`;
  for (let t = 0; t <= T; t += T > 120 ? 30 : 10) svg += `<text x="${x(t)}" y="18" fill="#9a8f80" text-anchor="middle">${t}s</text>`;
  svg += `</svg>`;
  const sw = S.sandwich;
  const cards = [
    ['Time', `${fmt(S.duration)} s`, S.completed ? 'sandwich complete' : `missing: ${S.missing.join(', ')}`],
    ['Grasps', S.counts.grasps, `${S.counts.misses} misses · ${S.counts.regrasps} quick re-grasps`],
    ['Hand path', `${fmt(hands[0].path + hands[1].path, 2)} m`, `L ${fmt(hands[0].path, 2)} · R ${fmt(hands[1].path, 2)} · both busy ${fmt(m.bimanualPct, 0)}%`],
    ['Sandwich', sw ? (sw.valid ? 'valid' : 'not quite') : '—', sw ? `PB ${fmt(sw.inner.pb * 100, 0)}% · jelly ${fmt(sw.inner.jelly * 100, 0)}% · offset ${fmt(sw.offset * 100, 1)} cm` : 'no stacked slices on the plate'],
    ['Fixations', m.nFix, `${fmt(m.pctTaskFix, 0)}% on task objects · ${fmt(m.meanFixDur, 0)} ms mean`],
    ['Just-in-time', m.jit, 'grasps preceded by a fixation on the object < 1 s before'],
    ['Look-ahead', m.ahead, 'grasps preceded by an earlier, interleaved fixation'],
    ['Errors', S.counts.contamination + S.counts.drops, `${S.counts.contamination} jar contaminations · ${S.counts.drops} drops`],
  ];
  el.innerHTML = `<h2>Sandwich made${S.completed ? '' : ' (incomplete)'}</h2>
  <div style="color:#7b7163">${log.meta.participant} · session ${log.meta.session} · ${log.meta.condition} · ${log.meta.layout} layout · seed ${log.meta.seed} · hands: ${log.meta.input} · gaze: ${log.meta.gaze}</div>
  <div class="metrics">${cards.map(([a, b, c]) => `<div class="metric"><span>${a}</span><b>${b}</b><span>${c}</span></div>`).join('')}</div>
  ${svg}
  <p style="color:#7b7163;font-size:12px">Bars: objects held by each hand, gaze AOI, detected fixations (task objects in colour, distractors grey). Planner-based optimality, step-wise regret and attention-model fits: <code>python -m sandwich.report ${log.filename()}</code></p>
  <div class="actions"><button id="dl">Download data</button>${log.meta.endpoint ? '<button id="up" class="ghost">Upload</button>' : ''}<button id="again" class="ghost">Next session</button></div>`;
  el.hidden = false;
  el.querySelector('#dl').onclick = onDownload;
  el.querySelector('#again').onclick = onAgain;
  const up = el.querySelector('#up'); if (up) up.onclick = async () => { up.textContent = 'Uploading…'; up.textContent = (await onUpload()) ? 'Uploaded ✓' : 'Upload failed'; };
}

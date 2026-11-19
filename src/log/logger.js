// Session log. Events are a flat list; continuous streams are columnar arrays
// (flattened, fixed stride) so a 5-minute session stays a few MB of JSON.
import * as THREE from 'three';

const r4 = v => Math.round(v * 1e4) / 1e4;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Logger {
  constructor(meta) {
    this.meta = { schema: 'sandwichestime/1', ...meta };
    this.t0 = null; this.events = [];
    this.frames = { t: [], head: [], body: [], gaze: { valid: [], screen: [], ray: [], aoi: [], label: [], near: [], nearDeg: [] }, hands: { L: blankHand(), R: blankHand() } };
    this.joints = { t: [], L: [], R: [] }; this._lastJ = -1;
    this.objects = {}; this._objLast = new Map();
    this.aoiFrames = { t: [], stats: [] };
    this.calibration = [];
    this.recording = false;
  }
  start(tAbs) { this.t0 = tAbs; this.recording = true; this.meta.startedAt = new Date().toISOString(); }
  stop() { this.recording = false; this.meta.endedAt = new Date().toISOString(); }
  rel(tAbs) { return this.t0 === null ? 0 : tAbs - this.t0; }
  event(type, payload = {}, tAbs) {
    const t = payload.t !== undefined ? payload.t : this.rel(tAbs ?? performance.now() / 1000);
    const e = { t: r4(t), type, ...payload }; e.t = r4(t);
    if (type === 'calibration') this.calibration.push(e);
    this.events.push(e); return e;
  }
  frame(t, { camera, body, gaze, hands, joints }) {
    const F = this.frames;
    F.t.push(r4(t));
    camera.getWorldPosition(_p); camera.getWorldQuaternion(_q);
    F.head.push(r4(_p.x), r4(_p.y), r4(_p.z), r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w));
    F.body.push(r4(body?.x ?? 0));
    const g = F.gaze, s = gaze?.sample;
    if (s?.valid) {
      g.valid.push(1); g.screen.push(s.screen ? r4(s.screen[0]) : null, s.screen ? r4(s.screen[1]) : null);
      g.ray.push(r4(s.origin.x), r4(s.origin.y), r4(s.origin.z), r4(s.dir.x), r4(s.dir.y), r4(s.dir.z));
      g.aoi.push(s.aoi); g.label.push(s.label ?? s.aoi); g.near.push(s.near); g.nearDeg.push(r4(s.nearDeg));
    } else { g.valid.push(0); g.screen.push(null, null); g.ray.push(null, null, null, null, null, null); g.aoi.push(null); g.label.push(null); g.near.push(null); g.nearDeg.push(null); }
    for (const h of hands) {
      const H = F.hands[h.side];
      H.tracked.push(h.tracked ? 1 : 0); H.pinch.push(h.pinch ? 1 : 0); H.closure.push(r4(h.closure));
      H.grip.push(r4(h.grip.x), r4(h.grip.y), r4(h.grip.z));
      H.wrist.push(r4(h.joints[0].x), r4(h.joints[0].y), r4(h.joints[0].z));
      H.quat.push(r4(h.quat.x), r4(h.quat.y), r4(h.quat.z), r4(h.quat.w));
      H.holding.push(h.holding ? h.holding.id : null); H.press.push(h.press ? 1 : 0);
    }
    if (joints && t - this._lastJ >= 1 / 30) {
      this._lastJ = t; this.joints.t.push(r4(t));
      for (const h of hands) { const a = this.joints[h.side]; for (const j of h.joints) a.push(r4(j.x), r4(j.y), r4(j.z)); }
    }
  }
  // object poses, logged only when they move (> 1 mm or > 0.5 deg)
  objectPoses(t, entities) {
    for (const e of entities) {
      if (!e.root.parent) continue;
      e.root.getWorldPosition(_p); e.root.getWorldQuaternion(_q);
      const last = this._objLast.get(e);
      if (last && last.p.distanceTo(_p) < 0.001 && last.q.angleTo(_q) < 0.009) continue;
      this._objLast.set(e, { p: _p.clone(), q: _q.clone() });
      const o = this.objects[e.id] || (this.objects[e.id] = { t: [], p: [], q: [] });
      o.t.push(r4(t)); o.p.push(r4(_p.x), r4(_p.y), r4(_p.z)); o.q.push(r4(_q.x), r4(_q.y), r4(_q.z), r4(_q.w));
    }
  }
  aoi(t, stats) { this.aoiFrames.t.push(r4(t)); this.aoiFrames.stats.push(stats); }
  toJSON() { return { meta: this.meta, layout: this.layout, task: this.task, events: this.events, frames: this.frames, joints: this.joints, objects: this.objects, aoiFrames: this.aoiFrames, calibration: this.calibration, summary: this.summary }; }
  filename() { const m = this.meta; return `sandwich_${m.participant}_s${m.session}_${m.condition}_${m.layout}_seed${m.seed}_${(m.startedAt || '').replace(/[:.]/g, '-')}.json`; }
  download() {
    const blob = new Blob([JSON.stringify(this.toJSON())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = this.filename(); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async upload(endpoint) {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.toJSON()) });
    return res.ok;
  }
  // crash safety: keep the latest copy in IndexedDB
  async backup() {
    try {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('sandwichestime', 1); r.onupgradeneeded = () => r.result.createObjectStore('sessions'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      await new Promise((res, rej) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(JSON.stringify(this.toJSON()), this.filename()); tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) { /* best effort */ }
  }
}
function blankHand() { return { tracked: [], pinch: [], closure: [], grip: [], wrist: [], quat: [], holding: [], press: [] }; }

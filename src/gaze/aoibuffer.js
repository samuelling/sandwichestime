// Low-res AOI ID buffer + bottom-up saliency (Itti–Koch-style centre–surround on
// intensity and colour-opponent channels, plus an edge-energy proxy for
// orientation). Gives each visible AOI its projected area, centroid and
// salience at ~5 Hz: the inputs a saliency model of gaze needs.
import * as THREE from 'three';

export class AOIBuffer {
  constructor(renderer, scene, camera, world, { w = 160, h = 90 } = {}) {
    Object.assign(this, { renderer, scene, camera, world, w, h });
    this.rtId = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    this.rtRgb = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
    this.idPx = new Uint8Array(w * h * 4); this.rgbPx = new Uint8Array(w * h * 4);
    this.labels = []; this.matCache = new Map();
    this.labelIndex = new Map();
  }
  idMat(label) {
    let i = this.labelIndex.get(label);
    if (i === undefined) { i = this.labels.length + 1; this.labels.push(label); this.labelIndex.set(label, i); }
    let m = this.matCache.get(i);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color((i & 255) / 255, ((i >> 8) & 255) / 255, 0) }); m.toneMapped = false; this.matCache.set(i, m); }
    return m;
  }
  capture() {
    const { renderer, scene, camera, w, h } = this;
    const prevRT = renderer.getRenderTarget(), prevXR = renderer.xr.enabled;
    renderer.xr.enabled = false;
    // 1) appearance (for saliency)
    renderer.setRenderTarget(this.rtRgb); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(this.rtRgb, 0, 0, w, h, this.rgbPx);
    // 2) ID pass: swap materials
    const swapped = [], hidden = [];
    scene.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.userData.isHand || o === undefined) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
      const label = this.world.aoiOf(o) || (o.userData.noAOI ? this.parentLabel(o) : null);
      swapped.push([o, o.material]);
      o.material = label ? this.idMat(label) : this.black || (this.black = new THREE.MeshBasicMaterial({ color: 0 }));
    });
    const bg = scene.background, env = scene.environment; scene.background = new THREE.Color(0); scene.environment = null;
    renderer.setRenderTarget(this.rtId); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(this.rtId, 0, 0, w, h, this.idPx);
    scene.background = bg; scene.environment = env;
    for (const [o, m] of swapped) o.material = m;
    for (const o of hidden) o.visible = true;
    renderer.setRenderTarget(prevRT); renderer.xr.enabled = prevXR;
    return this.analyse();
  }
  parentLabel(o) { let p = o.parent; while (p) { if (p.userData.entity) return p.userData.entity.aoi; p = p.parent; } return null; }
  analyse() {
    const { w, h } = this, n = w * h, rgb = this.rgbPx, id = this.idPx;
    const I = new Float32Array(n), RG = new Float32Array(n), BY = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = rgb[i * 4] / 255, g = rgb[i * 4 + 1] / 255, b = rgb[i * 4 + 2] / 255; I[i] = (r + g + b) / 3; RG[i] = r - g; BY[i] = b - (r + g) / 2; }
    const S = new Float32Array(n);
    for (const ch of [I, RG, BY]) {
      const c1 = blur(ch, w, h, 1), s1 = blur(ch, w, h, 5), c2 = blur(ch, w, h, 2), s2 = blur(ch, w, h, 10);
      const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = Math.abs(c1[i] - s1[i]) + Math.abs(c2[i] - s2[i]);
      normalise(m); for (let i = 0; i < n; i++) S[i] += m[i];
    }
    const E = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; E[i] = Math.hypot(I[i + 1] - I[i - 1], I[i + w] - I[i - w]); }
    normalise(E); for (let i = 0; i < n; i++) S[i] = (S[i] + E[i]) / 4;
    // per-AOI stats (image rows are bottom-up from readPixels)
    const stats = {};
    for (let i = 0; i < n; i++) {
      const k = id[i * 4] + (id[i * 4 + 1] << 8); if (!k) continue;
      const label = this.labels[k - 1]; if (!label) continue;
      const st = stats[label] || (stats[label] = [0, 0, 0, 0, 0]);
      const x = i % w, y = h - 1 - Math.floor(i / w);
      st[0]++; st[1] += S[i]; st[2] = Math.max(st[2], S[i]); st[3] += x; st[4] += y;
    }
    const out = {};
    for (const [k, [a, s, mx, sx, sy]] of Object.entries(stats)) out[k] = [a / n, +(s / a).toFixed(4), +mx.toFixed(4), +(sx / a / w).toFixed(4), +(sy / a / h).toFixed(4)];
    this.lastMap = S;
    return out; // label -> [areaFrac, meanSal, maxSal, cx, cy]
  }
}
function blur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = acc / (2 * r + 1); acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
function normalise(m) { let mx = 0; for (const v of m) mx = Math.max(mx, v); if (mx > 0) for (let i = 0; i < m.length; i++) m[i] /= mx; }

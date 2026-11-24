// Procedural task objects. These are built in code (not scanned) because each
// part must be addressable: lids that unscrew, slices with paintable faces,
// a knife that carries a measurable load of peanut butter or jelly.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Entity } from '../core/world.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------- bread ----------------
export const SLICE = { w: 0.112, h: 0.118, t: 0.013 };

function sliceShape(scale = 1) {
  // sandwich-loaf profile in XY, centred; crown at +y. Later rotated so +y -> -z.
  const w = SLICE.w / 2, h = SLICE.h / 2, s = new THREE.Shape();
  const P = (x, y) => [x * scale, y * scale];
  s.moveTo(...P(-w + 0.01, -h));
  s.lineTo(...P(w - 0.01, -h));
  s.quadraticCurveTo(...P(w, -h), ...P(w, -h + 0.01));
  s.lineTo(...P(w + 0.002, h - 0.045));
  s.bezierCurveTo(...P(w + 0.012, h - 0.02), ...P(w * 0.55, h + 0.004), ...P(0.012, h - 0.008));
  s.quadraticCurveTo(...P(0, h - 0.013), ...P(-0.012, h - 0.008));
  s.bezierCurveTo(...P(-w * 0.55, h + 0.004), ...P(-w - 0.012, h - 0.02), ...P(-w - 0.002, h - 0.045));
  s.lineTo(...P(-w, -h + 0.01));
  s.quadraticCurveTo(...P(-w, -h), ...P(-w + 0.01, -h));
  return s;
}
// XY shape -> XZ plane (crown toward -z), helper for flat geometries
const toXZ = g => { g.rotateX(-Math.PI / 2); return g; };

function planarUV(g) {
  g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getZ(i) - b.min.z) / (b.max.z - b.min.z));
  uv.needsUpdate = true; return g;
}

let _sliceGeoCache = null;
function sliceGeometries() {
  if (_sliceGeoCache) return _sliceGeoCache;
  const t = SLICE.t, bevel = 0.0018;
  const body = new THREE.ExtrudeGeometry(sliceShape(0.985), { depth: t - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 18 });
  body.translate(0, 0, -(t - 2 * bevel) / 2); toXZ(body);
  // crumb UVs on caps: planar in metres so crumb scale is constant
  const p = body.attributes.position, uv = body.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 6 + 0.5, p.getZ(i) * 6 + 0.5);
  const ringShape = sliceShape(1.0); ringShape.holes.push(new THREE.Path(sliceShape(0.9).getPoints(24)));
  const ring = toXZ(new THREE.ShapeGeometry(ringShape, 18));
  const spread = planarUV(toXZ(new THREE.ShapeGeometry(sliceShape(0.92), 18)));
  _sliceGeoCache = { body, ring, spread };
  return _sliceGeoCache;
}

export function spreadBox() { const g = sliceGeometries().spread; g.computeBoundingBox(); const b = g.boundingBox; return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }; }

// Paint layer for one face + one substance. Coverage is measured on the
// slice's own mask, so "how well did they spread" is a number, not a guess.
export class SpreadLayer {
  constructor(mat, faceSign, substance) {
    this.size = 128; this.substance = substance; this.faceSign = faceSign;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tex = new THREE.CanvasTexture(this.canvas);
    const m = mat.clone(); m.alphaMap = this.tex; m.transparent = true; m.depthWrite = false;
    m.bumpMap = this.tex; m.bumpScale = 2.2;
    m.polygonOffset = true; m.polygonOffsetFactor = -2 - (substance === 'jelly' ? 1 : 0);
    this.mesh = new THREE.Mesh(sliceGeometries().spread, m);
    if (faceSign < 0) { this.mesh.rotation.x = Math.PI; this.mesh.scale.z = -1; }
    this.mesh.position.y = faceSign * (SLICE.t / 2 + 0.0003 + (substance === 'jelly' ? 0.0004 : 0));
    this.mesh.visible = false; this.mesh.castShadow = false; this.mesh.userData.noAOI = true;
    this.amount = 0; this.coverage = 0;
    if (!SpreadLayer.mask) SpreadLayer.buildMask(this.size);
  }
  static buildMask(n) {
    const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
    const pts = sliceShape(0.92).getPoints(48), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    g.beginPath(); pts.forEach((p, i) => { const X = (p.x - x0) / (x1 - x0) * n, Y = (p.y - y0) / (y1 - y0) * n; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.fill(); const d = g.getImageData(0, 0, n, n).data; const m = new Uint8Array(n * n); let cnt = 0;
    for (let i = 0; i < n * n; i++) { m[i] = d[i * 4 + 3] > 128 ? 1 : 0; cnt += m[i]; }
    SpreadLayer.mask = m; SpreadLayer.maskCount = cnt;
  }
  // u,v in [0,1] over the spread bbox; r in uv units; a = alpha (0..1)
  dab(u, v, r, a) {
    const n = this.size, g = this.ctx;
    const x = u * n, y = (1 - v) * n, R = r * n;
    const grad = g.createRadialGradient(x, y, 0, x, y, R);
    grad.addColorStop(0, `rgba(255,255,255,${a})`); grad.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    this.tex.needsUpdate = true; this.mesh.visible = true; this.amount += a * r * r; this._dirty = true;
  }
  measure() {
    if (!this._dirty) return this.coverage;
    const d = this.ctx.getImageData(0, 0, this.size, this.size).data, m = SpreadLayer.mask; let c = 0;
    for (let i = 0; i < m.length; i++) if (m[i] && d[i * 4 + 3] > 90) c++;
    this._dirty = false; return (this.coverage = c / SpreadLayer.maskCount);
  }
}

export function makeSlice(M, id, index, isHeel) {
  const g = sliceGeometries();
  const root = new THREE.Group(); root.name = id;
  const crumbMat = isHeel ? M.crust : M.crumb;
  const body = new THREE.Mesh(g.body, [crumbMat, M.crust]);
  root.add(body);
  for (const s of [1, -1]) {
    if (isHeel && s > 0) continue;
    const ring = new THREE.Mesh(g.ring, M.crust); ring.position.y = s * (SLICE.t / 2 + 0.0002); if (s < 0) ring.rotation.x = Math.PI; ring.scale.z = s; ring.userData.noAOI = true; root.add(ring);
  }
  const ent = new Entity(id, root, { kind: 'slice', role: 'task', aoi: id, settle: 'flat2', restOffset: SLICE.t / 2, footprint: [[0, 0, 0.06]] });
  ent.state = { index, heel: isHeel, inBag: true };
  ent.layers = {};
  for (const face of [1, -1]) for (const sub of ['pb', 'jelly']) {
    const L = new SpreadLayer(sub === 'pb' ? M.pbStuff : M.jellyStuff, face, sub);
    root.add(L.mesh); ent.layers[`${sub}${face > 0 ? 'A' : 'B'}`] = L;
  }
  return ent;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();
// Loft a closed profile (array of [y,z]) along x through a list of rings {x, s (scale about the centre), r (0..1 blend toward a small circle)}.
function loftBag(profile, rings, cy, capStart) {
  const n = profile.length, pos = [], uv = [], idx = [];
  let per = 0; const acc = [0];
  for (let i = 0; i < n; i++) { const a = profile[i], b = profile[(i + 1) % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); acc.push(per); }
  rings.forEach((R, k) => {
    for (let i = 0; i <= n; i++) {
      const p = profile[i % n], ang = Math.atan2(p[0] - cy, p[1]);
      const y = cy + (p[0] - cy) * R.s, z = p[1] * R.s, yc = cy + (R.cy || 0) + Math.sin(ang) * R.rad, zc = Math.cos(ang) * R.rad;
      pos.push(R.x, y + (yc - y) * R.r, z + (zc - z) * R.r); uv.push(acc[i] / per, k / (rings.length - 1));
    }
  });
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) { const a = k * (n + 1) + i, b = a + n + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  if (capStart) { const c = pos.length / 3; pos.push(rings[0].x, cy, 0); uv.push(0.5, 0); for (let i = 0; i < n; i++) idx.push(c, i, i + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function makeBreadBag(M, world, nSlices = 12) {
  const L = nSlices * SLICE.t + 0.004, H = SLICE.h + 0.008, D = SLICE.w + 0.012;
  const root = new THREE.Group(); root.name = 'bread_bag';
  // loaf-shaped film: the slice outline, slightly inflated, lofted along the loaf and gathered at the open end
  const sp = sliceShape(1.07).getPoints(10).map(p => [p.y + SLICE.h / 2 + 0.004, p.x]);     // [y, z] with the flat base down
  const cy = H * 0.5, x0 = -L / 2 - 0.006, x1 = L / 2 + 0.004;
  const closed = [{ x: x0, s: 0.86 }, { x: x0 + 0.004, s: 0.96 }, { x: x0 + 0.012, s: 1 }, { x: x1, s: 1 }, { x: x1 + 0.02, s: 0.93, r: 0.35 }, { x: x1 + 0.04, s: 0.8, r: 0.75 }, { x: x1 + 0.056, s: 0.6, r: 1 }, { x: x1 + 0.062, s: 0.5, r: 1 }]
    .map((r, i, a) => ({ r: 0, cy: (r.r || 0) * H * 0.05, rad: 0.05 - 0.041 * Math.min(1, Math.max(0, (r.x - x1) / 0.056)), ...r }));
  const open = [{ x: x0, s: 0.86 }, { x: x0 + 0.004, s: 0.96 }, { x: x0 + 0.012, s: 1 }, { x: x1, s: 1 }, { x: x1 + 0.03, s: 1.02, r: 0.25 }, { x: x1 + 0.075, s: 0.98, r: 0.5 }]
    .map(r => ({ r: 0, cy: 0, rad: 0.062, ...r }));
  const gClosed = loftBag(sp, closed, cy, true), gOpen = loftBag(sp, open, cy, true);
  const bagBody = new THREE.Mesh(gClosed, M.bag); bagBody.castShadow = false; root.add(bagBody);
  // the twisted tuft of film beyond the clip
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 20, 4, true), M.bag); tuft.rotation.z = Math.PI / 2; tuft.position.set(x1 + 0.062 + 0.025, cy + H * 0.05, 0); tuft.castShadow = false; root.add(tuft);
  // printed band around the middle of the loaf
  const band = new THREE.Mesh(loftBag(sliceShape(1.078).getPoints(10).map(p => [p.y + SLICE.h / 2 + 0.004, p.x]), [{ x: -0.045, s: 1, r: 0, rad: 0, cy: 0 }, { x: 0.045, s: 1, r: 0, rad: 0, cy: 0 }], cy, false), M.bagPrint);
  band.castShadow = false; band.userData.noAOI = true; root.add(band);
  const tail = bagBody;
  const bag = new Entity('bread_bag', root, { kind: 'bread_bag', role: 'task', aoi: 'bread_bag', footprint: [[-0.06, 0, 0.08], [0.06, 0, 0.08]] });
  bag.state = { open: false, slices: [] };
  bag.parts = { body: bagBody, tuft, band, L, H };
  // standing-slice basis: local y -> +x, local -z -> +y
  const basis = _m4.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
  _q.setFromRotationMatrix(basis);
  for (let i = 0; i < nSlices; i++) {
    const heel = i === 0 || i === nSlices - 1;
    const s = makeSlice(M, `slice_${String(i + 1).padStart(2, '0')}`, i, heel);
    s.root.quaternion.copy(_q);
    // heel: crust side faces outward
    if (i === 0) s.root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    s.root.position.set(-L / 2 + SLICE.t * (i + 0.5) + 0.002, SLICE.h / 2 + 0.004, 0);
    root.add(s.root); world.entities.set(s.id, s);
    s.state.bag = bag;
    bag.state.slices.push(s);
  }
  // clip (the closure)
  const clipShape = new THREE.Shape(); clipShape.moveTo(-0.014, -0.012); clipShape.lineTo(0.014, -0.012); clipShape.lineTo(0.016, 0.012); clipShape.lineTo(-0.016, 0.012); clipShape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, -0.002, 0.005, 0, Math.PI * 2, true); clipShape.holes.push(hole);
  const clipGeo = new THREE.ExtrudeGeometry(clipShape, { depth: 0.002, bevelEnabled: false }); clipGeo.translate(0, 0.012, -0.001);
  const clipRoot = new THREE.Group(); clipRoot.add(new THREE.Mesh(clipGeo, M.clip));
  const clip = new Entity('bread_clip', clipRoot, { kind: 'bread_clip', role: 'task', aoi: 'bread_clip', footprint: [[0, 0, 0.02]] });
  clip.state = { onBag: bag };
  clip.attachPose = { pos: new THREE.Vector3(L / 2 + 0.064, H * 0.55 - 0.012, 0), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) };
  clipRoot.position.copy(clip.attachPose.pos); clipRoot.quaternion.copy(clip.attachPose.quat);
  root.add(clipRoot); world.entities.set(clip.id, clip);
  bag.clip = clip;
  bag.setOpen = (o) => { bag.state.open = o; tuft.visible = !o; bagBody.geometry = o ? gOpen : gClosed; };
  return bag;
}

// ---------------- jars ----------------
function ribbedLid(r, h, ribs = 64) {
  const g = new THREE.CylinderGeometry(r, r, h, ribs * 2, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), rr = Math.hypot(x, z);
    if (rr > r * 0.99 && Math.abs(y) < h / 2 - 0.0005) { const a = Math.atan2(z, x), k = 1 + 0.012 * Math.cos(a * ribs); p.setX(i, x * k); p.setZ(i, z * k); }
  }
  g.computeVertexNormals(); g.translate(0, h / 2, 0); return g;
}

export function makeJar(M, world, kind) {
  const pb = kind === 'pb';
  const R = pb ? 0.046 : 0.041, H = pb ? 0.112 : 0.118, wall = 0.0025;
  const root = new THREE.Group(); root.name = `${kind}_jar`;
  // glass/plastic wall as a closed lathe (outer up, lip, inner down) so transmission has thickness
  const prof = [V2(0, 0), V2(R - 0.006, 0), V2(R, 0.006), V2(R, H - 0.016), V2(R - 0.004, H - 0.01), V2(R - 0.006, H - 0.008), V2(R - 0.006, H), V2(R - 0.006 - wall, H), V2(R - 0.006 - wall, H - 0.009), V2(R - wall, H - 0.016), V2(R - wall, 0.007), V2(R - 0.006, wall), V2(0, wall)];
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), pb ? M.jarPlastic : M.jarGlass);
  shell.castShadow = true; root.add(shell);
  const fill = pb ? 0.088 : 0.092;
  const contentsMat = pb ? M.pbStuff : M.jellyStuff;
  const contents = new THREE.Mesh(new THREE.CylinderGeometry(R - wall - 0.0008, R - wall - 0.0008, 1, 48), contentsMat);
  contents.position.y = wall + fill / 2; contents.scale.y = fill - wall; root.add(contents);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0006, R + 0.0006, 0.058, 64, 1, true), pb ? M.labelPB : M.labelJelly);
  label.position.y = 0.05; label.rotation.y = Math.PI; root.add(label);
  const jar = new Entity(`${kind}_jar`, root, { kind: `${kind}_jar`, role: 'task', aoi: `${kind}_jar`, footprint: [[0, 0, R + 0.005]] });
  jar.state = { open: false, amount: 1.0, fill, contamination: { pb: 0, jelly: 0 } };
  jar.geom = { R, H, wall, mouthR: R - 0.006 - wall, rimY: H };
  jar.parts = { contents };
  jar.setAmount = (a) => { jar.state.amount = a; const f = wall + (fill - wall) * (0.25 + 0.75 * a); contents.scale.y = f - wall; contents.position.y = wall + (f - wall) / 2; jar.state.surfaceY = f; };
  jar.setAmount(1);
  // contamination smear (other substance visible on the surface)
  const smear = new THREE.Mesh(new THREE.CircleGeometry(R * 0.5, 24), (pb ? M.jellyStuff : M.pbStuff).clone());
  smear.rotation.x = -Math.PI / 2; smear.visible = false; smear.userData.noAOI = true; root.add(smear); jar.parts.smear = smear;
  // lid
  const lidRoot = new THREE.Group();
  const lidH = pb ? 0.022 : 0.016;
  const lidMesh = new THREE.Mesh(ribbedLid(R + 0.002, lidH, pb ? 72 : 48), pb ? M.lidRed : M.lidGold);
  lidRoot.add(lidMesh);
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(R * 0.62, 40), pb ? M.labelPB : M.lidGold);
  lidTop.rotation.x = -Math.PI / 2; lidTop.position.y = lidH + 0.0004; lidTop.userData.noAOI = true; lidRoot.add(lidTop);
  const lid = new Entity(`${kind}_lid`, lidRoot, { kind: `${kind}_lid`, role: 'task', aoi: `${kind}_lid`, settle: 'upright', footprint: [[0, 0, R + 0.004]] });
  lid.state = { onJar: jar, turns: 0, tight: true };
  lid.geom = { h: lidH };
  lid.seatY = H - 0.012;
  lidRoot.position.y = lid.seatY; root.add(lidRoot);
  world.entities.set(lid.id, lid);
  jar.lid = lid;
  return jar;
}

// ---------------- knife ----------------
export function makeKnife(M, id = 'knife') {
  const root = new THREE.Group(); root.name = id;
  const bs = new THREE.Shape();
  bs.moveTo(0, -0.008); bs.lineTo(0.085, -0.0105); bs.quadraticCurveTo(0.112, -0.009, 0.112, 0.0); bs.quadraticCurveTo(0.11, 0.009, 0.09, 0.0105); bs.lineTo(0, 0.008); bs.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bs, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0006, bevelSegments: 2, curveSegments: 16 }), M.steel);
  blade.geometry.rotateX(-Math.PI / 2); blade.position.set(0, 0.009, 0); root.add(blade);
  const bolster = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, 0.016, 20), M.steel); bolster.rotation.z = Math.PI / 2; bolster.position.set(-0.006, 0.009, 0); root.add(bolster);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.085, 8, 20), M.knifeHandle); handle.rotation.z = Math.PI / 2; handle.scale.set(1, 1, 0.75); handle.position.set(-0.062, 0.009, 0); root.add(handle);
  for (const x of [-0.035, -0.09]) { const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0135, 10), M.brass); rv.position.set(x, 0.009, 0); root.add(rv); }
  const glob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 12), M.pbStuff); glob.scale.set(1.6, 0.35, 0.8); glob.position.set(0.085, 0.0115, 0); glob.visible = false; glob.userData.noAOI = true; glob.castShadow = false; root.add(glob);
  const ent = new Entity(id, root, { kind: 'knife', role: 'task', aoi: id, footprint: [[0.03, 0, 0.03], [-0.06, 0, 0.03]] });
  ent.state = { load: 0, substance: null, residue: { pb: 0, jelly: 0 } };
  ent.geom = { bladeSamples: [0.015, 0.04, 0.065, 0.088, 0.108].map(x => new THREE.Vector3(x, 0.009, 0)), tip: new THREE.Vector3(0.108, 0.009, 0), grip: new THREE.Vector3(-0.06, 0.009, 0) };
  ent.parts = { glob };
  ent.updateGlob = (Mm) => {
    const s = ent.state, any = s.load > 0.02;
    glob.visible = any || s.residue.pb > 0.05 || s.residue.jelly > 0.05;
    const sub = s.load > 0.02 ? s.substance : (s.residue.pb > s.residue.jelly ? 'pb' : 'jelly');
    glob.material = sub === 'jelly' ? Mm.jellyStuff : Mm.pbStuff;
    const k = any ? 0.5 + s.load : 0.35 + 0.3 * Math.max(s.residue.pb, s.residue.jelly);
    glob.scale.set(1.6 * k, 0.35 * Math.max(0.4, k), 0.8 * Math.min(1, k));
  };
  return ent;
}

// distractor cutlery for the drawer / counter
export function makeCutlery(M, kind, id) {
  const root = new THREE.Group();
  if (kind === 'fork') {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.003, 0.012), M.steel); h.position.set(-0.05, 0.004, 0); root.add(h);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.003, 0.018), M.steel); neck.position.set(0.02, 0.005, 0); root.add(neck);
    for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.0025, 0.0028), M.steel); t.position.set(0.057, 0.006, -0.0075 + i * 0.005); root.add(t); }
  } else if (kind === 'spoon') {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.003, 0.011), M.steel); h.position.set(-0.05, 0.004, 0); root.add(h);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.steel); bowl.scale.set(1.35, 0.35, 0.9); bowl.rotation.x = Math.PI; bowl.position.set(0.04, 0.009, 0); root.add(bowl);
  } else { // chef knife
    const bsh = new THREE.Shape(); bsh.moveTo(0, -0.004); bsh.lineTo(0.17, 0.0); bsh.quadraticCurveTo(0.12, 0.035, 0, 0.04); bsh.closePath();
    const b = new THREE.Mesh(new THREE.ExtrudeGeometry(bsh, { depth: 0.002, bevelEnabled: false }), M.steel); b.geometry.rotateX(-Math.PI / 2); b.position.set(0, 0.012, 0.02); root.add(b);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.016), M.knifeHandle); hd.position.set(-0.055, 0.012, 0); root.add(hd);
  }
  return new Entity(id, root, { kind, role: 'distractor', aoi: id, footprint: [[0, 0, 0.05]] });
}

// ---------------- plate, towel, bell ----------------
export function makePlate(M, id = 'plate') {
  const R = 0.135;
  const prof = [V2(0, 0.006), V2(0.08, 0.006), V2(0.095, 0.009), V2(0.118, 0.019), V2(R, 0.022), V2(R + 0.001, 0.02), V2(0.12, 0.016), V2(0.098, 0.006), V2(0.07, 0.0), V2(0.062, 0.0), V2(0.06, 0.003), V2(0, 0.003)];
  const root = new THREE.Group(); root.name = id;
  const plate = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), M.plateGlaze); root.add(plate);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1345, 0.0014, 6, 96), M.plateRim); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0212; rim.userData.noAOI = true; root.add(rim);
  const ent = new Entity(id, root, { kind: 'plate', role: 'task', aoi: id, footprint: [[0, 0, R + 0.01]] });
  ent.supportMesh = plate;
  return ent;
}

export function makeTowel(M, id = 'towel') {
  const root = new THREE.Group();
  const geo = new RoundedBoxGeometry(0.24, 0.014, 0.16, 3, 0.006);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + 0.0015 * Math.sin(x * 60) * Math.cos(z * 45)); }
  geo.computeVertexNormals(); geo.translate(0, 0.007, 0);
  const uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 4, p.getZ(i) * 4);
  const mesh = new THREE.Mesh(geo, M.towel); root.add(mesh);
  const ent = new Entity(id, root, { kind: 'towel', role: 'task', aoi: id, footprint: [[0, 0, 0.12]] });
  ent.supportMesh = mesh;
  return ent;
}

export function makeBell(M, id = 'bell') {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.014, 48), M.bellBase); base.position.y = 0.007; root.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.039, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.steel); dome.position.y = 0.014; root.add(dome);
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.016, 12), M.steel); plunger.position.y = 0.06; root.add(plunger);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 8), M.steel); cap.position.y = 0.069; root.add(cap);
  const ent = new Entity(id, root, { kind: 'bell', role: 'task', aoi: id, footprint: [[0, 0, 0.055]] });
  ent.parts = { plunger, cap };
  return ent;
}

// Synthesised service-bell "ding" (inharmonic partials, exponential decay).
let _ac = null;
export function ding() {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = _ac.currentTime, out = _ac.createGain(); out.gain.value = 0.25; out.connect(_ac.destination);
    for (const [f, a, d] of [[2093, 1, 1.6], [2093 * 2.76, 0.45, 0.9], [2093 * 5.4, 0.2, 0.4], [2093 * 1.51, 0.25, 1.2]]) {
      const o = _ac.createOscillator(), g = _ac.createGain(); o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(out); o.start(t); o.stop(t + d);
    }
  } catch (e) { /* audio is optional */ }
}

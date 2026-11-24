// PBR materials: Poly Haven scanned textures for the room, procedural canvas
// textures for the task objects (bread crumb, crust, jar labels, spreads).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
// Scanned textures come in two sizes: 'standard' (assets/lite/: 512 px props, 1k room; about 6 MB) and 'high' (assets/: the 1k originals, about 62 MB).
export let ASSET_BASE = 'assets/lite/';
export function setAssetDetail(detail) { ASSET_BASE = detail === 'high' || detail === 'full' ? 'assets/' : 'assets/lite/'; }
let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function tex(url, { srgb = false, repeat = [1, 1] } = {}) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Scanned material from assets/manifest.json texture entries.
export function scanned(manifest, id, repeat = [1, 1], extra = {}) {
  const m = manifest.textures[id];
  const base = ASSET_BASE;
  return new THREE.MeshStandardMaterial({
    map: tex(base + m.diff, { srgb: true, repeat }),
    normalMap: tex(base + m.nor_gl, { repeat }),
    roughnessMap: tex(base + m.rough, { repeat }),
    ...extra,
  });
}

// ---------- procedural canvas helpers ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s = 1, oct = 5) { let f = 0, amp = 0.5, fr = 1; for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i); amp *= 0.5; fr *= 2.03; } return f; }

// height (Float32Array, w*h) -> normal map canvas
function normalFromHeight(hgt, w, h, strength = 2) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)];
    const u = hgt[((y - 1 + h) % h) * w + x], d = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const n = Math.hypot(nx, ny, nz); nx /= n; ny /= n; nz /= n;
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function canvasTex(c, srgb = true, wrap = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso; return t;
}

// Bread crumb: warm off-white with an open, slightly elongated pore structure.
export function crumbMaps(size = 512, seed = 7) {
  const w = size, h = size, hgt = new Float32Array(w * h);
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / 28, y / 22, seed, 5);
    const pores = Math.max(0, fbm(x / 7.5, y / 6, seed + 9, 3) - 0.56) * 4.5;
    const fine = fbm(x / 2.2, y / 2.2, seed + 3, 2);
    const v = 1 - pores * 0.9;
    hgt[y * w + x] = v * 0.8 + fine * 0.2;
    const i = (y * w + x) * 4;
    const shade = 0.82 + 0.18 * n - pores * 0.32 + (fine - 0.5) * 0.06;
    img.data[i] = 236 * shade; img.data[i + 1] = 214 * shade; img.data[i + 2] = 168 * shade; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTex(c), normalMap: canvasTex(normalFromHeight(hgt, w, h, 3.5), false) };
}

export function crustMaps(seed = 3) {
  const w = 256, h = 256, hgt = new Float32Array(w * h);
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / 20, y / 20, seed, 5), f = fbm(x / 3, y / 3, seed + 5, 2);
    hgt[y * w + x] = n * 0.7 + f * 0.3;
    const i = (y * w + x) * 4, s = 0.75 + 0.35 * n;
    img.data[i] = 178 * s; img.data[i + 1] = 118 * s; img.data[i + 2] = 58 * s; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { map: canvasTex(c), normalMap: canvasTex(normalFromHeight(hgt, w, h, 2), false) };
}

// Spread surfaces (also used for jar contents): soft swirled height.
export function spreadNormal(seed = 11) {
  const w = 256, h = 256, hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x / 40 + 1.5 * fbm(x / 60, y / 60, seed, 3), sy = y / 40;
    hgt[y * w + x] = Math.sin(sx * 6 + sy * 2) * 0.25 + fbm(x / 12, y / 12, seed + 1, 4);
  }
  return canvasTex(normalFromHeight(hgt, w, h, 1.6), false);
}

// Polyethylene bag crinkle normal.
export function crinkleNormal(seed = 5) {
  const w = 256, h = 256, hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = fbm(x / 18 + y / 70, y / 9, seed, 4), b = fbm(x / 6, y / 40, seed + 2, 3);
    hgt[y * w + x] = Math.abs(a - 0.5) * 1.4 + b * 0.3;
  }
  return canvasTex(normalFromHeight(hgt, w, h, 2.5), false);
}

// Jar labels. Fictional brands (a nod to the original authors).
export function labelTexture(kind) {
  const c = canvas(2048, 512), g = c.getContext('2d'); g.scale(2, 2);
  const pb = kind === 'pb';
  const bg = pb ? '#f3e7c9' : '#efe4ee', band = pb ? '#b3261e' : '#4b1a49', ink = pb ? '#5a2d0c' : '#2d0f2c';
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = band; g.fillRect(0, 0, 1024, 34); g.fillRect(0, 222, 1024, 34);
  for (let k = 0; k < 2; k++) {
    const x0 = k * 512;
    g.fillStyle = ink; g.textAlign = 'center';
    g.font = 'italic 600 30px Georgia, serif';
    g.fillText(pb ? 'Hayhoe Farms' : "Ballard's", x0 + 256, 82);
    g.font = '700 58px Georgia, serif';
    g.fillText(pb ? 'PEANUT BUTTER' : 'GRAPE JELLY', x0 + 256, 148);
    g.font = '500 24px ui-sans-serif, sans-serif';
    g.fillText(pb ? 'creamy · roasted · since 2003' : 'concord grape · since 2003', x0 + 256, 190);
    // little mark
    g.fillStyle = pb ? '#c8924d' : '#7d3b78';
    if (pb) { g.beginPath(); g.ellipse(x0 + 70, 120, 22, 34, 0.5, 0, Math.PI * 2); g.ellipse(x0 + 442, 120, 22, 34, -0.5, 0, Math.PI * 2); g.fill(); }
    else for (const [dx, dy] of [[0, 0], [16, 4], [8, 18], [24, 20], [-6, 16], [14, 32]]) { g.beginPath(); g.arc(x0 + 62 + dx, 98 + dy, 9, 0, Math.PI * 2); g.arc(x0 + 434 + dx, 98 + dy, 9, 0, Math.PI * 2); g.fill(); }
  }
  const t = canvasTex(c); t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// Printed band on the bread bag (fictional bakery; another nod to the original authors).
export function bagPrint() {
  const c = canvas(2048, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 2048, 256);
  for (let k = 0; k < 2; k++) {
    const x0 = k * 1024;
    g.fillStyle = '#f7f1e3'; g.fillRect(x0, 16, 1024, 224);
    g.fillStyle = '#c0392b'; g.fillRect(x0, 16, 1024, 18); g.fillRect(x0, 222, 1024, 18);
    g.fillStyle = '#1d3f7a'; g.textAlign = 'center';
    g.font = 'italic 700 86px Georgia, serif'; g.fillText("Pelz's", x0 + 512, 122);
    g.font = '700 40px ui-sans-serif, Helvetica, sans-serif'; g.fillText('SANDWICH BREAD', x0 + 512, 172);
    g.font = '500 24px ui-sans-serif, Helvetica, sans-serif'; g.fillStyle = '#c0392b'; g.fillText('soft white · 12 slices', x0 + 512, 206);
    // wheat marks
    g.strokeStyle = '#d9a441'; g.lineWidth = 5;
    for (const sx of [150, 874]) for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(x0 + sx + (j % 2 ? 12 : -12), 70 + j * 26, 16, 7, j % 2 ? -0.7 : 0.7, 0, Math.PI * 2); g.stroke(); }
  }
  const t = canvasTex(c); return t;
}

// Gingham for the dish towel (multiplied over the scanned linen).
export function ginghamTexture() {
  const c = canvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(52,86,140,0.55)';
  for (let i = 0; i < 8; i++) { g.fillRect(i * 32, 0, 16, 256); g.fillRect(0, i * 32, 256, 16); }
  return canvasTex(c);
}

// Glazed ceramic subway tile, running bond. One texture tile = 0.6 m x 0.6 m (4 x 8 tiles of 150 x 75 mm).
// Hand-made feel: slight per-tile tone shifts, pillowed edges, gentle glaze waviness.
export function subwayTiles(seed = 5) {
  const n = 1024, cols = 4, rows = 8, tw = n / cols, th = n / rows, grout = 5;
  const alb = canvas(n, n), ag = alb.getContext('2d'), rgh = canvas(n, n), rg = rgh.getContext('2d');
  const hgt = new Float32Array(n * n);
  const aimg = ag.createImageData(n, n), rimg = rg.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const row = Math.floor(y / th), xo = (x + (row % 2) * tw / 2) % n, col = Math.floor(xo / tw);
    const fx = xo - col * tw, fy = y - row * th, e = Math.min(fx, tw - fx, fy, th - fy);     // distance to tile edge (px)
    const i = (y * n + x) * 4, isGrout = e < grout / 2;
    const tone = 0.94 + 0.06 * hash(col, row, seed), warm = hash(col, row, seed + 7) * 0.02;
    const wav = fbm(x / 90, y / 90, seed + 3, 3);
    const pillow = Math.min(1, (e - grout / 2) / 9);                                    // rounded tile edge
    hgt[y * n + x] = isGrout ? 0 : 0.55 + 0.45 * (1 - (1 - pillow) * (1 - pillow)) + 0.12 * wav;
    const c = isGrout ? [196, 190, 180] : [247 * tone, (243 - warm * 120) * tone, (234 - warm * 300) * tone];
    aimg.data[i] = c[0]; aimg.data[i + 1] = c[1]; aimg.data[i + 2] = c[2]; aimg.data[i + 3] = 255;
    const r = isGrout ? 235 : 22 + 26 * wav;
    rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r; rimg.data[i + 3] = 255;
  }
  ag.putImageData(aimg, 0, 0); rg.putImageData(rimg, 0, 0);
  return { map: canvasTex(alb), roughnessMap: canvasTex(rgh, false), normalMap: canvasTex(normalFromHeight(hgt, n, n, 2.2), false) };
}

// Speckled quartz with faint veining (texture tile = 1 m with worldUV scale 1).
export function quartzTexture(seed = 21) {
  const n = 1024, c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const vein = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((x * 0.004 + y * 0.0016 + 2.2 * fbm(x / 160, y / 160, seed, 4)) * Math.PI)) * 9), 3);
    const sp = hash(x, y, seed) > 0.985 ? 0.82 : hash(x, y, seed + 1) > 0.97 ? 0.92 : 1;
    const base = 0.925 + 0.03 * fbm(x / 40, y / 40, seed + 4, 3);
    const v = base * sp - vein * 0.07;
    img.data[i] = 242 * v; img.data[i + 1] = 238 * v; img.data[i + 2] = 231 * v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return canvasTex(c);
}

// Window "view": soft blurred garden so the window reads as daylight.
export function windowView() {
  const c = canvas(512, 512), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#cfe3f3'); sky.addColorStop(0.55, '#eef4f2'); sky.addColorStop(0.62, '#a9b98c'); sky.addColorStop(1, '#5d7449');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
  g.filter = 'blur(14px)';
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 40},${95 + Math.random() * 50},${50 + Math.random() * 30},0.55)`;
    g.beginPath(); g.arc(Math.random() * 512, 250 + Math.random() * 200, 30 + Math.random() * 60, 0, Math.PI * 2); g.fill();
  }
  return canvasTex(c, true, false);
}

// ---------- the shared material library ----------
export function buildMaterials(manifest) {
  const M = {};
  // white quartz counter: neutral ground for figure/ground (and saliency) analyses
  M.marble = new THREE.MeshPhysicalMaterial({ map: quartzTexture(), roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.12 });
  M.marble.map.repeat.set(1, 1);
  M.tiles = new THREE.MeshPhysicalMaterial({ ...subwayTiles(), roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.1 });
  M.parquet = scanned(manifest, 'herringbone_parquet', [2.5, 2.5]);
  M.plaster = scanned(manifest, 'white_plaster_02', [3, 1.5], { color: 0xffffff, shadowSide: THREE.DoubleSide, normalScale: new THREE.Vector2(0.25, 0.25) });   // gentle relief: grazing spot light otherwise makes it blotchy
  M.plaster.map = null; M.plaster.color.set(0xf5f0e7);   // painted wall: keep the plaster's relief and roughness, drop its stained albedo
  M.oak = scanned(manifest, 'white_oak_veneer', [1, 1]);
  M.oakShelf = scanned(manifest, 'white_oak_veneer', [2, 0.25]);
  M.linen = scanned(manifest, 'rough_linen', [2, 2]);
  M.cabinet = new THREE.MeshPhysicalMaterial({ color: 0x5f6f5b, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 }); // sage paint
  M.cabinetInner = new THREE.MeshStandardMaterial({ color: 0xe9e3d8, roughness: 0.8 });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xc49a57, metalness: 1, roughness: 0.28 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.22 });
  M.brushed = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.38 });
  M.blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.06, metalness: 0, clearcoat: 1, reflectivity: 0.6 });
  M.fridge = new THREE.MeshPhysicalMaterial({ color: 0xe8e6e1, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  M.fridgeInner = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.5 });
  M.glassShelf = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.95, roughness: 0.05, thickness: 0.005, ior: 1.5 });
  M.ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf7f6f2, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
  M.plateGlaze = new THREE.MeshPhysicalMaterial({ color: 0x4a6a8c, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.15, sheen: 0.2, side: THREE.DoubleSide });   // lathe winding faces inward: draw (and ray-hit) both sides   // blue stoneware: reads against the pale counter and the bread
  M.plateRim = new THREE.MeshPhysicalMaterial({ color: 0xe9dfcb, roughness: 0.5 });
  M.ceramicRim = new THREE.MeshPhysicalMaterial({ color: 0x2f4a6b, roughness: 0.25, clearcoat: 1 });
  M.windowView = new THREE.MeshBasicMaterial({ map: windowView(), color: new THREE.Color(0xffffff).multiplyScalar(2.2) });
  M.windowFrame = new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.5 });
  M.ceiling = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.95, shadowSide: THREE.DoubleSide });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.7 });

  const crumb = crumbMaps(), crust = crustMaps();
  M.crumb = new THREE.MeshStandardMaterial({ map: crumb.map, normalMap: crumb.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 });
  M.crust = new THREE.MeshStandardMaterial({ map: crust.map, normalMap: crust.normalMap, roughness: 0.75 });
  const sn = spreadNormal();
  M.pbStuff = new THREE.MeshPhysicalMaterial({ color: 0x5f3109, roughness: 0.6, normalMap: sn, normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.08 });
  M.jellyStuff = new THREE.MeshPhysicalMaterial({ color: 0x5a1046, roughness: 0.08, transmission: 0.55, thickness: 0.02, attenuationColor: new THREE.Color(0x3a0630), attenuationDistance: 0.01, clearcoat: 1, normalMap: sn, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.jarGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 0.03, thickness: 0.004, ior: 1.5, envMapIntensity: 1.2 });
  M.jarPlastic = new THREE.MeshPhysicalMaterial({ color: 0xfff5e6, transmission: 0.6, roughness: 0.25, thickness: 0.003 });
  M.lidRed = new THREE.MeshPhysicalMaterial({ color: 0xa3221b, roughness: 0.35, clearcoat: 0.8 });
  M.lidGold = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.3 });
  M.bag = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.96, roughness: 0.12, thickness: 0.0005, ior: 1.35, normalMap: crinkleNormal(), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
  M.clip = new THREE.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.4 });
  M.bagPrint = new THREE.MeshPhysicalMaterial({ map: bagPrint(), roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 });
  M.knifeHandle = new THREE.MeshPhysicalMaterial({ color: 0x2a211b, roughness: 0.35, clearcoat: 0.6 });
  M.towel = new THREE.MeshStandardMaterial({ map: ginghamTexture(), normalMap: M.linen.normalMap, roughness: 0.95 });
  M.towel.map.repeat.set(2, 2);
  M.bellBase = new THREE.MeshPhysicalMaterial({ color: 0x151515, roughness: 0.3, clearcoat: 1 });
  M.labelPB = new THREE.MeshPhysicalMaterial({ map: labelTexture('pb'), roughness: 0.4, clearcoat: 0.5 });
  M.labelJelly = new THREE.MeshPhysicalMaterial({ map: labelTexture('jelly'), roughness: 0.4, clearcoat: 0.5 });
  return M;
}

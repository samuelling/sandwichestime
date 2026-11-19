// Small shared utilities: event bus, seeded RNG, One-Euro filter, clock.

export class Bus {
  constructor() { this.h = new Map(); }
  on(type, fn) { (this.h.get(type) || this.h.set(type, []).get(type)).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const a = this.h.get(type); if (a) a.splice(a.indexOf(fn) >>> 0, 1); }
  emit(type, payload) {
    for (const fn of this.h.get('*') || []) fn(type, payload); // loggers see an event before its consequences
    for (const fn of (this.h.get(type) || []).slice()) fn(payload);
  }
}

// mulberry32 — deterministic layouts from a seed, so a layout can be regenerated in analysis.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.shuffle = (arr) => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  return r;
}

// One-Euro filter (Casiez, Roussel & Vogel 2012) for jittery webcam landmarks.
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = null; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}
export class OneEuro3 {
  constructor(...a) { this.f = [new OneEuro(...a), new OneEuro(...a), new OneEuro(...a)]; }
  filter(v, t) { v.x = this.f[0].filter(v.x, t); v.y = this.f[1].filter(v.y, t); v.z = this.f[2].filter(v.z, t); return v; }
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const now = () => performance.now() / 1000;
export const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function toast(msg, ms = 1800) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

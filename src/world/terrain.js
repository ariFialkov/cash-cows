// Terrain: a seeded 1.5 km heightmap of a mountain valley — a river winding
// down the valley floor, creeks that flow downhill into it, rolling foothills,
// wooded slopes with clearings, grassy balds and layered ridges walling the
// horizon. Generated once on the CPU into a height texture, then rendered on
// the GPU: a fine disc of ground follows the rider over a coarse far mesh,
// both displacing a flat grid from the same texture so hooves and pixels
// agree exactly.

import * as THREE from 'three';
import { fbm2, valueNoise2 } from '../core/rng.js';

export const WORLD_HALF = 760;   // terrain extent (metres, half-size)
export const RANGE_HALF = 560;   // how far riders and cattle can roam
export const PEN_HALF = 170;     // the ranch pen (fence at ±PEN_HALF)
export const TEXEL = 2;          // heightmap resolution (metres)
const N = (WORLD_HALF * 2) / TEXEL + 1;

const NEAR_R = 115;              // fine ground disc radius
const NEAR_STEP = 1.25;
const FAR_STEP = 8;

// kind mask values (per texel)
export const K_OPEN = 0, K_WATER = 1, K_TRAIL = 2, K_ROCK = 3, K_BUILT = 4;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;

// ridged multifractal: sharp crests, elongated along z like ridge-and-valley country
function ridged(x, z, seed, oct) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(valueNoise2(x * f, z * f, seed + i * 77) * 2 - 1);
    v *= v;
    sum += v * amp; norm += amp;
    amp *= 0.55; f *= 2.05;
  }
  return sum / norm;
}

export class Terrain {
  constructor(seed, rand) {
    this.seed = seed;
    this.rand = rand;
    this.H = new Float32Array(N * N);       // ground height
    this.Wl = new Float32Array(N * N);      // water surface height (-1e9 = none)
    this.F = new Uint8Array(N * N);         // forest density 0..255
    this.K = new Uint8Array(N * N);         // kind mask
    this.G = new Uint8Array(N * N);         // grassiness 0..255
    this.Wl.fill(-1e9);
    this.rivers = [];                       // polylines [{x,z,y,w}] for water ribbons / minimap
    this.trails = [];
    this.bridge = null;
    this._a1 = rand() * 6.28; this._a2 = rand() * 6.28;
    const t0 = performance.now();
    this._landform();
    this._river();
    this._creeks();
    this._trails();
    this._bridgeSite();
    this._paint();
    this.genMs = performance.now() - t0;
  }

  // ---- sampling -----------------------------------------------------------
  _idx(i, j) { return j * N + i; }

  _sample(arr, x, z) {
    let g = (x + WORLD_HALF) / TEXEL, h = (z + WORLD_HALF) / TEXEL;
    if (g < 0) g = 0; else if (g > N - 1) g = N - 1;
    if (h < 0) h = 0; else if (h > N - 1) h = N - 1;
    const i0 = Math.floor(g), j0 = Math.floor(h);
    const i1 = Math.min(i0 + 1, N - 1), j1 = Math.min(j0 + 1, N - 1);
    const fx = g - i0, fz = h - j0;
    const a = arr[j0 * N + i0], b = arr[j0 * N + i1], c = arr[j1 * N + i0], d = arr[j1 * N + i1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }

  heightAt(x, z) {
    let h = this._sample(this.H, x, z);
    const b = this.bridge;
    if (b) {
      const u = (x - b.x) * b.dx + (z - b.z) * b.dz, v = -(x - b.x) * b.dz + (z - b.z) * b.dx;
      if (Math.abs(u) < b.halfLen + b.ramp && Math.abs(v) < b.halfW) {
        const deck = b.deckY(u);
        if (deck > h) h = deck;
      }
    }
    return h;
  }

  // water surface height here, or null
  waterAt(x, z) {
    const w = this._nearest(this.Wl, x, z);
    return w > -1e8 ? w : null;
  }

  waterDepthAt(x, z) {
    const w = this.waterAt(x, z);
    if (w === null) return 0;
    const b = this.bridge;
    if (b) {
      const u = (x - b.x) * b.dx + (z - b.z) * b.dz, v = -(x - b.x) * b.dz + (z - b.z) * b.dx;
      if (Math.abs(u) < b.halfLen + b.ramp && Math.abs(v) < b.halfW) return 0;
    }
    return Math.max(0, w - this._sample(this.H, x, z));
  }

  _nearest(arr, x, z) {
    let i = Math.round((x + WORLD_HALF) / TEXEL), j = Math.round((z + WORLD_HALF) / TEXEL);
    if (i < 0) i = 0; else if (i > N - 1) i = N - 1;
    if (j < 0) j = 0; else if (j > N - 1) j = N - 1;
    return arr[j * N + i];
  }

  kindAt(x, z) { return this._nearest(this.K, x, z); }
  forestAt(x, z) { return this._nearest(this.F, x, z) / 255; }
  grassAt(x, z) { return this._nearest(this.G, x, z) / 255; }

  slopeAt(x, z) {
    const e = TEXEL;
    const hx = this._sample(this.H, x + e, z) - this._sample(this.H, x - e, z);
    const hz = this._sample(this.H, x, z + e) - this._sample(this.H, x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  groundNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // ---- landform -----------------------------------------------------------
  riverX(z) {
    return -330 + 75 * Math.sin(z / 230 + this._a1) + 32 * Math.sin(z / 95 + this._a2)
      + (fbm2(z / 140, 3.7, this.seed + 31, 2) - 0.5) * 90;
  }

  _landform() {
    const S = this.seed;
    const H = this.H, F = this.F;
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * TEXEL;
      const rx = this.riverX(z);
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * TEXEL;
        const d = x - rx;                                   // signed distance east of the river
        const penD = Math.max(Math.abs(x), Math.abs(z));
        const penMask = 1 - smoothstep(150, 270, penD);      // 1 inside the ranch
        const riverBand = 1 - smoothstep(30, 120, Math.abs(d));

        // valley walls: west and east ranges, and ridges closing the north and south
        const westRise = smoothstep(150, 430, -d);
        const eastRise = smoothstep(730, 1000, d);
        const edgeWob = (fbm2(x / 300 + 11, 0.5, S + 41, 2) - 0.5) * 160;
        // the river leaves the valley through water gaps notched in the end ridges
        const edgeRise = smoothstep(440, 740, Math.abs(z) + edgeWob) * smoothstep(50, 220, Math.abs(d));
        const rise = 1 - (1 - westRise) * (1 - eastRise) * (1 - edgeRise);
        const crest = ridged(x / 230, z / 400, S + 5, 4);
        const mountains = rise * (55 + 125 * crest) + rise * rise * 45;

        // foothills and broad swells, tamed around the ranch and along the river
        const tame = (1 - 0.78 * penMask) * (1 - 0.7 * riverBand);
        const hills = (fbm2(x / 170, z / 170, S + 3, 3) - 0.5) * 2 * 12 * tame;
        const swell = (fbm2(x / 420 + 5, z / 420 - 2, S + 17, 2) - 0.5) * 2 * 9 * (1 - 0.7 * penMask);
        const micro = (fbm2(x / 26, z / 26, S + 9, 2) - 0.5) * 2 * 0.7;
        H[j * N + i] = hills + swell + micro + mountains;

        // woods: noise patches, thicker up the slopes, thinned to clearings,
        // held off the ranch and the river meadows, gone on the high balds
        const f = fbm2(x / 160 + 7, z / 160 - 3, S + 21, 3);
        const clear = fbm2(x / 55 - 4, z / 55 + 9, S + 27, 2);
        let forest = f + 0.22 * rise - 0.3 * penMask - 0.45 * riverBand + 0.06 - Math.max(0, clear - 0.6) * 2.5;
        forest = smoothstep(0.5, 0.64, forest);
        forest *= 1 - smoothstep(115, 160, mountains) * (1 - smoothstep(0.55, 0.75, crest));
        F[j * N + i] = Math.round(forest * 255);
      }
    }
  }

  // carve a channel along a polyline of {x, z, y (surface), w (half-width)}
  _carve(path, bankW, depth, kind) {
    const H = this.H, Wl = this.Wl, K = this.K;
    for (let p = 0; p < path.length; p++) {
      const { x, z, y, w } = path[p];
      const R = w + bankW;
      const i0 = Math.max(0, Math.floor((x - R + WORLD_HALF) / TEXEL)), i1 = Math.min(N - 1, Math.ceil((x + R + WORLD_HALF) / TEXEL));
      const j0 = Math.max(0, Math.floor((z - R + WORLD_HALF) / TEXEL)), j1 = Math.min(N - 1, Math.ceil((z + R + WORLD_HALF) / TEXEL));
      for (let j = j0; j <= j1; j++) {
        const tz = -WORLD_HALF + j * TEXEL;
        for (let i = i0; i <= i1; i++) {
          const tx = -WORLD_HALF + i * TEXEL;
          const dist = Math.hypot(tx - x, tz - z);
          if (dist >= R) continue;
          const k = j * N + i;
          const h = H[k];
          let t;
          if (dist < w) {
            const q = dist / w;
            t = y - depth * (1 - q * q);
            if (Wl[k] < y) Wl[k] = y;
            K[k] = kind;
          } else {
            t = lerp(y + 0.35, h, smoothstep(w, R, dist));
          }
          if (t < h || dist < w) H[k] = Math.min(H[k], t);
          // ground lying below the water line beside the channel is built up
          // into a low bank so the water never floats above it
          else if (K[k] !== kind && h < y + 0.3) H[k] = Math.max(H[k], lerp(y + 0.3, h, smoothstep(w, R, dist)));
        }
      }
    }
  }

  _river() {
    // surface follows a heavily smoothed local ground level, forced to descend southward
    const step = 3;
    const raw = [];
    for (let z = -WORLD_HALF - 6; z <= WORLD_HALF + 6; z += step) {
      const x = this.riverX(z);
      raw.push({ x, z, h: this._sample(this.H, x, z) });
    }
    const win = 40; // samples each side (~120 m)
    const path = [];
    for (let p = 0; p < raw.length; p++) {
      let s = 0, n = 0;
      for (let q = Math.max(0, p - win); q <= Math.min(raw.length - 1, p + win); q++) { s += raw[q].h; n++; }
      path.push({ x: raw[p].x, z: raw[p].z, y: s / n - 1.7, w: 0 });
    }
    for (let p = 1; p < path.length; p++) path[p].y = Math.min(path[p].y, path[p - 1].y - 0.002);
    for (const pt of path) pt.w = 11 + 3.5 * Math.sin(pt.z / 60 + this._a2) + (fbm2(pt.z / 70, 1.2, this.seed + 51, 2) - 0.5) * 6;
    this._carve(path, 11, 1.15, K_WATER);
    this.rivers.push({ path, width: 1.0, main: true });
  }

  _creeks() {
    // creeks run from springs up in the side hollows down to the river along
    // a wandering course; each one cuts its own small hollow, its bed a
    // smoothed reading of the ground that never climbs downstream
    const springs = [
      [[350 + this.rand() * 110, -330 - this.rand() * 110], -330 + this.rand() * 40],
      [[400 + this.rand() * 110, 190 + this.rand() * 120], 250 + this.rand() * 60],
      [[-140 - this.rand() * 70, -560 - this.rand() * 40], -470 + this.rand() * 30],
    ];
    let n = 0;
    for (const [[sx, sz], ez] of springs) {
      const ex = this.riverX(ez) + 4;
      const len = Math.hypot(ex - sx, ez - sz);
      const px = -(ez - sz) / len, pz = (ex - sx) / len;       // perpendicular
      const k = 2 + this.rand() * 2, ph = this.rand() * 6.28;
      const raw = [];
      const steps = Math.ceil(len / 3);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wig = (Math.sin(t * Math.PI * k + ph) * 28 + (fbm2(t * 9 + n * 3, 2.2, this.seed + 63 + n, 2) - 0.5) * 60) * Math.sin(t * Math.PI);
        const x = lerp(sx, ex, t) + px * wig, z = lerp(sz, ez, t) + pz * wig;
        raw.push({ x, z, h: this._sample(this.H, x, z) });
      }
      // never climbing downstream, and never below its own outlet into the river
      const rv = this.rivers[0].path;
      let near = rv[0];
      for (const q of rv) if (Math.abs(q.z - ez) < Math.abs(near.z - ez)) near = q;
      const win = 8;
      const path = [];
      let y = Infinity;
      for (let p = 0; p < raw.length; p++) {
        let s = 0, c = 0;
        for (let q = Math.max(0, p - win); q <= Math.min(raw.length - 1, p + win); q++) { s += raw[q].h; c++; }
        y = Math.min(y, s / c - 0.8);
        const remaining = (raw.length - 1 - p) * 3;
        y = Math.max(y, near.y + 0.1 + remaining * 0.004);
        path.push({ x: raw[p].x, z: raw[p].z, y, w: 2.2 });
      }
      for (let p = path.length - 5; p < path.length; p++) if (p >= 0) path[p].y = Math.min(path[p].y, near.y + 0.05);
      this._carve(path, 12, 0.5, K_WATER);
      this.rivers.push({ path, width: 1.0, main: false });
      n++;
    }
  }

  _trails() {
    // dirt tracks out of the two gates: north up to a bald with a view, west to the river crossing
    const wob = (t, s) => (fbm2(t * 0.02 + s, 0.3, this.seed + 71 + s, 2) - 0.5) * 24;
    const north = [];
    for (let z = -PEN_HALF; z >= -470; z -= 3) north.push({ x: wob(z, 1) * smoothstep(-PEN_HALF, -PEN_HALF - 60, z) + (z + PEN_HALF) * -0.12, z });
    const westZ = 40;
    const west = [];
    const rx = this.riverX(westZ);
    for (let x = -PEN_HALF; x >= rx - 60; x -= 3) west.push({ x, z: westZ + wob(x, 2) * smoothstep(-PEN_HALF, -PEN_HALF - 40, x) * smoothstep(rx - 25, rx - 70, x) });
    this.trails.push(north, west);
    for (const t of this.trails) this._mark(t, 2.4, K_TRAIL);
    this.gates = [{ side: 'N', at: 0 }, { side: 'W', at: westZ }];
  }

  // claim a disc for a building: nothing grows or spawns there
  reserve(x, z, r) {
    this._mark([{ x, z }], r, K_BUILT, false);
    const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / TEXEL)), i1 = Math.min(N - 1, Math.ceil((x + r + WORLD_HALF) / TEXEL));
    const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / TEXEL)), j1 = Math.min(N - 1, Math.ceil((z + r + WORLD_HALF) / TEXEL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(-WORLD_HALF + i * TEXEL - x, -WORLD_HALF + j * TEXEL - z) <= r) this.G[j * N + i] = 0;
    }
  }

  _mark(path, r, kind, onlyOpen = true) {
    const K = this.K;
    for (const { x, z } of path) {
      const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / TEXEL)), i1 = Math.min(N - 1, Math.ceil((x + r + WORLD_HALF) / TEXEL));
      const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / TEXEL)), j1 = Math.min(N - 1, Math.ceil((z + r + WORLD_HALF) / TEXEL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (Math.hypot(-WORLD_HALF + i * TEXEL - x, -WORLD_HALF + j * TEXEL - z) > r) continue;
        const k = j * N + i;
        if (!onlyOpen || K[k] === K_OPEN) K[k] = kind;
      }
    }
  }

  _bridgeSite() {
    // a wooden bridge where the west trail meets the river
    const z = 40;
    const x = this.riverX(z);
    const main = this.rivers[0].path;
    let best = main[0];
    for (const p of main) if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p;
    const w = best.w;
    const halfLen = w + 4, ramp = 12, halfW = 2.3;
    const y = best.y;
    const deckTop = y + 1.7;
    // the ramps run down to a hair under the ground at their ends so the trail meets the planks flush
    const endW = Math.max(y + 0.45, this._sample(this.H, x - halfLen - ramp, z) - 0.2);
    const endE = Math.max(y + 0.45, this._sample(this.H, x + halfLen + ramp, z) - 0.2);
    const b = {
      x, z, dx: 1, dz: 0, halfLen, ramp, halfW, y, deckTop, endW, endE,
      deckY: (u) => {
        const a = Math.abs(u);
        if (a <= halfLen) return deckTop + 0.5 * (1 - (u / halfLen) * (u / halfLen));
        return lerp(deckTop, u < 0 ? endW : endE, smoothstep(halfLen, halfLen + ramp, a));
      },
    };
    this.bridge = b;
    const pts = [];
    for (let u = -halfLen - ramp; u <= halfLen + ramp; u += 2) pts.push({ x: x + u, z });
    this._mark(pts, halfW + 0.5, K_BUILT, false);
  }

  // ---- colour ---------------------------------------------------------------
  _paint() {
    const H = this.H, F = this.F, K = this.K, G = this.G, Wl = this.Wl;
    const S = this.seed;
    const data = new Uint8Array(N * N * 4);
    const c = new THREE.Color(), tmp = new THREE.Color();
    const meadow = new THREE.Color(0x6aa64c), meadow2 = new THREE.Color(0x7fb35a), dry = new THREE.Color(0x9da34f);
    const floor = new THREE.Color(0x4f6e35), rock = new THREE.Color(0x8d8880), rock2 = new THREE.Color(0x6f6a62);
    const bald = new THREE.Color(0x9fb85e), dirt = new THREE.Color(0x8a6a3d), sand = new THREE.Color(0xa9946a);
    const bed = new THREE.Color(0x5e5a4a), grazed = new THREE.Color(0x86ad4f);
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * TEXEL;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * TEXEL;
        const k = j * N + i;
        const h = H[k];
        const il = Math.max(0, i - 1), ir = Math.min(N - 1, i + 1), ju = Math.max(0, j - 1), jd = Math.min(N - 1, j + 1);
        const slope = Math.hypot(H[j * N + ir] - H[j * N + il], H[jd * N + i] - H[ju * N + i]) / (2 * TEXEL);
        const forest = F[k] / 255;
        const n = fbm2(x * 0.02 + 40, z * 0.02 - 17, S + 7, 3);
        const d = fbm2(x * 0.09 - 8, z * 0.09 + 23, S + 13, 2);
        const penMask = 1 - smoothstep(160, 200, Math.max(Math.abs(x), Math.abs(z)));

        c.copy(meadow).lerp(meadow2, clamp01((n - 0.4) * 2));
        c.lerp(dry, Math.max(0, (n - 0.48) * 2.4));
        if (d > 0.7) c.lerp(dirt, Math.min(0.5, (d - 0.7) * 3));
        c.lerp(grazed, penMask * 0.45);
        c.lerp(floor, forest * 0.8);
        // balds on the high tops, rock on the steep faces and crests
        c.lerp(bald, smoothstep(105, 150, h) * (1 - smoothstep(0.5, 0.9, slope)) * (1 - forest));
        const rocky = smoothstep(0.85, 1.35, slope) * 0.9 + smoothstep(175, 230, h) * 0.5;
        c.lerp(tmp.copy(rock).lerp(rock2, d), Math.min(1, rocky));
        let grass = (1 - forest * 0.75) * (1 - smoothstep(0.7, 1.1, slope)) * (1 - smoothstep(170, 210, h));
        if (rocky > 0.5 && K[k] === K_OPEN) K[k] = K_ROCK;
        const kind = K[k];
        if (kind === K_WATER) {
          c.copy(bed).lerp(sand, clamp01((Wl[k] - h) < 0.5 ? 0.6 : 0.2));
          grass = 0;
        } else if (kind === K_TRAIL || kind === K_BUILT) {
          c.copy(dirt).lerp(sand, 0.35 + d * 0.3);
          grass = 0;
        } else if (Wl[k] > -1e8 || this._nearWater(i, j)) {
          c.lerp(sand, 0.45);
          grass *= 0.6;
        }
        c.offsetHSL(0, 0, (h / 60) * 0.02);
        data[k * 4] = c.r * 255; data[k * 4 + 1] = c.g * 255; data[k * 4 + 2] = c.b * 255; data[k * 4 + 3] = 255;
        G[k] = Math.round(clamp01(grass) * 255);
      }
    }
    this.colorData = data;
  }

  _nearWater(i, j) {
    const Wl = this.Wl;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      if (Wl[jj * N + ii] > -1e8) return true;
    }
    return false;
  }

  // ---- rendering -------------------------------------------------------------
  build(scene) {
    const heightTex = new THREE.DataTexture(this.H, N, N, THREE.RedFormat, THREE.FloatType);
    heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;
    const colorTex = new THREE.DataTexture(this.colorData, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    colorTex.magFilter = colorTex.minFilter = THREE.LinearFilter;
    colorTex.generateMipmaps = false;
    colorTex.needsUpdate = true;
    const detail = makeNoiseTexture(128);
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    this.noiseTex = detail;

    this.uniforms = {
      uHeight: { value: heightTex },
      uColor: { value: colorTex },
      uDetail: { value: detail },
      uHalf: { value: WORLD_HALF },
      uTexel: { value: TEXEL },
      uN: { value: N },
      uPlayer: { value: new THREE.Vector3() },
      uNearR: { value: NEAR_R },
    };

    const mkMat = (far) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = `
          uniform sampler2D uHeight; uniform float uHalf; uniform float uTexel; uniform float uN;
          uniform vec3 uPlayer; uniform float uNearR;
          varying vec2 vWxz;
          float hFetch(ivec2 i){ i = clamp(i, ivec2(0), ivec2(int(uN) - 1)); return texelFetch(uHeight, i, 0).r; }
          float hAt(vec2 p){
            vec2 g = clamp((p + uHalf) / uTexel, 0.0, uN - 1.0);
            vec2 f0 = floor(g); vec2 f = g - f0; ivec2 i = ivec2(f0);
            float a = hFetch(i), b = hFetch(i + ivec2(1, 0)), c = hFetch(i + ivec2(0, 1)), d = hFetch(i + ivec2(1, 1));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
        ` + shader.vertexShader
          .replace('#include <beginnormal_vertex>', `
            vec4 wp0 = modelMatrix * vec4(position, 1.0);
            vec2 wxz = wp0.xz;
            float e = ${far ? '3.0' : '0.8'};
            float hx0 = hAt(wxz - vec2(e, 0.0)), hx1 = hAt(wxz + vec2(e, 0.0));
            float hz0 = hAt(wxz - vec2(0.0, e)), hz1 = hAt(wxz + vec2(0.0, e));
            vec3 objectNormal = normalize(vec3(hx0 - hx1, 2.0 * e, hz0 - hz1));
            #ifdef USE_TANGENT
              vec3 objectTangent = vec3( tangent.xyz );
            #endif
          `)
          .replace('#include <begin_vertex>', `
            vec3 transformed = vec3(position);
            transformed.y = hAt(wxz);
            vWxz = wxz;
            float dd = distance(wxz, uPlayer.xz);
            ${far
              ? 'transformed.y -= 3.0 * (1.0 - smoothstep(uNearR - 4.0, uNearR + 7.0, dd));'
              : 'float rr = length(position.xz); transformed.y -= max(0.0, rr - (uNearR - 3.0)) * 1.6;'}
          `);
        shader.fragmentShader = `
          uniform sampler2D uColor; uniform sampler2D uDetail; uniform float uHalf; uniform float uTexel; uniform float uN;
          varying vec2 vWxz;
        ` + shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          vec2 tuv = ((vWxz + uHalf) / uTexel + 0.5) / uN;
          vec3 ground = texture2D(uColor, tuv).rgb;
          float d1 = texture2D(uDetail, vWxz * 0.31).r, d2 = texture2D(uDetail, vWxz * 1.7).g;
          ground *= 0.86 + 0.18 * d1 + 0.1 * d2;
          diffuseColor.rgb *= ground;
        `);
      };
      return mat;
    };

    // far: the whole world on a coarse grid, sunk out of sight under the near disc
    const farGeo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, Math.round(WORLD_HALF * 2 / FAR_STEP), Math.round(WORLD_HALF * 2 / FAR_STEP));
    farGeo.rotateX(-Math.PI / 2);
    farGeo.computeBoundingSphere();
    farGeo.boundingSphere.radius += 250;
    this.far = new THREE.Mesh(farGeo, mkMat(true));
    this.far.receiveShadow = true;
    this.far.frustumCulled = false;
    scene.add(this.far);

    // near: a fine disc that snaps along with the rider; its rim drops as a skirt
    const n = Math.ceil((NEAR_R * 2) / NEAR_STEP);
    const nearGeo = new THREE.PlaneGeometry(NEAR_R * 2, NEAR_R * 2, n, n);
    nearGeo.rotateX(-Math.PI / 2);
    const pos = nearGeo.attributes.position;
    const idx = nearGeo.index.array;
    const keep = [];
    const R2 = (NEAR_R + 2) * (NEAR_R + 2);
    for (let t = 0; t < idx.length; t += 3) {
      let inside = false;
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        const x = pos.getX(v), z = pos.getZ(v);
        if (x * x + z * z < R2) { inside = true; break; }
      }
      if (inside) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    nearGeo.setIndex(keep);
    nearGeo.computeBoundingSphere();
    nearGeo.boundingSphere.radius += 250;
    this.near = new THREE.Mesh(nearGeo, mkMat(false));
    this.near.receiveShadow = true;
    this.near.frustumCulled = false;
    scene.add(this.near);

    this._buildWater(scene);
  }

  _buildWater(scene) {
    const noise = this.noiseTex;
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(0.55, 0.7, 0.3).normalize() },
        uDeep: { value: new THREE.Color(0x2c5f6e) },
        uShallow: { value: new THREE.Color(0x7fb7c6) },
        uNoise: { value: noise },
      }]),
      vertexShader: `
        varying vec2 vUv; varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform sampler2D uNoise;
        varying vec2 vUv; varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main(){
          vec2 p = vWorld.xz;
          float n1 = texture2D(uNoise, p * 0.07 + vec2(uTime * 0.035, uTime * 0.02)).r;
          float n2 = texture2D(uNoise, p * 0.19 - vec2(uTime * 0.05, -uTime * 0.03)).g;
          vec3 nrm = normalize(vec3((n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.4, 1.0, (n2 - 0.5) * 0.7 + (n1 - 0.5) * 0.3));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, 0.3 + 0.7 * fres);
          vec3 Hh = normalize(uSun + V);
          float spec = pow(max(dot(nrm, Hh), 0.0), 80.0);
          col += spec * 0.8 * vec3(1.0, 0.97, 0.9);
          float edge = smoothstep(0.36, 0.5, abs(vUv.y - 0.5));
          col = mix(col, vec3(0.92), edge * 0.4 * (0.4 + 0.6 * n2));
          float alpha = mix(0.66, 0.88, fres) - edge * 0.25;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    this.water = new THREE.Group();
    for (const r of this.rivers) {
      const geo = ribbon(r.path, r.main ? 0.9 : 0.6);
      const mesh = new THREE.Mesh(geo, this.waterMat);
      mesh.renderOrder = 2;
      this.water.add(mesh);
    }
    scene.add(this.water);
  }

  update(playerPos, dt, time) {
    this.uniforms.uPlayer.value.copy(playerPos);
    const snap = NEAR_STEP * 2;
    this.near.position.set(Math.round(playerPos.x / snap) * snap, 0, Math.round(playerPos.z / snap) * snap);
    this.waterMat.uniforms.uTime.value = time;
    void dt;
  }
}

// a strip along a path, `k` metres of extra half-width beyond the channel so no gap shows at the bank
function ribbon(path, extra) {
  const n = path.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  let along = 0;
  for (let p = 0; p < n; p++) {
    const a = path[Math.max(0, p - 1)], b = path[Math.min(n - 1, p + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    const w = path[p].w + extra;
    const y = path[p].y;
    if (p > 0) along += Math.hypot(path[p].x - path[p - 1].x, path[p].z - path[p - 1].z);
    pos.set([path[p].x + nx * w, y, path[p].z + nz * w, path[p].x - nx * w, y, path[p].z - nz * w], p * 6);
    uv.set([along / 10, 0, along / 10, 1], p * 4);
    if (p > 0) {
      const i = p * 2;
      idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// tileable value noise in R and G (two octaves each) for ground detail and water ripples
export function makeNoiseTexture(size) {
  const data = new Uint8Array(size * size * 4);
  const lat = (period, seed) => {
    const t = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < t.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; t[i] = s / 4294967296; }
    return (x, z) => {
      const gx = (x / size) * period, gz = (z / size) * period;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = gx - ix, fz = gz - iz;
      const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
      const g = (i, j) => t[((j + period) % period) * period + ((i + period) % period)];
      const a = g(ix, iz), b = g(ix + 1, iz), c = g(ix, iz + 1), d = g(ix + 1, iz + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  const r1 = lat(8, 3), r2 = lat(32, 11), g1 = lat(6, 29), g2 = lat(24, 47);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const k = (z * size + x) * 4;
    data[k] = (r1(x, z) * 0.65 + r2(x, z) * 0.35) * 255;
    data[k + 1] = (g1(x, z) * 0.6 + g2(x, z) * 0.4) * 255;
    data[k + 2] = 128; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

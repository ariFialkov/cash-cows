// Long grass: tufts of thin bent blades (three variants — tall bare, short
// and wide, seed-headed) hashed into cells and re-laid around the rider, plus
// a sparse ring of big tufts further out. Blades sway in the wind on the GPU,
// and every near tuft carries a little spring: a horse or cow brushing past
// pushes the blades over and they wobble back upright on their own. The
// grass only ever reacts — nothing pushes back.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

const VARIANTS = [
  { blades: 7, height: 0.78, headed: false, spread: 0.15, lean: 0.55, wBase: 0.048 },   // tall bare long grass
  { blades: 7, height: 0.8, headed: true, spread: 0.16, lean: 0.5, wBase: 0.05 },      // tall with seed heads
];

// sparse tufts of long grass out to 90 m (most bare, some headed), all with
// brushing physics so the ones you ride through bend and wobble back
const LAYERS = [
  { variant: 0, cell: 5, radius: 18, per: 1, scale: 1.45, fadeIn: [0, 0], fadeOut: [80, 89], physics: true },
  { variant: 1, cell: 7, radius: 13, per: 1, scale: 1.5, fadeIn: [0, 0], fadeOut: [80, 89], physics: true },
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const YAXIS = new THREE.Vector3(0, 1, 0);

function frac(x) { return x - Math.floor(x); }
function hash(a, b, c) { return frac(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453); }

// one tuft: several tapered strips fanning out from the root, each curving
// outward under its own weight, optionally tipped with a seed head
function tuftGeometry(v, seed) {
  const rand = mulberry32(seed);
  const pos = [], col = [], uvs = [], idx = [];
  const SEG = 3;
  const base = new THREE.Color(0x5a8f2e), tip = new THREE.Color(0xa9d35c), head = new THREE.Color(0xc9b06a);
  let vi = 0;
  for (let b = 0; b < v.blades; b++) {
    const a = (b / v.blades) * Math.PI * 2 + rand() * 1.2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const h = v.height * (0.75 + rand() * 0.5);
    const lean = v.lean * (0.6 + rand() * 0.8);
    const rx = dx * v.spread * rand(), rz = dz * v.spread * rand();
    const w0 = v.wBase * (0.8 + rand() * 0.5);
    const cx = -dz, cz = dx;                       // across the blade
    const dark = 0.85 + rand() * 0.3;
    for (let j = 0; j <= SEG; j++) {
      const s = j / SEG;
      const y = h * s * (1 - 0.18 * s * s * lean);
      const out = h * lean * s * s * 0.55;
      const w = w0 * (1 - 0.82 * s);
      const px = rx + dx * out, pz = rz + dz * out;
      pos.push(px + cx * w, y, pz + cz * w, px - cx * w, y, pz - cz * w);
      _c.copy(base).lerp(tip, s * s).multiplyScalar(dark);
      col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
      uvs.push(0, s, 1, s);
      if (j > 0) {
        const k = vi + j * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    vi += (SEG + 1) * 2;
    if (v.headed && b % 2 === 0) {
      // seed head: a slim spike continuing the blade past its tip
      const y0 = h * (1 - 0.18 * lean), out0 = h * lean * 0.55;
      const len = 0.09 + rand() * 0.05, w = 0.014;
      for (let j = 0; j <= 2; j++) {
        const t = j / 2;
        const y = y0 + len * t * (1 - 0.3 * lean), out = out0 + len * t * lean * 0.6;
        const ww = w * (j === 1 ? 1.4 : 0.6);
        const px = rx + dx * out, pz = rz + dz * out;
        pos.push(px + cx * ww, y, pz + cz * ww, px - cx * ww, y, pz - cz * ww);
        _c.copy(head).multiplyScalar(dark);
        col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
        uvs.push(0, 1, 1, 1);
        if (j > 0) {
          const k = vi + j * 2;
          idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      }
      vi += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1;    // lit like a lawn
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.userData.height = v.height * 1.25 + (v.headed ? 0.14 : 0);
  return geo;
}

export class Grass {
  constructor(scene, terrain, seed, quality = 'high') {
    this.terrain = terrain;
    this.seed = seed;
    this.layers = [];
    for (let L = 0; L < LAYERS.length; L++) {
      // low quality: one tuft of each variant per cell instead of two
      const cfg = quality === 'low' && LAYERS[L].physics ? { ...LAYERS[L], per: 1 } : LAYERS[L];
      const S = cfg.radius * 2 + 1;
      const count = S * S * cfg.per;
      const geo = tuftGeometry(VARIANTS[cfg.variant], seed + L * 17);
      const bend = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
      bend.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aBend', bend);
      // Lambert: the cheapest lit material, since thousands of thin blades overdraw
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const uniforms = { uTime: { value: 0 }, uBladeH: { value: geo.userData.height }, uPlayer: { value: new THREE.Vector3() } };
      // each layer bakes its own fade distances into the shader: keep their programs apart
      mat.customProgramCacheKey = () => `grass-${L}`;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = `
          attribute vec2 aBend;
          uniform float uTime; uniform float uBladeH; uniform vec3 uPlayer;
        ` + shader.vertexShader
          .replace('#include <begin_vertex>', `
            vec3 transformed = vec3(position);
            float kk = clamp(position.y / uBladeH, 0.0, 1.0);
            kk *= kk;
            // the layer fades in past its inner edge and thins out toward its outer edge
            vec3 root = instanceMatrix[3].xyz;
            float dRoot = distance(root.xz, uPlayer.xz);
            transformed *= smoothstep(${cfg.fadeIn[0].toFixed(1)}, ${cfg.fadeIn[1].toFixed(1)}, dRoot)
                         * (1.0 - smoothstep(${cfg.fadeOut[0].toFixed(1)}, ${cfg.fadeOut[1].toFixed(1)}, dRoot));
          `)
          .replace('#include <project_vertex>', `
            vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
            float g = sin(uTime * 1.5 + root.x * 0.32 + root.z * 0.21) * 0.55
                    + sin(uTime * 2.6 + root.x * 0.9 - root.z * 0.7) * 0.3
                    + sin(uTime * 0.7 + root.z * 0.12) * 0.4;
            vec2 sway = vec2(0.045 + g * 0.06, 0.02 + g * 0.035);
            mvPosition.xz += (aBend + sway) * kk;
            // a pushed-over blade arcs down as well as sideways
            mvPosition.y -= dot(aBend, aBend) / (2.6 * uBladeH) * kk;
            mvPosition = modelViewMatrix * mvPosition;
            gl_Position = projectionMatrix * mvPosition;
          `);
        // blades are lit as a lawn from either side: never flip the normal on the back face
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
          float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
          vec3 normal = normalize(vNormal);
          vec3 nonPerturbedNormal = normal;
        `);
      };
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.layers.push({
        cfg, S, count, mesh, bend, uniforms, cell: null,
        key: new Int32Array(count).fill(0x7fffffff),  // which cell each slot holds
        px: new Float32Array(count), pz: new Float32Array(count), on: new Uint8Array(count),
        bx: new Float32Array(count), bz: new Float32Array(count), vx: new Float32Array(count), vz: new Float32Array(count),
        active: new Set(),
      });
    }
  }

  _slot(lay, gx, gz, k) {
    const S = lay.S;
    return ((((gx % S) + S) % S) * S + (((gz % S) + S) % S)) * lay.cfg.per + k;
  }

  _lay(lay, L, cx, cz) {
    const T = this.terrain;
    const { radius: R, per, cell, scale } = lay.cfg;
    let dirty = false;
    for (let gx = cx - R; gx <= cx + R; gx++) {
      for (let gz = cz - R; gz <= cz + R; gz++) for (let k = 0; k < per; k++) {
        const slot = this._slot(lay, gx, gz, k);
        const key = gx * 65536 + gz;
        if (lay.key[slot] === key) continue;
        lay.key[slot] = key;
        dirty = true;
        lay.bx[slot] = lay.bz[slot] = lay.vx[slot] = lay.vz[slot] = 0;
        lay.active.delete(slot);
        const h1 = hash(gx, gz, L * 3 + k * 11 + 1 + this.seed * 1e-3), h2 = hash(gx, gz, L * 3 + k * 11 + 2), h3 = hash(gx, gz, L * 3 + k * 11 + 3);
        const x = (gx + h1) * cell, z = (gz + h2) * cell;
        const g = T.grassAt(x, z);
        if (h3 > g * 0.95) { lay.on[slot] = 0; _m.makeScale(0, 0, 0); }
        else {
          lay.on[slot] = 1;
          lay.px[slot] = x; lay.pz[slot] = z;
          const s = (0.75 + h2 * 0.65) * scale;
          _q.setFromAxisAngle(YAXIS, h1 * Math.PI * 2);
          _m.compose(_v.set(x, T.heightAt(x, z) - 0.02, z), _q, _s.set(s, s * (0.85 + h3 * 0.5), s));
          _c.setHSL(0.24 + (h1 - 0.5) * 0.05 + (1 - g) * 0.03, 0.55 - (1 - g) * 0.2, 0.55 + (h2 - 0.5) * 0.14 + (1 - g) * 0.1);
          lay.mesh.setColorAt(slot, _c);
        }
        lay.mesh.setMatrixAt(slot, _m);
        lay.bend.setXY(slot, 0, 0);
      }
    }
    if (dirty) {
      lay.mesh.instanceMatrix.needsUpdate = true;
      if (lay.mesh.instanceColor) lay.mesh.instanceColor.needsUpdate = true;
      lay.bend.needsUpdate = true;
    }
  }

  // movers: [{ x, z, vx, vz, r }] — bodies brushing through the grass this frame
  update(playerPos, dt, time, movers) {
    for (let L = 0; L < this.layers.length; L++) {
      const lay = this.layers[L];
      const cx = Math.round(playerPos.x / lay.cfg.cell), cz = Math.round(playerPos.z / lay.cfg.cell);
      if (!lay.cell || Math.abs(cx - lay.cell[0]) > 1 || Math.abs(cz - lay.cell[1]) > 1) {
        lay.cell = [cx, cz];
        this._lay(lay, L, cx, cz);
      }
      lay.uniforms.uTime.value = time;
      lay.uniforms.uPlayer.value.copy(playerPos);
    }

    // brushing: bodies push nearby tufts over (radially, and along their motion)
    for (const m of movers) {
      const R = m.r + 0.9;
      const sp = Math.hypot(m.vx, m.vz);
      const ux = sp > 1e-3 ? m.vx / sp : 0, uz = sp > 1e-3 ? m.vz / sp : 0;
      const drive = Math.min(1, 0.35 + sp / 5);
      for (const lay of this.layers) {
        if (!lay.cfg.physics) continue;
        const cell = lay.cfg.cell;
        const gx0 = Math.floor((m.x - R) / cell), gx1 = Math.floor((m.x + R) / cell);
        const gz0 = Math.floor((m.z - R) / cell), gz1 = Math.floor((m.z + R) / cell);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) for (let k = 0; k < lay.cfg.per; k++) {
          const slot = this._slot(lay, gx, gz, k);
          if (!lay.on[slot] || lay.key[slot] !== gx * 65536 + gz) continue;
          const dx = lay.px[slot] - m.x, dz = lay.pz[slot] - m.z;
          const d = Math.hypot(dx, dz);
          if (d > R) continue;
          const push = (1 - d / R) * drive;
          const rx = d > 1e-3 ? dx / d : 0, rz = d > 1e-3 ? dz / d : 0;
          // a held-down force while the body is over it, plus a flick along its motion
          lay.vx[slot] += ((rx * 0.6 + ux * 1.0) * 52 * push) * dt;
          lay.vz[slot] += ((rz * 0.6 + uz * 1.0) * 52 * push) * dt;
          lay.active.add(slot);
        }
      }
    }

    // spring back: under-damped so the blades wobble upright for a couple of swings
    const k = 34, c = 2.6;
    for (const lay of this.layers) {
      if (!lay.active.size) continue;
      for (const slot of lay.active) {
        let bx = lay.bx[slot], bz = lay.bz[slot], vx = lay.vx[slot], vz = lay.vz[slot];
        vx += (-k * bx - c * vx) * dt; vz += (-k * bz - c * vz) * dt;
        bx += vx * dt; bz += vz * dt;
        const l = Math.hypot(bx, bz);
        if (l > 1.15) { bx *= 1.15 / l; bz *= 1.15 / l; vx *= 0.5; vz *= 0.5; }
        if (l < 0.004 && Math.abs(vx) + Math.abs(vz) < 0.02) { bx = bz = vx = vz = 0; lay.active.delete(slot); }
        lay.bx[slot] = bx; lay.bz[slot] = bz; lay.vx[slot] = vx; lay.vz[slot] = vz;
        lay.bend.setXY(slot, bx, bz);
      }
      lay.bend.needsUpdate = true;
    }
  }
}

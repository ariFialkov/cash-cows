// Skinned cattle: the rigged cow / bull GLBs driven by the same gait engine
// as the horses, with a bovine profile (shorter flatter strides, low head,
// little knee action, stiff back, hinds that hop together at the gallop),
// plus cow-only behaviours: grazing, the lassoed struggle and the Crash
// Bull's stomp. Hides are painted into vertex colours the same way as the
// horse coats — Holstein patches, brown, and the glowing special variants.

import * as THREE from 'three';
import { loadRigTemplate, instantiateRig, applyPose, bodyCapsules } from './horseModel.js';
import { GaitEngine } from './gait.js';
import { fbm2 } from '../core/rng.js';

export const CATTLE = {
  cow:  { model: 'cow',  height: 1.42 },
  bull: { model: 'bull', height: 1.52 },
};

// Bovine gait profile. Cattle walk, break into a short choppy trot and then
// a rocking gallop where the hind feet land almost together.
const COW_GAIT = {
  midGait: 'trot', midMin: 2.0, gallopMin: 4.6,
  strideScale: 0.8, freqScale: 1.0, bobScale: 0.85, suspension: 0.45, pitchScale: 1.1,
  kneeLift: 0.65, hockLift: 0.85, neckCarriage: 0.12, headNod: 0.6, tailCarriage: -0.3, stretch: 0.25,
  mid: { offsets: [0.0, 0.5, 0.5, 0.0], duty: 0.5, stride: 2.0 },
  gallop: { offsets: [0.3, 0.42, 0.0, 0.08], duty: 0.36, stride: 3.2 },
};
const BULL_GAIT = { ...COW_GAIT, strideScale: 0.85, freqScale: 0.92, bobScale: 1.0, kneeLift: 0.7, neckCarriage: 0.18, headNod: 0.8 };

export function loadCattle(kind) {
  const c = CATTLE[kind];
  return loadRigTemplate(c.model, c.height, { fixTorso: true });
}
export function preloadCattle() {
  return Promise.all([loadCattle('cow'), loadCattle('bull')]);
}

// ---------------------------------------------------------------------------
// Hide painting

const _c = new THREE.Color(), _c2 = new THREE.Color();
function noise3(x, y, z, seed) {
  return (fbm2(x + z * 0.7, y - z * 0.4, seed, 3) + fbm2(y + x * 0.6, z + x * 0.3, seed + 31, 3)) * 0.5;
}

// look: { base, spot, pattern, whiteFace, horn, hoof, muzzle, udder }
export const LOOKS = {
  holstein: { base: 0xe9e4da, spot: 0x2e2a28, pattern: 'patches', whiteLegs: true, horn: 0xcfc4ae, muzzle: 0xd9b7a8, udder: 0xe8b7a8 },
  brown:    { base: 0xa4693c, spot: 0x8a5530, pattern: 'mottle', horn: 0xcfc4ae, muzzle: 0xd6b3a6, udder: 0xe8b7a8 },
  angus:    { base: 0x26211f, spot: 0x141111, pattern: 'mottle', horn: 0xcfc4ae, muzzle: 0x2a2424, udder: 0x6b5450 },
  mystery:  { base: 0x3b2a68, spot: 0x7b5fd1, pattern: 'patches', horn: 0xd9c8ff, muzzle: 0x2a1d4e, udder: 0x5b48a0 },
  offer:    { base: 0xe8b64c, spot: 0xc98f1b, pattern: 'patches', horn: 0xfff2c8, muzzle: 0xa8791c, udder: 0xe2c078 },
  crash:    { base: 0x17151a, spot: 0x0d0c0f, pattern: 'mottle', horn: 0xd8d2c6, muzzle: 0x0d0c0f, udder: 0x17151a },
};

export function paintHide(mesh, look, seed = 1, variant = 0, model = 'cow') {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(look.base), spot = new THREE.Color(look.spot);
  const horn = new THREE.Color(look.horn), muzzle = new THREE.Color(look.muzzle), udder = new THREE.Color(look.udder);
  const hoof = new THREE.Color(0x2b2119), tuft = new THREE.Color(0x2e2520), white = new THREE.Color(0xf1ece2);
  const zMax = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));

  const groupOf = names.map((n) => {
    if (n.startsWith('tail')) return 'tail';
    if (n === 'tail3') return 'tuft';
    if (n === 'head' || n === 'headend') return 'neck';
    if (n === 'skull') return 'skull';
    if (n.includes('earend')) return 'ear';
    if (/^(R_)?(frontleg(0k|1|2)|backleg[12])$/.test(n)) return 'leg';
    return 'body';
  });
  const w = { tail: 0, tuft: 0, neck: 0, skull: 0, ear: 0, leg: 0 };
  // patch coverage varies per variant: some Holsteins are mostly black
  const cover = look.pattern === 'patches' ? 0.62 - (variant % 3) * 0.06 : 0.5;
  const dbg = look.debug ? { horn: new THREE.Color(0x00ff00), muzzle: new THREE.Color(0xff0000), udder: new THREE.Color(0xff00ff), ear: new THREE.Color(0x0000ff) } : null;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const gx = x / bb.max.x;
    const gy = (y - bb.min.y) / (bb.max.y - bb.min.y);
    const gz = z / zMax;
    for (const k in w) w[k] = 0;
    for (let j = 0; j < 4; j++) {
      const g = groupOf[si.getComponent(i, j)];
      if (g !== 'body') w[g] += sw.getComponent(i, j);
    }
    const hair = noise3(x * 30, y * 30, z * 30, seed);
    _c.copy(base).offsetHSL(0, 0, (hair - 0.5) * 0.08);

    if (look.pattern === 'patches') {
      // big irregular patches, edges softened
      const n = noise3(x * 2.6, y * 2.6, z * 2.6, seed + 5) + noise3(x * 8, y * 8, z * 8, seed + 9) * 0.25;
      if (n > cover) _c.copy(spot).offsetHSL(0, 0, (hair - 0.5) * 0.05);
    } else {
      // brown/black: soft mottling, darker along the topline and shoulders
      const n = noise3(x * 5, y * 5, z * 5, seed + 7);
      _c.lerp(spot, THREE.MathUtils.clamp((n - 0.35) * 1.6, 0, 1) * 0.7);
      if (gy > 0.8 && w.skull < 0.2) _c.lerp(spot, 0.35);
    }
    // belly lightening on light coats
    if (gy < 0.4 && w.leg < 0.3 && base.getHSL(_c2).l > 0.2) _c.offsetHSL(0, 0, 0.04);
    // Hereford-style white face + brisket on some browns
    if (look.whiteFace && ((w.skull > 0.5 && gy > 0.55) || (w.neck > 0.4 && gy < 0.55 && Math.abs(gx) < 0.4))) {
      _c.copy(white).offsetHSL(0, 0, (hair - 0.5) * 0.05);
    }
    // Holstein lower legs are usually white
    if (look.whiteLegs && w.leg > 0.6 && gy < 0.25) _c.copy(white);
    // udder
    const isUdder = look.udder && gy < 0.42 && gy > 0.2 && gz < -0.05 && gz > -0.55 && Math.abs(gx) < 0.45 && w.leg < 0.25;
    if (isUdder) _c.lerp(dbg ? dbg.udder : udder, 0.85);
    // muzzle: front of the skull, below the eyes
    const isMuzzle = w.skull > 0.5 && gz > 0.88 && gy < 0.72;
    if (isMuzzle) _c.lerp(dbg ? dbg.muzzle : muzzle, 0.75);
    // horns: on the crown, off centre; the bull's sweep wide and forward
    const isHorn = model === 'bull'
      ? w.skull > 0.5 && gz > 0.3 && gz < 0.9 && ((gy > 0.82 && Math.abs(gx) > 0.35) || (gy > 0.66 && Math.abs(gx) > 0.68))
      : w.skull > 0.5 && gy > 0.92 && Math.abs(gx) > 0.22 && Math.abs(gx) < 0.72 && gz < 0.86;
    if (isHorn) _c.copy(dbg ? dbg.horn : horn).offsetHSL(0, 0, (hair - 0.5) * 0.1);
    if (dbg && w.ear > 0.3) _c.copy(dbg.ear);
    // tail tuft, hooves
    if (w.tuft > 0.5) _c.copy(tuft);
    if (gy < 0.06) _c.copy(hoof);
    colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
  }
  const attr = new THREE.BufferAttribute(colors, 3);
  geo.setAttribute('color', attr);
  return attr;
}

// painted hides are shared between cows of the same model / look / variant
const hideCache = new Map();
function hideFor(mesh, model, lookName, variant) {
  const key = `${model}/${lookName}/${variant}`;
  if (hideCache.has(key)) { mesh.geometry.setAttribute('color', hideCache.get(key)); return; }
  const look = { ...LOOKS[lookName] };
  if (lookName === 'brown' && variant % 3 === 2) look.whiteFace = true;
  if (model === 'bull') look.udder = null;
  if (lookName === 'debug') Object.assign(look, LOOKS.holstein, { debug: true });
  const attr = paintHide(mesh, look, 11 + variant * 17 + lookName.length, variant, model);
  hideCache.set(key, attr);
}

// ---------------------------------------------------------------------------

export class SkinnedCowRig {
  // kind: 'standard' | 'mystery' | 'offer' | 'crash'; model: 'cow' | 'bull'
  constructor(template, kind, model, size, lookName, variant = 0) {
    this.kind = kind;
    this.skinned = true;
    this.group = new THREE.Group();
    this.template = template;
    this.engine = new GaitEngine(model === 'bull' ? BULL_GAIT : COW_GAIT, template.legLen);
    this.pose = null;
    this.phase = Math.random() * 10;

    const inst = instantiateRig(template, true);
    this.model = inst.model;
    this.bones = inst.bones;
    this.mesh = inst.mesh;
    this.modelBaseY = inst.modelBaseY;
    this.group.add(this.model);

    hideFor(this.mesh, model, lookName, variant);
    const matOpts = { vertexColors: true, roughness: 0.9 };
    if (kind === 'mystery') Object.assign(matOpts, { emissive: 0x6a3df0, emissiveIntensity: 0.35, roughness: 0.7 });
    if (kind === 'offer') Object.assign(matOpts, { emissive: 0xffb824, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.35 });
    if (kind === 'crash') matOpts.roughness = 0.75;
    this.mesh.material = new THREE.MeshStandardMaterial(matOpts);
    this.M = { body: this.mesh.material };

    // the Crash Bull's red eyes: glowing spheres riding the skull bone
    if (kind === 'crash') {
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2.2 });
      const skull = this.bones.skull || this.bones.head;
      const poll = new THREE.Vector3();
      this.group.updateMatrixWorld(true);
      skull.getWorldPosition(poll);
      // the nose is the template's most-forward vertex; eyes sit a third of
      // the way down the face from the poll, a hand's width either side
      const muzzle = template.muzzle.clone().multiplyScalar(template.S).add(new THREE.Vector3(0, this.modelBaseY, 0));
      const eyeW = poll.clone().lerp(muzzle, 0.32);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), eyeMat);
        eye.position.set(eyeW.x + s * 0.115, eyeW.y + 0.02, eyeW.z);
        this.group.add(eye);
        skull.attach(eye);
      }
    }

    this.group.scale.setScalar(size);
    this.graze = 0;          // 0 head up .. 1 muzzle in the grass
    this.chew = 0;
    this.postPose();
  }

  // state: 'graze' | 'move' | 'struggle' | 'stomp'; intensity 0..1
  animate(dt, state, speed, intensity, time) {
    const moving = state === 'move' ? speed : 0;
    const pose = this.engine.update(dt, moving, 0, time);
    this.pose = pose;
    const P = this.engine.phase;

    if (state === 'struggle' || state === 'stomp') {
      const k = 0.4 + intensity * 0.9;
      // thrash cadence: the normal struggle rate, and for the bull it winds
      // up with his anger to at most double. Integrated as a phase so a
      // changing rate never jumps the motion.
      const f = state === 'stomp' ? 6 * (1 + Math.min(1, intensity)) : 6;
      this.thrash = (this.thrash || this.phase) + dt * f;
      const t = this.thrash;
      pose.pitch += Math.sin(t) * 0.09 * k;
      pose.roll = Math.sin(t * 0.8 + 1) * 0.1 * k;
      pose.bodyY += Math.abs(Math.sin(t)) * 0.07 * k;
      if (state === 'stomp') {
        // head down, horns tossing, off fore hoof pawing the ground
        pose.neck += 0.45 + Math.sin(t * 1.1) * 0.2 * k;
        pose.head = -0.35 + Math.sin(t * 1.3) * 0.35 * k;
        pose.headYaw = Math.sin(t * 0.7) * 0.45 * k;
        const paw = Math.sin(t);
        pose.legs[1] = { a: -0.35 + paw * 0.45, b: -0.5 * Math.max(0, Math.sin(t + 1.2)) * (0.6 + k), c: 0.8 * Math.max(0, Math.sin(t + 1.2)) * (0.6 + k), d: 0.15 };
        pose.legs[0] = { a: 0.15, b: -0.05, c: 0.05, d: -0.15 };
        pose.legs[2] = { a: 0.28, b: 0.12, c: -0.15, d: -0.12 };
        pose.legs[3] = { a: 0.28, b: 0.12, c: -0.15, d: -0.12 };
        for (let i = 0; i < 5; i++) { pose.tail[i].x = 0.7 + Math.sin(t * 1.5 + i) * 0.15; pose.tail[i].z = Math.sin(t * 1.2 + i * 0.8) * 0.3; }
      } else {
        // thrashing against the rope: head shaking, legs bracing and stamping
        pose.neck += Math.sin(t * 1.1) * 0.3 * k;
        pose.head = Math.sin(t * 1.4 + 0.5) * 0.25 * k;
        pose.headYaw = Math.sin(t * 0.9) * 0.5 * k;
        for (let i = 0; i < 4; i++) {
          const s = Math.sin(t + i * 1.7), lift = Math.max(0, Math.sin(t + i * 1.7 + 1)) * k;
          const front = i < 2;
          pose.legs[i] = { a: s * 0.45 * k, b: front ? -0.55 * lift : 0.35 * lift, c: front ? 0.75 * lift : -0.55 * lift, d: 0.1 * lift - 0.1 };
        }
        for (let i = 0; i < 5; i++) { pose.tail[i].x = 0.2 + Math.sin(t * 1.3 + i) * 0.2; pose.tail[i].z = Math.sin(t * 1.5 + i * 0.9) * 0.5; }
      }
      this.postPose();
      return;
    }

    // grazing: dip the neck and nose to the grass, chew, lift now and then
    const wantGraze = state === 'graze' ? (Math.sin(time * 0.45 + this.phase) + 1) / 2 > 0.3 ? 1 : 0 : 0;
    this.graze += (wantGraze - this.graze) * Math.min(1, dt * 1.6);
    const g = this.graze;
    if (g > 0.01) {
      pose.neck += g * 0.95;
      pose.head += g * 0.25;
      pose.chestFlex += g * 0.06;
      pose.headYaw += g * Math.sin(time * 0.7 + this.phase) * 0.15;
      // chewing: tiny nod at the poll while the head is down
      if (g > 0.85) pose.head += Math.sin(time * 9 + this.phase) * 0.03;
    }
    // cattle keep the head level and low on the move; a little side sway at speed
    pose.headYaw += Math.sin(P * Math.PI * 2) * 0.05 * pose.run;
    this.postPose();
  }

  postPose() {
    if (!this.pose) return;
    // the cattle rigs' ear bones carry stray weights (the bull's hump), so
    // the ears stay still; they're part of the skull here anyway
    this.pose.ears[0] = this.pose.ears[1] = 0;
    applyPose(this, this.pose, this.pose.bodyY, this.pose.roll);
  }

  colliders() { return bodyCapsules(this); }

  // where the rope cinches: the base of the neck
  neckWorldPos(out) {
    return this.bones.head.getWorldPosition(out);
  }

  // The neck as a ring the lasso can cinch onto: centre on the neck axis
  // between the throat (head bone) and the poll (skull bone), the ring's
  // normal along that axis, radius measured once from the template mesh's
  // half-width there (scaled by the model and this cow's size).
  neckRing(out) {
    const t = this.template;
    if (this._neckR === undefined) {
      const headT = t.scene.getObjectByName('head'), skullT = t.scene.getObjectByName('skull');
      if (!headT || !skullT) { this._neckR = null; }
      else {
        const a = headT.getWorldPosition(new THREE.Vector3()), b = skullT.getWorldPosition(new THREE.Vector3());
        const axis = b.clone().sub(a), L = axis.length(); axis.divideScalar(L);
        const m = t.mesh, v = new THREE.Vector3(), rel = new THREE.Vector3();
        // only the neck/head skin: vertices weighted mainly to the head or skull bones
        const names = m.skeleton.bones.map((bn) => bn.name);
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
        const widths = [];
        for (let i = 0; i < m.geometry.attributes.position.count; i++) {
          let wn = 0;
          for (let j = 0; j < 4; j++) { const nm = names[si.getComponent(i, j)]; if (nm === 'head' || nm === 'skull') wn += sw.getComponent(i, j); }
          if (wn < 0.6) continue;
          m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
          rel.copy(v).sub(a);
          const s = rel.dot(axis) / L;
          if (s < 0.28 || s > 0.48) continue; // mid-neck, clear of the poll and horns
          const w = Math.abs(v.x - a.x);
          if (w > 0.7 * t.max.x) continue;    // horns / ears reach the model's full width; the neck never does
          // lateral half-width: the neck's dewlap and a bull's hump extend
          // up and down along the centre line, the rope sits on the sides
          widths.push(w);
        }
        const rMax = widths.length ? Math.max(...widths) : 0.05;
        this._neckR = rMax * t.S;
        this._neckAt = 0.4;
      }
    }
    if (this._neckR === null) return null;
    const a = this.bones.head.getWorldPosition(_na), b = this.bones.skull.getWorldPosition(_nb);
    out.normal.copy(b).sub(a).normalize();
    out.center.copy(a).lerp(b, this._neckAt);
    out.radius = this._neckR * this.group.scale.x;
    return out;
  }
}
const _na = new THREE.Vector3(), _nb = new THREE.Vector3();

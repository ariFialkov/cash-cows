// Skinned cowboys: three rigged humanoid models (humanoid "smartrig"
// skeleton, T-pose) that ride the skinned horses in place of the procedural
// rider. Outfits are painted into vertex colours by region (hat, hair, face,
// hands, shirt, coat, pants, boots, belt, scarf) from a palette, so the
// player's pick and every rival get their own colours. The riding pose is
// composed from world-axis limb rotations on top of the bind pose and driven
// by the same rider parameters the procedural rider uses (torso lean,
// posting, lasso arm poses).

import * as THREE from 'three';
import { loadRigTemplate, instantiateRig, setBoneWorldRot } from './horseModel.js';
import { fbm2 } from '../core/rng.js';

export const COWBOYS = [
  { id: 'ranger',   model: 'cowboy1', name: 'Ranger',   height: 1.78, hasCoat: false, chaps: false },
  { id: 'drifter',  model: 'cowboy2', name: 'Drifter',  height: 1.80, hasCoat: true,  chaps: false },
  { id: 'wrangler', model: 'cowboy3', name: 'Wrangler', height: 1.74, hasCoat: false, chaps: true },
];

export const PALETTE = {
  skin:  [0xf1c9a5, 0xe0ac86, 0xc68e64, 0x9c6a45, 0x6e4a32, 0x4a3224],
  hair:  [0x2a1a10, 0x5a3a1e, 0x9a6a3a, 0xd8b26a, 0x8a8a8a, 0x1a1616],
  shirt: [0xb03a2e, 0x2e6fb0, 0x3d7a3a, 0x2f2f33, 0xd9c48f, 0x7a4a8a, 0xe08a2a, 0xf0eee6],
  pants: [0x33415c, 0x22304a, 0x5a4634, 0x2b2b2b, 0x8a7a5a],
  hat:   [0x6b4c2a, 0x2b2622, 0xc9b58c, 0x8a6f4d, 0x3a2f2a],
  boots: [0x3c2713, 0x1f1a17, 0x6b4a2a],
  scarf: [0xb03a2e, 0x2e6fb0, 0xf0d060, 0xf4f0e6, 0x3d7a3a],
  coat:  [0x5a4634, 0x3a2f2a, 0x8a7a5a, 0x2b2b2b],
};

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export function randomOutfit() {
  return {
    skin: pick(PALETTE.skin), hair: pick(PALETTE.hair), shirt: pick(PALETTE.shirt), pants: pick(PALETTE.pants),
    hat: pick(PALETTE.hat), boots: pick(PALETTE.boots), scarf: pick(PALETTE.scarf), coat: pick(PALETTE.coat),
  };
}
// the player's outfit: a fixed look per model, with the shirt from the menu swatch
export function playerOutfit(cowboyIdx, shirtHex) {
  const base = [
    { skin: 0xe0ac86, hair: 0x5a3a1e, pants: 0x33415c, hat: 0x6b4c2a, boots: 0x3c2713, scarf: 0xf0d060, coat: 0x5a4634 },
    { skin: 0xc68e64, hair: 0x2a1a10, pants: 0x2b2b2b, hat: 0x2b2622, boots: 0x1f1a17, scarf: 0xb03a2e, coat: 0x3a2f2a },
    { skin: 0xf1c9a5, hair: 0xd8b26a, pants: 0x5a4634, hat: 0xc9b58c, boots: 0x6b4a2a, scarf: 0x2e6fb0, coat: 0x8a7a5a },
  ][cowboyIdx % 3];
  return { ...base, shirt: shirtHex };
}

export function loadCowboy(idx) {
  const c = COWBOYS[idx % COWBOYS.length];
  return loadRigTemplate(c.model, c.height, { humanoid: true }).then((t) => { t.cowboy = c; return t; });
}

// ---------------------------------------------------------------------------
// Outfit painting

const _c = new THREE.Color();
const GROUP_RULES = [
  [/HandThumb|HandIndex|HandMiddle|HandRing|HandPinky|Hand$/, 'hand'],
  [/ForeArm$/, 'forearm'], [/Arm$/, 'arm'], [/Shoulder$/, 'shoulder'],
  [/HeadTop_End|headfront|Head$/, 'head'], [/Neck$/, 'neck'],
  [/Spine2$/, 'chest'], [/Spine1$/, 'spine'], [/Spine$/, 'waist'], [/Hips$/, 'hips'],
  [/UpLeg$/, 'thigh'], [/Leg$/, 'shin'], [/Foot$|ToeBase$|Toe_End$/, 'foot'],
];
function groupName(n) { for (const [re, g] of GROUP_RULES) if (re.test(n)) return g; return 'body'; }
const DEBUG_COLORS = { hand: 0xff0000, forearm: 0xff8800, arm: 0xffff00, shoulder: 0x88ff00, head: 0x00ff00, neck: 0x00ffaa, chest: 0x00ffff, spine: 0x0088ff, waist: 0x0000ff, hips: 0x8800ff, thigh: 0xff00ff, shin: 0xff0088, foot: 0x884400, body: 0x888888 };

export function paintOutfit(mesh, outfit, cowboy, template, debug = false) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const bones = mesh.skeleton.bones;
  const names = bones.map((b) => b.name);
  const groupOf = names.map(groupName);
  // Work in the template scene's world frame (upright, source units) — the
  // same frame the loader measures in: the geometry is stored rotated and
  // quantized, so each vertex goes through the template mesh's skinning at
  // bind and its world matrix. Bone positions come from the template scene.
  const tm = template.mesh;
  const v = new THREE.Vector3();
  const worldOf = (i) => tm.getVertexPosition(i, v).applyMatrix4(tm.matrixWorld);
  const bb = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) bb.expandByPoint(worldOf(i));
  const H = bb.max.y - bb.min.y;
  const bindPos = (re) => {
    const n = names.find((x) => re.test(x));
    const b = n && template.scene.getObjectByName(n);
    return b ? b.getWorldPosition(new THREE.Vector3()) : null;
  };
  const head = bindPos(/Head$/) || new THREE.Vector3(0, bb.min.y + H * 0.87, 0);
  const hips = bindPos(/Hips$/) || new THREE.Vector3(0, bb.min.y + H * 0.55, 0);
  const knee = bindPos(/LeftLeg$/) || new THREE.Vector3(0, bb.min.y + H * 0.29, 0);
  paintOutfit.lastInfo = { head: head.toArray(), hips: hips.toArray(), knee: knee.toArray(), bb: [bb.min.toArray(), bb.max.toArray()] };

  const col = (hex) => new THREE.Color(hex);
  const C = { skin: col(outfit.skin), hair: col(outfit.hair), shirt: col(outfit.shirt), pants: col(outfit.pants), hat: col(outfit.hat), boots: col(outfit.boots), scarf: col(outfit.scarf), coat: col(outfit.coat), belt: col(0x3a2414), buckle: col(0xc8a94a), hatband: col(0x2a1d14) };
  const colors = new Float32Array(pos.count * 3);
  const w = {};
  for (let i = 0; i < pos.count; i++) {
    worldOf(i);
    const x = v.x, y = v.y, z = v.z;
    for (const k in w) w[k] = 0;
    let dom = 'body', dw = 0;
    for (let j = 0; j < 4; j++) {
      const g = groupOf[si.getComponent(i, j)], wt = sw.getComponent(i, j);
      w[g] = (w[g] || 0) + wt;
      if (w[g] > dw) { dw = w[g]; dom = g; }
    }
    if (debug) { _c.setHex(DEBUG_COLORS[dom]); colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b; continue; }

    const hair = fbm2(x * 0.3, y * 0.3, 5, 2); // fine cloth/skin variation (x, y in cm)
    const rHead = Math.hypot(x - head.x, z - head.z);     // radial distance from the head axis
    const brimY = head.y + H * 0.06;                        // hat brim sits just above the eyes
    // --- default by group ---
    if (dom === 'head') {
      const isHat = y > brimY || (rHead > H * 0.075 && y > head.y + H * 0.02);
      const isFace = z > head.z + H * 0.01 && y > head.y - H * 0.02;
      _c.copy(isHat ? C.hat : isFace ? C.skin : C.hair);
      if (isHat && y > brimY && y < brimY + H * 0.025 && rHead < H * 0.07) _c.copy(C.hatband);
    } else if (dom === 'neck') {
      _c.copy(rHead > H * 0.055 || y < head.y - H * 0.045 ? C.scarf : C.skin);
    } else if (dom === 'hand') {
      _c.copy(C.skin);
    } else if (dom === 'forearm' || dom === 'arm' || dom === 'shoulder' || dom === 'chest' || dom === 'spine') {
      _c.copy(cowboy.hasCoat ? C.coat : C.shirt);
      // the duster hangs open: shirt shows down the front
      if (cowboy.hasCoat && (dom === 'chest' || dom === 'spine') && Math.abs(x) < H * 0.03 && z > head.z) _c.copy(C.shirt);
    } else if (dom === 'waist' || dom === 'hips') {
      const beltY = hips.y + H * 0.02;
      if (Math.abs(y - beltY) < H * 0.02) _c.copy(Math.abs(x) < H * 0.02 && z > 0 ? C.buckle : C.belt);
      else if (y > beltY) _c.copy(cowboy.hasCoat ? C.coat : C.shirt);
      else _c.copy(cowboy.hasCoat && Math.hypot(x, z) > H * 0.14 ? C.coat : C.pants);
    } else if (dom === 'thigh') {
      // the duster's skirt hangs outside the legs
      _c.copy(cowboy.hasCoat && (Math.abs(x) < H * 0.03 || Math.abs(x) > H * 0.11 || z < -H * 0.04) ? C.coat : C.pants);
    } else if (dom === 'shin') {
      // boot shafts reach most of the way up the shin
      _c.copy(y < knee.y - (knee.y - bb.min.y) * 0.18 ? C.boots : C.pants);
    } else if (dom === 'foot') {
      _c.copy(C.boots);
    } else {
      _c.copy(C.shirt);
    }
    _c.offsetHSL(0, 0, (hair - 0.5) * 0.06);
    colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------------------
// The rider

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
// world-frame rotation from sequential axis turns: first a, then b, then c
function seq(ax1, a1, ax2 = null, a2 = 0, ax3 = null, a3 = 0) {
  _qa.setFromAxisAngle(ax1, a1);
  if (ax2) { _qb.setFromAxisAngle(ax2, a2); _qa.premultiply(_qb); }
  if (ax3) { _qc.setFromAxisAngle(ax3, a3); _qa.premultiply(_qc); }
  return _qa;
}

export class SkinnedCowboy {
  constructor(template, outfit) {
    this.template = template;
    this.cowboy = template.cowboy;
    const inst = instantiateRig(template);
    this.model = inst.model;
    this.bones = inst.bones;
    this.mesh = inst.mesh;
    this.group = new THREE.Group();
    this.group.add(this.model);
    this.outfit = { ...outfit };
    this.repaint();
    this.mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

    // seat the hips at the group origin
    const hips = this.bones.smartrigHips;
    const p = new THREE.Vector3();
    this.model.updateMatrixWorld(true);
    hips.getWorldPosition(p);
    this.model.position.set(-p.x, -p.y + 0.02, -p.z);
    this._state = { armPose: 'rest', time: 0, run: 0, P: 0, gallopW: 0, trotW: 0 };
    this.pose(0, 0, 0);
  }

  repaint() { paintOutfit(this.mesh, this.outfit, this.cowboy, this.template); }
  setShirt(hex) { this.outfit.shirt = hex; this.repaint(); }

  // lean: torso pitch (rad, + forward); roll: torso roll; lift: posting rise (m)
  pose(lean, roll, lift) {
    const { armPose, time, run, P } = this._state;
    const g = this.group;
    g.position.y = lift;
    const set = (name, q) => setBoneWorldRot(this, 'smartrig' + name, q);

    // spine: lean forward from the waist, head counters, slight roll
    set('Spine', seq(X, lean * 0.35, Z, roll * 0.5));
    set('Spine1', seq(X, lean * 0.4, Z, roll * 0.5));
    set('Spine2', seq(X, lean * 0.25));
    set('Neck', seq(X, -lean * 0.45));
    set('Head', seq(X, -lean * 0.35 + run * 0.1));

    // legs astride: thighs forward and out, knees bent, heels down
    for (const [side, s] of [['Left', 1], ['Right', -1]]) {
      set(side + 'UpLeg', seq(X, -1.25, Z, s * 0.42));
      set(side + 'Leg', seq(X, 1.35));
      set(side + 'Foot', seq(X, 0.15));
      set(side + 'ToeBase', seq(X, 0));
    }

    // left arm: reins
    set('LeftArm', seq(Z, -1.25, X, -0.55));
    set('LeftForeArm', seq(X, -1.15, Y, 0.3));
    set('LeftHand', seq(X, -0.2));
    // right arm: lasso poses (mirrors the procedural rider's)
    if (armPose === 'spin') {
      const t = time * 9;
      set('RightArm', seq(Z, -1.55 + Math.cos(t) * 0.1, X, Math.sin(t) * 0.12));
      set('RightForeArm', seq(X, -0.35 + Math.sin(t) * 0.15, Y, Math.cos(t) * 0.15));
      set('RightHand', seq(X, -0.3));
    } else if (armPose === 'throw') {
      set('RightArm', seq(Z, -0.7, X, -1.0));
      set('RightForeArm', seq(X, -0.2));
      set('RightHand', seq(X, -0.2));
    } else if (armPose === 'pull') {
      set('RightArm', seq(Z, 1.0, X, -0.95 + Math.sin(time * 6) * 0.08));
      set('RightForeArm', seq(X, -1.2 + Math.sin(time * 6 + 1) * 0.1));
      set('RightHand', seq(X, -0.3));
    } else {
      set('RightArm', seq(Z, 1.2, X, -0.5 + Math.sin(P) * 0.05 * run));
      set('RightForeArm', seq(X, -1.05));
      set('RightHand', seq(X, -0.2));
    }
    // fingers curled into a loose grip
    for (const [side, s] of [['Left', -1], ['Right', 1]]) {
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k <= 3; k++) set(`${side}Hand${f}${k}`, seq(Z, s * 0.55));
      for (let k = 1; k <= 3; k++) set(`${side}HandThumb${k}`, seq(Y, s * -0.3));
    }
  }

  animate(armPose, time, g) { Object.assign(this._state, { armPose, time }, g); }

  handWorldPos(out) {
    return this.bones.smartrigRightHand.getWorldPosition(out);
  }
}

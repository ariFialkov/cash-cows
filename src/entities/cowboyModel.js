// Skinned cowboys: three rigged humanoid models (humanoid "smartrig"
// skeleton, T-pose) that ride the skinned horses in place of the procedural
// rider. Each wears its own painted texture set (albedo, normal, roughness),
// and on top of the texture every garment (hat, shirt, bandana, pants,
// boots, coat) can be recoloured: the mesh is classified into regions by
// bone weights refined with the texture's own colours, and the shader
// re-tints a region by luminance so the seams, folds and stitching stay.
// The riding pose is composed from world-axis limb rotations on top of the
// bind pose and driven by the same rider parameters the procedural rider
// uses (torso lean, posting, lasso arm poses).

import * as THREE from 'three';
import { loadRigTemplate, instantiateRig, setBoneWorldRot } from './horseModel.js';

export const COWBOYS = [
  { id: 'ranger',   model: 'cowboy1', name: 'Ranger',   height: 1.78, hasCoat: false, chaps: false },
  { id: 'drifter',  model: 'cowboy2', name: 'Drifter',  height: 1.80, hasCoat: true,  chaps: false },
  { id: 'wrangler', model: 'cowboy3', name: 'Wrangler', height: 1.74, hasCoat: false, chaps: true },
];

// garments a rider can recolour (null keeps the texture's own colour)
export const GARMENTS = [
  { key: 'hat',   name: 'Hat' },
  { key: 'shirt', name: 'Shirt' },
  { key: 'scarf', name: 'Bandana' },
  { key: 'pants', name: 'Pants' },
  { key: 'boots', name: 'Boots' },
  { key: 'coat',  name: 'Coat', needsCoat: true },
];

export const PALETTE = {
  shirt: [0xb03a2e, 0x2e6fb0, 0x3d7a3a, 0x2f2f33, 0xd9c48f, 0x7a4a8a, 0xe08a2a, 0xf0eee6],
  pants: [0x33415c, 0x22304a, 0x5a4634, 0x2b2b2b, 0x8a7a5a, 0x6d3f2a],
  hat:   [0x6b4c2a, 0x2b2622, 0xc9b58c, 0x8a6f4d, 0x3a2f2a, 0x8b2f2a],
  boots: [0x3c2713, 0x1f1a17, 0x6b4a2a, 0x8a5a3a],
  scarf: [0xb03a2e, 0x2e6fb0, 0xf0d060, 0xf4f0e6, 0x3d7a3a, 0x7a4a8a],
  coat:  [0x5a4634, 0x3a2f2a, 0x8a7a5a, 0x2b2b2b, 0x6d3f2a],
};

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
// rivals: each garment keeps its painted look half the time, otherwise a palette colour
export function randomOutfit() {
  const o = {};
  for (const g of GARMENTS) o[g.key] = Math.random() < 0.5 ? null : pick(PALETTE[g.key]);
  return o;
}
// the player's outfit from the saved picks (index per garment, -1 = as painted)
export function playerOutfit(cowboyIdx, custom = {}) {
  const o = {};
  for (const g of GARMENTS) {
    const i = custom[g.key];
    o[g.key] = typeof i === 'number' && i >= 0 ? PALETTE[g.key][i % PALETTE[g.key].length] : null;
  }
  return o;
}

// ---------------------------------------------------------------------------
// Textures: the albedo doubles as a colour sampler for region classification

const texCache = new Map();
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('texture failed: ' + url));
    img.src = url;
  });
}
function loadCowboyTextures(model) {
  if (texCache.has(model)) return texCache.get(model);
  const base = `${import.meta.env.BASE_URL}models/tex/${model}`;
  const p = (async () => {
    const [albedo, normal, rough] = await Promise.all([loadImage(`${base}_albedo.webp`), loadImage(`${base}_normal.webp`), loadImage(`${base}_rough.webp`)]);
    const mk = (img, srgb) => {
      const t = new THREE.Texture(img);
      // the rigs were exported from FBX without textures, so their UVs keep
      // the FBX convention (v from the bottom): three's default orientation
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    // a small copy of the albedo to read colours from on the CPU
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(albedo, 0, 0, S, S);
    const px = ctx.getImageData(0, 0, S, S).data;
    const sample = (u, v) => {
      const x = Math.min(S - 1, Math.max(0, Math.floor(u * S))), y = Math.min(S - 1, Math.max(0, Math.floor((1 - v) * S)));
      const k = (y * S + x) * 4;
      return [px[k] / 255, px[k + 1] / 255, px[k + 2] / 255];
    };
    return { map: mk(albedo, true), normalMap: mk(normal, false), roughnessMap: mk(rough, false), sample };
  })();
  texCache.set(model, p);
  p.catch(() => texCache.delete(model));
  return p;
}

export function loadCowboy(idx) {
  const c = COWBOYS[idx % COWBOYS.length];
  return Promise.all([loadRigTemplate(c.model, c.height, { humanoid: true }), loadCowboyTextures(c.model).catch(() => null)])
    .then(([t, tex]) => { t.cowboy = c; t.tex = tex; return t; });
}

// ---------------------------------------------------------------------------
// Outfit painting: per-vertex tint (colour attribute) + [mix, region mean luminance]

const _c = new THREE.Color();
const GROUP_RULES = [
  [/HandThumb|HandIndex|HandMiddle|HandRing|HandPinky|Hand$/, 'hand'],
  [/ForeArm$/, 'forearm'], [/Arm$/, 'arm'], [/Shoulder$/, 'shoulder'],
  [/HeadTop_End|headfront|Head$/, 'head'], [/Neck$/, 'neck'],
  [/Spine2$/, 'chest'], [/Spine1$/, 'spine'], [/Spine$/, 'waist'], [/Hips$/, 'hips'],
  [/UpLeg$/, 'thigh'], [/Leg$/, 'shin'], [/Foot$|ToeBase$|Toe_End$/, 'foot'],
];
function groupName(n) { for (const [re, g] of GROUP_RULES) if (re.test(n)) return g; return 'body'; }
const DEBUG_COLORS = { skin: 0xf1c9a5, hair: 0x5a3a1e, hat: 0xffff00, hatband: 0x888800, scarf: 0x00ffff, shirt: 0xff0000, coat: 0x8800ff, pants: 0x0000ff, boots: 0x884400, belt: 0x00ff00, buckle: 0x00ff88 };
// which regions a bone group may hold: the texture's colours settle the rest
const CANDIDATES = {
  head: ['hat', 'skin', 'hair'], neck: ['scarf', 'skin', 'shirt'], hand: ['skin'],
  forearm: ['shirt', 'coat', 'skin'], arm: ['shirt', 'coat'], shoulder: ['shirt', 'coat'], chest: ['shirt', 'coat', 'scarf'], spine: ['shirt', 'coat'],
  waist: ['shirt', 'coat', 'pants', 'belt'], hips: ['pants', 'coat', 'belt', 'shirt'], thigh: ['pants', 'coat', 'boots'], shin: ['pants', 'boots', 'coat'], foot: ['boots'], body: ['shirt'],
};
const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (rgb) => 0.2126 * srgb2lin(rgb[0]) + 0.7152 * srgb2lin(rgb[1]) + 0.0722 * srgb2lin(rgb[2]);

// classify every vertex into an outfit region; cached per template
function classify(mesh, cowboy, template) {
  if (template.regions) return template.regions;
  const geo = mesh.geometry;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const groupOf = names.map(groupName);
  // the template scene's world frame (upright, source units)
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

  const n = pos.count;
  const group = new Array(n), guess = new Array(n), region = new Array(n);
  const w = {};
  for (let i = 0; i < n; i++) {
    worldOf(i);
    const x = v.x, y = v.y, z = v.z;
    for (const k in w) w[k] = 0;
    let dom = 'body', dw = 0;
    for (let j = 0; j < 4; j++) {
      const g = groupOf[si.getComponent(i, j)], wt = sw.getComponent(i, j);
      w[g] = (w[g] || 0) + wt;
      if (w[g] > dw) { dw = w[g]; dom = g; }
    }
    group[i] = dom;
    // --- geometric first guess ---
    const rHead = Math.hypot(x - head.x, z - head.z);
    const brimY = head.y + H * 0.06;
    let r;
    if (dom === 'head') {
      const isHat = y > brimY || (rHead > H * 0.075 && y > head.y + H * 0.02);
      const isFace = z > head.z + H * 0.01 && y > head.y - H * 0.02;
      r = isHat ? 'hat' : isFace ? 'skin' : 'hair';
      if (isHat && y > brimY && y < brimY + H * 0.025 && rHead < H * 0.07) r = 'hatband';
    } else if (dom === 'neck') r = rHead > H * 0.055 || y < head.y - H * 0.045 ? 'scarf' : 'skin';
    else if (dom === 'hand') r = 'skin';
    else if (dom === 'forearm' || dom === 'arm' || dom === 'shoulder' || dom === 'chest' || dom === 'spine') {
      r = cowboy.hasCoat ? 'coat' : 'shirt';
      if (cowboy.hasCoat && (dom === 'chest' || dom === 'spine') && Math.abs(x) < H * 0.03 && z > head.z) r = 'shirt';
    } else if (dom === 'waist' || dom === 'hips') {
      const beltY = hips.y + H * 0.02;
      if (Math.abs(y - beltY) < H * 0.02) r = Math.abs(x) < H * 0.02 && z > 0 ? 'buckle' : 'belt';
      else if (y > beltY) r = cowboy.hasCoat ? 'coat' : 'shirt';
      else r = cowboy.hasCoat && Math.hypot(x, z) > H * 0.14 ? 'coat' : 'pants';
    } else if (dom === 'thigh') r = cowboy.hasCoat && (Math.abs(x) < H * 0.03 || Math.abs(x) > H * 0.11 || z < -H * 0.04) ? 'coat' : 'pants';
    else if (dom === 'shin') r = y < knee.y - (knee.y - bb.min.y) * 0.18 ? 'boots' : 'pants';
    else if (dom === 'foot') r = 'boots';
    else r = 'shirt';
    guess[i] = r;
  }

  // --- refine with the texture: each guessed region's typical colour, then
  // every vertex takes the nearest candidate colour for its bone group ---
  const tex = template.tex;
  const meanL = {};
  if (tex && uv) {
    const cols = new Array(n);
    const acc = {};
    for (let i = 0; i < n; i++) {
      const c = tex.sample(uv.getX(i), uv.getY(i));
      cols[i] = c;
      const a = acc[guess[i]] || (acc[guess[i]] = { r: [], g: [], b: [] });
      a.r.push(c[0]); a.g.push(c[1]); a.b.push(c[2]);
    }
    const med = (arr) => { const s = arr.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
    const rep = {};
    for (const k in acc) if (acc[k].r.length > 12) rep[k] = [med(acc[k].r), med(acc[k].g), med(acc[k].b)];
    // the bandana: whatever sits in a collar of vertices round the neck axis
    // between the collarbones and the chin that isn't skin (or beard)
    const fixed = new Array(n).fill(null);
    if (rep.skin) {
      const neckB = bindPos(/Neck$/) || new THREE.Vector3(0, head.y - H * 0.07, 0);
      const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      const picked = [];
      for (let i = 0; i < n; i++) {
        const g = group[i];
        if (g !== 'neck' && g !== 'chest' && g !== 'shoulder' && g !== 'spine' && g !== 'head') continue;
        worldOf(i);
        const rN = Math.hypot(v.x - head.x, v.z - head.z);
        if (v.y < neckB.y - H * 0.05 || v.y > head.y - H * 0.015 || rN > H * 0.1) continue;
        const c = cols[i];
        const skinD = d2(c, rep.skin), hairD = rep.hair ? d2(c, rep.hair) : 1;
        if (skinD < 0.012 || hairD < 0.008) continue;
        picked.push(i);
      }
      if (picked.length > 25) {
        for (const i of picked) fixed[i] = 'scarf';
        const rr = [], gg = [], bb2 = [];
        for (const i of picked) { rr.push(cols[i][0]); gg.push(cols[i][1]); bb2.push(cols[i][2]); }
        rep.scarf = [med(rr), med(gg), med(bb2)];
      } else delete rep.scarf;
    }
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { region[i] = fixed[i]; continue; }
      const cands = (CANDIDATES[group[i]] || ['shirt']).filter((k) => rep[k] && k !== 'scarf');
      if (guess[i] === 'belt' || guess[i] === 'buckle' || guess[i] === 'hatband' || cands.length < 2) { region[i] = guess[i] === 'scarf' ? 'shirt' : guess[i]; continue; }
      const c = cols[i];
      let best = guess[i], bd = Infinity;
      for (const k of cands) {
        const d = (c[0] - rep[k][0]) ** 2 + (c[1] - rep[k][1]) ** 2 + (c[2] - rep[k][2]) ** 2;
        // a small bias toward the geometric guess keeps stray texels in place
        const dd = k === guess[i] ? d * 0.6 : d;
        if (dd < bd) { bd = dd; best = k; }
      }
      region[i] = best;
    }
    const sums = {};
    for (let i = 0; i < n; i++) { const s = sums[region[i]] || (sums[region[i]] = [0, 0]); s[0] += lum(cols[i]); s[1]++; }
    for (const k in sums) meanL[k] = Math.max(0.02, sums[k][0] / sums[k][1]);
  } else {
    for (let i = 0; i < n; i++) region[i] = guess[i];
  }
  template.regions = { region, meanL };
  return template.regions;
}

// write the tint attributes for an outfit (null garments keep the texture)
export function paintOutfit(mesh, outfit, cowboy, template, debug = false) {
  const geo = mesh.geometry;
  const n = geo.attributes.position.count;
  const { region, meanL } = classify(mesh, cowboy, template);
  const colors = new Float32Array(n * 3);
  const info = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = region[i];
    const hex = debug ? DEBUG_COLORS[r] : outfit[r];
    if (hex === null || hex === undefined) { colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 1; info[i * 2] = 0; }
    else { _c.setHex(hex); colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b; info[i * 2] = 1; }
    info[i * 2 + 1] = meanL[r] || 0.25;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(info, 2));
  paintOutfit.lastInfo = { regions: Object.keys(meanL) };
}

// the textured rider material: albedo/normal/roughness, plus luminance
// re-tinting of the garments picked in the outfit (or flat colours when the
// textures are missing)
export function cowboyMaterial(template) {
  const tex = template.tex;
  const mat = new THREE.MeshStandardMaterial({
    map: tex ? tex.map : null,
    normalMap: tex ? tex.normalMap : null,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: tex ? tex.roughnessMap : null,
    roughness: 1, metalness: 0,
    vertexColors: !tex,
  });
  if (!tex) return mat;
  mat.customProgramCacheKey = () => 'cowboy-tinted';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute vec3 color; attribute vec2 aTint; varying vec3 vTintC; varying vec2 vTintI;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTintC = color; vTintI = aTint;');
    shader.fragmentShader = 'varying vec3 vTintC; varying vec2 vTintI;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        // re-tint by luminance: the garment's shading, seams and folds stay
        float tl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 tinted = vTintC * clamp(tl / max(vTintI.y, 0.02), 0.0, 1.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, tinted, vTintI.x);
      `);
  };
  return mat;
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

// Rider dynamics: the cowboy is not glued to the saddle. A few spring-damper
// states (seat compression, torso pitch, torso roll) integrate the saddle's
// vertical / fore-aft / lateral accelerations each frame, so landings press
// him into the seat, acceleration rocks him back, braking and the horse's
// pitch tip him forward, and turns lean him in. Lean is spread up the spine
// with the head counter-rotating to keep the gaze level, the pelvis and
// shoulder girdle counter-yaw with the stride, and the legs absorb the bob.
// Arm work (rest / spin / throw / pull) is layered on top with per-bone
// slerp smoothing so pose changes never pop.
const smooth01 = (t) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _d = new THREE.Vector3(), _axis = new THREE.Vector3(), _qt = new THREE.Quaternion(), _qw = new THREE.Quaternion();

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
    this.mesh.material = cowboyMaterial(template);
    this.repaint();

    // seat the hips at the group origin
    const hips = this.bones.smartrigHips;
    const p = new THREE.Vector3();
    this.model.updateMatrixWorld(true);
    hips.getWorldPosition(p);
    this.seatOffset = new THREE.Vector3(-p.x, -p.y + 0.02, -p.z);
    this.hipsHeight = p.y; // hips above the soles when standing
    this.model.position.copy(this.seatOffset);
    this._state = { armPose: 'rest', time: 0, run: 0, P: 0, gallopW: 0, trotW: 0 };
    this.dyn = {
      seat: 0, seatV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
      lastY: null, vy: 0, ay: 0, lastSpeed: null, ax: 0,
      arm: 'rest', armT: 0, tugPhase: Math.random() * 6, headYaw: 0, headPitch: 0,
      seed: Math.random() * 100,
      // lower legs: loose masses hanging off the knees (swing fore-aft, flap in/out)
      legs: [{ sw: 0, swV: 0, lat: 0, latV: 0 }, { sw: 0, swV: 0, lat: 0, latV: 0 }],
    };
    this.q = new Map(); // per-bone current world-frame rotation (smoothed)
    this.pose({ lean: 0.08, roll: 0, lift: 0, horse: null, speed: 0, turn: 0, dt: 1 / 60, lassoAngle: null, heading: 0, look: null });
  }

  repaint() { paintOutfit(this.mesh, this.outfit, this.cowboy, this.template); }
  setOutfit(outfit) { Object.assign(this.outfit, outfit); this.repaint(); }
  // show the outfit regions as flat colours (tooling)
  debugRegions() {
    paintOutfit(this.mesh, this.outfit, this.cowboy, this.template, true);
    this.mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  }
  setShirt(hex) { this.setOutfit({ shirt: hex }); }

  animate(armPose, time, g) { Object.assign(this._state, { armPose, time }, g); }

  // args: lean/roll (the built-in rider's torso pitch + roll), lift (posting
  // rise, m), horse (gait pose or null), speed, turn (rad/s lean input),
  // dt, lassoAngle (world spin angle of the loop), heading (rig yaw),
  // look (direction to look, rider-local, or null)
  pose(args) {
    const { armPose, time, run, P, gallopW, trotW } = this._state;
    const D = this.dyn;
    const horse = args.horse;
    const dt = THREE.MathUtils.clamp(args.dt || 1 / 60, 1e-3, 0.05);
    const walkW = horse ? Math.max(0, 1 - trotW - gallopW - (horse.run < 0.05 ? 1 : 0)) : 0;
    const n = (k) => Math.sin(time * 0.37 * k + D.seed * k) * 0.5 + Math.sin(time * 0.91 * k + D.seed) * 0.5; // slow wobble

    // ---- saddle forces ----
    const bodyY = horse ? horse.bodyY : 0;
    if (D.lastY === null) D.lastY = bodyY;
    const vy = (bodyY - D.lastY) / dt;
    const ayRaw = (vy - D.vy) / dt;
    D.ay += (THREE.MathUtils.clamp(ayRaw, -60, 60) - D.ay) * Math.min(1, dt * 25);
    D.vy = vy; D.lastY = bodyY;
    if (D.lastSpeed === null) D.lastSpeed = args.speed;
    D.ax += (THREE.MathUtils.clamp((args.speed - D.lastSpeed) / dt, -25, 25) - D.ax) * Math.min(1, dt * 8);
    D.lastSpeed = args.speed;

    // ---- spring states (2 substeps for stability) ----
    const h = dt / 2;
    const horsePitch = horse ? horse.pitch : 0;
    const horseRoll = horse ? horse.roll : 0;
    const armT = D.armT;
    let pitchT = args.lean + horsePitch * 0.45 - D.ax * 0.045;
    let rollT = horseRoll * 0.35 - args.turn * 0.09;
    let seatT = 0;
    // arm-work body language feeds the targets below
    if (armPose === 'throw') pitchT += 0.28 * smooth01(armT / 0.12) * (1 - 0.6 * smooth01((armT - 0.25) / 0.45));
    if (armPose === 'pull') pitchT -= 0.22;
    if (armPose === 'spin') pitchT -= 0.05;
    for (let i = 0; i < 2; i++) {
      // seat: rider inertia lags the saddle's vertical acceleration
      const seatA = -520 * (D.seat - seatT) - 28 * D.seatV - D.ay * 0.9;
      D.seatV += seatA * h; D.seat += D.seatV * h;
      const pitchA = -150 * (D.pitch - pitchT) - 21 * D.pitchV;
      D.pitchV += pitchA * h; D.pitch += D.pitchV * h;
      const rollA = -110 * (D.roll - rollT) - 17 * D.rollV;
      D.rollV += rollA * h; D.roll += D.rollV * h;
    }
    D.seat = THREE.MathUtils.clamp(D.seat, -0.05, 0.04);
    const pitch = D.pitch, roll = D.roll;

    // ---- arm pose timing ----
    if (armPose !== D.arm) { D.arm = armPose; D.armT = 0; } else D.armT += dt;
    const T = D.armT;
    // pull: rhythmic tugs against the rope (a little irregular)
    D.tugPhase += dt * (2 * Math.PI) * (1.5 + n(1) * 0.25);
    const tug = armPose === 'pull' ? Math.pow(Math.max(0, Math.sin(D.tugPhase)), 2) * smooth01(T / 0.4) : 0;

    // ---- look direction: torso helps the head; lag on the head ----
    let lookYaw = 0, lookPitch = 0;
    if (args.look) {
      lookYaw = Math.atan2(args.look.x, args.look.z);
      lookPitch = -Math.atan2(args.look.y, Math.hypot(args.look.x, args.look.z));
    } else {
      lookYaw = THREE.MathUtils.clamp(args.turn * 0.35, -0.5, 0.5) + n(0.3) * 0.12 * (1 - run);
      lookPitch = n(0.5) * 0.05;
    }
    if (armPose === 'spin') { lookPitch -= 0.18; lookYaw += Math.cos((args.lassoAngle ?? time * 7.5) + args.heading) * 0.06; }
    lookYaw = THREE.MathUtils.clamp(lookYaw, -1.6, 1.6);
    const torsoYaw = THREE.MathUtils.clamp(lookYaw * 0.35, -0.45, 0.45);
    D.headYaw += (THREE.MathUtils.clamp(lookYaw - torsoYaw, -0.9, 0.9) - D.headYaw) * Math.min(1, dt * 7);
    D.headPitch += (lookPitch - D.headPitch) * Math.min(1, dt * 7);

    // ---- gait rhythm in the trunk ----
    const gaitW = walkW * 0.7 + trotW + gallopW * 0.6;
    const pelvisYaw = Math.sin(P) * 0.045 * gaitW;
    const pelvisRoll = -Math.sin(P) * 0.03 * walkW;
    const breathe = Math.sin(time * 1.3 + D.seed) * 0.012 * (1 - run * 0.5);

    // seat: posting lift + spring compression
    this.group.position.y = args.lift + D.seat * 0.6;
    this.model.position.copy(this.seatOffset);

    const set = (name, q, rate = 14) => {
      let cur = this.q.get(name);
      if (!cur) { cur = q.clone(); this.q.set(name, cur); }
      else cur.slerp(q, 1 - Math.exp(-rate * dt));
      setBoneWorldRot(this, 'smartrig' + name, cur);
    };

    // ---- spine chain: pelvis tilt, lumbar, thoracic; head stabilised ----
    let spinYaw = 0, spinRoll = 0;
    if (armPose === 'spin') {
      const phi = (args.lassoAngle ?? time * 7.5) + args.heading;
      spinYaw = -Math.sin(phi) * 0.07;
      spinRoll = Math.cos(phi) * 0.035;
    }
    let throwYaw = 0;
    if (armPose === 'throw') throwYaw = -0.22 * smooth01(T / 0.14) * (1 - 0.75 * smooth01((T - 0.3) / 0.5));
    const pullYaw = armPose === 'pull' ? 0.12 : 0;
    set('Hips', seq(X, -D.seat * 1.5, Y, pelvisYaw, Z, pelvisRoll), 30);
    set('Spine', seq(X, pitch * 0.32, Y, -pelvisYaw * 0.5 + torsoYaw * 0.3, Z, roll * 0.45 + spinRoll), 30);
    set('Spine1', seq(X, pitch * 0.38 + breathe, Y, -pelvisYaw * 0.6 + torsoYaw * 0.4 + spinYaw + throwYaw + pullYaw, Z, roll * 0.4), 30);
    set('Spine2', seq(X, pitch * 0.22 + breathe * 0.6, Y, torsoYaw * 0.3 + spinYaw * 0.6 + throwYaw * 0.6, Z, roll * 0.15 + spinRoll * 0.5), 30);
    set('Neck', seq(X, -pitch * 0.42 + D.headPitch * 0.35, Y, D.headYaw * 0.4), 30);
    set('Head', seq(X, -pitch * 0.4 + D.headPitch * 0.65 + run * 0.06, Y, D.headYaw * 0.6, Z, -roll * 0.5 - D.headYaw * 0.06), 30);

    // ---- legs: absorb the bob, brace on a pull, half-seat at the gallop ----
    // The lower legs are loosely hung: under-damped springs driven by the
    // saddle's vertical acceleration, so every gallop landing throws the
    // shins back and out and they swing forward and slap in against the
    // horse's sides, fading at the trot and gone at the walk.
    const absorb = -D.seat * 4 + gallopW * 0.08 * Math.cos(P - 0.4);
    const brace = tug * 0.25;
    const flop = (gallopW + trotW * 0.3) * (1 - brace);
    for (const [i, side, s] of [[0, 'Left', 1], [1, 'Right', -1]]) {
      const L = D.legs[i];
      const drive = D.ay * flop * (1 + n(4 + i) * 0.2);
      for (let k = 0; k < 2; k++) {
        L.swV += (-70 * L.sw - 6.5 * L.swV - drive * 0.055) * h; L.sw += L.swV * h;
        L.latV += (-95 * L.lat - 7.5 * L.latV + drive * 0.04) * h; L.lat += L.latV * h;
      }
      L.sw = THREE.MathUtils.clamp(L.sw, -0.4, 0.4);
      L.lat = THREE.MathUtils.clamp(L.lat, -0.12, 0.3);
      set(side + 'UpLeg', seq(X, -1.25 + pitch * 0.25 - absorb * 0.35 + brace * 0.2 + L.sw * 0.25, Z, s * (0.42 + absorb * 0.1 + L.lat)), 30);
      set(side + 'Leg', seq(X, 1.35 + absorb * 0.9 - brace * 0.5 + L.sw, Z, s * L.lat * 0.5), 30);
      set(side + 'Foot', seq(X, 0.15 + absorb * 0.4 + brace * 0.3 + L.sw * 0.7 + L.swV * 0.02), 30);
      set(side + 'ToeBase', seq(X, 0), 30);
    }

    // ---- left arm: reins, following the horse's head ----
    const neck = horse ? horse.neck : 0;
    const reinTight = armPose === 'pull' ? 0.3 : 0;
    set('LeftShoulder', seq(X, 0, Y, 0, Z, spinRoll * 0.5), 20);
    set('LeftArm', seq(Z, -1.22 - roll * 0.25 + reinTight * 0.15, X, -0.55 - neck * 0.35 - run * 0.15 + Math.sin(P) * 0.03 * gaitW), 20);
    set('LeftForeArm', seq(X, -1.12 + neck * 0.3 - reinTight, Y, 0.3), 20);
    set('LeftHand', seq(X, -0.2 - reinTight * 0.4), 20);

    // ---- right arm: the lasso ----
    if (armPose === 'spin') {
      // the hand circles with the loop: raised arm swung round a cone
      const phi = (args.lassoAngle ?? time * 7.5) + args.heading;
      _d.set(Math.cos(phi), 0, Math.sin(phi));
      _axis.set(_d.z, 0, -_d.x).normalize();
      _qt.setFromAxisAngle(_axis, 0.24);
      _qw.copy(seq(Z, -1.5, X, 0.12)).premultiply(_qt);
      set('RightShoulder', seq(Z, 0.12, X, -0.05), 16);
      set('RightArm', _qw, 16);
      set('RightForeArm', seq(X, -0.4 + Math.sin(phi + 0.9) * 0.2, Y, Math.cos(phi + 0.9) * 0.18), 16);
      set('RightHand', seq(X, -0.35 + Math.sin(phi + 1.6) * 0.3, Z, Math.cos(phi + 1.6) * 0.22), 16);
    } else if (armPose === 'throw') {
      // release: the arm comes over the top from the spin and whips forward,
      // extending; then it follows through down and settles pointing after
      // the loop. Parametrised as the lowered arm swung about the lateral
      // axis so the path goes up -> forward -> down, never out to the side.
      const rel = smooth01(T / 0.15), fol = smooth01((T - 0.18) / 0.55);
      const swing = THREE.MathUtils.lerp(-2.85, -1.45, rel) + fol * 0.6;      // -pi = straight up, -pi/2 = forward
      const yawTo = THREE.MathUtils.clamp(lookYaw, -0.6, 0.6) * rel;          // toward the target
      set('RightShoulder', seq(X, -0.12 * rel * (1 - fol * 0.6), Y, -0.12 * rel), 24);
      set('RightArm', seq(Z, 1.3, X, swing, Y, yawTo), T < 0.25 ? 30 : 12);
      set('RightForeArm', seq(X, THREE.MathUtils.lerp(-0.55, -0.06, rel) - fol * 0.4), T < 0.25 ? 30 : 12);
      set('RightHand', seq(X, -0.3 + fol * 0.1, Y, -0.15 * rel), 20);
    } else if (armPose === 'pull') {
      // braced back against the rope: the arm reaches toward the rope,
      // elbow bent, rhythmic tugs pulling the rope in to the chest
      const toRope = THREE.MathUtils.clamp(lookYaw, -1.2, 1.2);
      set('RightShoulder', seq(X, 0.1 + tug * 0.12, Y, 0.15 + toRope * 0.15), 14);
      set('RightArm', seq(Z, 1.0, X, 0.45 + tug * 0.28 + n(2) * 0.04, Y, toRope * 0.55), 14);
      set('RightForeArm', seq(X, -0.95 - tug * 0.45, Y, -0.15), 14);
      set('RightHand', seq(X, -0.35 - tug * 0.2), 14);
    } else {
      // rest: hand on the thigh, loose, swaying a touch with the stride
      set('RightShoulder', seq(X, 0), 10);
      set('RightArm', seq(Z, 1.18 + n(3) * 0.03, X, -0.42 - neck * 0.15 + Math.sin(P) * 0.04 * gaitW), 10);
      set('RightForeArm', seq(X, -0.95 + Math.cos(P) * 0.03 * gaitW), 10);
      set('RightHand', seq(X, -0.2), 10);
    }
    // fingers: a loose grip, tighter on the rope
    const grip = armPose === 'pull' ? 0.85 + tug * 0.15 : armPose === 'throw' ? 0.35 : 0.6;
    for (const [side, s] of [['Left', -1], ['Right', 1]]) {
      const g = side === 'Left' ? 0.6 + reinTight * 0.4 : grip;
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k <= 3; k++) set(`${side}Hand${f}${k}`, seq(Z, s * g), 18);
      for (let k = 1; k <= 3; k++) set(`${side}HandThumb${k}`, seq(Y, s * -0.3), 18);
    }
  }

  handWorldPos(out) {
    return this.bones.smartrigRightHand.getWorldPosition(out);
  }

  _set(name, q, rate, dt) {
    let cur = this.q.get(name);
    if (!cur) { cur = q.clone(); this.q.set(name, cur); }
    else cur.slerp(q, 1 - Math.exp(-rate * dt));
    setBoneWorldRot(this, 'smartrig' + name, cur);
  }

  // Off the horse. The bot sets the group's world transform; this poses the
  // body for: 'roped' (dragged on his back by the wrists: a loose, flailing
  // ragdoll scaled by how fast he is being pulled), 'tantrum' (sits up,
  // pounds the ground, drums his heels), 'dustoff' (gets up, brushes himself
  // down), 'jog' (back to the horse) and 'mount' (the riding seat). Pose
  // rates ease right after a mode change so states flow into each other.
  groundPose(mode, T, dt, opts = {}) {
    dt = THREE.MathUtils.clamp(dt || 1 / 60, 1e-3, 0.05);
    if (mode !== this._gMode) { this._gMode = mode; this._gModeT = 0; } else this._gModeT += dt;
    const ease = smooth01(this._gModeT / 0.7);           // 0 right after a switch .. 1 settled
    const baseRate = 5 + 9 * ease;
    const set = (name, q, rate = baseRate) => this._set(name, q, rate, dt);
    this.model.position.copy(this.seatOffset);
    const D = this.dyn;
    // slow organic wobble, per joint
    const n = (k, f = 1) => Math.sin(T * (0.9 + (k % 5) * 0.37) * f + D.seed * k) * 0.55 + Math.sin(T * (1.7 + (k % 3) * 0.61) * f + D.seed * 0.5 * k) * 0.45;

    if (mode === 'roped') {
      // dragged by one limb (opts.limb = { kind: 'hand'|'ankle', side }):
      // that limb is stretched straight toward the rope; everything else
      // trails behind, loose and flailing. sp: drag speed 0..1, jerk: a
      // tension tug 0..1 (the caught limb snaps taut, the body jolts),
      // kick: a free-leg kick 0..1
      const sp = opts.speed ?? 0.5, jerk = opts.jerk ?? 0, kick = opts.kick ?? 0;
      const limb = opts.limb || { kind: 'hand', side: 'Right' };
      const byHand = limb.kind === 'hand';
      const flail = 0.35 + sp * 0.65;
      // the body arches toward the caught limb on a jerk
      const arch = byHand ? -1 : 1;
      set('Hips', seq(X, arch * 0.06 + n(1) * 0.1 * flail, Y, n(2) * 0.14 * flail, Z, n(3) * 0.1 * flail));
      set('Spine', seq(X, arch * (0.08 + jerk * 0.14) + n(4) * 0.08 * flail, Y, n(5) * 0.2 * flail, Z, n(6) * 0.08 * flail));
      set('Spine1', seq(X, arch * (0.06 + jerk * 0.1), Y, n(7) * 0.14 * flail));
      set('Spine2', seq(X, arch * 0.04, Y, n(8) * 0.1 * flail));
      // head lolls; when dragged by the ankle it trails back, chin up
      set('Neck', seq(X, (byHand ? -0.3 : 0.15) + n(9) * 0.12 * flail, Y, n(10) * 0.3 * flail));
      set('Head', seq(X, (byHand ? -0.4 + jerk * 0.15 : 0.25) + n(11) * 0.18 * flail, Y, n(12, 1.4) * 0.55 * flail, Z, n(13) * 0.3 * flail));
      for (const [side, s, k] of [['Right', -1, 14], ['Left', 1, 20]]) {
        if (byHand && side === limb.side) {
          // the caught arm: straight overhead to the rope, yanked at the shoulder on a jerk
          set(side + 'Shoulder', seq(Z, -s * (0.15 + jerk * 0.25)));
          set(side + 'Arm', seq(Z, -s * 1.5, X, -0.1 + n(k) * 0.06 - jerk * 0.08, Y, n(k + 1) * 0.06));
          set(side + 'ForeArm', seq(X, -0.12 * (1 - jerk) + n(k + 2) * 0.06));
          set(side + 'Hand', seq(X, -0.4, Z, n(k + 3) * 0.1));
        } else if (byHand) {
          // the free arm flops about beside him, elbow loose
          set(side + 'Shoulder', seq(Z, s * 0.05 * n(k)));
          set(side + 'Arm', seq(Z, -s * (0.55 + Math.max(0, n(k)) * 0.5 * flail), X, 0.2 + n(k + 1) * 0.5 * flail, Y, n(k + 4) * 0.3 * flail));
          set(side + 'ForeArm', seq(X, -0.5 - Math.max(0, n(k + 2)) * 0.9 * flail, Y, s * 0.2));
          set(side + 'Hand', seq(X, -0.3 + n(k + 3) * 0.4 * flail, Z, n(k + 5) * 0.3 * flail));
        } else {
          // dragged by the ankle: both arms trail loosely above the head, flailing
          set(side + 'Shoulder', seq(Z, -s * 0.1));
          set(side + 'Arm', seq(Z, -s * (1.05 + n(k) * 0.35 * flail), X, -0.2 + n(k + 1) * 0.45 * flail, Y, n(k + 4) * 0.3 * flail));
          set(side + 'ForeArm', seq(X, -0.35 - Math.max(0, n(k + 2)) * 0.8 * flail, Y, s * 0.15));
          set(side + 'Hand', seq(X, -0.3 + n(k + 3) * 0.4 * flail, Z, n(k + 5) * 0.3 * flail));
        }
      }
      for (const [side, s, k] of [['Left', 1, 26], ['Right', -1, 32]]) {
        if (!byHand && side === limb.side) {
          // the caught leg: straight to the rope, toes pointed, the hip yanked on a jerk
          set(side + 'UpLeg', seq(X, 0.05 + jerk * 0.1 + n(k) * 0.05, Z, s * 0.05));
          set(side + 'Leg', seq(X, 0.06 * (1 - jerk) + Math.max(0, n(k + 3)) * 0.05));
          set(side + 'Foot', seq(X, 0.55 + n(k + 4) * 0.1));
        } else {
          // free legs trail loose, splay and kick now and then; knees never
          // fold further than the thigh lifts, so the feet stay off the ground
          const kk = (opts.kickSide ?? 1) === s ? kick : kick * 0.3;
          const lift = (byHand ? 0.25 : 0.35) + Math.max(0, n(k)) * 0.4 * flail + kk * 0.8;
          set(side + 'UpLeg', seq(X, -lift, Z, s * (0.15 + n(k + 1) * 0.2 * flail), Y, n(k + 2) * 0.15 * flail));
          set(side + 'Leg', seq(X, Math.min(lift * 0.95, 0.35 + kk * 0.7 + Math.max(0, n(k + 3)) * 0.35 * flail)));
          set(side + 'Foot', seq(X, 0.35 + n(k + 4) * 0.25 * flail));
        }
      }
    } else if (mode === 'tantrum') {
      // sit up first (0.6 s), then pound the ground, drum the heels, shake the head
      const rise = smooth01(T / 0.6);
      const fury = smooth01((T - 0.4) / 0.4) * (opts.fury ?? 1);
      set('Hips', seq(X, 0.05 + rise * 0.12 + Math.sin(T * 9) * 0.05 * fury));
      set('Spine', seq(X, -0.1 + rise * 0.35 + Math.sin(T * 9) * 0.06 * fury, Y, Math.sin(T * 4.5) * 0.14 * fury));
      set('Spine1', seq(X, -0.05 + rise * 0.2, Y, Math.sin(T * 4.5) * 0.1 * fury)); set('Spine2', seq(X, rise * 0.05));
      set('Neck', seq(X, -0.3 + rise * 0.1)); set('Head', seq(X, -0.3 + rise * 0.1 + Math.sin(T * 9) * 0.08 * fury, Y, Math.sin(T * 6) * 0.6 * fury, Z, Math.sin(T * 3) * 0.14 * fury));
      for (const [side, s, ph] of [['Left', 1, 0], ['Right', -1, Math.PI]]) {
        const pound = Math.max(0, Math.sin(T * 9 + ph)) * fury;
        // arms come down from overhead as he sits up, then pound
        set(side + 'Shoulder', seq(X, -0.15 * pound));
        set(side + 'Arm', seq(Z, s * -1.5 + rise * s * 0.45, X, -0.12 - rise * 1.05 + pound * 0.85));
        set(side + 'ForeArm', seq(X, -0.35 - rise * 0.4 - pound * 0.25));
        set(side + 'Hand', seq(X, -0.5));
        // heels drum: the knee lifts and the shin follows so the foot stays on the ground
        const drum = Math.max(0, Math.sin(T * 10 + ph)) * fury;
        set(side + 'UpLeg', seq(X, -0.25 - rise * 1.25 - drum * 0.25, Z, s * 0.18));
        set(side + 'Leg', seq(X, 0.1 + drum * 0.3));
        set(side + 'Foot', seq(X, 0.35 - drum * 0.2));
      }
    } else if (mode === 'dustoff') {
      // gets up from sitting (0.7 s crouch to stand), brushes hat and trousers, straightens
      const stand = smooth01(T / 0.7);
      const up = smooth01((T - 1.7) / 0.6);
      const crouch = 1 - stand;
      set('Hips', seq(X, 0.1 * crouch));
      set('Spine', seq(X, 0.55 * crouch + 0.25 * stand * (1 - up))); set('Spine1', seq(X, 0.3 * crouch + 0.2 * stand * (1 - up))); set('Spine2', seq(X, 0.1 * stand * (1 - up)));
      set('Neck', seq(X, -0.2 * crouch + 0.1 * stand * (1 - up))); set('Head', seq(X, -0.3 * crouch + 0.3 * stand * (1 - up), Y, Math.sin(T * 2.2) * 0.25 * stand * (1 - up)));
      const brushR = Math.sin(T * 7), brushL = Math.sin(T * 5.5 + 1);
      set('RightShoulder', seq(X, 0)); set('LeftShoulder', seq(X, 0));
      // hands push off the ground while rising, then brush, then rest on the hips
      set('RightArm', seq(Z, 1.25 - up * 0.2, X, crouch * 0.6 + stand * ((-0.45 + brushR * 0.35) * (1 - up) + up * 0.1), Y, 0.1));
      set('RightForeArm', seq(X, crouch * -0.3 + stand * ((-0.85 + brushR * 0.25) * (1 - up) - up * 1.3), Y, up * -0.6));
      set('LeftArm', seq(Z, -1.15 + up * 0.15, X, crouch * 0.6 + stand * ((-0.9 + brushL * 0.45) * (1 - up) + up * 0.1), Y, -0.1));
      set('LeftForeArm', seq(X, crouch * -0.3 + stand * ((-1.0 + brushL * 0.2) * (1 - up) - up * 1.3), Y, up * 0.6));
      set('RightHand', seq(X, -0.3)); set('LeftHand', seq(X, -0.3));
      for (const [side, s] of [['Left', 1], ['Right', -1]]) {
        set(side + 'UpLeg', seq(X, -1.3 * crouch - 0.05 * stand, Z, s * 0.1));
        set(side + 'Leg', seq(X, 1.5 * crouch + 0.08 * stand));
        set(side + 'Foot', seq(X, -0.2 * crouch));
      }
    } else if (mode === 'jog') {
      // an easy jog: bent arms pumping, knees up, a little forward lean and bounce
      const w = opts.walk ?? 1;
      const phi = (opts.phase ?? T * 2 * Math.PI * 2.6);
      set('Hips', seq(X, 0.05 * w, Y, Math.sin(phi) * 0.08 * w, Z, Math.sin(phi) * 0.04 * w));
      set('Spine', seq(X, 0.12 * w, Y, -Math.sin(phi) * 0.08 * w)); set('Spine1', seq(X, 0.06 * w)); set('Spine2', seq(X, 0.02 * w));
      set('Neck', seq(X, -0.1 * w)); set('Head', seq(X, -0.08 * w, Y, Math.sin(T * 1.3) * 0.08));
      set('RightShoulder', seq(X, 0)); set('LeftShoulder', seq(X, 0));
      set('RightArm', seq(Z, 1.3, X, -0.15 * w + Math.sin(phi) * 0.5 * w)); set('LeftArm', seq(Z, -1.3, X, -0.15 * w - Math.sin(phi) * 0.5 * w));
      set('RightForeArm', seq(X, -0.35 - 1.1 * w)); set('LeftForeArm', seq(X, -0.35 - 1.1 * w));
      set('RightHand', seq(X, -0.35)); set('LeftHand', seq(X, -0.35));
      for (const [side, s, ph] of [['Left', 1, 0], ['Right', -1, Math.PI]]) {
        const sw = Math.sin(phi + ph);
        set(side + 'UpLeg', seq(X, (-0.15 - sw * 0.6) * w, Z, s * 0.06));
        set(side + 'Leg', seq(X, (Math.max(0, -Math.sin(phi + ph - 1.1)) * 1.25 + 0.15) * w + 0.05));
        set(side + 'Foot', seq(X, 0.1 + Math.max(0, -sw) * 0.35 * w));
      }
    } else {
      // 'mount': the riding seat, hands to the reins
      set('Hips', seq(X, 0)); set('Spine', seq(X, 0.05)); set('Spine1', seq(X, 0.05)); set('Spine2', seq(X, 0.02));
      set('Neck', seq(X, -0.05)); set('Head', seq(X, -0.05));
      set('RightShoulder', seq(X, 0)); set('LeftShoulder', seq(X, 0));
      set('RightArm', seq(Z, 1.18, X, -0.42)); set('RightForeArm', seq(X, -0.95)); set('RightHand', seq(X, -0.2));
      set('LeftArm', seq(Z, -1.22, X, -0.55)); set('LeftForeArm', seq(X, -1.12, Y, 0.3)); set('LeftHand', seq(X, -0.2));
      for (const [side, s] of [['Left', 1], ['Right', -1]]) {
        set(side + 'UpLeg', seq(X, -1.25, Z, s * 0.42)); set(side + 'Leg', seq(X, 1.35)); set(side + 'Foot', seq(X, 0.15));
      }
    }
    const grip = mode === 'roped' ? 0.9 : 0.55;
    for (const [side, s] of [['Left', -1], ['Right', 1]]) {
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k <= 3; k++) set(`${side}Hand${f}${k}`, seq(Z, s * grip), 18);
      for (let k = 1; k <= 3; k++) set(`${side}HandThumb${k}`, seq(Y, s * -0.3), 18);
    }
  }

  // After posing and placing: lift the group so no key body point sits
  // below the ground (heightFn gives ground height at x, z).
  floorClamp(heightFn, margin = 0.07) {
    this.group.updateMatrixWorld(true);
    let lift = 0;
    for (const nm of FLOOR_BONES) {
      const b = this.bones[nm];
      if (!b) continue;
      b.getWorldPosition(_fp);
      const need = heightFn(_fp.x, _fp.z) + margin - _fp.y;
      if (need > lift) lift = need;
    }
    if (lift > 0) this.group.position.y += lift;
    return lift;
  }

  // the caught limb as a ring the lasso cinches onto: centred on the wrist
  // or ankle joint, normal along the limb, a wrist's / ankle's radius
  limbRing(limb, out) {
    const joint = this.bones['smartrig' + limb.side + (limb.kind === 'hand' ? 'Hand' : 'Foot')];
    const parent = this.bones['smartrig' + limb.side + (limb.kind === 'hand' ? 'ForeArm' : 'Leg')];
    joint.getWorldPosition(out.center);
    parent.getWorldPosition(_wl);
    out.normal.copy(out.center).sub(_wl).normalize();
    out.radius = limb.kind === 'hand' ? 0.04 : 0.052;
    return out;
  }
}
const _wl = new THREE.Vector3(), _fp = new THREE.Vector3();
const FLOOR_BONES = ['smartrigHead', 'smartrigLeftHand', 'smartrigRightHand', 'smartrigLeftForeArm', 'smartrigRightForeArm', 'smartrigLeftLeg', 'smartrigRightLeg', 'smartrigLeftFoot', 'smartrigRightFoot', 'smartrigLeftToeBase', 'smartrigRightToeBase', 'smartrigHips', 'smartrigSpine1'];

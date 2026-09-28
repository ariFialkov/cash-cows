// Skinned horse breeds: loads the rigged GLB for a horse type, paints a
// species coat into vertex colours (no texture needed), and drives the real
// 27-bone skeleton from the SAME procedural animation code as the built-in
// horse. HorseRider.animate()/applyJump() pose a set of virtual joints; on
// postPose() those joint rotations are retargeted onto the bones as deltas
// over the bind pose, about each bone's world-aligned axes:
//   virtual hip/knee/fetlock  -> shoulder+elbow+knee+fetlock (4-joint legs)
//   virtual neck+head         -> head bone (+ chest spine flex)
//   virtual tail x3           -> 5-bone tail chain
//   virtual ears              -> ear bones
//   virtual body bob/pitch    -> model root + pelvis (Hips) bone

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HorseRider, COWBOY_COLORS } from './horse.js';
import { HORSE_TYPES } from '../game/horses.js';
import { fbm2 } from '../core/rng.js';
import { GaitEngine } from './gait.js';

const cache = new Map();

// Generic rigged-quadruped template loader (horses and cattle share the same
// 27-bone skeleton naming). `height` is the model's world height in metres;
// opts.fixTorso re-skins stray torso vertices off the head bone.
export function loadRigTemplate(model, height, opts = {}) {
  if (cache.has(model)) return cache.get(model);
  const p = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(`${import.meta.env.BASE_URL}models/${model}.glb`,
      (g) => resolve(prepareTemplate(g.scene, height, opts)), undefined, reject);
  });
  cache.set(model, p);
  return p;
}

export function loadHorseType(type) {
  return loadRigTemplate(HORSE_TYPES[type].model, HORSE_TYPES[type].height);
}

const WX = new THREE.Vector3(1, 0, 0), WY = new THREE.Vector3(0, 1, 0), WZ = new THREE.Vector3(0, 0, 1);

function prepareTemplate(scene, height, opts) {
  scene.updateMatrixWorld(true);
  let mesh = null;
  scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });

  let frontChain = null;
  if (!opts.humanoid) {
    if (opts.fixTorso) fixTorsoWeights(mesh);
    // some breeds' front legs are rigged shoulder→elbow→fetlock→pastern with no
    // carpus; give them a knee so the cannon can fold
    frontChain = ensureFrontKnees(mesh);
    scene.updateMatrixWorld(true);
    // the rigs' single 'head' bone carries neck AND skull; split a skull bone
    // off at the poll so the neck can drop while the nose reaches out
    ensureSkull(mesh);
    scene.updateMatrixWorld(true);
  }

  // measure from SKINNED vertex positions (what actually renders), not the
  // raw quantized geometry
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const world = new Array(pos.count);
  const muzzle = new THREE.Vector3(0, 0, -Infinity); // most forward point (the nose)
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    min.min(v); max.max(v);
    world[i] = v.clone();
    if (v.z > muzzle.z && Math.abs(v.x) < 0.02) muzzle.copy(v); // near the centre line (not a horn tip)
  }
  const size = max.clone().sub(min);
  const S = height / size.y;

  // per-bone bind data: rest local quaternion + world axes expressed locally
  const boneData = new Map();
  const wq = new THREE.Quaternion(), inv = new THREE.Quaternion();
  scene.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldQuaternion(wq);
    inv.copy(wq).invert();
    boneData.set(o.name, {
      rest: o.quaternion.clone(),
      wq: wq.clone(), wqInv: inv.clone(),
      ax: WX.clone().applyQuaternion(inv).normalize(),
      ay: WY.clone().applyQuaternion(inv).normalize(),
      az: WZ.clone().applyQuaternion(inv).normalize(),
    });
  });

  // ground offset so hooves / boots sit on y = 0
  const groundY = min.y;
  if (opts.humanoid) return { scene, S, boneData, size, mesh, groundY, min, max, humanoid: true };

  // seat: highest point of the mesh over the mid-back (the saddle top)
  const chest = new THREE.Vector3(), hips = new THREE.Vector3();
  scene.getObjectByName('chest').getWorldPosition(chest);
  scene.getObjectByName('Hips').getWorldPosition(hips);
  const seatZ = chest.z * 0.4 + hips.z * 0.6;
  let seatY = -Infinity;
  for (const p of world) {
    if (Math.abs(p.x) < size.x * 0.12 && Math.abs(p.z - seatZ) < size.z * 0.05) seatY = Math.max(seatY, p.y);
  }
  const seat = new THREE.Vector3(0, seatY, seatZ);
  // leg length (shoulder joint height) in world metres, for stride geometry
  const sh = new THREE.Vector3();
  scene.getObjectByName('frontleg').getWorldPosition(sh);
  const legLen = (sh.y - min.y) * S;

  return { scene, S, boneData, seat, size, mesh, groundY, legLen, frontChain, min, max, muzzle };
}

// ---------------------------------------------------------------------------
// Torso weight fix-up. Some rigs (the cattle) have barrel/belly vertices
// skinned to the head bone; hand those behind the neck base to the chest or
// pelvis by position so the body doesn't swing when the head moves.

function fixTorsoWeights(mesh) {
  const skel = mesh.skeleton;
  const names = skel.bones.map((b) => b.name);
  const idx = (n) => names.indexOf(n);
  const headI = idx('head'), chestI = idx('chest'), hipsI = idx('Hips');
  if (headI < 0 || chestI < 0 || hipsI < 0) return;
  const wp = (i) => { const p = new THREE.Vector3(); skel.bones[i].getWorldPosition(p); return p; };
  const chestZ = wp(chestI).z, hipsZ = wp(hipsI).z, headZ = wp(headI).z;
  const cut = chestZ + (headZ - chestZ) * 0.35;  // behind here is torso, not neck
  const band = (headZ - chestZ) * 0.2;
  const mid = (chestZ + hipsZ) / 2;
  const geo = mesh.geometry;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const vtx = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < si.count; i++) {
    let slot = -1;
    for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === headI && sw.getComponent(i, j) > 0) slot = j;
    if (slot < 0) continue;
    mesh.getVertexPosition(i, vtx).applyMatrix4(mesh.matrixWorld);
    if (vtx.z >= cut + band) continue;
    const f = vtx.z <= cut - band ? 1 : (cut + band - vtx.z) / (2 * band); // fraction moved off the head
    const target = vtx.z > mid ? chestI : hipsI;
    const w = sw.getComponent(i, slot);
    // merge into an existing slot of the target bone if there is one
    let tslot = -1, free = -1;
    for (let j = 0; j < 4; j++) {
      if (si.getComponent(i, j) === target && sw.getComponent(i, j) > 0) tslot = j;
      if (sw.getComponent(i, j) === 0 && free < 0) free = j;
    }
    if (f >= 1) {
      if (tslot >= 0) { sw.setComponent(i, tslot, sw.getComponent(i, tslot) + w); sw.setComponent(i, slot, 0); }
      else si.setComponent(i, slot, target);
    } else if (tslot >= 0) {
      sw.setComponent(i, tslot, sw.getComponent(i, tslot) + w * f);
      sw.setComponent(i, slot, w * (1 - f));
    } else if (free >= 0) {
      si.setComponent(i, free, target); sw.setComponent(i, free, w * f);
      sw.setComponent(i, slot, w * (1 - f));
    } else if (f > 0.5) {
      si.setComponent(i, slot, target);
    }
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Front-leg knee insertion. Returns the bone-name chain per side:
//   { L: [shoulder, elbow, knee, fetlock, pastern|null], R: [...] }

const KNEE_FRAC = 0.47;   // carpus sits 47% of the way from fetlock up to elbow
const KNEE_BLEND = 0.07;  // skin weight blend band around the joint (fraction of segment)

function ensureFrontKnees(mesh) {
  const skel = mesh.skeleton;
  const names = skel.bones.map((b) => b.name);
  const idx = (n) => names.indexOf(n);
  const wy = (n) => { const p = new THREE.Vector3(); skel.bones[idx(n)].getWorldPosition(p); return p.y; };
  // is the bone below the elbow a knee (mid-leg) or already the fetlock (low)?
  const f = (wy('frontleg1') - wy('frontleg2')) / Math.max(1e-6, wy('frontleg0') - wy('frontleg2'));
  if (f > 0.45) {
    return {
      L: ['frontleg', 'frontleg0', 'frontleg1', 'frontleg2', null],
      R: ['R_frontleg', 'R_frontleg0', 'R_frontleg1', 'R_frontleg2', null],
    };
  }

  const geo = mesh.geometry;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const pos = geo.attributes.position;
  const vtx = new THREE.Vector3();
  const bones = [...skel.bones];
  const inverses = skel.boneInverses.map((m) => m.clone());
  const chain = {};

  for (const side of ['', 'R_']) {
    const elbowI = idx(side + 'frontleg0'), fetI = idx(side + 'frontleg1');
    const elbow = bones[elbowI], fet = bones[fetI];

    // new knee bone on the straight elbow→fetlock segment, elbow's orientation
    const knee = new THREE.Bone();
    knee.name = side + 'frontleg0k';
    knee.position.copy(fet.position).multiplyScalar(1 - KNEE_FRAC);
    elbow.add(knee);
    fet.position.sub(knee.position);
    knee.add(fet); // reparent: world transform of the fetlock is unchanged
    const kneeI = bones.length;
    bones.push(knee);
    const elbowBind = inverses[elbowI].clone().invert();
    const kneeBind = elbowBind.multiply(new THREE.Matrix4().makeTranslation(knee.position.x, knee.position.y, knee.position.z));
    inverses.push(kneeBind.invert());

    // re-skin: elbow-weighted vertices below the knee belong to the knee
    mesh.updateMatrixWorld(true);
    const eW = new THREE.Vector3(), fW = new THREE.Vector3();
    elbow.getWorldPosition(eW);
    fet.getWorldPosition(fW);
    const dir = fW.clone().sub(eW);
    const L = dir.length();
    dir.divideScalar(L);
    const t0 = (1 - KNEE_FRAC) - KNEE_BLEND, t1 = (1 - KNEE_FRAC) + KNEE_BLEND;
    for (let i = 0; i < pos.count; i++) {
      let slot = -1;
      for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === elbowI && sw.getComponent(i, j) > 0) slot = j;
      if (slot < 0) continue;
      mesh.getVertexPosition(i, vtx).applyMatrix4(mesh.matrixWorld);
      const t = vtx.clone().sub(eW).dot(dir) / L;
      if (t <= t0) continue;
      const w = sw.getComponent(i, slot);
      const kneeFrac = t >= t1 ? 1 : (t - t0) / (t1 - t0);
      if (kneeFrac >= 1) {
        si.setComponent(i, slot, kneeI);
      } else {
        // split across a free slot if there is one, else round to the heavier side
        let free = -1;
        for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) === 0) { free = j; break; }
        if (free >= 0) {
          sw.setComponent(i, slot, w * (1 - kneeFrac));
          si.setComponent(i, free, kneeI);
          sw.setComponent(i, free, w * kneeFrac);
        } else if (kneeFrac > 0.5) {
          si.setComponent(i, slot, kneeI);
        }
      }
    }
    chain[side ? 'R' : 'L'] = [side + 'frontleg', side + 'frontleg0', knee.name, side + 'frontleg1', side + 'frontleg2'];
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
  const skeleton = new THREE.Skeleton(bones, inverses);
  mesh.bind(skeleton, mesh.bindMatrix.clone());
  return chain;
}

// ---------------------------------------------------------------------------
// Skull insertion. The 'head' bone pivots mid-neck and is skinned to the
// whole neck + head, so a new 'skull' bone is placed at the poll (between the
// head pivot and the ears), the ear/head-end bones are re-parented under it,
// and head-weighted vertices forward of the throatlatch are re-skinned to it.

const SKULL_FRAC = 0.7;    // poll sits 70% of the way from the head pivot to the ears
const SKULL_CUT = 0.16;    // split plane offset (fraction of pivot→ear distance)
const SKULL_BLEND = 0.14;  // blend band either side of the split (same units)

function ensureSkull(mesh) {
  const skel = mesh.skeleton;
  const names = skel.bones.map((b) => b.name);
  const idx = (n) => names.indexOf(n);
  const headI = idx('head');
  if (headI < 0 || idx('skull') >= 0) return;
  const head = skel.bones[headI];
  const wp = (n) => { const p = new THREE.Vector3(); skel.bones[idx(n)].getWorldPosition(p); return p; };
  const headW = wp('head');
  const earMid = wp('earend').add(wp('R_earend')).multiplyScalar(0.5);
  const toEar = earMid.clone().sub(headW);
  const D = toEar.length();

  // new bone at the poll, keeping the head bone's orientation
  const pollW = headW.clone().addScaledVector(toEar, SKULL_FRAC);
  const skull = new THREE.Bone();
  skull.name = 'skull';
  skull.position.copy(head.worldToLocal(pollW.clone()));
  head.add(skull);
  head.updateWorldMatrix(true, true);
  // ears and head end ride on the skull
  for (const c of [...head.children]) if (c !== skull && c.isBone) skull.attach(c);

  const bones = [...skel.bones];
  const inverses = skel.boneInverses.map((m) => m.clone());
  const skullI = bones.length;
  bones.push(skull);
  const headBind = inverses[headI].clone().invert();
  const skullBind = headBind.multiply(new THREE.Matrix4().makeTranslation(skull.position.x, skull.position.y, skull.position.z));
  inverses.push(skullBind.invert());

  // split plane: mostly forward, a little up, through a point just ahead of the
  // pivot — separates the skull + jaw from the neck at the throatlatch
  const n = new THREE.Vector3(0, 0.35, 0.94).normalize();
  const geo = mesh.geometry;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const pos = geo.attributes.position;
  const vtx = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  const d0 = (SKULL_CUT - SKULL_BLEND) * D, d1 = (SKULL_CUT + SKULL_BLEND) * D;
  for (let i = 0; i < pos.count; i++) {
    let slot = -1;
    for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === headI && sw.getComponent(i, j) > 0) slot = j;
    if (slot < 0) continue;
    mesh.getVertexPosition(i, vtx).applyMatrix4(mesh.matrixWorld);
    const d = vtx.sub(headW).dot(n);
    if (d <= d0) continue;
    const w = sw.getComponent(i, slot);
    const f = d >= d1 ? 1 : (d - d0) / (d1 - d0);
    if (f >= 1) {
      si.setComponent(i, slot, skullI);
    } else {
      let free = -1;
      for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) === 0) { free = j; break; }
      if (free >= 0) {
        sw.setComponent(i, slot, w * (1 - f));
        si.setComponent(i, free, skullI);
        sw.setComponent(i, free, w * f);
      } else if (f > 0.5) {
        si.setComponent(i, slot, skullI);
      }
    }
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
  mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix.clone());
}

// ---------------------------------------------------------------------------
// Coat painting: vertex colours from bind-pose position + bone weights.

const _c = new THREE.Color(), _c2 = new THREE.Color();

function noise3(x, y, z, seed) {
  // cheap 3D-ish value noise from two 2D fbm samples
  return (fbm2(x + z * 0.7, y - z * 0.4, seed, 3) + fbm2(y + x * 0.6, z + x * 0.3, seed + 31, 3)) * 0.5;
}

export function paintCoat(mesh, coat, seedIn = 7) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const colors = new Float32Array(pos.count * 3);

  const base = new THREE.Color(coat.base);
  const mane = new THREE.Color(coat.mane);
  const white = new THREE.Color(0xf3efe8);
  const hoof = new THREE.Color(0x2b2119);
  const points = coat.points ? new THREE.Color(coat.points) : null;
  const spot = new THREE.Color(coat.spot || coat.mane);
  const leather = new THREE.Color(0x5a381c);
  const seed = seedIn;
  const socks = coat.socks === 'all' ? [true, true, true, true]
    : coat.socks === 'none' || !coat.socks ? [false, false, false, false] : coat.socks;

  // bone groups by index
  const groupOf = names.map((n) => {
    if (n.startsWith('tail')) return 'tail';
    if (n === 'head' || n === 'headend' || n === 'skull') return 'head';
    if (n.includes('earend')) return 'ear';
    if (/^(R_)?frontleg(0k|1|2)$/.test(n)) return n.startsWith('R_') ? 'legFR' : 'legFL';
    if (/^(R_)?backleg[12]$/.test(n)) return n.startsWith('R_') ? 'legHR' : 'legHL';
    if (/^(R_)?backleg2$/.test(n)) return n.startsWith('R_') ? 'legHR' : 'legHL';
    return 'body';
  });
  const legIndex = { legFL: 0, legFR: 1, legHL: 2, legHR: 3 };

  const w = { tail: 0, head: 0, ear: 0, legFL: 0, legFR: 0, legHL: 0, legHR: 0 };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const gx = x / bb.max.x;                              // -1 .. 1 (left/right)
    const gy = (y - bb.min.y) / (bb.max.y - bb.min.y);   // 0 hoof .. 1 ear tips
    const gz = z;                                        // -1 tail .. 1 nose

    for (const k in w) w[k] = 0;
    for (let j = 0; j < 4; j++) {
      const g = groupOf[si.getComponent(i, j)];
      if (g !== 'body') w[g] += sw.getComponent(i, j);
    }
    const legW = w.legFL + w.legFR + w.legHL + w.legHR;
    const legId = legW > 0 ? legIndex[['legFL', 'legFR', 'legHL', 'legHR'].reduce((a, b) => (w[a] >= w[b] ? a : b))] : -1;

    const hair = noise3(x * 30, y * 30, z * 30, seed);   // fine hair variation
    _c.copy(base).offsetHSL(0, 0, (hair - 0.5) * 0.08);

    // patterns
    if (coat.pattern === 'dapple') {
      const n = noise3(x * 9, y * 9, z * 9, seed + 3);
      if (n > 0.54 && gy > 0.25) _c.lerp(white, Math.min(1, (n - 0.54) * 6) * 0.5);
    } else if (coat.pattern === 'pinto') {
      const n = noise3(x * 3.2, y * 3.2, z * 3.2, seed + 5);
      if (n > 0.5) _c.copy(white).offsetHSL(0, 0, (hair - 0.5) * 0.04);
    } else if (coat.pattern === 'leopard') {
      const n = noise3(x * 26, y * 26, z * 26, seed + 9);
      if (n > 0.6) _c.copy(spot);
    } else if (coat.pattern === 'roan') {
      const n = noise3(x * 40, y * 40, z * 40, seed + 11);
      _c.lerp(white, 0.35 + n * 0.4);
    }
    // belly lightening (not on black coats)
    if (gy < 0.45 && Math.abs(gz) < 0.6 && legW < 0.3 && base.getHSL(_c2).l > 0.15) _c.offsetHSL(0, 0, 0.05 * (0.45 - gy) / 0.45);
    // dorsal stripe (dun)
    if (coat.pattern === 'dun' && Math.abs(gx) < 0.07 && gy > 0.78 && gz > -0.72 && gz < 0.45 && w.head < 0.3) _c.copy(mane);

    // points: darker lower legs and muzzle
    if (points && legW > 0.5) _c.lerp(points, Math.min(1, (legW - 0.5) * 3));
    // socks
    if (legId >= 0 && socks[legId] && legW > 0.55 && gy < 0.3) _c.copy(white).offsetHSL(0, 0, (hair - 0.5) * 0.05);
    // hooves
    if (gy < 0.055) _c.copy(hoof);

    // mane along the crest and forelock; tail
    const crest = w.head > 0.45 && gy > 0.74 && Math.abs(gx) < 0.28 && gz > 0.3 && gz < 0.82;
    const forelock = w.head > 0.5 && gy > 0.9 && gz > 0.8 && gz < 0.93 && Math.abs(gx) < 0.35;
    if (crest || forelock || w.tail > 0.5) _c.copy(mane).offsetHSL(0, 0, (hair - 0.5) * 0.1);

    // blaze down the face
    if (coat.blaze && gz > 0.8 && Math.abs(gx) < 0.13 + (hair - 0.5) * 0.06 && gy > 0.5 && !forelock) _c.copy(white);
    // muzzle
    if (gz > 0.955 && gy < 0.72) _c.lerp(new THREE.Color(0x7a6a62), 0.55);

    // saddle leather: the raised block over the mid-back and its flaps
    const saddleZ = gz > -0.3 && gz < 0.14;
    const saddleTop = saddleZ && gy > 0.72 && legW < 0.2 && w.head < 0.2 && w.tail < 0.2 && Math.abs(gx) < 0.75;
    const flap = saddleZ && gy > 0.5 && gy <= 0.72 && Math.abs(gx) > 0.72 && legW < 0.2;
    if (saddleTop || flap) _c.copy(leather).offsetHSL(0, 0, (hair - 0.5) * 0.08);

    colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

// Shared skeleton driving for anything built on a rig template. `rig` needs
// { template, model, bones }.
export function setBoneRot(rig, name, rx, ry, rz) {
  const b = rig.bones[name];
  const d = rig.template.boneData.get(name);
  if (!b || !d) return;
  b.quaternion.copy(d.rest);
  if (rx) b.quaternion.multiply(_q.setFromAxisAngle(d.ax, rx));
  if (rz) b.quaternion.multiply(_q2.setFromAxisAngle(d.az, rz));
  if (ry) b.quaternion.multiply(_q.setFromAxisAngle(d.ay, ry));
}

// Apply a rotation given in the WORLD frame (at bind) to a bone, on top of
// its rest pose — for limbs whose pose is easier to compose as sequential
// world-axis turns (humanoid arms and legs). Sequential world rotations
// compose as q = later * earlier.
const _q3 = new THREE.Quaternion();
export function setBoneWorldRot(rig, name, qWorld) {
  const b = rig.bones[name];
  const d = rig.template.boneData.get(name);
  if (!b || !d) return;
  _q3.copy(d.wqInv).multiply(qWorld).multiply(d.wq);
  b.quaternion.copy(d.rest).multiply(_q3);
}

// Clone a template's scene into a drivable model: returns { model, bones,
// mesh, modelBaseY }. The mesh gets its own geometry object so per-instance
// vertex colours can be attached; with `share` the vertex buffers themselves
// stay shared with the template (cheap for big herds).
export function instantiateRig(template, share = false) {
  const model = SkeletonUtils.clone(template.scene);
  model.scale.setScalar(template.S);
  const bones = {};
  let mesh = null;
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (share) {
      const src = o.geometry, g = new THREE.BufferGeometry();
      g.setIndex(src.index);
      for (const name in src.attributes) g.setAttribute(name, src.attributes[name]);
      g.boundingBox = src.boundingBox; g.boundingSphere = src.boundingSphere;
      o.geometry = g;
    } else {
      o.geometry = o.geometry.clone();
    }
    o.castShadow = true;
    o.frustumCulled = false;
    mesh = o;
  });
  return { model, bones, mesh, modelBaseY: -template.groundY * template.S };
}

// Push a gait-engine pose onto the skeleton. `roll` is the body roll about
// the forward axis; bodyY the bob offset in metres.
export function applyPose(rig, pose, bodyY, roll) {
  rig.model.position.y = rig.modelBaseY + bodyY;
  setBoneRot(rig, 'Hips', pose.pitch, 0, roll);
  setBoneRot(rig, 'chest', pose.chestFlex, 0, 0);

  const chains = [rig.template.frontChain.L, rig.template.frontChain.R];
  for (let i = 0; i < 2; i++) {
    const L = pose.legs[i], c = chains[i];
    setBoneRot(rig, c[0], L.a, 0, 0);            // shoulder
    setBoneRot(rig, c[1], L.b, 0, 0);            // elbow
    setBoneRot(rig, c[2], L.c, 0, 0);            // knee (carpus)
    setBoneRot(rig, c[3], L.d, 0, 0);            // fetlock
    if (c[4]) setBoneRot(rig, c[4], L.d * 0.5, 0, 0); // pastern carries on the flex
  }
  const hinds = ['backleg', 'R_backleg'];
  for (let i = 2; i < 4; i++) {
    const L = pose.legs[i], p = hinds[i - 2];
    setBoneRot(rig, p, L.a, 0, 0);          // hip
    setBoneRot(rig, p + '0', L.b, 0, 0);    // stifle
    setBoneRot(rig, p + '1', L.c, 0, 0);    // hock
    setBoneRot(rig, p + '2', L.d, 0, 0);    // fetlock
  }

  setBoneRot(rig, 'head', pose.neck + pose.headX * 0.7, pose.headYaw, 0);
  setBoneRot(rig, 'skull', pose.head, pose.headYaw * 0.5, 0);
  setBoneRot(rig, 'earend', 0, 0, pose.ears[0]);
  setBoneRot(rig, 'R_earend', 0, 0, pose.ears[1]);
  const tailNames = ['tail', 'tailstart', 'tail1', 'tail2', 'tail3'];
  for (let i = 0; i < 5; i++) setBoneRot(rig, tailNames[i], pose.tail[i].x, 0, pose.tail[i].z);
}

export class SkinnedHorseRider extends HorseRider {
  constructor(template, species, cowboyIdx = 0) {
    super({ virtual: true });
    this.species = species;
    this.template = template;
    const S = template.S;
    this.engine = new GaitEngine(HORSE_TYPES[species.type].gait, template.legLen);
    this.pose = null;

    const inst = instantiateRig(template);
    this.model = inst.model;
    this.bones = inst.bones;
    this.mesh = inst.mesh;
    this.modelBaseY = inst.modelBaseY; // hooves on the ground
    this.group.add(this.model);
    paintCoat(this.mesh, species.coat, species.id.length * 13);
    this.mesh.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: species.coat.metal ? 0.38 : species.coat.pattern === 'sheen' ? 0.55 : 0.85,
      metalness: species.coat.metal ? 0.55 : 0,
    });

    // rider mounts on an anchor riding the chest bone at the saddle seat
    this.group.updateMatrixWorld(true);
    this.anchor = new THREE.Object3D();
    this.anchor.position.copy(template.seat);
    this.model.add(this.anchor);
    this.group.updateMatrixWorld(true);
    this.bones.chest.attach(this.anchor);
    this.riderMount = new THREE.Object3D();
    this.riderMount.scale.setScalar(1 / S);
    this.riderMount.position.set(0, 0, 0.004);
    this.anchor.add(this.riderMount);
    this.riderMount.add(this.rider);
    this.rider.position.set(0, 0, 0);
    this.riderRestY = 0;

    this.setColors(0, cowboyIdx);
    this.postPose();
  }

  setColors(_coatIdx, shirtIdx) {
    const cb = COWBOY_COLORS[shirtIdx % COWBOY_COLORS.length];
    this.mats.shirt.color.setHex(cb.shirt);
    if (this.cowboy) this.cowboy.setShirt(cb.shirt);
  }

  // Put a skinned cowboy (cowboyModel.js) in the saddle in place of the
  // procedural rider. The procedural rider keeps being posed invisibly; the
  // cowboy reads its torso lean / posting and the arm pose each frame.
  mountCowboy(cowboy) {
    if (this.cowboy) this.riderMount.remove(this.cowboy.group);
    this.cowboy = cowboy;
    this.rider.visible = false;
    this.riderMount.add(cowboy.group);
    this.postPose();
  }

  _animateRider(armPose, time, g) {
    super._animateRider(armPose, time, g);
    if (this.cowboy) this.cowboy.animate(armPose, time, g);
  }

  handWorldPos(out) {
    return this.cowboy ? this.cowboy.handWorldPos(out) : super.handWorldPos(out);
  }

  _setRot(name, rx, ry, rz) { setBoneRot(this, name, rx, ry, rz); }

  // The gait engine produces the horse pose; the virtual body carries the
  // bob/roll the rider and jump logic read; postPose() pushes it to bones.
  animate(dt, speed, turn, armPose, time) {
    const pose = this.engine.update(dt, speed, turn, time);
    this.pose = pose;
    this.body.position.y = 1.06 + pose.bodyY;
    this.body.rotation.z = pose.roll;
    this._animateRider(armPose, time, {
      run: pose.run, P: pose.P * Math.PI * 2, gallopW: pose.gallopW, trotW: pose.trotW,
    });
  }

  // Equestrian jump blended over the gait pose. f = 0 takeoff .. 1 touchdown.
  applyJump(f) {
    const pose = this.pose;
    if (!pose) return;
    const w = Math.min(1, 4 * f * (1 - f) * 1.8);
    const mix = (cur, tgt) => cur + (tgt - cur) * w;
    pose.pitch = mix(pose.pitch, -0.3 * Math.cos(f * Math.PI));
    pose.chestFlex = mix(pose.chestFlex, 0.1 * Math.sin(f * Math.PI));
    for (let i = 0; i < 2; i++) { // forelegs: tuck tight, then reach down to land
      const L = pose.legs[i];
      const e = Math.max(0, (f - 0.55) / 0.45);
      const t = { a: -0.9 + e * 0.35, b: -0.9 + e * 0.85, c: 1.3 - e * 1.25, d: 0.6 - e * 0.75 };
      for (const k in t) L[k] = mix(L[k], t[k]);
    }
    for (let i = 2; i < 4; i++) { // hinds: drive off extended, then gather under
      const L = pose.legs[i];
      const e = Math.max(0, (f - 0.4) / 0.6);
      const t = { a: 0.75 - e * 1.1, b: -0.25 + e * 0.9, c: 0.25 - e * 1.0, d: -0.15 + e * 0.5 };
      for (const k in t) L[k] = mix(L[k], t[k]);
    }
    pose.neck = mix(pose.neck, 0.45);
    pose.headX = mix(pose.headX, -0.15);
    pose.head = mix(pose.head, -0.3);  // nose out over the fence
    pose.tail[0].x = mix(pose.tail[0].x, 0.5);
    // rider rises into two-point
    this.torso.rotation.x += (0.55 - this.torso.rotation.x) * w;
    this.rider.position.y = this.riderRestY + Math.sin(f * Math.PI) * 0.035 * w;
  }

  // push the pose onto the skeleton
  postPose() {
    if (!this.pose) return;
    applyPose(this, this.pose, this.body.position.y - 1.06, this.body.rotation.z);
    if (this.cowboy) this.cowboy.pose(this.torso.rotation.x, this.torso.rotation.z, this.rider.position.y - this.riderRestY);
  }
}

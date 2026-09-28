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

const cache = new Map();

export function loadHorseType(type) {
  if (cache.has(type)) return cache.get(type);
  const p = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(`${import.meta.env.BASE_URL}models/${HORSE_TYPES[type].model}.glb`,
      (g) => resolve(prepareTemplate(g.scene, type)), undefined, reject);
  });
  cache.set(type, p);
  return p;
}

const WX = new THREE.Vector3(1, 0, 0), WY = new THREE.Vector3(0, 1, 0), WZ = new THREE.Vector3(0, 0, 1);

function prepareTemplate(scene, type) {
  scene.updateMatrixWorld(true);
  let mesh = null;
  scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });

  // measure from SKINNED vertex positions (what actually renders), not the
  // raw quantized geometry
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const world = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    min.min(v); max.max(v);
    world[i] = v.clone();
  }
  const size = max.clone().sub(min);
  const S = HORSE_TYPES[type].height / size.y;

  // per-bone bind data: rest local quaternion + world axes expressed locally
  const boneData = new Map();
  const wq = new THREE.Quaternion(), inv = new THREE.Quaternion();
  scene.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldQuaternion(wq);
    inv.copy(wq).invert();
    boneData.set(o.name, {
      rest: o.quaternion.clone(),
      ax: WX.clone().applyQuaternion(inv).normalize(),
      ay: WY.clone().applyQuaternion(inv).normalize(),
      az: WZ.clone().applyQuaternion(inv).normalize(),
    });
  });

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
  // ground offset so hooves sit on y = 0
  const groundY = min.y;

  return { scene, type, S, boneData, seat, size, mesh, groundY };
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
    if (n === 'head' || n === 'headend') return 'head';
    if (n.includes('earend')) return 'ear';
    if (/^(R_)?frontleg[12]$/.test(n)) return n.startsWith('R_') ? 'legFR' : 'legFL';
    if (/^(R_)?backleg[12]$/.test(n)) return n.startsWith('R_') ? 'legHR' : 'legHL';
    if (/^(R_)?frontleg2$/.test(n)) return n.startsWith('R_') ? 'legFR' : 'legFL';
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

export class SkinnedHorseRider extends HorseRider {
  constructor(template, species, cowboyIdx = 0) {
    super({ virtual: true, gait: HORSE_TYPES[species.type].gait });
    this.species = species;
    this.template = template;
    const S = template.S;

    this.model = SkeletonUtils.clone(template.scene);
    this.model.scale.setScalar(S);
    this.modelBaseY = -template.groundY * S; // hooves on the ground
    this.group.add(this.model);

    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.geometry = o.geometry.clone();
      paintCoat(o, species.coat, species.id.length * 13);
      o.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: species.coat.metal ? 0.38 : species.coat.pattern === 'sheen' ? 0.55 : 0.85,
        metalness: species.coat.metal ? 0.55 : 0,
      });
      o.castShadow = true;
      o.frustumCulled = false;
      this.mesh = o;
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

  setColors(_coatIdx, cowboyIdx) {
    const cb = COWBOY_COLORS[cowboyIdx % COWBOY_COLORS.length];
    this.mats.shirt.color.setHex(cb.shirt);
  }

  _setRot(name, rx, ry, rz) {
    const b = this.bones[name];
    const d = this.template.boneData.get(name);
    if (!b || !d) return;
    b.quaternion.copy(d.rest);
    if (rx) b.quaternion.multiply(_q.setFromAxisAngle(d.ax, rx));
    if (rz) b.quaternion.multiply(_q2.setFromAxisAngle(d.az, rz));
    if (ry) b.quaternion.multiply(_q.setFromAxisAngle(d.ay, ry));
  }

  _mapLeg(leg, prefix) {
    const hip = leg.hip.rotation.x, knee = leg.knee.rotation.x, fet = leg.fetlock.rotation.x;
    this._setRot(prefix, hip, 0, 0);
    if (leg.front) {
      // elbow + knee share the fold
      this._setRot(prefix + '0', knee * 0.5, 0, 0);
      this._setRot(prefix + '1', knee * 0.7, 0, 0);
    } else {
      // stifle and hock flex in opposite directions (reciprocal apparatus)
      this._setRot(prefix + '0', knee * 0.55, 0, 0);
      this._setRot(prefix + '1', -knee * 0.75, 0, 0);
    }
    this._setRot(prefix + '2', fet * 0.8, 0, 0);
  }

  // push the virtual joint pose onto the skeleton
  postPose() {
    const b = this.body;
    this.model.position.y = this.modelBaseY + (b.position.y - 1.06);
    this._setRot('Hips', b.rotation.x, 0, b.rotation.z);
    this._setRot('chest', -b.rotation.x * 0.5, 0, 0); // spine flex

    this._mapLeg(this.legs[0], 'frontleg');
    this._mapLeg(this.legs[1], 'R_frontleg');
    this._mapLeg(this.legs[2], 'backleg');
    this._mapLeg(this.legs[3], 'R_backleg');

    const neckD = this.neck.rotation.x - 0.5;
    const headD = this.head.rotation.x + 0.05;
    this._setRot('head', neckD + headD * 0.7, this.head.rotation.y, 0);
    this._setRot('earend', 0, 0, this.earL.rotation.z - 0.15);
    this._setRot('R_earend', 0, 0, this.earR.rotation.z + 0.15);

    const t0 = this.tail[0].rotation.x - 0.7, t1 = this.tail[1].rotation.x, t2 = this.tail[2].rotation.x;
    const z0 = this.tail[0].rotation.z, z1 = this.tail[1].rotation.z, z2 = this.tail[2].rotation.z;
    this._setRot('tail', t0 * 0.5, 0, z0 * 0.5);
    this._setRot('tailstart', t0 * 0.4 + t1 * 0.4, 0, z0 * 0.4 + z1 * 0.4);
    this._setRot('tail1', t1 * 0.5 + t2 * 0.3, 0, z1 * 0.5 + z2 * 0.3);
    this._setRot('tail2', t2 * 0.5, 0, z2 * 0.5);
    this._setRot('tail3', t2 * 0.4, 0, z2 * 0.4);
  }
}

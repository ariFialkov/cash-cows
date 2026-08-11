// Procedurally-built, many-jointed horse + cowboy rig.
// Joints: neck, head, ears, jaw, tail(x3), per-leg shoulder/hip + knee +
// fetlock, rider torso/head/arms(shoulder+elbow)/legs. All animation is
// code-driven gait cycles (idle / walk / gallop) blended by speed.

import * as THREE from 'three';
import { PEN_HALF } from '../world/world.js';
import { loft, loftUp, loftDown } from '../core/loft.js';

export const HORSE_COATS = [
  { body: 0x8a5a2b, mane: 0x3d2812, sock: 0xe8e2d4, blaze: true, stripe: true, name: 'Chestnut' },
  { body: 0x4a3527, mane: 0x1d1410, sock: 0x241a12, blaze: true, stripe: true, name: 'Bay' },
  { body: 0xd9d4c8, mane: 0xa9a294, sock: 0xbdb7aa, blaze: false, stripe: false, name: 'Grey' },
  { body: 0x232323, mane: 0x0d0d0d, sock: 0xe8e2d4, blaze: true, stripe: false, name: 'Midnight' },
];
export const COWBOY_COLORS = [
  { shirt: 0xb03a2e, name: 'Red' },
  { shirt: 0x2e6fb0, name: 'Blue' },
  { shirt: 0x3d7a3a, name: 'Green' },
  { shirt: 0x2f2f33, name: 'Black' },
];

function mat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}
function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------

function buildLeg(parent, x, y, z, mats, front) {
  const hip = pivot(parent, x, y, z);
  // haunch / shoulder muscle blending the leg into the barrel
  const muscle = add(hip, new THREE.SphereGeometry(0.14, 12, 10), mats.body, 0, 0.05, front ? 0.01 : -0.02);
  muscle.scale.set(0.85, 1.5, front ? 1.0 : 1.25);
  const upperLen = 0.42;
  add(hip, loftDown([
    { z: 0, rx: 0.1, ry: 0.13 },
    { z: 0.14, rx: 0.08, ry: 0.095 },
    { z: 0.3, rx: 0.058, ry: 0.062 },
    { z: upperLen, rx: 0.052, ry: 0.054 },
  ]), mats.body);

  const knee = pivot(hip, 0, -upperLen, 0);
  const lowerLen = 0.38;
  add(knee, loftDown([
    { z: 0, rx: 0.055, ry: 0.06 },
    { z: 0.16, rx: 0.045, ry: 0.048 },
    { z: lowerLen, rx: 0.04, ry: 0.042 },
  ]), mats.body);

  const fetlock = pivot(knee, 0, -lowerLen, 0);
  const cannonLen = 0.22;
  add(fetlock, loftDown([
    { z: 0, rx: 0.045, ry: 0.048 },
    { z: 0.12, rx: 0.04, ry: 0.042 },
    { z: cannonLen, rx: 0.048, ry: 0.05 },
  ]), mats.sock);
  const hoofG = new THREE.CylinderGeometry(0.062, 0.072, 0.09, 12);
  add(fetlock, hoofG, mats.hoof, 0, -cannonLen - 0.04, 0.012);

  return { hip, knee, fetlock, front };
}

export class HorseRider {
  constructor() {
    this.group = new THREE.Group();
    this.phase = 0;
    this.speedSm = 0;
    this.leanSm = 0;
    this._buildMaterials(HORSE_COATS[0], COWBOY_COLORS[0]);
    this._build();
  }

  _buildMaterials(coat, cowboy) {
    this.mats = {
      body: mat(coat.body),
      mane: mat(coat.mane, 0.95),
      sock: mat(coat.sock),
      marking: mat(0xf2ede2, 0.95),
      hoof: mat(0x2b2119, 0.6),
      tack: mat(0x50331a, 0.7),
      saddle: mat(0x6e451e, 0.65),
      blanket: mat(0x9d3b34, 0.95),
      shirt: mat(cowboy.shirt),
      pants: mat(0x33415c),
      skin: mat(0xdfae8b),
      hat: mat(0x8a6f4d, 0.9),
      boots: mat(0x3c2713, 0.7),
    };
  }

  setColors(coatIdx, cowboyIdx) {
    const coat = HORSE_COATS[coatIdx % HORSE_COATS.length];
    const cb = COWBOY_COLORS[cowboyIdx % COWBOY_COLORS.length];
    this.mats.body.color.setHex(coat.body);
    this.mats.mane.color.setHex(coat.mane);
    this.mats.sock.color.setHex(coat.sock);
    this.mats.shirt.color.setHex(cb.shirt);
    if (this.blaze) this.blaze.visible = coat.blaze;
    if (this.stripe) this.stripe.visible = coat.stripe;
  }

  _build() {
    const M = this.mats;
    // ------- horse body (root sits at ground level) -------
    this.body = pivot(this.group, 0, 1.06, 0);

    // sculpted barrel: croup -> hindquarters -> flank -> belly -> girth ->
    // withers -> chest, with a real topline and belly curve
    const bodySections = [
      { z: -0.80, rx: 0.05, ryT: 0.06, ryB: 0.05, y: 0.13 },
      { z: -0.72, rx: 0.16, ryT: 0.18, ryB: 0.15, y: 0.08 },
      { z: -0.58, rx: 0.29, ryT: 0.31, ryB: 0.27, y: 0.02 },
      { z: -0.42, rx: 0.33, ryT: 0.34, ryB: 0.31, y: 0 },
      { z: -0.20, rx: 0.30, ryT: 0.31, ryB: 0.34, y: -0.015 },
      { z: 0.02, rx: 0.31, ryT: 0.30, ryB: 0.37, y: -0.02 },
      { z: 0.24, rx: 0.32, ryT: 0.32, ryB: 0.36, y: -0.01 },
      { z: 0.42, rx: 0.29, ryT: 0.37, ryB: 0.31, y: 0.005 },
      { z: 0.58, rx: 0.24, ryT: 0.32, ryB: 0.24, y: 0.03 },
      { z: 0.72, rx: 0.13, ryT: 0.18, ryB: 0.13, y: 0.05 },
      { z: 0.79, rx: 0.04, ryT: 0.05, ryB: 0.04, y: 0.07 },
    ];
    add(this.body, loft(bodySections, 18), M.body);
    // dorsal stripe: a thin contour-hugging shell along the topline
    this.stripe = add(this.body, loft(bodySections.slice(1, 9), 8, {
      thetaStart: Math.PI / 2 - 0.16, thetaLength: 0.32, inflate: 0.02, caps: false,
    }), M.mane);
    this.stripe.castShadow = false;

    // ------- neck & head -------
    // neck pivots at the chest and hangs FORWARD (positive x-rotation tips
    // the neck axis toward +z, the direction the horse faces)
    this.neck = pivot(this.body, 0, 0.22, 0.62);
    this.neck.rotation.x = 0.5;
    // tapering neck with a crest, wide where it melts into the shoulders
    add(this.neck, loftUp([
      { z: -0.06, rx: 0.20, ryT: 0.27, ryB: 0.24 },
      { z: 0.14, rx: 0.16, ryT: 0.23, ryB: 0.19 },
      { z: 0.32, rx: 0.125, ryT: 0.19, ryB: 0.15 },
      { z: 0.48, rx: 0.105, ryT: 0.155, ryB: 0.125 },
      { z: 0.62, rx: 0.09, ryT: 0.12, ryB: 0.10 },
    ], 14), M.body);
    // mane: soft overlapping tufts hugging the crest
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const tuft = add(this.neck, new THREE.SphereGeometry(0.062, 8, 6), M.mane,
        0, 0.05 + i * 0.105, -(0.235 - t * 0.09));
      tuft.scale.set(0.5, 1.05, 1.0);
      tuft.rotation.x = -0.3;
    }

    this.head = pivot(this.neck, 0, 0.58, 0.05);
    this.head.rotation.x = -0.05; // rest pitch; animate() drives from here
    // sculpted head: broad cheeks and brow tapering to a soft square muzzle
    const headSections = [
      { z: -0.14, rx: 0.04, ry: 0.045, y: 0.02 },
      { z: -0.08, rx: 0.108, ryT: 0.12, ryB: 0.13, y: 0.015 },
      { z: 0.04, rx: 0.118, ryT: 0.12, ryB: 0.14, y: 0.01 },
      { z: 0.15, rx: 0.10, ryT: 0.105, ryB: 0.115, y: 0 },
      { z: 0.26, rx: 0.082, ryT: 0.09, ryB: 0.093, y: -0.01 },
      { z: 0.37, rx: 0.07, ryT: 0.075, ryB: 0.078, y: -0.022 },
      { z: 0.46, rx: 0.062, ryT: 0.06, ryB: 0.068, y: -0.03 },
      { z: 0.51, rx: 0.028, ry: 0.03, y: -0.034 },
    ];
    add(this.head, loft(headSections, 14), M.body);
    // face blaze running brow to muzzle
    this.blaze = add(this.head, loft(headSections.slice(2, 7), 6, {
      thetaStart: Math.PI / 2 - 0.22, thetaLength: 0.44, inflate: 0.025, caps: false,
    }), M.marking);
    this.blaze.castShadow = false;
    const forelock = add(this.head, new THREE.SphereGeometry(0.07, 8, 6), M.mane, 0, 0.09, 0.0); // forelock
    forelock.scale.set(0.9, 0.5, 1.3);
    // eyes
    const eyeG = new THREE.SphereGeometry(0.028, 8, 6);
    add(this.head, eyeG, M.hoof, 0.096, 0.06, 0.15);
    add(this.head, eyeG, M.hoof, -0.096, 0.06, 0.15);
    // ears
    const earGeo = new THREE.ConeGeometry(0.05, 0.16, 7);
    this.earL = pivot(this.head, 0.08, 0.15, -0.03);
    this.earR = pivot(this.head, -0.08, 0.15, -0.03);
    add(this.earL, earGeo, M.body, 0, 0.06, 0);
    add(this.earR, earGeo, M.body, 0, 0.06, 0);
    // bridle
    add(this.head, new THREE.TorusGeometry(0.088, 0.013, 6, 16), M.tack, 0, -0.025, 0.34).rotation.z = Math.PI / 2;

    // ------- tail: 3 chained segments -------
    this.tail = [];
    let tp = pivot(this.body, 0, 0.18, -0.72);
    tp.rotation.x = 0.7;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.CapsuleGeometry(0.055 - i * 0.012, 0.2, 4, 8);
      add(tp, seg, M.mane, 0, -0.13, 0);
      const next = pivot(tp, 0, -0.26, 0);
      this.tail.push(tp);
      tp = next;
    }

    // ------- legs -------
    this.legs = [
      buildLeg(this.body, 0.2, -0.18, 0.48, M, true),   // FL
      buildLeg(this.body, -0.2, -0.18, 0.48, M, true),  // FR
      buildLeg(this.body, 0.2, -0.16, -0.45, M, false), // HL
      buildLeg(this.body, -0.2, -0.16, -0.45, M, false),// HR
    ];

    // ------- tack -------
    add(this.body, new THREE.BoxGeometry(0.52, 0.05, 0.5), M.blanket, 0, 0.3, 0.05);
    const saddle = add(this.body, new THREE.BoxGeometry(0.4, 0.12, 0.42), M.saddle, 0, 0.36, 0.05);
    saddle.geometry.translate(0, 0, 0);
    add(this.body, new THREE.BoxGeometry(0.34, 0.14, 0.08), M.saddle, 0, 0.42, -0.14); // cantle
    add(this.body, new THREE.CylinderGeometry(0.035, 0.05, 0.09, 8), M.saddle, 0, 0.47, 0.2); // horn

    // ------- rider -------
    this.rider = pivot(this.body, 0, 0.42, 0.02);
    this.torso = pivot(this.rider, 0, 0.08, 0);
    // hips + belt
    add(this.torso, loftUp([
      { z: -0.02, rx: 0.145, ry: 0.105 },
      { z: 0.05, rx: 0.155, ry: 0.115 },
      { z: 0.12, rx: 0.145, ry: 0.108 },
    ], 12), M.pants);
    add(this.torso, new THREE.CylinderGeometry(0.152, 0.156, 0.035, 14), M.tack, 0, 0.135, 0);
    add(this.torso, new THREE.BoxGeometry(0.05, 0.035, 0.02), mat(0xc8a94a, 0.4), 0, 0.135, 0.105); // buckle
    // shirt torso: waist -> chest -> shoulders
    add(this.torso, loftUp([
      { z: 0.13, rx: 0.14, ry: 0.10 },
      { z: 0.25, rx: 0.145, ry: 0.102 },
      { z: 0.37, rx: 0.165, ry: 0.115 },
      { z: 0.46, rx: 0.168, ry: 0.115 },
      { z: 0.54, rx: 0.10, ry: 0.075 },
    ], 12), M.shirt);
    // head + hat
    this.riderHead = pivot(this.torso, 0, 0.56, 0);
    add(this.riderHead, new THREE.SphereGeometry(0.105, 14, 12), M.skin, 0, 0.05, 0);
    add(this.riderHead, new THREE.SphereGeometry(0.02, 8, 6), M.skin, 0, 0.035, 0.1); // nose
    // curved-brim hat: lathe profile swept around y
    const brim = new THREE.LatheGeometry([
      new THREE.Vector2(0.0, 0.125), new THREE.Vector2(0.1, 0.122),
      new THREE.Vector2(0.18, 0.12), new THREE.Vector2(0.235, 0.135),
      new THREE.Vector2(0.26, 0.158),
    ], 20);
    const brimMesh = add(this.riderHead, brim, M.hat, 0, 0, 0);
    brimMesh.material.side = THREE.DoubleSide;
    add(this.riderHead, loftUp([
      { z: 0.12, rx: 0.105, ry: 0.115 },
      { z: 0.17, rx: 0.10, ry: 0.108 },
      { z: 0.23, rx: 0.085, ry: 0.09 },
      { z: 0.255, rx: 0.045, ry: 0.05 },
    ], 12), M.hat);
    add(this.riderHead, new THREE.CylinderGeometry(0.107, 0.11, 0.03, 14), M.tack, 0, 0.145, 0); // hatband
    // bandana
    add(this.riderHead, new THREE.SphereGeometry(0.07, 8, 6), M.blanket, 0, -0.03, 0.02);

    // arms — right arm swings the lasso
    const buildArm = (side) => {
      const shoulder = pivot(this.torso, side * -0.21, 0.44, 0);
      add(shoulder, new THREE.SphereGeometry(0.06, 10, 8), M.shirt, 0, -0.01, 0);
      add(shoulder, loftDown([
        { z: 0.02, rx: 0.055, ry: 0.058 },
        { z: 0.14, rx: 0.048, ry: 0.05 },
        { z: 0.26, rx: 0.044, ry: 0.045 },
      ]), M.shirt);
      const elbow = pivot(shoulder, 0, -0.26, 0);
      add(elbow, loftDown([
        { z: 0, rx: 0.045, ry: 0.047 },
        { z: 0.12, rx: 0.04, ry: 0.041 },
        { z: 0.22, rx: 0.033, ry: 0.034 },
      ]), M.skin);
      return { shoulder, elbow };
    };
    const armR = buildArm(1);
    this.shoulderR = armR.shoulder;
    this.elbowR = armR.elbow;
    this.handR = pivot(this.elbowR, 0, -0.24, 0);
    add(this.handR, new THREE.SphereGeometry(0.036, 8, 6), M.skin, 0, 0.01, 0); // fist

    const armL = buildArm(-1);
    this.shoulderL = armL.shoulder;
    this.elbowL = armL.elbow;
    add(this.elbowL, new THREE.SphereGeometry(0.036, 8, 6), M.skin, 0, -0.24, 0); // rein hand
    // reins pose
    this.shoulderL.rotation.set(-0.5, 0, -0.15);
    this.elbowL.rotation.x = -0.9;

    // rider legs astride
    for (const side of [1, -1]) {
      const hip = pivot(this.rider, side * 0.17, 0.05, 0.02);
      hip.rotation.set(-0.5, 0, side * 0.35);
      add(hip, loftDown([
        { z: -0.03, rx: 0.075, ry: 0.085 },
        { z: 0.15, rx: 0.066, ry: 0.07 },
        { z: 0.32, rx: 0.058, ry: 0.06 },
      ]), M.pants);
      const knee = pivot(hip, 0, -0.32, 0);
      knee.rotation.x = 1.15;
      add(knee, loftDown([
        { z: 0, rx: 0.06, ry: 0.062 },
        { z: 0.13, rx: 0.052, ry: 0.054 },
        { z: 0.24, rx: 0.047, ry: 0.048 },
      ]), M.pants);
      // boot: shaft, foot and heel
      add(knee, new THREE.CylinderGeometry(0.05, 0.055, 0.09, 10), M.boots, 0, -0.28, 0);
      const toe = add(knee, new THREE.SphereGeometry(0.05, 8, 6), M.boots, 0, -0.325, 0.07);
      toe.scale.set(0.9, 0.65, 1.5);
      add(knee, new THREE.BoxGeometry(0.05, 0.04, 0.04), M.boots, 0, -0.335, -0.03);
    }

    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  // ---- gait animation ------------------------------------------------------
  // speed m/s, turn rad/s. armPose: 'rest' | 'spin' | 'throw' | 'pull'
  animate(dt, speed, turn, armPose, time) {
    this.speedSm += (speed - this.speedSm) * Math.min(1, dt * 6);
    const s = this.speedSm;
    const galloping = s > 4.5;
    const strideFreq = galloping ? 1.4 + s * 0.09 : 0.9 + s * 0.35;
    if (s > 0.15) this.phase += dt * strideFreq;
    const P = this.phase * Math.PI * 2;
    const run = Math.min(1, s / 6);          // 0 idle .. 1 full gallop
    const walkAmt = Math.min(1, s / 2.5) * (1 - run * 0.4);

    // body bob / pitch / roll into turns
    this.leanSm += (turn - this.leanSm) * Math.min(1, dt * 5);
    const bob = galloping ? Math.sin(P * 1) * 0.05 * run : Math.sin(P * 2) * 0.015 * walkAmt;
    this.body.position.y = 1.06 + bob + (galloping ? 0.03 * run : 0);
    this.body.rotation.x = galloping ? Math.cos(P) * 0.06 * run : 0;
    this.body.rotation.z = THREE.MathUtils.clamp(-this.leanSm * 0.12, -0.18, 0.18);

    // legs — walk: 4-beat offsets; gallop: rotary gallop pairing
    const offsets = galloping ? [0.05, 0.15, 0.55, 0.65] : [0, 0.5, 0.75, 0.25];
    const amp = galloping ? 0.75 * run : 0.5 * walkAmt;
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      const lp = P + offsets[i] * Math.PI * 2;
      const swing = Math.cos(lp);
      const lift = Math.max(0, Math.sin(lp));
      leg.hip.rotation.x = swing * amp * (leg.front ? 1 : 0.9);
      leg.knee.rotation.x = leg.front
        ? -lift * (0.5 + amp)                       // front knees fold forward
        : lift * (0.45 + amp * 0.8) * -1;
      leg.fetlock.rotation.x = lift * 0.7 - 0.08;
      if (s < 0.15) { // settle to stand
        leg.hip.rotation.x *= 0.2;
        leg.knee.rotation.x *= 0.2;
        leg.fetlock.rotation.x = -0.05;
      }
    }

    // neck & head — neck hangs forward and stretches out at speed
    const neckBase = 0.5 + run * 0.35 + (galloping ? Math.cos(P) * 0.08 * run : 0);
    this.neck.rotation.x = neckBase + Math.sin(time * 0.7) * 0.02;
    this.head.rotation.x = -0.05 - run * 0.2;
    this.head.rotation.y = THREE.MathUtils.clamp(this.leanSm * 0.35, -0.4, 0.4);
    this.earL.rotation.z = 0.15 + Math.sin(time * 1.3) * 0.1;
    this.earR.rotation.z = -0.15 + Math.sin(time * 1.7 + 2) * 0.1;

    // tail — streams back with speed, swishes at idle
    for (let i = 0; i < 3; i++) {
      const t = this.tail[i];
      t.rotation.x = (i === 0 ? 0.7 : 0) + run * 0.5 - Math.sin(P + i) * 0.12 * run;
      t.rotation.z = Math.sin(time * (1.1 + i * 0.3) + i) * (0.18 - run * 0.12);
    }

    // rider — posts with the gallop, leans forward with speed
    this.torso.rotation.x = 0.08 + run * 0.28 + (galloping ? Math.cos(P) * 0.05 * run : 0);
    this.torso.rotation.z = this.body.rotation.z * -0.6;
    this.riderHead.rotation.x = -this.torso.rotation.x * 0.7;

    // right arm poses
    if (armPose === 'spin') {
      // overhead lasso spin
      this.shoulderR.rotation.set(2.6, 0, -0.5);
      this.elbowR.rotation.set(-0.4 + Math.sin(time * 9) * 0.12, 0, Math.cos(time * 9) * 0.12);
    } else if (armPose === 'throw') {
      this.shoulderR.rotation.set(1.9, 0, -1.1);
      this.elbowR.rotation.set(-0.15, 0, 0);
    } else if (armPose === 'pull') {
      this.shoulderR.rotation.set(-0.9, 0, -0.35 + Math.sin(time * 6) * 0.08);
      this.elbowR.rotation.set(-1.1 + Math.sin(time * 6 + 1) * 0.1, 0, 0);
    } else {
      this.shoulderR.rotation.set(-0.45 + Math.sin(P) * 0.06 * run, 0, 0.12);
      this.elbowR.rotation.set(-0.7, 0, 0);
    }
  }

  handWorldPos(out) {
    return this.handR.getWorldPosition(out);
  }
}

// ---------------------------------------------------------------------------
// Player: movement physics wrapping the rig.

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.rig = new HorseRider();
    this.obj = this.rig.group;
    scene.add(this.obj);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;      // facing away from the camera (screen-up)
    this.speed = 0;
    this.maxSpeed = 12.5;
    this.armPose = 'rest';
    this._turnRate = 0;
  }

  // moveDir: normalized world-space desired direction (or zero), 0..1 strength
  update(dt, moveDir, strength, time) {
    const accel = 16, decel = 14, turnSpeed = 3.4;
    const want = strength * this.maxSpeed;

    if (strength > 0.05) {
      const target = Math.atan2(moveDir.x, moveDir.z);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const maxTurn = turnSpeed * dt * (0.55 + 0.45 * (1 - Math.min(1, this.speed / this.maxSpeed)));
      const step = THREE.MathUtils.clamp(d, -maxTurn, maxTurn);
      this.heading += step;
      this._turnRate = step / Math.max(dt, 1e-4);
      // slow down for sharp turns
      const align = Math.max(0.25, Math.cos(d));
      this.speed = THREE.MathUtils.clamp(this.speed + accel * dt * align, 0, want * align + 1);
    } else {
      this.speed = Math.max(0, this.speed - decel * dt);
      this._turnRate *= 1 - Math.min(1, dt * 8);
    }

    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;

    // fence bounds
    const B = PEN_HALF - 1.2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);

    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.heading;
    this.rig.animate(dt, this.speed, this._turnRate, this.armPose, time);
  }
}

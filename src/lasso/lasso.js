// The lasso: an overhead spinning loop while riding, a ballistic throw with a
// trailing rope, and a taut, sagging line + cinched loop during a wrangle.
// The rope is a CatmullRom tube rebuilt per-frame; the loop is a torus.

import * as THREE from 'three';

const ROPE_RADIUS = 0.028;
const ROPE_SEGS = 36;

export class Lasso {
  constructor(scene) {
    this.scene = scene;
    this.state = 'idle'; // idle | aiming | flying | attached | snapping
    this.color = 0xb98a5a;

    this.ropeMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.85 });
    this.rope = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.rope.castShadow = true;
    this.rope.frustumCulled = false;
    scene.add(this.rope);

    this.loop = new THREE.Mesh(new THREE.TorusGeometry(0.55, ROPE_RADIUS, 8, 28), this.ropeMat);
    this.loop.castShadow = true;
    scene.add(this.loop);

    // aim indicator: dashed arc + landing ring
    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.visible = false;
    scene.add(this.aimRing);

    const aimGeo = new THREE.BufferGeometry();
    this.aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({
      color: 0xffe08a, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.8,
    }));
    this.aimLine.frustumCulled = false;
    this.aimLine.visible = false;
    scene.add(this.aimLine);

    this.spinAngle = 0;
    this.flyT = 0;
    this.flyDur = 0.5;
    this.flyFrom = new THREE.Vector3();
    this.flyTo = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.attachedCow = null;
    this.onLand = null;
    this.snapT = 0;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._pts = [];
  }

  setColor(hex) {
    this.color = hex;
    this.ropeMat.color.setHex(hex);
  }

  // --- aiming preview -------------------------------------------------------
  // locked: aim assist has snapped onto a cow — tint the ring green
  aimAt(worldTarget, groundY, locked = false) {
    this.state = 'aiming';
    this.target.copy(worldTarget);
    this.aimRing.visible = true;
    this.aimRing.position.set(worldTarget.x, groundY + 0.08, worldTarget.z);
    this.aimRing.material.color.setHex(locked ? 0x7ef07a : 0xffe08a);
    this.aimLine.material.color.setHex(locked ? 0x7ef07a : 0xffe08a);
    this.aimLine.visible = true;
  }

  cancelAim() {
    if (this.state === 'aiming') this.state = 'idle';
    this.aimRing.visible = false;
    this.aimLine.visible = false;
  }

  // --- throw ----------------------------------------------------------------
  // homingCow (optional): aim-assist target — the loop tracks it in flight so
  // fleeing cows don't outrun a well-aimed throw.
  throwTo(worldTarget, handPos, onLand, homingCow = null) {
    this.state = 'flying';
    this.aimRing.visible = false;
    this.aimLine.visible = false;
    this.flyFrom.copy(handPos);
    this.flyTo.copy(worldTarget);
    this.flyT = 0;
    const dist = handPos.distanceTo(worldTarget);
    this.flyDur = 0.28 + dist * 0.022;
    this.onLand = onLand;
    this.homing = homingCow;
  }

  attach(cow) {
    this.state = 'attached';
    this.attachedCow = cow;
  }

  snap() {
    // rope breaks: brief whip-away then back to idle
    this.state = 'snapping';
    this.snapT = 0;
    this.attachedCow = null;
  }

  releaseToIdle() {
    this.state = 'idle';
    this.attachedCow = null;
  }

  // --- per-frame ------------------------------------------------------------
  update(dt, player, time) {
    const hand = player.rig.handWorldPos(this._v1);

    if (this.state === 'flying') {
      this.flyT += dt;
      const t = Math.min(1, this.flyT / this.flyDur);
      if (this.homing && !this.homing.captured && this.homing.state !== 'lassoed') {
        // steer the landing point onto the assisted cow as it runs
        const k = Math.min(1, dt * (4 + t * 10));
        this.flyTo.x += (this.homing.pos.x - this.flyTo.x) * k;
        this.flyTo.z += (this.homing.pos.z - this.flyTo.z) * k;
        this.flyTo.y = this.homing.pos.y + 0.3;
      }
      const p = this._bezier(t, hand);
      this.loop.position.copy(p);
      this.loop.rotation.set(-Math.PI / 2 + (1 - t) * 0.7, this.spinAngle * 0.3, 0);
      const spread = 0.55 + Math.sin(t * Math.PI) * 0.35; // loop opens mid-flight
      this.loop.scale.setScalar(spread / 0.55);
      this._ropeBetween(hand, p, 0.35 * (1 - t * 0.5));
      if (t >= 1) {
        const cb = this.onLand;
        this.onLand = null;
        this.homing = null;
        this.state = 'idle';
        if (cb) cb(this.flyTo.clone());
      }
      return;
    }

    if (this.state === 'attached' && this.attachedCow) {
      const neck = this.attachedCow.rig.neckWorldPos(this._v2);
      neck.y += 0.1;
      // cinched loop around the neck
      this.loop.position.copy(neck);
      this.loop.rotation.set(-1.25, this.attachedCow.heading, 0);
      const s = this.attachedCow.size * 0.75;
      this.loop.scale.setScalar(s + Math.sin(time * 11) * 0.03);
      // taut rope with struggle jitter
      const sag = 0.25 + Math.sin(time * 7.3) * 0.1;
      this._ropeBetween(hand, neck, sag, time);
      return;
    }

    if (this.state === 'snapping') {
      this.snapT += dt;
      const k = this.snapT / 0.4;
      // rope recoils toward the hand
      const back = this._v2.copy(hand).add(new THREE.Vector3(Math.sin(time * 40) * 0.4, 1.2 - k, Math.cos(time * 37) * 0.4));
      this.loop.position.lerp(back, Math.min(1, dt * 10));
      this.loop.scale.setScalar(Math.max(0.4, 1 - k * 0.6));
      this._ropeBetween(hand, this.loop.position, 0.6 * (1 - k));
      if (k >= 1) this.state = 'idle';
      return;
    }

    // idle / aiming: spin overhead
    this.spinAngle += dt * (this.state === 'aiming' ? 13 : 7.5);
    const r = this.state === 'aiming' ? 1.05 : 0.8;
    const center = this._v2.set(player.pos.x, hand.y + 0.75, player.pos.z);
    this.loop.position.set(
      center.x + Math.cos(this.spinAngle) * 0.25,
      center.y + Math.sin(this.spinAngle * 2) * 0.05,
      center.z + Math.sin(this.spinAngle) * 0.25
    );
    this.loop.rotation.set(-Math.PI / 2 + 0.18, 0, 0);
    this.loop.rotation.z = this.spinAngle;
    this.loop.scale.setScalar(r / 0.55);
    // short rope from hand to loop edge
    const edge = this.loop.position.clone().add(new THREE.Vector3(Math.cos(this.spinAngle) * r, 0, Math.sin(this.spinAngle) * r));
    this._ropeBetween(hand, edge, 0.12);

    if (this.state === 'aiming') {
      // dashed arc hand → target
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push(this._bezierTo(t, hand, this.target, new THREE.Vector3()));
      }
      this.aimLine.geometry.setFromPoints(pts);
      this.aimLine.computeLineDistances();
      this.aimRing.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
    }
  }

  _bezier(t, hand) {
    return this._bezierTo(t, this.flyFrom.clone().lerp(hand, 0.5), this.flyTo, new THREE.Vector3());
  }

  _bezierTo(t, from, to, out) {
    const peak = Math.max(from.y, to.y) + from.distanceTo(to) * 0.22 + 0.8;
    const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
    const a = 1 - t;
    out.set(
      a * a * from.x + 2 * a * t * mx + t * t * to.x,
      a * a * from.y + 2 * a * t * peak + t * t * to.y,
      a * a * from.z + 2 * a * t * mz + t * t * to.z
    );
    return out;
  }

  _ropeBetween(a, b, sag, time = 0) {
    const pts = this._pts;
    pts.length = 0;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      if (time && i > 0 && i < n) {
        p.x += Math.sin(time * 9 + i * 2.1) * 0.03;
        p.z += Math.cos(time * 8 + i * 1.7) * 0.03;
      }
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, ROPE_SEGS, ROPE_RADIUS, 6, false);
    this.rope.geometry.dispose();
    this.rope.geometry = geo;
  }
}

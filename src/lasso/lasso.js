// The lasso: an overhead spinning loop while riding, a ballistic throw with a
// trailing rope, and a taut, sagging line + cinched loop during a wrangle.
//
// Both the rope AND the loop are rebuilt per-frame as tubes. The loop is a
// closed CatmullRom ring of control points whose radius/lift deform with the
// forces on it — centrifugal lag while spinning, drag flutter in flight,
// cinch tension during a wrangle, crumpling when the rope snaps — with a
// honda knot where the rope ties in.

import * as THREE from 'three';

const ROPE_RADIUS = 0.028;
const ROPE_SEGS = 36;
const LOOP_PTS = 16;
const LOOP_SEGS = 40;
const ROPE_N = 12; // verlet particles

export class Lasso {
  constructor(scene, world = null) {
    this.scene = scene;
    this.world = world; // for rope-terrain collision
    this.state = 'idle'; // idle | aiming | flying | attached | snapping
    this.color = 0xb98a5a;

    this.ropeMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.85 });
    this.rope = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.rope.castShadow = true;
    this.rope.frustumCulled = false;
    scene.add(this.rope);

    // dynamic loop mesh (geometry lives in world space)
    this.loop = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.loop.castShadow = true;
    this.loop.frustumCulled = false;
    scene.add(this.loop);

    // honda knot at the rope/loop junction
    this.honda = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.ropeMat);
    this.honda.castShadow = true;
    scene.add(this.honda);

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
    this.homing = null;
    this.snapT = 0;

    // verlet rope state
    this.ropeP = [];
    this.ropePrev = [];
    for (let i = 0; i < ROPE_N; i++) {
      this.ropeP.push(new THREE.Vector3(0, -10, 0));
      this.ropePrev.push(new THREE.Vector3(0, -10, 0));
    }
    this._ropeSeeded = false;
    this._segLen = 0.2;

    // loop dynamics state
    this.loopCenter = new THREE.Vector3(0, -10, 0);
    this.loopRadius = 0.8;
    this._n = new THREE.Vector3(0, 1, 0);
    this._e1 = new THREE.Vector3(1, 0, 0);
    this._e2 = new THREE.Vector3(0, 0, 1);
    this._hondaPt = new THREE.Vector3();
    this._pts = [];
    this._loopPts = [];
    for (let i = 0; i < LOOP_PTS; i++) this._loopPts.push(new THREE.Vector3());

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
  }

  setColor(hex) {
    this.color = hex;
    this.ropeMat.color.setHex(hex);
  }

  // --- aiming preview -------------------------------------------------------
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
    // coil the rope at the hand so it pays out behind the flying loop
    for (let i = 0; i < ROPE_N; i++) {
      this.ropeP[i].copy(handPos).add(this._v3.set(
        Math.sin(i * 2.1) * 0.05, Math.cos(i * 1.7) * 0.05, Math.sin(i * 2.6) * 0.05));
      this.ropePrev[i].copy(this.ropeP[i]);
    }
  }

  attach(cow) {
    this.state = 'attached';
    this.attachedCow = cow;
  }

  snap() {
    this.state = 'snapping';
    this.snapT = 0;
    this.attachedCow = null;
    // recoil impulse: the freed tail springs back toward the rider
    const dir = this._v3.copy(this.ropeP[ROPE_N - 1]).sub(this.ropeP[0]).normalize();
    for (let i = ROPE_N - 3; i < ROPE_N; i++) {
      this.ropePrev[i].copy(this.ropeP[i]).addScaledVector(dir, 0.3);
    }
  }

  releaseToIdle() {
    this.state = 'idle';
    this.attachedCow = null;
    this._ropeSeeded = false; // snap cleanly back to the overhead coil
  }

  // --- loop construction ----------------------------------------------------
  _basis(n) {
    this._n.copy(n).normalize();
    this._e1.set(0, 1, 0).cross(this._n);
    if (this._e1.lengthSq() < 1e-4) this._e1.set(1, 0, 0);
    this._e1.normalize();
    this._e2.copy(this._n).cross(this._e1).normalize();
  }

  // radiusFn(theta) -> { r, lift }; hondaPhi: plane angle the rope ties in at
  _buildLoop(center, radiusFn, hondaPhi) {
    for (let i = 0; i < LOOP_PTS; i++) {
      const th = (i / LOOP_PTS) * Math.PI * 2;
      // pinch the ring toward the honda so the loop hangs off the knot
      let d = th - hondaPhi;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const pinch = Math.exp(-(d * d) / 0.22);
      const { r, lift } = radiusFn(th);
      const rr = r * (1 - 0.18 * pinch);
      this._loopPts[i].copy(center)
        .addScaledVector(this._e1, Math.cos(th) * rr)
        .addScaledVector(this._e2, Math.sin(th) * rr)
        .addScaledVector(this._n, lift);
    }
    const curve = new THREE.CatmullRomCurve3(this._loopPts, true, 'catmullrom', 0.65);
    const geo = new THREE.TubeGeometry(curve, LOOP_SEGS, ROPE_RADIUS, 6, true);
    this.loop.geometry.dispose();
    this.loop.geometry = geo;
    // honda point on the ring
    this._hondaPt.copy(center)
      .addScaledVector(this._e1, Math.cos(hondaPhi) * radiusFn(hondaPhi).r * 0.86)
      .addScaledVector(this._e2, Math.sin(hondaPhi) * radiusFn(hondaPhi).r * 0.86);
    this.honda.position.copy(this._hondaPt);
    this.loopCenter.copy(center);
  }

  _planeAngleTo(point, center) {
    const d = this._v3.copy(point).sub(center);
    return Math.atan2(d.dot(this._e2), d.dot(this._e1));
  }

  // --- per-frame ------------------------------------------------------------
  update(dt, player, time) {
    const hand = player.rig.handWorldPos(this._v1);

    if (this.state === 'flying') {
      this.flyT += dt;
      const t = Math.min(1, this.flyT / this.flyDur);
      if (this.homing && !this.homing.captured && this.homing.state !== 'lassoed') {
        const k = Math.min(1, dt * (4 + t * 10));
        this.flyTo.x += (this.homing.pos.x - this.flyTo.x) * k;
        this.flyTo.z += (this.homing.pos.z - this.flyTo.z) * k;
        this.flyTo.y = this.homing.pos.y + 0.3;
      }
      const p = this._bezier(t, hand);
      const vel = this._bezier(Math.min(1, t + 0.03), hand).sub(p); // flight direction
      const speed = vel.length() / 0.03 * (1 / this.flyDur);
      // plane starts pitched into the throw, lays flat as it drops on target
      const nv = this._v2.copy(vel).setY(0);
      if (nv.lengthSq() > 1e-6) nv.normalize().multiplyScalar(0.9 * (1 - t));
      else nv.set(0, 0, 0);
      nv.y = 1;
      this._basis(nv);
      this.spinAngle += dt * 9 * (1 - t * 0.6);
      const R = 0.55 + Math.sin(t * Math.PI) * 0.35;
      const flut = Math.min(1, speed * 0.05) * (1 - t * 0.5);
      const phiV = this._planeAngleTo(this._v3.copy(p).add(vel), p);
      const sa = this.spinAngle;
      this._buildLoop(p, (th) => ({
        // drag: the trailing edge of the loop lags and ripples
        r: R * (1 + 0.05 * Math.sin(2 * th + sa * 2) + 0.07 * flut * Math.sin(3 * th - time * 18) + 0.04 * flut * Math.sin(5 * th + time * 23)),
        lift: R * (-0.14 * flut * Math.cos(th - phiV) + 0.05 * flut * Math.sin(2 * th - time * 16)),
      }), this._planeAngleTo(hand, p));
      this._ropeSim(dt, hand, this._hondaPt, { slack: 1.06, gravity: -9 });
      if (t >= 1) {
        const cb = this.onLand;
        this.onLand = null;
        this.homing = null;
        this.state = 'idle';
        // reseed for whatever comes next (re-attach or recall to the spin) so
        // the solver never has to violently reel in a fully stretched rope
        this._ropeSeeded = false;
        if (cb) cb(this.flyTo.clone());
      }
      return;
    }

    if (this.state === 'attached' && this.attachedCow) {
      const cow = this.attachedCow;
      const neck = cow.rig.neckWorldPos(this._v2);
      neck.y += 0.1;
      // ring seated around the neck, tipped with the cow's stance
      const fwd = this._v3.set(Math.sin(cow.heading), 0.5, Math.cos(cow.heading));
      this._basis(fwd);
      const R = cow.size * 0.42;
      const jig = 0.4 + cow.struggleIntensity * 0.6;
      this._buildLoop(neck, (th) => ({
        r: R * (1 + 0.05 * jig * Math.sin(3 * th + time * 9) + 0.035 * jig * Math.sin(5 * th - time * 12) + 0.02 * Math.sin(time * 11)),
        lift: R * 0.08 * jig * Math.sin(2 * th + time * 8),
      }), this._planeAngleTo(hand, neck));
      // working rope: modest slack that tautens as the struggle intensifies
      this._ropeSim(dt, hand, this._hondaPt, {
        slack: 1.09 - 0.06 * Math.min(1, cow.struggleIntensity),
        gravity: -10,
      });
      return;
    }

    if (this.state === 'snapping') {
      this.snapT += dt;
      const k = Math.min(1, this.snapT / 0.55);
      // the freed rope whips back on its own; the crumpling loop rides its tail
      this._ropeSim(dt, hand, hand, { pinEnd: false, gravity: -11, damping: 0.94 });
      const center = this.loopCenter.copy(this.ropeP[ROPE_N - 1]);
      this._basis(this._v3.set(Math.sin(time * 6) * 0.4, 1, Math.cos(time * 5) * 0.4));
      const R = Math.max(0.18, this.loopRadius * (1 - k * 0.6));
      this._buildLoop(center, (th) => ({
        // crumple: high-frequency buckling as the tension lets go
        r: R * (1 + 0.28 * k * Math.sin(4 * th + time * 30) + 0.18 * k * Math.sin(7 * th - time * 41)),
        lift: R * 0.2 * k * Math.sin(3 * th + time * 26),
      }), this._planeAngleTo(hand, center));
      if (k >= 1) { this.state = 'idle'; this._ropeSeeded = false; }
      return;
    }

    // idle / aiming: overhead spin
    const aiming = this.state === 'aiming';
    this.spinAngle += dt * (aiming ? 13 : 7.5);
    const sa = this.spinAngle;
    const R = aiming ? 1.0 : 0.78;
    this.loopRadius = R;
    const center = this._v2.set(
      player.pos.x + Math.cos(sa) * 0.22,
      hand.y + 0.72 + Math.sin(sa * 2) * 0.04,
      player.pos.z + Math.sin(sa) * 0.22
    );
    // plane tips slightly, wobbling with the spin
    this._basis(this._v3.set(Math.cos(sa) * 0.16, 1, Math.sin(sa) * 0.16));
    const spinRate = aiming ? 1.35 : 1;
    this._buildLoop(center, (th) => ({
      // centrifugal lag: a rotating oval + travelling flutter waves
      r: R * (1 + 0.09 * Math.sin(2 * th - sa * 2) + 0.05 * Math.sin(3 * th - time * 9 * spinRate) + 0.03 * Math.sin(5 * th + time * 13)),
      lift: R * (0.07 * Math.sin(2 * th - sa * 2 + 1.2) + 0.04 * Math.sin(3 * th + time * 8)),
    }), this._planeAngleTo(hand, center));
    this._ropeSim(dt, hand, this._hondaPt, { slack: 1.03, gravity: -8 });

    if (aiming) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        pts.push(this._bezierTo(i / 20, hand, this.target, new THREE.Vector3()));
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

  // Verlet rope: integrate gravity + damping, then satisfy segment-length
  // constraints with both ends pinned (hand and honda). With pinEnd=false the
  // far end runs free — used while the rope whips back after a snap.
  _ropeSim(dt, a, b, { slack = 1.08, gravity = -10, pinEnd = true, damping = 0.985 } = {}) {
    const P = this.ropeP, V = this.ropePrev;
    if (!this._ropeSeeded) {
      for (let i = 0; i < ROPE_N; i++) {
        P[i].lerpVectors(a, b, i / (ROPE_N - 1));
        V[i].copy(P[i]);
      }
      this._ropeSeeded = true;
    }
    const steps = dt > 0.028 ? 2 : 1;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      // integrate free particles
      const last = pinEnd ? ROPE_N - 1 : ROPE_N;
      for (let i = 1; i < last; i++) {
        const p = P[i], v = V[i];
        const vx = (p.x - v.x) * damping, vy = (p.y - v.y) * damping, vz = (p.z - v.z) * damping;
        v.copy(p);
        p.x += vx;
        p.y += vy + gravity * h * h;
        p.z += vz;
      }
      P[0].copy(a);
      if (pinEnd) {
        P[ROPE_N - 1].copy(b);
        this._segLen = Math.max(0.06, (a.distanceTo(b) * slack) / (ROPE_N - 1));
      }
      // distance constraints
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < ROPE_N - 1; i++) {
          const p1 = P[i], p2 = P[i + 1];
          const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - this._segLen) / d;
          const w1 = i === 0 ? 0 : 0.5;
          const w2 = (i + 1 === ROPE_N - 1 && pinEnd) ? 0 : 0.5;
          const wSum = w1 + w2;
          if (wSum === 0) continue;
          const k1 = (w1 / wSum) * diff, k2 = (w2 / wSum) * diff;
          p1.x += dx * k1; p1.y += dy * k1; p1.z += dz * k1;
          p2.x -= dx * k2; p2.y -= dy * k2; p2.z -= dz * k2;
        }
      }
      // rope-terrain collision: no particle may sink below the ground
      if (this.world) {
        for (let i = 1; i < ROPE_N; i++) {
          const p = P[i];
          const gy = this.world.heightAt(p.x, p.z) + 0.04;
          if (p.y < gy) p.y = gy;
        }
      } else if (!pinEnd) {
        for (let i = 1; i < ROPE_N; i++) if (P[i].y < a.y - 1.6) P[i].y = a.y - 1.6;
      }
    }
    const curve = new THREE.CatmullRomCurve3(P);
    const geo = new THREE.TubeGeometry(curve, ROPE_SEGS, ROPE_RADIUS, 6, false);
    this.rope.geometry.dispose();
    this.rope.geometry = geo;
  }
}

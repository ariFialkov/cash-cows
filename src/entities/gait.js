// Biomechanical gait engine for the skinned horse breeds.
//
// Every limb runs a stance/swing cycle keyed to its touchdown phase inside
// a shared stride phase. Gaits are defined by footfall timing + duty factor:
//   walk     4-beat lateral sequence   LH, LF, RH, RF
//   trot     2-beat diagonal pairs     LF+RH, RF+LH        (suspension)
//   runwalk  4-beat running walk       (gaited breeds' mid gait, no suspension)
//   gallop   4-beat transverse gallop  LH, RH, LF, RF      (suspension)
// Stride frequency comes from speed / stride length so hooves plant instead
// of sliding, and neighbouring gaits cross-fade (timing, duty, amplitudes)
// through a shared phase so transitions re-time the legs smoothly rather
// than switching animations.
//
// Joint angles are rotations about the horse's lateral (world X) axis:
//   positive tips the distal end BACKWARD, negative FORWARD.
//   shoulder/hip:  negative = protraction (leg reaches forward)
//   elbow:         negative = flexion (forearm swings forward-up)
//   carpus (knee): positive = flexion (cannon folds back)
//   stifle:        positive = flexion;  hock: negative = flexion
//   fetlock:       negative = extension (sinks under load), positive = flexion

import * as THREE from 'three';

const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;

// footfall phase per leg [LF, RF, LH, RH] and stance duty factor
export const GAITS = {
  walk:    { offsets: [0.25, 0.75, 0.0, 0.5], duty: 0.66, stride: 1.55 },
  runwalk: { offsets: [0.25, 0.75, 0.0, 0.5], duty: 0.52, stride: 1.75 },
  trot:    { offsets: [0.0, 0.5, 0.5, 0.0],   duty: 0.44, stride: 2.35 },
  gallop:  { offsets: [0.3, 0.45, 0.0, 0.15], duty: 0.32, stride: 3.9 },
};

// shortest-path lerp of a cyclic phase offset
function lerpPhase(a, b, t) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return frac(a + d * t);
}

export class GaitEngine {
  // params: per-type tuning from horses.js (see HORSE_TYPES[].gait)
  constructor(params, legLen) {
    this.p = params;
    this.legLen = legLen;
    this.phase = Math.random();
    this.speedSm = 0;
    this.leanSm = 0;
    this.w = { idle: 1, walk: 0, mid: 0, gallop: 0 }; // smoothed gait weights
    this.noiseSeed = Math.random() * 100;
    // tail spring chain (5 bones): pitch + sway angle & velocity
    this.tail = Array.from({ length: 5 }, () => ({ x: 0, z: 0, vx: 0, vz: 0 }));
    this.prevBodyY = 0;
    this.bodyVelY = 0;
    // ears: random flick impulses
    this.ear = [{ t: 1 + Math.random() * 3, k: 0 }, { t: 2 + Math.random() * 3, k: 0 }];
    // idle: cocked hind leg, weight shifts
    this.restLeg = Math.random() < 0.5 ? 2 : 3;
    this.restLegT = 4 + Math.random() * 6;
    this.restBlend = 1;
  }

  // slow organic wobble so no two strides are identical
  _noise(t, k) {
    const s = this.noiseSeed + k * 7.3;
    return (Math.sin(t * 0.37 + s) * 0.5 + Math.sin(t * 0.91 + s * 1.7) * 0.3 + Math.sin(t * 1.63 + s * 0.4) * 0.2);
  }

  update(dt, speed, turn, time) {
    const p = this.p;
    this.speedSm += (speed - this.speedSm) * Math.min(1, dt * 5);
    this.leanSm += (turn - this.leanSm) * Math.min(1, dt * 5);
    const v = this.speedSm;

    // ---- gait weights by speed (with hysteresis-free soft bands) ----
    const midGait = GAITS[p.midGait];
    const walkIn = sstep(0.15, 0.7, v);
    const midIn = sstep(p.midMin - 0.6, p.midMin + 0.6, v);
    const galIn = sstep(p.gallopMin - 0.9, p.gallopMin + 0.9, v);
    const target = {
      idle: 1 - walkIn,
      walk: walkIn * (1 - midIn),
      mid: midIn * (1 - galIn),
      gallop: galIn,
    };
    for (const k in this.w) this.w[k] += (target[k] - this.w[k]) * Math.min(1, dt * 4);
    const W = this.w;
    const moving = 1 - W.idle;

    // ---- blended gait parameters ----
    // a profile may swap in its own footfall timing (cattle hop the hinds)
    const g = [p.walk || GAITS.walk, p.mid || midGait, p.gallop || GAITS.gallop];
    const gw = [W.walk, W.mid, W.gallop];
    const norm = Math.max(1e-4, gw[0] + gw[1] + gw[2]);
    const wn = gw.map((x) => x / norm);
    const offsets = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      // lerp walk->mid then ->gallop along shortest phase path
      const a = lerpPhase(g[0].offsets[i], g[1].offsets[i], wn[1] / Math.max(1e-4, wn[0] + wn[1]));
      offsets[i] = lerpPhase(a, g[2].offsets[i], wn[2]);
    }
    const duty = g[0].duty * wn[0] + g[1].duty * wn[1] + g[2].duty * wn[2];
    const stride = (g[0].stride * wn[0] + g[1].stride * wn[1] + g[2].stride * wn[2]) * p.strideScale;

    // stride frequency from speed so feet plant, not slide
    const nz = this._noise(time, 1);
    const freq = Math.max(0.55, v / Math.max(0.6, stride)) * p.freqScale * (1 + nz * 0.03);
    if (moving > 0.02) this.phase += dt * freq * Math.max(0.35, moving);
    const P = this.phase;

    // sweep of the limb during stance from the ground it covers
    const sweep = 0.78 * 2 * Math.asin(THREE.MathUtils.clamp((stride * duty) / (2 * this.legLen), 0, 0.95));
    const ampN = 1 + this._noise(time, 2) * 0.05;

    const pose = {
      bodyY: 0, pitch: 0, roll: 0, chestFlex: 0,
      neck: 0, head: 0, headX: 0, headYaw: THREE.MathUtils.clamp(this.leanSm * 0.35, -0.4, 0.4),
      legs: [], ears: [0, 0], tail: [],
    };

    // ---- legs ----
    const lead = 1; // right lead gallop: RF (1) and RH (3) reach further
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const lp = frac(P - offsets[i]);
      const leadBoost = W.gallop * ((i === 1 || i === 3) ? 0.1 : -0.04) * lead;
      const reach = (sweep * 0.55 + leadBoost) * ampN * (front ? 1 : 1.08);
      const back = (sweep * 0.45 - leadBoost * 0.5) * ampN * (front ? 1 : 1.1);
      const kneeLift = p.kneeLift * (0.55 + 0.45 * Math.min(1, v / 5));
      const hockLift = p.hockLift * (0.5 + 0.5 * Math.min(1, v / 5));
      const L = this._legCycle(lp, duty, front, reach, back, kneeLift, hockLift, W);
      // idle: relax + cocked hind leg
      const rest = this._restPose(i, dt);
      for (const k in L) L[k] = L[k] * moving + rest[k] * W.idle;
      pose.legs.push(L);
    }

    // ---- body: gait-shaped bob / pitch / spine, phase-locked to footfalls ----
    const bobS = p.bobScale;
    // walk: gentle 2/cycle, sway
    const walkBob = -0.012 * Math.cos(TAU * 2 * (P - 0.1));
    const walkRoll = 0.035 * Math.sin(TAU * P);
    const walkNod = 0.055 * p.headNod * Math.cos(TAU * 2 * (P - 0.35));
    // trot / running walk: two suspension peaks per cycle
    const midSusp = p.midGait === 'trot' ? 1.0 : 0.25;
    const trotBob = -0.038 * midSusp * p.suspension * Math.cos(TAU * 2 * (P - 0.2));
    const trotPitch = 0.012 * Math.sin(TAU * 2 * P);
    const trotNod = (p.midGait === 'runwalk' ? 0.09 : 0.012) * p.headNod * Math.cos(TAU * 2 * (P - 0.3));
    // gallop: one big cycle — forelegs load at ~0.4, suspension ~0.8
    const galBob = -0.065 * p.suspension * Math.cos(TAU * (P - 0.4));
    const galPitch = 0.075 * Math.cos(TAU * (P - 0.4));
    const galFlex = 0.07 * Math.cos(TAU * (P - 0.92));       // back rounds while gathering
    // gallop: the neck pumps hard — reaches out and down as the forelegs
    // land, comes back up through the drive and suspension
    const galNod = 0.24 * p.headNod * Math.cos(TAU * (P - 0.35));
    // full gallop: neck stretched low and long, nose poked out (flat, aerodynamic)
    const st = p.stretch ?? 1; // per-type: how flat-out the gallop neck gets
    const flatOut = W.gallop * Math.min(1, Math.max(0, (v - p.gallopMin) / 5)) * st; // 0..1 as speed climbs past the gallop threshold

    pose.bodyY = (walkBob * W.walk + trotBob * W.mid + galBob * W.gallop) * bobS
      + W.gallop * 0.02 * bobS;
    pose.pitch = (trotPitch * W.mid + galPitch * W.gallop) * p.pitchScale;
    pose.roll = walkRoll * W.walk + THREE.MathUtils.clamp(-this.leanSm * 0.12, -0.18, 0.18);
    pose.chestFlex = -pose.pitch * 0.45 + galFlex * W.gallop;
    const carriage = p.neckCarriage + Math.min(1, v / 9) * 0.32 + W.gallop * 0.2 * st + flatOut * 0.22;
    pose.neck = carriage + walkNod * W.walk + trotNod * W.mid + galNod * W.gallop
      + this._noise(time, 3) * 0.02;
    pose.headX = -Math.min(1, v / 9) * 0.18;
    // skull at the poll: nose out as the neck drops, so the face stays
    // reaching forward rather than tucking; counter-nods a little so the
    // head doesn't bob as much as the neck
    pose.head = -Math.min(1, v / 9) * 0.12 - W.gallop * 0.45 * st - flatOut * 0.3
      - galNod * W.gallop * 0.4 - walkNod * W.walk * 0.3;

    // ---- idle life: breathing, weight shift, head drift ----
    const breath = Math.sin(time * 1.4 + this.noiseSeed) * 0.004;
    pose.bodyY += breath * W.idle;
    pose.roll += W.idle * this._noise(time * 0.5, 4) * 0.012;
    pose.neck += W.idle * (this._noise(time * 0.35, 5) * 0.06 + 0.03);
    pose.head += W.idle * this._noise(time * 0.45, 9) * 0.05;
    pose.headYaw += W.idle * this._noise(time * 0.3, 6) * 0.12;

    // ---- ears: idle drift + random flicks ----
    for (let e = 0; e < 2; e++) {
      const ear = this.ear[e];
      ear.t -= dt;
      if (ear.t <= 0) { ear.k = 1; ear.t = 1.5 + Math.random() * 4; }
      ear.k = Math.max(0, ear.k - dt * 2.6);
      const flick = Math.sin(ear.k * Math.PI) * 0.35;
      pose.ears[e] = (e === 0 ? 1 : -1) * (0.05 + this._noise(time, 7 + e) * 0.08) + flick * (e === 0 ? 1 : -1)
        - Math.min(1, v / 8) * 0.15 * (e === 0 ? 1 : -1); // pinned back a touch at speed
    }

    // ---- tail: damped spring chain driven by body motion ----
    const bodyY = pose.bodyY;
    const velY = (bodyY - this.prevBodyY) / Math.max(dt, 1e-4);
    this.bodyVelY += (velY - this.bodyVelY) * Math.min(1, dt * 20);
    this.prevBodyY = bodyY;
    const streams = Math.min(1, v / 7) * 0.55 + p.tailCarriage;
    const swish = (Math.sin(time * 1.1 + this.noiseSeed) * 0.5 + Math.sin(time * 2.3 + this.noiseSeed * 2) * 0.3) * (0.28 - Math.min(1, v / 7) * 0.2)
      + this._noise(time * 0.8, 8) * 0.1;
    let parentX = streams - this.bodyVelY * 0.35, parentZ = swish + this.leanSm * 0.15;
    for (let i = 0; i < 5; i++) {
      const s = this.tail[i];
      const stiff = 60 - i * 8, damp = 7;
      s.vx += ((parentX - s.x) * stiff - s.vx * damp) * dt;
      s.vz += ((parentZ - s.z) * stiff - s.vz * damp) * dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      pose.tail.push({ x: s.x * (i === 0 ? 0.7 : 0.5), z: s.z * (i === 0 ? 0.6 : 0.45) });
      parentX = s.x; parentZ = s.z;
    }

    pose.P = P;
    pose.run = Math.min(1, v / 7);
    pose.gallopW = W.gallop;
    pose.trotW = W.mid * (p.midGait === 'trot' ? 1 : 0.3);
    return pose;
  }

  // one limb's stance/swing cycle. lp: leg phase 0..1 (0 = touchdown)
  _legCycle(lp, duty, front, reach, back, kneeLift, hockLift, W) {
    const gal = W.gallop;
    if (lp < duty) {
      // ---- stance: foot planted, limb sweeps back under the body ----
      const s = lp / duty;
      const prot = lerp(reach, -back, s);
      const load = Math.sin(Math.PI * s);                   // weight-bearing bell
      const brk = sstep(0.72, 1, s);                        // breakover at the end of stance
      if (front) {
        return {
          a: -prot,                                          // shoulder
          b: -0.05 * load - 0.12 * brk,                      // elbow: slight give, starts to flex
          c: 0.03 * load + 0.22 * brk,                       // carpus: locked, then folds back
          d: -(0.32 + 0.18 * gal) * load + 0.25 * brk,       // fetlock sinks under load, snaps at breakover
        };
      }
      return {
        a: -prot,                                            // hip
        b: 0.06 * load - 0.14 * brk,                         // stifle: give, then push-off extension
        c: -0.05 * load + 0.16 * brk,                        // hock: extension into push-off
        d: -(0.3 + 0.18 * gal) * load + 0.22 * brk,
      };
    }
    // ---- swing: limb folds, protracts, then extends for touchdown ----
    const w = (lp - duty) / (1 - duty);
    const fold = Math.sin(Math.PI * Math.pow(w, 0.8));      // peaks early-mid swing
    const land = sstep(0.78, 1, w);                          // reach out for the ground
    if (front) {
      // Competition-trot knee action. The forearm lifts toward horizontal
      // with the elbow, and the carpus folds by (a bit more than) the same
      // angle, so at the top of the lift the cannon hangs vertical / a touch
      // back with the hoof pointing down. Right after breakover the hoof
      // trails back briefly (early), then everything unfolds forward to land.
      const prot = lerp(-back, reach, smooth(Math.min(1, w / 0.85)));
      const lift = Math.sin(Math.PI * Math.pow(w, 1.1));    // peaks just past mid-swing
      const early = Math.sin(Math.PI * Math.min(1, w / 0.6)) * (1 - w);
      const kl = 0.7 + 0.3 * kneeLift;
      const elbow = (0.55 * W.walk + 0.9 * W.mid + 0.8 * W.gallop) * kl;
      const carpus = elbow + (0.18 * W.walk + 0.28 * W.mid + 0.22 * W.gallop) * kl;
      return {
        a: -prot,
        b: -elbow * lift,                                      // elbow flexes, forearm lifts
        c: carpus * lift * (1 - land * 0.7) + 0.45 * early,   // cannon hangs, then reaches
        d: 0.5 * lift * (1 - land) + 0.25 * early - 0.1 * land, // hoof points down, levels to land
      };
    }
    const prot = lerp(-back, reach, smooth(w));
    return {
      a: -prot,
      b: (0.55 * hockLift) * fold,                            // stifle flexes
      c: -(0.75 * hockLift) * fold * (1 - land * 0.5),        // hock flexes (reciprocal)
      d: 0.45 * fold * (1 - land) - 0.1 * land,
    };
  }

  // standing: square up, cock one hind leg now and then
  _restPose(i, dt) {
    this.restLegT -= dt;
    if (this.restLegT <= 0) {
      this.restLeg = this.restLeg === 2 ? 3 : 2;
      this.restLegT = 6 + Math.random() * 8;
      this.restBlend = 0;
    }
    this.restBlend = Math.min(1, this.restBlend + dt * 0.8);
    const cock = i === this.restLeg ? smooth(this.restBlend) : (i >= 2 ? 1 - smooth(this.restBlend) : 0) * 0.0;
    if (i >= 2 && cock > 0) return { a: 0.05 * cock, b: 0.16 * cock, c: -0.2 * cock, d: 0.12 * cock };
    return { a: 0, b: 0, c: 0, d: -0.03 };
  }
}

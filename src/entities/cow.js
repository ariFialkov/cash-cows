// Many-jointed cow rig (neck/head/jaw/ears/tail x2/4 legs x2 joints + hooves)
// with procedural spot textures, plus special variants:
//   mystery — identical size, starfield-purple glow, hidden multiplier
//   offer   — golden glow, take-it-or-leave-it deal on lasso
//   crash   — the Crash Bull: hulking, black, red-eyed mini crash game
// AI: graze / wander / herd-flee with fence awareness (corner them!).

import * as THREE from 'three';
import { PEN_HALF } from '../world/world.js';
import { multiplierForSize, drawMysteryMultiplier } from '../game/economy.js';

const texCache = new Map();
function spotTexture(bgHex, spotHex, key) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bgHex;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = spotHex;
  for (let i = 0; i < 14; i++) {
    g.save();
    g.translate(Math.random() * 256, Math.random() * 256);
    g.rotate(Math.random() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, 14 + Math.random() * 30, 10 + Math.random() * 22, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

function mat(color, rough = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
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

function cowMaterials(kind) {
  if (kind === 'mystery') {
    const body = new THREE.MeshStandardMaterial({
      map: spotTexture('#3b2a68', '#7b5fd1', 'mystery'),
      emissive: 0x6a3df0, emissiveIntensity: 0.35, roughness: 0.7,
    });
    return { body, accent: mat(0x2a1d4e), horn: mat(0xd9c8ff, 0.5), glow: 0x9b7bff };
  }
  if (kind === 'offer') {
    const body = new THREE.MeshStandardMaterial({
      map: spotTexture('#e8b64c', '#c98f1b', 'offer'),
      emissive: 0xffb824, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.35,
    });
    return { body, accent: mat(0xa8791c), horn: mat(0xfff2c8, 0.4), glow: 0xffcf5e };
  }
  if (kind === 'crash') {
    const body = new THREE.MeshStandardMaterial({ color: 0x17151a, roughness: 0.75 });
    return {
      body, accent: mat(0x0d0c0f),
      horn: mat(0xd8d2c6, 0.5),
      eye: new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 2.2 }),
      glow: 0xff3311,
    };
  }
  // standard: half holstein, half brown
  if (Math.random() < 0.5) {
    return {
      body: new THREE.MeshStandardMaterial({ map: spotTexture('#e9e4da', '#2e2a28', 'holstein' + ((Math.random() * 3) | 0)), roughness: 0.9 }),
      accent: mat(0xd6c9b8), horn: mat(0xcfc4ae, 0.6),
    };
  }
  return {
    body: new THREE.MeshStandardMaterial({ map: spotTexture('#a4693c', '#8a5530', 'brown' + ((Math.random() * 3) | 0)), roughness: 0.9 }),
    accent: mat(0x8a5530), horn: mat(0xcfc4ae, 0.6),
  };
}

function buildCowLeg(parent, x, y, z, M) {
  const hip = pivot(parent, x, y, z);
  const upper = 0.34;
  add(hip, new THREE.CylinderGeometry(0.09, 0.07, upper, 8), M.body, 0, -upper / 2, 0);
  const knee = pivot(hip, 0, -upper, 0);
  const lower = 0.3;
  add(knee, new THREE.CylinderGeometry(0.06, 0.055, lower, 8), M.accent, 0, -lower / 2, 0);
  add(knee, new THREE.CylinderGeometry(0.065, 0.075, 0.08, 8), mat(0x2b2119, 0.6), 0, -lower - 0.03, 0.008);
  return { hip, knee };
}

export class CowRig {
  constructor(kind, size) {
    this.kind = kind;
    this.group = new THREE.Group();
    this.phase = Math.random() * 10;
    const M = (this.M = cowMaterials(kind));
    const bull = kind === 'crash';

    this.body = pivot(this.group, 0, 0.88, 0);
    const barrel = new THREE.CapsuleGeometry(bull ? 0.42 : 0.37, bull ? 0.8 : 0.7, 6, 12);
    barrel.rotateX(Math.PI / 2);
    add(this.body, barrel, M.body).scale.set(1, 0.96, 1);
    add(this.body, new THREE.SphereGeometry(bull ? 0.44 : 0.38, 12, 10), M.body, 0, 0.03, -0.4).scale.set(1, 1, 1.1);
    if (bull) add(this.body, new THREE.SphereGeometry(0.4, 12, 10), M.body, 0, 0.2, 0.32); // shoulder hump

    // neck / head / jaw
    this.neck = pivot(this.body, 0, 0.12, bull ? 0.58 : 0.52);
    this.neck.rotation.x = -0.5;
    add(this.neck, new THREE.CapsuleGeometry(0.17, 0.2, 6, 10), M.body, 0, 0.16, 0).scale.set(0.9, 1, 1.15);
    this.head = pivot(this.neck, 0, 0.38, 0.02);
    this.head.rotation.x = 0.95;
    add(this.head, new THREE.BoxGeometry(0.26, 0.24, 0.3), M.body, 0, 0, 0.08);
    add(this.head, new THREE.BoxGeometry(0.18, 0.16, 0.18), M.accent, 0, -0.05, 0.3); // muzzle
    this.jaw = pivot(this.head, 0, -0.12, 0.2);
    add(this.jaw, new THREE.BoxGeometry(0.15, 0.05, 0.16), M.accent, 0, 0, 0.08);
    // eyes
    const eyeMat = M.eye || mat(0x1a1512, 0.4);
    add(this.head, new THREE.SphereGeometry(bull ? 0.045 : 0.035, 8, 6), eyeMat, 0.12, 0.06, 0.14);
    add(this.head, new THREE.SphereGeometry(bull ? 0.045 : 0.035, 8, 6), eyeMat, -0.12, 0.06, 0.14);
    // ears
    this.earL = pivot(this.head, 0.15, 0.08, -0.02);
    this.earR = pivot(this.head, -0.15, 0.08, -0.02);
    const earGeo = new THREE.SphereGeometry(0.07, 8, 6);
    add(this.earL, earGeo, M.body, 0.05, 0, 0).scale.set(1.4, 0.5, 0.8);
    add(this.earR, earGeo, M.body, -0.05, 0, 0).scale.set(1.4, 0.5, 0.8);
    // horns
    const hornGeo = new THREE.ConeGeometry(bull ? 0.055 : 0.035, bull ? 0.34 : 0.18, 8);
    const hL = add(this.head, hornGeo, M.horn, 0.14, 0.14, -0.02);
    hL.rotation.z = -1.0;
    const hR = add(this.head, hornGeo, M.horn, -0.14, 0.14, -0.02);
    hR.rotation.z = 1.0;
    if (bull) { hL.rotation.x = hR.rotation.x = -0.35; }
    // nose ring for the bull
    if (bull) {
      const ring = add(this.head, new THREE.TorusGeometry(0.05, 0.012, 6, 12), mat(0xc8b96a, 0.3), 0, -0.1, 0.4);
      ring.rotation.x = 0.4;
    }

    // tail (2 joints + tuft)
    this.tail = [];
    let tp = pivot(this.body, 0, 0.22, -0.62);
    tp.rotation.x = 0.5;
    for (let i = 0; i < 2; i++) {
      add(tp, new THREE.CapsuleGeometry(0.032 - i * 0.008, 0.2, 4, 6), M.accent, 0, -0.12, 0);
      const next = pivot(tp, 0, -0.24, 0);
      this.tail.push(tp);
      tp = next;
    }
    add(tp, new THREE.SphereGeometry(0.05, 6, 6), mat(0x2e2520, 0.9), 0, -0.03, 0).scale.set(1, 1.6, 1);

    // udder (not on the bull)
    if (!bull) add(this.body, new THREE.SphereGeometry(0.16, 10, 8), mat(0xe8b7a8, 0.8), 0, -0.3, -0.22).scale.set(1, 0.75, 1);

    // legs
    this.legs = [
      buildCowLeg(this.body, 0.22, -0.28, 0.42, M),
      buildCowLeg(this.body, -0.22, -0.28, 0.42, M),
      buildCowLeg(this.body, 0.22, -0.28, -0.4, M),
      buildCowLeg(this.body, -0.22, -0.28, -0.4, M),
    ];

    this.group.scale.setScalar(size);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  // state: 'graze' | 'move' | 'struggle' | 'stomp'; intensity 0..1
  animate(dt, state, speed, intensity, time) {
    this.phase += dt * (0.8 + speed * 0.55);
    const P = this.phase * Math.PI * 2;
    const run = Math.min(1, speed / 5);
    const offsets = [0, 0.5, 0.75, 0.25];

    if (state === 'struggle' || state === 'stomp') {
      const k = 0.4 + intensity * 0.9;
      const f = state === 'stomp' ? 7 + intensity * 6 : 6;
      this.body.rotation.x = Math.sin(time * f) * 0.09 * k;
      this.body.rotation.z = Math.sin(time * f * 0.8 + 1) * 0.1 * k;
      this.body.position.y = 0.88 + Math.abs(Math.sin(time * f)) * 0.07 * k;
      this.neck.rotation.x = -0.5 + Math.sin(time * f * 1.1) * 0.3 * k;
      this.head.rotation.y = Math.sin(time * f * 0.9) * 0.5 * k;
      this.jaw.rotation.x = 0.3 + Math.sin(time * f * 2) * 0.2;
      for (let i = 0; i < 4; i++) {
        const leg = this.legs[i];
        leg.hip.rotation.x = Math.sin(time * f + i * 1.7) * 0.5 * k;
        leg.knee.rotation.x = -Math.max(0, Math.sin(time * f + i * 1.7 + 1)) * 0.8 * k;
      }
      for (let i = 0; i < 2; i++) this.tail[i].rotation.z = Math.sin(time * 9 + i) * 0.5;
      return;
    }

    this.body.rotation.x = run * Math.cos(P) * 0.05;
    this.body.rotation.z = 0;
    this.body.position.y = 0.88 + (run > 0.1 ? Math.abs(Math.sin(P)) * 0.05 * run : 0);

    const amp = state === 'move' ? 0.32 + run * 0.45 : 0;
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      const lp = P + offsets[i] * Math.PI * 2;
      leg.hip.rotation.x = Math.cos(lp) * amp;
      leg.knee.rotation.x = -Math.max(0, Math.sin(lp)) * (0.4 + amp);
      if (amp === 0) { leg.hip.rotation.x = 0; leg.knee.rotation.x = -0.03; }
    }

    if (state === 'graze') {
      const g = (Math.sin(time * 0.45 + this.phase) + 1) / 2;
      this.neck.rotation.x = -0.5 - g * 0.85;
      this.head.rotation.x = 0.95 + g * 0.4;
      this.jaw.rotation.x = g > 0.85 ? Math.sin(time * 8) * 0.12 : 0;
    } else {
      this.neck.rotation.x = -0.5 + run * 0.25;
      this.head.rotation.x = 0.95 - run * 0.2;
      this.jaw.rotation.x = 0;
    }
    this.earL.rotation.z = Math.sin(time * 1.4 + this.phase) * 0.2;
    this.earR.rotation.z = Math.sin(time * 1.1 + this.phase + 3) * 0.2;
    this.tail[0].rotation.z = Math.sin(time * (1.3 + run * 3) + this.phase) * (0.3 + run * 0.2);
    this.tail[1].rotation.z = Math.sin(time * (1.3 + run * 3) + this.phase + 0.9) * 0.4;
  }

  neckWorldPos(out) {
    return this.neck.getWorldPosition(out);
  }
}

// ---------------------------------------------------------------------------

let COW_ID = 1;

export class Cow {
  constructor(scene, world, kind, x, z) {
    this.id = COW_ID++;
    this.world = world;
    this.kind = kind;

    if (kind === 'mystery') {
      this.size = 1.1;                     // all mysteries look identical
      this.mult = drawMysteryMultiplier(); // hidden prize
    } else if (kind === 'offer') {
      this.size = 1.0 + Math.random() * 0.3;
      this.mult = null;                    // drawn when lassoed
    } else if (kind === 'crash') {
      this.size = 1.4;
      this.mult = null;                    // crash game
    } else {
      this.size = 0.85 + Math.random() * 0.7;
      this.mult = multiplierForSize(this.size);
    }

    this.rig = new CowRig(kind, this.size);
    this.obj = this.rig.group;
    scene.add(this.obj);

    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = 'graze';
    this.stateT = Math.random() * 4;
    this.captured = false;
    this.struggleIntensity = 0;
    // bigger cows are a touch slower — herd basics still apply
    this.runSpeed = (kind === 'crash' ? 7.6 : 8.6) - (this.size - 1) * 1.6;
  }

  dispose(scene) {
    scene.remove(this.obj);
  }

  update(dt, player, cows, time) {
    const FLEE_R = 20, CALM_R = 26;
    const toPlayer = this.pos.distanceTo(player.pos);

    if (this.state === 'lassoed') {
      // dragged fight handled by the wrangle controller; just animate
      this.rig.animate(dt, this.kind === 'crash' ? 'stomp' : 'struggle', 0, this.struggleIntensity, time);
      this._settle(dt);
      return;
    }

    this.stateT -= dt;
    if (this.state === 'flee') {
      if (toPlayer > CALM_R) { this.state = 'graze'; this.stateT = 1 + Math.random() * 3; }
    } else if (toPlayer < FLEE_R) {
      this.state = 'flee';
    } else if (this.stateT <= 0) {
      this.state = this.state === 'graze' ? 'wander' : 'graze';
      this.stateT = this.state === 'graze' ? 2 + Math.random() * 5 : 2 + Math.random() * 3;
      this.wanderDir = Math.random() * Math.PI * 2;
    }

    let targetSpeed = 0;
    let targetHeading = this.heading;

    if (this.state === 'flee') {
      // flee player + light boids (cohesion toward herd, separation)
      const away = new THREE.Vector3().subVectors(this.pos, player.pos).normalize();
      const herd = new THREE.Vector3();
      const sep = new THREE.Vector3();
      let n = 0;
      for (const c of cows) {
        if (c === this || c.captured || c.state === 'lassoed') continue;
        const d = c.pos.distanceTo(this.pos);
        if (d < 24) { herd.add(c.pos); n++; }
        if (d < 2.6 && d > 1e-4) sep.add(new THREE.Vector3().subVectors(this.pos, c.pos).divideScalar(d * d));
      }
      const dir = away.clone().multiplyScalar(1.6);
      if (n > 0) {
        herd.divideScalar(n).sub(this.pos);
        const hl = herd.length();
        if (hl > 1e-3) dir.add(herd.divideScalar(hl).multiplyScalar(0.5));
      }
      dir.add(sep.multiplyScalar(2));

      // fence awareness: steer along the rails instead of pinning into them —
      // but panicked cows near a chasing rider still get stuck in corners.
      const M = PEN_HALF - 3.5;
      if (this.pos.x > M && dir.x > 0) { dir.x *= 0.15; dir.z += Math.sign(dir.z || (Math.random() - 0.5)) * 0.9; }
      if (this.pos.x < -M && dir.x < 0) { dir.x *= 0.15; dir.z += Math.sign(dir.z || (Math.random() - 0.5)) * 0.9; }
      if (this.pos.z > M && dir.z > 0) { dir.z *= 0.15; dir.x += Math.sign(dir.x || (Math.random() - 0.5)) * 0.9; }
      if (this.pos.z < -M && dir.z < 0) { dir.z *= 0.15; dir.x += Math.sign(dir.x || (Math.random() - 0.5)) * 0.9; }

      dir.y = 0;
      if (dir.lengthSq() > 1e-5) targetHeading = Math.atan2(dir.x, dir.z);
      // cornered: both axes pinned and rider close → panic but crawl
      const cornered = Math.abs(this.pos.x) > M && Math.abs(this.pos.z) > M;
      const urgency = THREE.MathUtils.clamp(1 - (toPlayer - 4) / (FLEE_R - 4), 0.35, 1);
      targetSpeed = this.runSpeed * urgency * (cornered ? 0.35 : 1);
    } else if (this.state === 'wander') {
      targetHeading = this.wanderDir;
      targetSpeed = 1.3;
      const M = PEN_HALF - 8;
      if (Math.abs(this.pos.x) > M || Math.abs(this.pos.z) > M) {
        targetHeading = Math.atan2(-this.pos.x, -this.pos.z);
        this.wanderDir = targetHeading;
      }
    }

    // steer
    let d = targetHeading - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.heading += THREE.MathUtils.clamp(d, -3.2 * dt, 3.2 * dt);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 4);

    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    const B = PEN_HALF - 1.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);
    this._settle(dt);

    const animState = this.speed > 0.25 ? 'move' : 'graze';
    this.rig.animate(dt, animState, this.speed, 0, time);

    // special cows shimmer
    if (this.kind === 'mystery' || this.kind === 'offer') {
      this.rig.M.body.emissiveIntensity = 0.28 + Math.sin(time * 2.4 + this.id) * 0.14;
    }
  }

  _settle(dt) {
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.heading;
    void dt;
  }
}

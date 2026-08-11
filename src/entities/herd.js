// Herd manager: seeds the range with herds of standard cows plus a sprinkle
// of specials, and keeps the population topped up as cows are wrangled.

import * as THREE from 'three';
import { Cow } from './cow.js';
import { PEN_HALF } from '../world/world.js';

const TARGET_STANDARD = 130;
const TARGET_SPECIALS = { mystery: 10, offer: 10, crash: 6 };

export class Herd {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cows = [];
    this._respawnT = 0;
    this._seed();
  }

  _randPoint(minFromCenter, avoid, avoidR) {
    for (let tries = 0; tries < 40; tries++) {
      const x = (Math.random() * 2 - 1) * (PEN_HALF - 12);
      const z = (Math.random() * 2 - 1) * (PEN_HALF - 12);
      if (Math.hypot(x, z) < minFromCenter) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoidR) continue;
      return [x, z];
    }
    return [PEN_HALF * 0.5, PEN_HALF * 0.5];
  }

  _seed() {
    let placed = 0;
    while (placed < TARGET_STANDARD) {
      const herdSize = Math.min(4 + Math.floor(Math.random() * 5), TARGET_STANDARD - placed);
      const [hx, hz] = this._randPoint(18, null, 0);
      for (let i = 0; i < herdSize; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 7;
        const x = THREE.MathUtils.clamp(hx + Math.sin(a) * r, -PEN_HALF + 6, PEN_HALF - 6);
        const z = THREE.MathUtils.clamp(hz + Math.cos(a) * r, -PEN_HALF + 6, PEN_HALF - 6);
        this.cows.push(new Cow(this.scene, this.world, 'standard', x, z));
        placed++;
      }
    }
    for (const [kind, n] of Object.entries(TARGET_SPECIALS)) {
      for (let i = 0; i < n; i++) {
        const [x, z] = this._randPoint(35, null, 0);
        this.cows.push(new Cow(this.scene, this.world, kind, x, z));
      }
    }
  }

  remove(cow) {
    cow.dispose(this.scene);
    const i = this.cows.indexOf(cow);
    if (i >= 0) this.cows.splice(i, 1);
  }

  update(dt, player, time, riders = []) {
    for (const c of this.cows) c.update(dt, player, this.cows, time, riders);

    // top up population, spawning out of sight of the player
    this._respawnT -= dt;
    if (this._respawnT <= 0) {
      this._respawnT = 1.5;
      const counts = { standard: 0, mystery: 0, offer: 0, crash: 0 };
      for (const c of this.cows) counts[c.kind]++;
      let kind = null;
      if (counts.standard < TARGET_STANDARD) kind = 'standard';
      else for (const [k, n] of Object.entries(TARGET_SPECIALS)) {
        if (counts[k] < n) { kind = k; break; }
      }
      if (kind) {
        const [x, z] = this._randPoint(20, player.pos, 55);
        this.cows.push(new Cow(this.scene, this.world, kind, x, z));
      }
    }
  }

  // nearest free cow whose body is within `radius` of a ground point
  cowNear(point, radius) {
    let best = null, bestScore = Infinity;
    for (const c of this.cows) {
      if (c.state === 'lassoed' || c.captured) continue;
      const d = Math.hypot(c.pos.x - point.x, c.pos.z - point.z);
      const margin = d - c.size * 0.55; // bigger cows are easier to ring
      if (margin < radius && margin < bestScore) { best = c; bestScore = margin; }
    }
    return best;
  }
}

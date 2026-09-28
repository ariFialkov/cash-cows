// Herd manager: seeds the range with herds of standard cows plus a sprinkle
// of specials, and keeps the population topped up as cows are wrangled.

import * as THREE from 'three';
import { Cow, preloadCows } from './cow.js';
import { PEN_HALF } from '../world/world.js';

const TARGET_STANDARD = 220;
const TARGET_SPECIALS = { mystery: 14, offer: 14, crash: 8 };
const PEN_SHARE = 0.38;          // the rest graze the clearings out on the range
const REMOTE_SHARE = 0.25;       // ...and a few small bunches push into the woods and up the slopes

export class Herd {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cows = [];
    this._respawnT = 0;
    preloadCows();
    this._seed();
  }

  _randPoint(minFromCenter, avoid, avoidR, inPen, remote = false) {
    if (this.world.randomPoint) return this.world.randomPoint({ inPen, minFromCenter, avoid, avoidR, margin: 12, remote });
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
      const inPen = placed < TARGET_STANDARD * PEN_SHARE;
      // out on the range the bunches are smaller and scattered; remote ones smaller still
      const remote = !inPen && Math.random() < REMOTE_SHARE;
      const herdSize = Math.min(inPen ? 4 + Math.floor(Math.random() * 5) : remote ? 1 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 4), TARGET_STANDARD - placed);
      const [hx, hz] = this._randPoint(18, null, 0, inPen, remote);
      for (let i = 0; i < herdSize; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 7;
        let x = hx + Math.sin(a) * r, z = hz + Math.cos(a) * r;
        if (this.world.isOpen && !this.world.isOpen(x, z, 0.85, remote)) { x = hx; z = hz; }
        else if (inPen) {
          x = THREE.MathUtils.clamp(x, -PEN_HALF + 6, PEN_HALF - 6);
          z = THREE.MathUtils.clamp(z, -PEN_HALF + 6, PEN_HALF - 6);
        }
        this.cows.push(new Cow(this.scene, this.world, 'standard', x, z));
        placed++;
      }
    }
    for (const [kind, n] of Object.entries(TARGET_SPECIALS)) {
      for (let i = 0; i < n; i++) {
        const [x, z] = this._randPoint(35, null, 0, i < n * PEN_SHARE);
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
        const inPen = Math.random() < PEN_SHARE;
        const [x, z] = this._randPoint(20, player.pos, 55, inPen, !inPen && Math.random() < REMOTE_SHARE);
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

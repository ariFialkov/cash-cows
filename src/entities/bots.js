// Simulated multiplayer: bot cowboys roaming the range, hunting cows and
// winning (or losing) their own bets. Purely cosmetic economy — their wins
// come from the same odds tables as the player's, and get announced to make
// the range feel alive and lucky.

import * as THREE from 'three';
import { HorseRider } from './horse.js';
import { Lasso } from '../lasso/lasso.js';
import { PEN_HALF } from '../world/world.js';
import { LASSO_TIERS, drawOutcome, round2 } from '../game/economy.js';

const NAMES = ['Dusty', 'Big Tex', 'Maribel', 'Cactus Joe', 'Sundown'];
const BOT_COUNT = 5;
const VIS_DIST = 130;        // beyond this, AI-only (no animation / lasso mesh)

class Bot {
  constructor(scene, world, i) {
    this.name = NAMES[i % NAMES.length];
    this.world = world;
    this.rig = new HorseRider();
    this.rig.setColors((i + 1) % 4, (i + 2) % 4);
    this.obj = this.rig.group;
    scene.add(this.obj);

    const a = (i / BOT_COUNT) * Math.PI * 2;
    const r = 60 + Math.random() * 120;
    this.pos = new THREE.Vector3(
      THREE.MathUtils.clamp(Math.sin(a) * r, -PEN_HALF + 10, PEN_HALF - 10),
      0,
      THREE.MathUtils.clamp(Math.cos(a) * r, -PEN_HALF + 10, PEN_HALF - 10)
    );
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0;
    this._turnRate = 0;
    this.armPose = 'spin';

    this.tier = LASSO_TIERS[i % LASSO_TIERS.length];
    this.lasso = new Lasso(scene, world);
    this.lasso.setColor(this.tier.color);

    this.state = 'roam'; // roam | hunt | throwing | wrangle
    this.stateT = Math.random() * 6;
    this.target = null;
    this.outcome = null;
    this.wrangleT = 0;
    this._pickWaypoint();
  }

  _pickWaypoint() {
    this.wp = [
      (Math.random() * 2 - 1) * (PEN_HALF - 20),
      (Math.random() * 2 - 1) * (PEN_HALF - 20),
    ];
  }

  _unclaim() {
    if (this.target && this.target.claimedBy === this) this.target.claimedBy = null;
    this.target = null;
  }

  _release(cowFlees) {
    if (this.target && cowFlees) {
      this.target.state = 'flee';
      this.target.speed = this.target.runSpeed * 0.8;
      this.target.struggleIntensity = 0;
    }
    this._unclaim();
  }

  _moveToward(dt, tx, tz, maxSpeed) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.5 && maxSpeed > 0) {
      const want = Math.atan2(dx, dz);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const step = THREE.MathUtils.clamp(d, -2.8 * dt, 2.8 * dt);
      this.heading += step;
      this._turnRate = step / Math.max(dt, 1e-4);
      const align = Math.max(0.3, Math.cos(d));
      const targetSpeed = maxSpeed * align * THREE.MathUtils.clamp(dist / 6, 0.35, 1);
      this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 4);
    } else {
      this.speed = Math.max(0, this.speed - 12 * dt);
      this._turnRate *= 1 - Math.min(1, dt * 8);
    }
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    const B = PEN_HALF - 2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.heading;
    return dist;
  }

  _hook(cow) {
    cow.state = 'lassoed';
    cow.struggleIntensity = 0.5;
    this.lasso.attach(cow);
    this.outcome = drawOutcome(cow.mult);
    this.wrangleT = 0;
    this.wrangleDur = Math.min(this.outcome.duration, 4.6);
    this.state = 'wrangle';
  }

  update(dt, player, herd, effects, onWin, time) {
    const toPlayer = this.pos.distanceTo(player.pos);
    const vis = toPlayer < VIS_DIST;
    this.obj.visible = vis;
    this.lasso.rope.visible = this.lasso.loop.visible = this.lasso.honda.visible = vis;

    this.stateT -= dt;

    if (this.state === 'roam') {
      const dist = this._moveToward(dt, this.wp[0], this.wp[1], 7.5);
      this.armPose = 'spin';
      if (dist < 6 || this.stateT <= 0) {
        // look for a target: free standard cows, away from the player
        let best = null, bestD = 65;
        for (const c of herd.cows) {
          if (c.kind !== 'standard' || c.captured || c.state === 'lassoed' || c.claimedBy) continue;
          if (c.pos.distanceTo(player.pos) < 22) continue; // leave the player's quarry alone
          const d = c.pos.distanceTo(this.pos);
          if (d < bestD) { best = c; bestD = d; }
        }
        if (best) {
          this.target = best;
          best.claimedBy = this;
          this.state = 'hunt';
          this.stateT = 18; // give up eventually
        } else {
          this._pickWaypoint();
          this.stateT = 4 + Math.random() * 6;
        }
      }
    } else if (this.state === 'hunt') {
      const c = this.target;
      if (!c || c.captured || c.state === 'lassoed' || this.stateT <= 0 ||
          c.pos.distanceTo(player.pos) < 16) {
        this._unclaim();
        this.state = 'roam';
        this.stateT = 2 + Math.random() * 4;
        this._pickWaypoint();
      } else {
        const dist = this._moveToward(dt, c.pos.x, c.pos.z, 11.5);
        this.armPose = 'spin';
        if (dist < 11) {
          if (vis) {
            this.state = 'throwing';
            this.stateT = 2.5;
            const hand = this.rig.handWorldPos(new THREE.Vector3());
            this.lasso.throwTo(
              c.pos.clone().setY(c.pos.y + 0.3), hand,
              (pt) => {
                if (this.state !== 'throwing') return;
                const cow = this.target;
                if (cow && !cow.captured && cow.state !== 'lassoed' &&
                    Math.hypot(cow.pos.x - pt.x, cow.pos.z - pt.z) < 2.4) {
                  this._hook(cow);
                } else {
                  this._unclaim();
                  this.state = 'roam';
                  this.stateT = 2 + Math.random() * 3;
                }
              },
              c
            );
          } else {
            this._hook(c); // nobody's watching — skip the throw animation
          }
        }
      }
    } else if (this.state === 'throwing') {
      this._moveToward(dt, this.pos.x, this.pos.z, 0);
      this.armPose = 'throw';
      if (this.stateT <= 0 || (!vis && this.lasso.state === 'flying')) {
        // flight got interrupted (or we left the visible bubble) — just resolve
        this.lasso.releaseToIdle();
        const c = this.target;
        if (c && !c.captured && c.state !== 'lassoed') this._hook(c);
        else { this._unclaim(); this.state = 'roam'; this.stateT = 3; }
      }
    } else if (this.state === 'wrangle') {
      this._moveToward(dt, this.pos.x, this.pos.z, 0);
      this.armPose = 'pull';
      const c = this.target;
      this.wrangleT += dt;
      if (c) c.struggleIntensity = 0.4 + Math.min(1, this.wrangleT / this.wrangleDur) * 0.6;
      if (this.wrangleT >= this.wrangleDur && c) {
        if (this.outcome.win) {
          const win = round2(this.outcome.mult * this.tier.bet);
          effects.burst(c.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xf2b632, 26, 4, 4);
          onWin(this, win, this.outcome.mult);
          herd.remove(c);
          this._unclaim();
          this.lasso.releaseToIdle();
        } else {
          this.lasso.snap();
          this._release(true);
        }
        this.state = 'roam';
        this.stateT = 9 + Math.random() * 13; // breather between hunts
        this._pickWaypoint();
      }
    }

    if (vis) {
      this.rig.animate(dt, this.speed, this._turnRate, this.armPose, time);
      this.lasso.update(dt, this, time);
    }
  }
}

export class Bots {
  constructor(scene, world, onWin) {
    this.onWin = onWin;
    this.list = [];
    for (let i = 0; i < BOT_COUNT; i++) this.list.push(new Bot(scene, world, i));
  }

  update(dt, player, herd, effects, time) {
    for (const b of this.list) b.update(dt, player, herd, effects, this.onWin, time);
  }
}

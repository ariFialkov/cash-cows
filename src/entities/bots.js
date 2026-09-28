// Simulated multiplayer: bot cowboys roaming the range, hunting cows and
// winning (or losing) their own bets. Purely cosmetic economy — their wins
// come from the same odds tables as the player's, and get announced to make
// the range feel alive and lucky.

import * as THREE from 'three';
import { HorseRider, updateJump, applyJumpPose, DEFAULT_MOVE } from './horse.js';
import { Lasso } from '../lasso/lasso.js';
import { PEN_HALF } from '../world/world.js';
import { LASSO_TIERS, drawOutcome, round2 } from '../game/economy.js';
import { HORSE_SPECIES, speciesStats, movementParams } from '../game/horses.js';
import { loadHorseType, SkinnedHorseRider } from './horseModel.js';
import { COWBOYS, loadCowboy, SkinnedCowboy, randomOutfit } from './cowboyModel.js';

const NAMES = ['Dusty', 'Big Tex', 'Maribel', 'Cactus Joe', 'Sundown'];
const BOT_COUNT = 5;
const VIS_DIST = 130;        // beyond this, AI-only (no animation / lasso mesh)
const RARITY_WEIGHT = { common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1 };

function pickSpecies() {
  const total = HORSE_SPECIES.reduce((s, sp) => s + RARITY_WEIGHT[sp.rarity], 0);
  let r = Math.random() * total;
  for (const sp of HORSE_SPECIES) { r -= RARITY_WEIGHT[sp.rarity]; if (r <= 0) return sp; }
  return HORSE_SPECIES[0];
}

class Bot {
  constructor(scene, world, i) {
    this.name = NAMES[i % NAMES.length];
    this.scene = scene;
    this.world = world;
    this.rig = new HorseRider();
    this.rig.setColors((i + 1) % 4, (i + 2) % 4);
    this.obj = this.rig.group;
    scene.add(this.obj);

    // every rival rides a real breed, with that breed's movement stats
    this.species = pickSpecies();
    this.move = movementParams(speciesStats(this.species));
    // ...and is one of the three cowboys in a random outfit
    this.cowboyIdx = (Math.random() * COWBOYS.length) | 0;
    loadHorseType(this.species.type).then((template) => {
      const rig = new SkinnedHorseRider(template, this.species, (i + 2) % 4);
      rig.phase = this.rig.phase;
      this.scene.remove(this.obj);
      this.rig = rig;
      this.obj = rig.group;
      this.obj.position.copy(this.pos);
      this.obj.rotation.y = this.heading;
      this.scene.add(this.obj);
      return loadCowboy(this.cowboyIdx).then((ct) => { if (this.rig === rig) rig.mountCowboy(new SkinnedCowboy(ct, randomOutfit())); });
    }).catch(() => { this.move = { ...DEFAULT_MOVE }; });

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
    this.jump = null;
    this.jumpCooldown = Math.random(); // desync first jumps
    this.landT = 0;

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
      const turn = this.move.turnSpeed * 0.82;
      const step = THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
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
    // bots take the same equestrian jumps over rocks/bushes (silently)
    const jumpY = updateJump(this, this.world, dt, false);
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z) + jumpY;
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
      const dist = this._moveToward(dt, this.wp[0], this.wp[1], this.move.maxSpeed * 0.58);
      this.armPose = 'spin';
      if (dist < 6 || this.stateT <= 0) {
        // look for a target: free standard cows, away from the player
        let best = null, bestD = 65;
        for (const c of herd.cows) {
          if (c.kind !== 'standard' || c.captured || c.state === 'lassoed' || c.claimedBy) continue;
          if (c.pos.distanceTo(player.pos) < 18) continue; // leave the player's quarry alone
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
          c.pos.distanceTo(player.pos) < 12) {
        this._unclaim();
        this.state = 'roam';
        this.stateT = 2 + Math.random() * 4;
        this._pickWaypoint();
      } else {
        const dist = this._moveToward(dt, c.pos.x, c.pos.z, this.move.maxSpeed * 0.9);
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
          onWin(this, win, this.outcome.mult, c.pos.clone());
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
      // the cowboy follows the rope's spin and watches the cow he's working
      this.rig.lassoAngle = this.lasso.spinAngle;
      this.rig.lookTarget = this.target && (this.state === 'hunt' || this.state === 'throwing' || this.state === 'wrangle') ? this.target.pos : null;
      this.rig.animate(dt, this.speed, this._turnRate, this.armPose, time);
      applyJumpPose(this);
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

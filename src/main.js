// Cash Cows — main game orchestration: renderer, camera, game states,
// throw/hook logic and the three special-cow bet flows.

import './style.css';
import * as THREE from 'three';
import { World, RANGE_HALF } from './world/world.js';
import { Player } from './entities/horse.js';
import { Herd } from './entities/herd.js';
import { Bots } from './entities/bots.js';
import { Lasso } from './lasso/lasso.js';
import { Effects } from './core/effects.js';
import { sfx } from './core/sfx.js';
import { Input } from './input/input.js';
import { UI, tmpl } from './ui/ui.js';
import { Minimap } from './ui/minimap.js';
import { getSpecies, speciesStats, movementParams } from './game/horses.js';
import { loadHorseType, SkinnedHorseRider } from './entities/horseModel.js';
import { loadCowboy, SkinnedCowboy, playerOutfit } from './entities/cowboyModel.js';
import { COWBOY_COLORS } from './entities/horse.js';
import {
  Wallet, LASSO_TIERS, fmt, round2, winProbForMultiplier,
  drawOutcome, drawOffer, drawCrashPoint, crashMultAt,
} from './game/economy.js';

// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);

const wallet = new Wallet();
// ?seed=N pins the range layout (handy for comparing builds); otherwise a fresh valley each session
const urlSeed = parseInt(new URLSearchParams(location.search).get('seed'), 10);
// phones and small machines get a thinner grass carpet, fewer backdrop trees and a smaller shadow map
const lowEnd = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
const urlQuality = new URLSearchParams(location.search).get('quality');   // ?quality=low|high overrides
const world = new World(scene, Number.isFinite(urlSeed) ? urlSeed >>> 0 : (Math.random() * 0xffffffff) >>> 0, { quality: urlQuality || (lowEnd ? 'low' : 'high') });
const player = new Player(scene, world);
const herd = new Herd(scene, world);
const lasso = new Lasso(scene, world);
const effects = new Effects(scene);
const ui = new UI(wallet);
const minimap = new Minimap();
const input = new Input(canvas);

// ---- floating win tags above cows caught by bot cowboys ----
const floaters = [];
function spawnFloater(worldPos, text, big) {
  const el = document.createElement('div');
  el.className = 'floater' + (big ? ' big' : '');
  el.textContent = text;
  document.getElementById('hud').appendChild(el);
  floaters.push({ el, pos: worldPos.clone().add(new THREE.Vector3(0, 1.7, 0)), age: 0 });
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    f.pos.y += dt * 0.55;
    if (f.age > 2.8) { f.el.remove(); floaters.splice(i, 1); continue; }
    _proj.copy(f.pos).project(camera);
    let x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
    let y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    // only shown while the spot is actually in frame
    const visible = _proj.z < 1 && x > -20 && x < window.innerWidth + 20 && y > -20 && y < window.innerHeight + 20;
    f.el.style.display = visible ? '' : 'none';
    if (visible) {
      // keep the pill fully readable when the catch is near a screen edge
      x = Math.min(Math.max(x, 70), window.innerWidth - 70);
      y = Math.min(Math.max(y, 44), window.innerHeight - 14);
      f.el.style.left = `${x}px`;
      f.el.style.top = `${y}px`;
      f.el.style.opacity = f.age > 2 ? String(1 - (f.age - 2) / 0.8) : '1';
    }
  }
}

// simulated multiplayer: rival cowboys working the same range. Wins show as a
// small name+prize tag above the caught cow (only while it's in frame).
const bots = new Bots(scene, world, (bot, win, mult, cowPos) => {
  const big = mult >= 4;
  spawnFloater(
    cowPos,
    big ? `${bot.name} +${fmt(win)} · ${mult}×!` : `${bot.name} +${fmt(win)}`,
    big
  );
});

let state = 'menu';            // menu | transition | playing
let wrangle = null;            // active bet flow
let transT = 0;
const transFrom = new THREE.Vector3();
const transLook = new THREE.Vector3();

// the camera sits 44° above the horizon at a standstill and eases down toward
// 24° at a gallop (widening a touch), so the horizon, the ridges and the
// valley open up ahead as you ride
const CAM_DIST = 16.1;
const CAM_PITCH_IDLE = 44 * Math.PI / 180, CAM_PITCH_RUN = 24 * Math.PI / 180;
const CAM_FOV_IDLE = 50, CAM_FOV_RUN = 55;
const CAM_OFFSET = new THREE.Vector3(0, Math.sin(CAM_PITCH_IDLE) * CAM_DIST, Math.cos(CAM_PITCH_IDLE) * CAM_DIST);
let camRun = 0;
let menuOffset = false;
const camLook = new THREE.Vector3();

function applyCustomization() {
  player.rig.setColors(0, wallet.custom.shirt);
  lasso.setColor(LASSO_TIERS[wallet.custom.lasso].color);
  ui.refreshBet();
}
applyCustomization();
ui.showMenu();

// ---- the player's cowboy: the picked model in the saddle ----
let dressToken = 0;
async function dressPlayer(rig) {
  const token = ++dressToken;
  const idx = wallet.custom.cowboy;
  try {
    const ct = await loadCowboy(idx);
    if (token !== dressToken || !rig.mountCowboy) return;
    rig.mountCowboy(new SkinnedCowboy(ct, playerOutfit(idx, wallet.custom.outfit)));
  } catch (err) {
    console.warn('cowboy model failed to load, keeping the built-in rider', err);
  }
}

// ---- horse breeds: load the equipped species' model and mount the rider ----
let shownSpecies = null;
let equipToken = 0;
async function showSpecies(id) {
  const species = getSpecies(id);
  const token = ++equipToken;
  player.setMovement(movementParams(speciesStats(species)));
  try {
    const template = await loadHorseType(species.type);
    if (token !== equipToken) return; // superseded by a newer request
    const rig = new SkinnedHorseRider(template, species, wallet.custom.shirt);
    rig.phase = player.rig.phase;
    rig.speedSm = player.rig.speedSm;
    player.setRig(rig);
    shownSpecies = species.id;
    dressPlayer(rig);
  } catch (err) {
    console.warn('horse model failed to load, keeping the built-in horse', err);
  }
}
showSpecies(wallet.custom.horse);

// ---- stable storefront wiring ----
ui.onPreview = (id) => { sfx.click(); showSpecies(id); };
ui.onBuy = (id) => {
  const sp = getSpecies(id);
  if (wallet.custom.owned.includes(id)) return;
  if (!wallet.canBet(sp.price)) { ui.toast('Not enough coins for that horse', 'lose'); return; }
  wallet.take(sp.price);
  wallet.custom.owned.push(id);
  wallet.custom.horse = id;
  wallet.save();
  sfx.win(true);
  sfx.coin();
  ui.refreshBalance();
  ui.previewId = id;
  ui.renderStable();
  ui.refreshHorseName();
  showSpecies(id);
};
ui.onEquip = (id) => {
  if (!wallet.custom.owned.includes(id)) return;
  sfx.click();
  wallet.custom.horse = id;
  wallet.save();
  ui.previewId = id;
  ui.renderStable();
  ui.refreshHorseName();
  showSpecies(id);
};
ui.onStableClose = () => {
  if (shownSpecies !== wallet.custom.horse) showSpecies(wallet.custom.horse);
};

// ---------------------------------------------------------------------------
// UI wiring

ui.onCustomize = (kind, i) => {
  sfx.click();
  if (kind === 'outfit') {
    // i = { part, index }: re-tint the rider in place and refresh the portraits
    wallet.custom.outfit[i.part] = i.index;
    wallet.save();
    const cb = player.rig.cowboy;
    if (cb && cb.setOutfit) cb.setOutfit(playerOutfit(wallet.custom.cowboy, wallet.custom.outfit));
    else dressPlayer(player.rig);
    ui.refreshPortraits();
    return;
  }
  wallet.custom[kind] = i;
  wallet.save();
  applyCustomization();
  if (kind === 'cowboy') { dressPlayer(player.rig); ui.refreshOutfitRows(); }
};

ui.onStart = () => {
  sfx.unlock();
  sfx.click();
  state = 'transition';
  transT = 0;
  transFrom.copy(camera.position);
  transLook.copy(camLook);
  ui.startGame();
};

ui.onMenu = () => {
  if (wrangle) { ui.toast('Finish the wrangle first, partner'); return; }
  sfx.click();
  state = 'menu';
  input.enabled = false;
  lasso.cancelAim();
  ui.showMenu();
};

ui.onBetCycle = (dir = 1) => {
  if (wrangle) return;
  sfx.click();
  const n = LASSO_TIERS.length;
  wallet.custom.lasso = ((wallet.custom.lasso + dir) % n + n) % n;
  wallet.save();
  applyCustomization();
};

input.onAnyPress = () => sfx.unlock();

// ---------------------------------------------------------------------------
// Aiming & throwing. Screen deltas map to the ground plane: the camera looks
// down the -z axis at a fixed azimuth, so screen (dx, dy) → world (dx, dy).

const aimTarget = new THREE.Vector3();
const _hand = new THREE.Vector3();
const ASSIST_RADIUS = 6; // aim assist: throws magnetize to a cow this close to the target point
let assistCow = null;

function aimVectorToTarget(dx, dy) {
  const len = Math.hypot(dx, dy);
  const strength = THREE.MathUtils.clamp((len - 20) / 240, 0.1, 1);
  const dist = 5 + strength * 17;
  const inv = 1 / (len || 1);
  aimTarget.set(
    player.pos.x + dx * inv * dist,
    0,
    player.pos.z + dy * inv * dist
  );
  assistCow = herd.cowNear(aimTarget, ASSIST_RADIUS) || bots.near(aimTarget, ASSIST_RADIUS * 0.75);
  if (assistCow) {
    aimTarget.x = assistCow.pos.x;
    aimTarget.z = assistCow.pos.z;
  }
  const B = RANGE_HALF - 1;
  aimTarget.x = THREE.MathUtils.clamp(aimTarget.x, -B, B);
  aimTarget.z = THREE.MathUtils.clamp(aimTarget.z, -B, B);
  aimTarget.y = world.heightAt(aimTarget.x, aimTarget.z) + 0.15;
  return len;
}

function canThrow() {
  return state === 'playing' && !wrangle && (lasso.state === 'idle' || lasso.state === 'aiming');
}

input.onAim = (dx, dy) => {
  if (!canThrow()) return;
  if (Math.hypot(dx, dy) < 18) { lasso.cancelAim(); return; }
  aimVectorToTarget(dx, dy);
  lasso.aimAt(aimTarget, aimTarget.y - 0.15, !!assistCow);
  document.getElementById('aim-hint').classList.remove('hidden');
};

input.onAimEnd = (dx, dy) => {
  document.getElementById('aim-hint').classList.add('hidden');
  if (!canThrow()) return;
  if (Math.hypot(dx, dy) < 24) { lasso.cancelAim(); return; }
  const bet = LASSO_TIERS[wallet.custom.lasso].bet;
  if (!wallet.canBet(bet)) {
    lasso.cancelAim();
    ui.toast(`Not enough coins for a ${bet}-coin lasso`, 'lose');
    return;
  }
  aimVectorToTarget(dx, dy);
  sfx.whoosh();
  lasso.throwTo(aimTarget, player.rig.handWorldPos(_hand), onLassoLand, assistCow);
};

function onLassoLand(pt) {
  const cow = herd.cowNear(pt, 1.7);
  if (cow) { hook(cow); return; }
  // a rival in the loop? rope him off his horse (just for laughs)
  const bot = bots.near(pt, 1.8);
  if (bot && ropeBot(bot)) return;
  effects.burst(pt, 0xc9b48a, 10, 2, 1.5); // dust poof
}

// The gag: no bet, no payout. He's dragged for a couple of seconds, then let
// go to sulk, dust off and climb back on.
function ropeBot(bot) {
  if (!bot.rope(player.pos, (b, pos, text) => spawnFloater(pos, text, false))) return false;
  sfx.rope();
  lasso.attach(bot.ropeTarget);
  wrangle = { mode: 'joke', cow: null, bot, t: 0, duration: 2.6 };
  ui.toast(`You roped ${bot.name} clean off his horse!`, 'gold');
  return true;
}

// ---------------------------------------------------------------------------
// Bet flows

function hook(cow) {
  sfx.rope();
  sfx.moo();
  cow.state = 'lassoed';
  cow.struggleIntensity = 0.5;
  lasso.attach(cow);
  const bet = LASSO_TIERS[wallet.custom.lasso].bet;

  if (cow.kind === 'offer') {
    wrangle = { mode: 'offer', cow, bet, t: 0, timeout: 8 };
    const offerMult = cow.offerData?.mult ?? (cow.offerData = drawOffer()).mult;
    const el = ui.showPopup(tmpl.offer(offerMult, bet, Math.round(winProbForMultiplier(offerMult) * 100)));
    el.querySelector('#rp-yes').addEventListener('click', () => acceptOffer());
    el.querySelector('#rp-no').addEventListener('click', () => declineOffer());
    return;
  }

  if (cow.kind === 'crash') {
    wallet.take(bet);
    ui.refreshBalance();
    wrangle = { mode: 'crash', cow, bet, t: 0, crashPoint: drawCrashPoint(), cashed: false };
    const el = ui.showPopup(tmpl.crash(fmt(bet)));
    el.querySelector('#rp-cash').addEventListener('click', () => cashOut());
    return;
  }

  // standard & mystery
  wallet.take(bet);
  ui.refreshBalance();
  const outcome = drawOutcome(cow.mult);
  const mystery = cow.kind === 'mystery';
  wrangle = { mode: 'wrangle', cow, bet, outcome, t: 0, mystery };
  const holdPct = Math.round(winProbForMultiplier(cow.mult) * 100);
  ui.showPopup(tmpl.wrangle(
    mystery ? '???' : `${fmt(cow.mult * bet)}`,
    mystery ? 'Mystery cow — hold on!' : `${cow.mult}&times; &middot; ${holdPct}% to hold`
  ));
}

function acceptOffer() {
  if (!wrangle || wrangle.mode !== 'offer') return;
  sfx.click();
  const { cow, bet } = wrangle;
  const mult = cow.offerData.mult;
  if (!wallet.canBet(bet)) { declineOffer(); ui.toast('Not enough coins!', 'lose'); return; }
  wallet.take(bet);
  ui.refreshBalance();
  const outcome = drawOutcome(mult);
  wrangle = { mode: 'wrangle', cow, bet, outcome, t: 0, mystery: false };
  const holdPct = Math.round(winProbForMultiplier(mult) * 100);
  ui.showPopup(tmpl.wrangle(`${fmt(mult * bet)}`, `${mult}&times; &middot; ${holdPct}% to hold`));
}

function declineOffer() {
  if (!wrangle || wrangle.mode !== 'offer') return;
  sfx.click();
  releaseCow(wrangle.cow);
  wrangle = null;
  ui.hidePopup();
  lasso.releaseToIdle();
}

function cashOut() {
  if (!wrangle || wrangle.mode !== 'crash' || wrangle.cashed) return;
  const w = wrangle;
  const mult = Math.min(crashMultAt(w.t), w.crashPoint - 1e-6);
  if (mult <= 0) return;
  w.cashed = true;
  const win = round2(mult * w.bet);
  wallet.give(win);
  ui.refreshBalance();
  sfx.win(mult >= 5);
  sfx.coin();
  effects.burst(w.cow.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xf2b632, 40, 5, 5);
  ui.toast(`Cashed out at ${mult.toFixed(2)}&times; &middot; +${fmt(win)}`, 'win');
  finishWrangle(true);
}

function finishWrangle(captured) {
  const cow = wrangle.cow;
  wrangle = null;
  ui.hidePopup();
  if (captured) {
    herd.remove(cow);
    lasso.releaseToIdle();
  } else {
    releaseCow(cow);
    lasso.snap();
  }
  if (wallet.topUpIfBroke()) {
    ui.refreshBalance();
    ui.toast('Flat broke! The bank staked you some fresh coins', 'gold');
  }
}

function releaseCow(cow) {
  cow.state = 'flee';
  cow.speed = cow.runSpeed * 0.8;
  cow.struggleIntensity = 0;
  cow.offerData = null;
}

function updateWrangle(dt, time) {
  if (!wrangle) return;
  const w = wrangle;
  w.t += dt;

  if (w.mode === 'joke') {
    // drag the roped rival along behind the horse, then let him go
    const g = w.bot.ground;
    if (!g || g.mode !== 'roped') { wrangle = null; lasso.releaseToIdle(); return; }
    g.puller.copy(player.pos);
    const toP = new THREE.Vector3().subVectors(player.pos, g.pos).setY(0);
    const d = toP.length();
    // his body centre trails ~3.6 m back so the caught limb clears the horse
    if (d > 3.6) {
      toP.divideScalar(d);
      g.pos.addScaledVector(toP, Math.min(d - 3.6, 7 * dt));
      // bumping along the ground
      g.pos.x += Math.sin(time * 9) * 0.15 * dt; g.pos.z += Math.cos(time * 7) * 0.15 * dt;
    }
    if (w.t >= w.duration) {
      lasso.snap();
      w.bot.release();
      ui.toast(`Let ${w.bot.name} go. He's not happy about it.`);
      wrangle = null;
    }
    return;
  }

  const cow = w.cow;

  // the hooked cow drags away from the rider; the rider is leashed to it
  const away = new THREE.Vector3().subVectors(cow.pos, player.pos);
  const dist = away.length();
  if (dist > 1e-3) {
    away.divideScalar(dist);
    const drag = w.mode === 'crash' ? 0 : 0.7;
    cow._prev.copy(cow.pos);
    cow.pos.addScaledVector(away, drag * dt);
    // the fence, trees and buildings hold it like any other cow — a roped
    // cow backed against the rails stays inside the pen
    if (world.confine) world.confine(cow.pos, cow._prev, 0.9);
    else {
      const B = RANGE_HALF - 1.6;
      cow.pos.x = THREE.MathUtils.clamp(cow.pos.x, -B, B);
      cow.pos.z = THREE.MathUtils.clamp(cow.pos.z, -B, B);
    }
    if (dist > 14) player.pos.addScaledVector(away, (dist - 14) * 4 * dt);
  }
  cow.heading += Math.sin(time * 3.1 + cow.id) * dt * 1.5;

  if (w.mode === 'wrangle') {
    const T = w.outcome.duration;
    const prog = Math.min(1, w.t / T);
    cow.struggleIntensity = 0.4 + prog * 0.6;
    const bar = document.getElementById('rp-progress');
    if (bar) bar.style.width = `${(w.outcome.win ? prog : prog * 0.85) * 100}%`;
    if (w.t >= T) {
      if (w.outcome.win) {
        const win = round2(w.outcome.mult * w.bet);
        wallet.give(win);
        ui.refreshBalance();
        sfx.win(w.outcome.mult >= 5);
        sfx.coin();
        effects.burst(cow.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xf2b632, 36, 5, 5);
        ui.toast(
          w.mystery
            ? `Mystery revealed: ${w.outcome.mult}&times; &middot; +${fmt(win)}`
            : `Wrangled! ${w.outcome.mult}&times; &middot; +${fmt(win)}`,
          'win'
        );
        finishWrangle(true);
      } else {
        const cons = round2((w.outcome.consMult || 0) * w.bet);
        if (cons > 0) wallet.give(cons);
        ui.refreshBalance();
        sfx.snap();
        effects.burst(cow.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xd96b4a, 16, 3, 2);
        ui.toast(`Rope snapped! +${fmt(cons)} wranglin' time bonus`, 'lose');
        finishWrangle(false);
      }
    }
  } else if (w.mode === 'offer') {
    cow.struggleIntensity = 0.35;
    if (w.t >= w.timeout) declineOffer();
  } else if (w.mode === 'crash') {
    const mult = crashMultAt(w.t);
    cow.struggleIntensity = 1 - Math.exp(-w.t / 4.5); // pure function of time — no tells
    if (mult >= w.crashPoint) {
      sfx.crash();
      effects.burst(cow.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff3311, 30, 6, 3);
      ui.toast(`Bull broke loose at ${w.crashPoint.toFixed(2)}&times;! Bet lost`, 'lose');
      finishWrangle(false);
    } else {
      const val = document.getElementById('rp-crash-val');
      if (val) {
        val.textContent = `${fmt(round2(mult * w.bet))}`;
        val.classList.toggle('hot', cow.struggleIntensity > 0.6);
      }
      if (((w.tickT = (w.tickT || 0) + dt)) > 0.25) { w.tickT = 0; sfx.tick(); }
    }
  }
}

// ---------------------------------------------------------------------------
// Camera

function updateCamera(dt, time) {
  if (state === 'menu') {
    // hero shot: a slow orbit round the rider, framed beside the panel
    // (left of it on a wide screen, above it on a phone)
    const az = time * 0.18;
    camera.position.set(
      player.pos.x + Math.sin(az) * 6.4,
      player.pos.y + 2.1,
      player.pos.z + Math.cos(az) * 6.4
    );
    camLook.set(player.pos.x, player.pos.y + 1.25, player.pos.z);
    camera.lookAt(camLook);
    const w = window.innerWidth, h = window.innerHeight;
    const sheet = w <= 700 || h >= w;
    camera.setViewOffset(w, h, sheet ? 0 : w * 0.28, sheet ? h * 0.2 : 0, w, h);
    menuOffset = true;
    return;
  }
  if (menuOffset) { camera.clearViewOffset(); menuOffset = false; }

  const runK = THREE.MathUtils.clamp((player.speed - 2) / (player.maxSpeed - 2), 0, 1);
  camRun += (runK - camRun) * (1 - Math.exp(-dt * 1.4));
  const pitch = THREE.MathUtils.lerp(CAM_PITCH_IDLE, CAM_PITCH_RUN, camRun);
  const dist = CAM_DIST + camRun * 3;
  CAM_OFFSET.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  const fov = THREE.MathUtils.lerp(CAM_FOV_IDLE, CAM_FOV_RUN, camRun);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const goal = new THREE.Vector3().addVectors(player.pos, CAM_OFFSET);
  const goalLook = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);

  if (state === 'transition') {
    transT += dt;
    const t = Math.min(1, transT / 1.4);
    const e = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transFrom, goal, e);
    camLook.lerpVectors(transLook, goalLook, e);
    camera.lookAt(camLook);
    if (t >= 1) {
      state = 'playing';
      input.enabled = true;
    }
    return;
  }

  const k = 1 - Math.exp(-dt * 5);
  camera.position.lerp(goal, k);
  camLook.lerp(goalLook, k);
  camera.lookAt(camLook);
}

// jump the chase camera straight to its goal (used by the test harness)
function snapCamera() {
  camera.position.addVectors(player.pos, CAM_OFFSET);
  camLook.set(player.pos.x, player.pos.y + 1, player.pos.z);
  camera.lookAt(camLook);
}

// popup floats above the rider (or the crash bull)
const _proj = new THREE.Vector3();
function updatePopupAnchor() {
  if (!ui.popupVisible) return;
  const anchor = wrangle && wrangle.mode === 'crash' ? wrangle.cow.pos : player.pos;
  _proj.set(anchor.x, anchor.y + 2.7, anchor.z).project(camera);
  ui.positionPopup(
    (_proj.x * 0.5 + 0.5) * window.innerWidth,
    (-_proj.y * 0.5 + 0.5) * window.innerHeight,
    true
  );
}

// ---------------------------------------------------------------------------
// Grass brushing: every body moving through the carpet pushes the blades over.
// Velocities are finite-differenced from last frame's positions.

const movers = [];
const lastPos = new Map();
function grassMovers() {
  movers.length = 0;
  const add = (key, pos, r, dt) => {
    const last = lastPos.get(key);
    let vx = 0, vz = 0;
    if (last) { vx = (pos.x - last.x) / dt; vz = (pos.z - last.z) / dt; last.x = pos.x; last.z = pos.z; }
    else lastPos.set(key, { x: pos.x, z: pos.z });
    movers.push({ x: pos.x, z: pos.z, vx, vz, r });
  };
  const dt = Math.max(1e-3, lastDt);
  add(player, player.pos, 1.15, dt);
  for (const b of bots.list) {
    if (Math.abs(b.pos.x - player.pos.x) > 44 || Math.abs(b.pos.z - player.pos.z) > 44) continue;
    add(b, b.pos, 1.15, dt);
    if (b.ground && b.ground.pos) add(b.ground, b.ground.pos, 0.8, dt);
  }
  for (const c of herd.cows) {
    if (c.captured || Math.abs(c.pos.x - player.pos.x) > 44 || Math.abs(c.pos.z - player.pos.z) > 44) continue;
    add(c, c.pos, 0.95, dt);
    if (movers.length > 40) break;
  }
  return movers;
}

// hooves through the shallows throw up spray
let splashT = 0;
const _splash = new THREE.Vector3();
function updateSplashes(dt) {
  if (player.waterDepth > 0.12 && player.speed > 2.5) {
    splashT -= dt;
    if (splashT <= 0) {
      splashT = 0.11 - Math.min(0.06, player.speed * 0.004);
      _splash.set(player.pos.x - Math.sin(player.heading) * 0.6, player.pos.y + player.waterDepth, player.pos.z - Math.cos(player.heading) * 0.6);
      effects.burst(_splash, 0xd8eef5, 4 + Math.round(player.speed * 0.5), 1.6, 2.4 + player.speed * 0.15);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop

const clock = new THREE.Clock();
const moveDir = new THREE.Vector3();
let lastDt = 1 / 60;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  lastDt = dt;
  const time = clock.elapsedTime;

  // movement: screen up = world -z (camera looks along -z from +z offset)
  let strength = 0;
  if (state === 'playing') {
    strength = Math.min(1, Math.hypot(input.move.x, input.move.y));
    if (strength > 0.05) moveDir.set(input.move.x, 0, -input.move.y).normalize();
  }

  player.rig.group.visible = true;
  player.armPose =
    state !== 'playing' ? 'rest'
    : lasso.state === 'flying' ? 'throw'
    : lasso.state === 'attached' ? 'pull'
    : 'spin';
  // the cowboy's arm follows the rope's spin; he watches what he's working
  player.rig.lassoAngle = lasso.spinAngle;
  player.rig.lookTarget = wrangle ? (wrangle.cow ? wrangle.cow.pos : wrangle.bot.ground?.pos ?? null) : (lasso.state === 'aiming' || lasso.state === 'flying') ? aimTarget : null;

  player.update(dt, moveDir, wrangle ? Math.min(strength, 0.6) : strength, time);
  herd.update(dt, player, time, bots.list);
  bots.update(dt, player, herd, effects, time);
  updateWrangle(dt, time);
  lasso.update(dt, player, time);
  updateSplashes(dt);
  effects.update(dt);
  world.update(player.pos, dt, time, grassMovers(), camera.position);
  updateCamera(dt, time);
  updatePopupAnchor();
  updateFloaters(dt);
  if (state !== 'menu') minimap.update(player, herd.cows, bots.list, world);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debug/testing handle
window.__cc = { player, herd, wallet, hook, lasso, input, bots, world, camera, renderer, snapCamera, showSpecies, getState: () => state, getWrangle: () => wrangle, onLassoLand };

// PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

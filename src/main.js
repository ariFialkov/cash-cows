// Cash Cows — main game orchestration: renderer, camera, game states,
// throw/hook logic and the three special-cow bet flows.

import './style.css';
import * as THREE from 'three';
import { World, PEN_HALF } from './world/world.js';
import { Player } from './entities/horse.js';
import { Herd } from './entities/herd.js';
import { Lasso } from './lasso/lasso.js';
import { Effects } from './core/effects.js';
import { sfx } from './core/sfx.js';
import { Input } from './input/input.js';
import { UI, tmpl } from './ui/ui.js';
import { Minimap } from './ui/minimap.js';
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
const world = new World(scene, (Math.random() * 0xffffffff) >>> 0);
const player = new Player(scene, world);
const herd = new Herd(scene, world);
const lasso = new Lasso(scene);
const effects = new Effects(scene);
const ui = new UI(wallet);
const minimap = new Minimap();
const input = new Input(canvas);

let state = 'menu';            // menu | transition | playing
let wrangle = null;            // active bet flow
let transT = 0;
const transFrom = new THREE.Vector3();
const transLook = new THREE.Vector3();

const CAM_OFFSET = new THREE.Vector3(0, 11.2, 11.6); // 44° above horizon
const camLook = new THREE.Vector3();

function applyCustomization() {
  player.rig.setColors(wallet.custom.horse, wallet.custom.cowboy);
  lasso.setColor(LASSO_TIERS[wallet.custom.lasso].color);
  ui.refreshBet();
}
applyCustomization();
ui.showMenu();

// ---------------------------------------------------------------------------
// UI wiring

ui.onCustomize = (kind, i) => {
  sfx.click();
  wallet.custom[kind] = i;
  wallet.save();
  applyCustomization();
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

ui.onBetCycle = () => {
  if (wrangle) return;
  sfx.click();
  wallet.custom.lasso = (wallet.custom.lasso + 1) % LASSO_TIERS.length;
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
  assistCow = herd.cowNear(aimTarget, ASSIST_RADIUS);
  if (assistCow) {
    aimTarget.x = assistCow.pos.x;
    aimTarget.z = assistCow.pos.z;
  }
  const B = PEN_HALF - 1;
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
  if (!cow) {
    effects.burst(pt, 0xc9b48a, 10, 2, 1.5); // dust poof
    return;
  }
  hook(cow);
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
  const cow = w.cow;
  w.t += dt;

  // the hooked cow drags away from the rider; the rider is leashed to it
  const away = new THREE.Vector3().subVectors(cow.pos, player.pos);
  const dist = away.length();
  if (dist > 1e-3) {
    away.divideScalar(dist);
    const drag = w.mode === 'crash' ? 0 : 0.7;
    cow.pos.addScaledVector(away, drag * dt);
    const B = PEN_HALF - 1.6;
    cow.pos.x = THREE.MathUtils.clamp(cow.pos.x, -B, B);
    cow.pos.z = THREE.MathUtils.clamp(cow.pos.z, -B, B);
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
    const az = time * 0.22;
    camera.position.set(
      player.pos.x + Math.sin(az) * 7,
      player.pos.y + 2.4,
      player.pos.z + Math.cos(az) * 7
    );
    camLook.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
    camera.lookAt(camLook);
    return;
  }

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
// Main loop

const clock = new THREE.Clock();
const moveDir = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
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

  player.update(dt, moveDir, wrangle ? Math.min(strength, 0.6) : strength, time);
  herd.update(dt, player, time);
  updateWrangle(dt, time);
  lasso.update(dt, player, time);
  effects.update(dt);
  world.update(player.pos, dt);
  updateCamera(dt, time);
  updatePopupAnchor();
  if (state !== 'menu') minimap.update(player, herd.cows);

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
window.__cc = { player, herd, wallet, hook, lasso, input, getState: () => state, getWrangle: () => wrangle };

// PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

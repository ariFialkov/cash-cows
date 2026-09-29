// DOM overlay: the start screen (cowboy portraits, shirt, horse, lasso tier),
// HUD, toasts, the stable storefront and the popup that floats above the
// rider (wrangle progress / offer deal / crash cash-out).

import { LASSO_TIERS, fmt } from '../game/economy.js';
import { COWBOY_COLORS } from '../entities/horse.js';
import { COWBOYS } from '../entities/cowboyModel.js';
import { HORSE_TYPES, HORSE_SPECIES, RARITY, speciesStats, getSpecies } from '../game/horses.js';
import { cowboyPortrait } from './portraits.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const icon = (id, cls = 'ico') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

export class UI {
  constructor(wallet) {
    this.wallet = wallet;
    this.onStart = null;
    this.onCustomize = null;   // (kind, index)
    this.onBetCycle = null;
    this.onMenu = null;
    this.onPreview = null;     // (speciesId) — stable card selected
    this.onBuy = null;         // (speciesId)
    this.onEquip = null;       // (speciesId)
    this.onStableClose = null;

    this.menuEl = $('menu');
    this.hudEl = $('hud');
    this.popupEl = $('rider-popup');
    this.popupInner = $('rp-inner');
    this.stableEl = $('stable');
    this.stableTab = 'light';
    this.previewId = null;

    this._buildPickers();
    this._buildStable();
    $('start-btn').addEventListener('click', () => this.onStart?.());
    $('bet-pill').addEventListener('click', () => this.onBetCycle?.());
    $('menu-btn').addEventListener('click', () => this.onMenu?.());
    $('stable-btn').addEventListener('click', () => this.openStable());
    $('stable-close').addEventListener('click', () => this.closeStable());
    $('reset-balance-btn').addEventListener('click', () => {
      this.wallet.topUpIfBroke();
      this.refreshBalance();
    });
  }

  // ---- start screen pickers ----
  _select(rowEl, cls, el) {
    rowEl.querySelectorAll('.' + cls).forEach((s) => s.classList.remove('sel'));
    el.classList.add('sel');
  }

  _cowboyCards() {
    const row = $('cowboy-picks');
    row.innerHTML = '';
    const sel = this.wallet.custom.cowboy;
    this._portraits = [];
    COWBOYS.forEach((cb, i) => {
      const el = document.createElement('button');
      el.className = 'cowboy-card' + (i === sel ? ' sel' : '');
      el.title = cb.name;
      el.innerHTML = `<img class="portrait pending" alt="${cb.name}" draggable="false"><span class="cc-name">${cb.name}</span><span class="cc-check">${icon('i-check')}</span>`;
      el.addEventListener('click', () => { this._select(row, 'cowboy-card', el); this.onCustomize?.('cowboy', i); });
      row.appendChild(el);
      this._portraits.push(el.querySelector('.portrait'));
    });
    this.refreshPortraits();
  }

  // (re)render the three portraits in the current shirt colour
  refreshPortraits() {
    const shirt = COWBOY_COLORS[this.wallet.custom.shirt].shirt;
    const token = (this._portraitToken = (this._portraitToken || 0) + 1);
    this._portraits.forEach((img, i) => {
      cowboyPortrait(i, shirt).then((url) => {
        if (token !== this._portraitToken) return;
        img.src = url;
        img.classList.remove('pending');
      }).catch(() => {});
    });
  }

  _shirtSwatches() {
    const row = $('cowboy-swatches');
    row.innerHTML = '';
    COWBOY_COLORS.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'swatch' + (i === this.wallet.custom.shirt ? ' sel' : '');
      el.style.background = `radial-gradient(circle at 35% 30%, rgba(255,255,255,.35), transparent 45%), ${hex(c.shirt)}`;
      el.title = c.name;
      el.addEventListener('click', () => { this._select(row, 'swatch', el); this.onCustomize?.('shirt', i); });
      row.appendChild(el);
    });
  }

  _tierCards() {
    const row = $('lasso-swatches');
    row.innerHTML = '';
    LASSO_TIERS.forEach((t, i) => {
      const el = document.createElement('button');
      el.className = 'tier' + (i === this.wallet.custom.lasso ? ' sel' : '');
      el.style.color = hex(t.color);
      el.title = t.name;
      el.innerHTML = `${icon('i-rope')}<span class="t-bet">${icon('i-coin')}${t.bet}</span><span class="t-name">${t.name}</span>`;
      el.addEventListener('click', () => { this._select(row, 'tier', el); this.onCustomize?.('lasso', i); });
      row.appendChild(el);
    });
  }

  _buildPickers() {
    this._cowboyCards();
    this._shirtSwatches();
    this._tierCards();
    this.refreshHorseName();
  }

  // the horse card on the start screen: name, rarity, coat-coloured mark, stats
  refreshHorseName() {
    const sp = getSpecies(this.wallet.custom.horse);
    const r = RARITY[sp.rarity];
    $('horse-name').textContent = sp.name;
    const rar = $('horse-rarity');
    rar.textContent = r.label;
    rar.style.color = r.color;
    this._coatIcon($('horse-mini-ico'), sp);
    $('horse-mini-stats').innerHTML = this._statBars(speciesStats(sp));
  }

  _coatIcon(svg, sp) {
    svg.style.color = hex(sp.coat.base);
    svg.querySelector('use')?.setAttribute('href', '#i-horse');
    // the mane takes the mane colour: paint it via a CSS variable on the <use>
    svg.style.setProperty('--mane', hex(sp.coat.mane));
  }

  // ---- stable storefront ----
  _buildStable() {
    const tabs = $('stable-tabs');
    tabs.innerHTML = '';
    for (const [key, t] of Object.entries(HORSE_TYPES)) {
      const b = document.createElement('button');
      b.className = 'stable-tab';
      b.textContent = t.name;
      b.dataset.type = key;
      b.addEventListener('click', () => { this.stableTab = key; this.renderStable(); });
      tabs.appendChild(b);
    }
  }

  openStable() {
    this.stableTab = getSpecies(this.wallet.custom.horse).type;
    this.previewId = this.wallet.custom.horse;
    this.menuEl.classList.add('hidden');
    this.stableEl.classList.remove('hidden');
    this.renderStable();
  }

  closeStable() {
    this.stableEl.classList.add('hidden');
    this.menuEl.classList.remove('hidden');
    this.previewId = null;
    this.refreshHorseName();
    this.onStableClose?.();
  }

  get stableOpen() { return !this.stableEl.classList.contains('hidden'); }

  _statBars(stats, cls = 'stat') {
    const row = (label, v) => `<div class="${cls}">${label}<div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div></div>`;
    return row('Speed', stats.speed) + row('Agility', stats.agility) + row('Handling', stats.handling);
  }

  renderStable() {
    const c = this.wallet.custom;
    $('stable-balance-value').textContent = fmt(this.wallet.balance);
    document.querySelectorAll('.stable-tab').forEach((b) => b.classList.toggle('sel', b.dataset.type === this.stableTab));

    const type = HORSE_TYPES[this.stableTab];
    $('stable-type').innerHTML = `<b>${type.name} horses</b> — ${type.blurb}<div class="type-stats">${this._statBars(type.stats)}</div>`;

    const grid = $('stable-grid');
    grid.innerHTML = '';
    for (const sp of HORSE_SPECIES.filter((s) => s.type === this.stableTab)) {
      const owned = c.owned.includes(sp.id);
      const equipped = c.horse === sp.id;
      const stats = speciesStats(sp);
      const r = RARITY[sp.rarity];
      const canAfford = this.wallet.balance >= sp.price;
      const card = document.createElement('div');
      card.className = 'horse-card' + (equipped ? ' equipped' : '') + (this.previewId === sp.id ? ' previewing' : '');
      card.innerHTML = `
        <div class="card-top">
          <svg class="coat-ico" style="color:${hex(sp.coat.base)}"><use href="#i-horse"/></svg>
          <div class="card-name"><b>${sp.name}</b><span class="rarity" style="color:${r.color}">${r.label}</span></div>
          <div class="card-price ${owned ? 'owned' : ''}">${owned ? (equipped ? 'EQUIPPED' : 'OWNED') : `${icon('i-coin')}${fmt(sp.price)}`}</div>
        </div>
        <div class="card-blurb">${sp.blurb}</div>
        <div class="card-stats">${this._statBars(stats)}</div>
        <div class="card-actions">
          ${owned
            ? (equipped ? '<button class="btn-equipped" disabled>Riding this horse</button>' : '<button class="btn-equip">EQUIP</button>')
            : `<button class="btn-buy" ${canAfford ? '' : 'disabled'}>${canAfford ? 'BUY' : 'NOT ENOUGH COINS'}</button>`}
        </div>`;
      card.addEventListener('click', () => {
        if (this.previewId !== sp.id) { this.previewId = sp.id; this.onPreview?.(sp.id); this.renderStable(); }
      });
      card.querySelector('.btn-buy')?.addEventListener('click', (e) => { e.stopPropagation(); this.onBuy?.(sp.id); });
      card.querySelector('.btn-equip')?.addEventListener('click', (e) => { e.stopPropagation(); this.onEquip?.(sp.id); });
      grid.appendChild(card);
    }
  }

  showMenu() {
    this.refreshBalance();
    this.menuEl.classList.remove('hidden', 'fading');
    this.hudEl.classList.add('hidden');
    this.hidePopup();
  }

  startGame() {
    this.menuEl.classList.add('fading');
    setTimeout(() => this.menuEl.classList.add('hidden'), 500);
    this.hudEl.classList.remove('hidden');
    this.refreshBalance();
    this.refreshBet();
  }

  refreshBalance() {
    $('balance-value').textContent = fmt(this.wallet.balance);
    $('menu-balance-value').textContent = fmt(this.wallet.balance);
    $('reset-balance-btn').classList.toggle('hidden', this.wallet.balance >= LASSO_TIERS[0].bet);
  }

  refreshBet() {
    const tier = LASSO_TIERS[this.wallet.custom.lasso];
    $('bet-value').textContent = tier.bet;
    $('bet-rope-swatch').style.color = hex(tier.color);
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.innerHTML = msg;
    $('toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  // ---- rider popup ----
  showPopup(html) {
    this.popupInner.innerHTML = html;
    this.popupEl.classList.remove('hidden');
    return this.popupInner;
  }

  positionPopup(x, y, visible) {
    if (!visible) return;
    const pad = 8;
    const r = this.popupInner.getBoundingClientRect();
    const hw = r.width / 2;
    x = Math.round(Math.min(Math.max(x, hw + pad), window.innerWidth - hw - pad));
    y = Math.round(Math.max(y, r.height + pad + 4));
    // damp writes so buttons stay steady under a slowly-drifting camera
    if (this._px === undefined) { this._px = x; this._py = y; }
    this._px += (x - this._px) * 0.25;
    this._py += (y - this._py) * 0.25;
    const nx = Math.round(this._px), ny = Math.round(this._py);
    if (nx !== this._lx || ny !== this._ly) {
      this._lx = nx; this._ly = ny;
      this.popupEl.style.left = `${nx}px`;
      this.popupEl.style.top = `${ny}px`;
    }
  }

  hidePopup() {
    this.popupEl.classList.add('hidden');
    this.popupInner.innerHTML = '';
  }

  get popupVisible() {
    return !this.popupEl.classList.contains('hidden');
  }
}

// ---- popup templates ----
export const tmpl = {
  wrangle(prizeLabel, sub) {
    return `<div class="rp-title">Wrangling</div>
      <div class="rp-big">${prizeLabel}</div>
      <div class="rp-sub">${sub}</div>
      <div class="rp-bar"><div id="rp-progress"></div></div>`;
  },
  offer(mult, bet, holdPct) {
    return `<div class="rp-title">The Deal</div>
      <div class="rp-big">${mult}&times;</div>
      <div class="rp-sub">Risk ${fmt(bet)} to win ${fmt(mult * bet)} &middot; ${holdPct}% to hold</div>
      <div class="rp-row">
        <button class="rp-yes" id="rp-yes">TAKE IT</button>
        <button class="rp-no" id="rp-no">PASS</button>
      </div>`;
  },
  crash(value) {
    return `<div class="rp-title">He's gettin' mad&hellip;</div>
      <div class="rp-big" id="rp-crash-val">${value}</div>
      <div class="rp-row"><button class="rp-cash" id="rp-cash">CASH OUT</button></div>`;
  },
};

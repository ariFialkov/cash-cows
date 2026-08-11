// DOM overlay: menu customization, HUD, toasts, and the popup that floats
// above the rider (wrangle progress / offer deal / crash cash-out).

import { LASSO_TIERS, fmt } from '../game/economy.js';
import { HORSE_COATS, COWBOY_COLORS } from '../entities/horse.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(wallet) {
    this.wallet = wallet;
    this.onStart = null;
    this.onCustomize = null;   // (kind, index)
    this.onBetCycle = null;
    this.onMenu = null;

    this.menuEl = $('menu');
    this.hudEl = $('hud');
    this.popupEl = $('rider-popup');
    this.popupInner = $('rp-inner');

    this._buildSwatches();
    $('start-btn').addEventListener('click', () => this.onStart?.());
    $('bet-pill').addEventListener('click', () => this.onBetCycle?.());
    $('menu-btn').addEventListener('click', () => this.onMenu?.());
    $('reset-balance-btn').addEventListener('click', () => {
      this.wallet.topUpIfBroke();
      this.refreshBalance();
    });
  }

  _swatchRow(rowEl, items, kind, getColor, selected, withBetTag) {
    rowEl.innerHTML = '';
    items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'swatch' + (i === selected ? ' sel' : '');
      const c = '#' + getColor(item).toString(16).padStart(6, '0');
      el.style.background = `radial-gradient(circle at 35% 30%, #ffffff44, transparent 45%), ${c}`;
      if (withBetTag) {
        const tag = document.createElement('span');
        tag.className = 'bet-tag';
        tag.textContent = item.bet;
        el.appendChild(tag);
      }
      el.title = item.name;
      el.addEventListener('click', () => {
        rowEl.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
        el.classList.add('sel');
        this.onCustomize?.(kind, i);
      });
      rowEl.appendChild(el);
    });
  }

  _buildSwatches() {
    const c = this.wallet.custom;
    this._swatchRow($('cowboy-swatches'), COWBOY_COLORS, 'cowboy', (i) => i.shirt, c.cowboy, false);
    this._swatchRow($('horse-swatches'), HORSE_COATS, 'horse', (i) => i.body, c.horse, false);
    this._swatchRow($('lasso-swatches'), LASSO_TIERS, 'lasso', (i) => i.color, c.lasso, true);
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
    $('bet-rope-swatch').style.borderColor = '#' + tier.color.toString(16).padStart(6, '0');
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

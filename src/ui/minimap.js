// Circular radar minimap: player-centered, north-up (which matches screen-up,
// since the camera azimuth is fixed). Standard cows are cream dots; specials
// are bigger colour-coded dots, and when they're beyond radar range they clamp
// to the rim as direction markers so you can ride toward them.

import { PEN_HALF } from '../world/world.js';

const RANGE = 120;         // metres of world shown from center to rim
const DOT_COLORS = {
  standard: 'rgba(247, 234, 208, 0.85)',
  mystery: '#b58cff',
  offer: '#ffc94d',
  crash: '#ff5031',
};

export class Minimap {
  constructor() {
    this.el = document.getElementById('minimap');
    this.ctx = this.el.getContext('2d');
    this._sizeDirty = true;
    window.addEventListener('resize', () => { this._sizeDirty = true; });
  }

  _resize() {
    this.css = this.el.clientWidth || 138;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.el.width = this.css * dpr;
    this.el.height = this.css * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._sizeDirty = false;
  }

  update(player, cows, bots = []) {
    if (this._sizeDirty) this._resize();
    const ctx = this.ctx;
    const S = this.css;
    const C = S / 2;
    const rim = C - 3;
    const scale = (C - 6) / RANGE;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, rim, 0, Math.PI * 2);
    ctx.clip();

    // ground + fence
    ctx.fillStyle = 'rgba(22, 14, 5, 0.6)';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(190, 150, 95, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      C + (-PEN_HALF - player.pos.x) * scale,
      C + (-PEN_HALF - player.pos.z) * scale,
      PEN_HALF * 2 * scale,
      PEN_HALF * 2 * scale
    );

    // cows (screen-up = world -z, so map x = dx, map y = dz)
    for (const cow of cows) {
      if (cow.captured) continue;
      const dx = cow.pos.x - player.pos.x;
      const dz = cow.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const special = cow.kind !== 'standard';
      if (d <= RANGE) {
        const r = special ? 3.5 : 2;
        ctx.fillStyle = DOT_COLORS[cow.kind];
        ctx.beginPath();
        ctx.arc(C + dx * scale, C + dz * scale, r, 0, Math.PI * 2);
        ctx.fill();
        if (special) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (special) {
        // off-range special: clamp to the rim as a direction marker
        const k = (rim - 5) / d;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = DOT_COLORS[cow.kind];
        ctx.beginPath();
        ctx.arc(C + dx * k, C + dz * k, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // rival cowboys: pale blue dots, clamped to the rim when far
    for (const b of bots) {
      const dx = b.pos.x - player.pos.x;
      const dz = b.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const k = d <= RANGE ? scale : (rim - 5) / d;
      ctx.fillStyle = '#9fdcff';
      ctx.strokeStyle = 'rgba(20,40,60,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(C + dx * k, C + dz * k, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // player arrow (heading 0 = +z = map-down)
    ctx.translate(C, C);
    ctx.rotate(Math.atan2(Math.cos(player.heading), Math.sin(player.heading)));
    ctx.fillStyle = '#ffd968';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6.5, 0);
    ctx.lineTo(-4.5, 4);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-4.5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // rim
    ctx.strokeStyle = 'rgba(122, 82, 48, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(C, C, rim, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Unified input:
//   touch — left-zone drag = virtual joystick, elsewhere swipe = lasso throw
//   desktop — WASD/arrows move, click-drag-release = lasso throw
// Screen aim vectors are handed to the game, which maps them into the world.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };          // -1..1 screen space (y up = forward)
    this.onAim = null;                    // (dx, dy) live drag
    this.onAimEnd = null;                 // (dx, dy) release
    this.onAimCancel = null;
    this.onAnyPress = null;
    this.enabled = false;

    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (this.isTouch) document.body.classList.add('touch-mode');

    this._keys = new Set();
    this._joyId = null;
    this._joyBase = { x: 0, y: 0 };
    this._aimId = null;
    this._aimStart = { x: 0, y: 0 };
    this._mouseAiming = false;

    this._joyBaseEl = document.getElementById('joystick-base');
    this._knobEl = document.getElementById('joystick-knob');

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      this._updateKeys();
      this.onAnyPress?.();
    });
    window.addEventListener('keyup', (e) => { this._keys.delete(e.code); this._updateKeys(); });
    window.addEventListener('blur', () => { this._keys.clear(); this._updateKeys(); });

    const c = this.canvas;
    c.addEventListener('touchstart', (e) => this._touchStart(e), { passive: false });
    c.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
    c.addEventListener('touchend', (e) => this._touchEnd(e), { passive: false });
    c.addEventListener('touchcancel', (e) => this._touchEnd(e), { passive: false });

    c.addEventListener('mousedown', (e) => {
      if (this.isTouch || !this.enabled) return;
      this._mouseAiming = true;
      this._aimStart = { x: e.clientX, y: e.clientY };
      this.onAnyPress?.();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._mouseAiming) return;
      this.onAim?.(e.clientX - this._aimStart.x, e.clientY - this._aimStart.y);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this._mouseAiming) return;
      this._mouseAiming = false;
      this.onAimEnd?.(e.clientX - this._aimStart.x, e.clientY - this._aimStart.y);
    });
  }

  _updateKeys() {
    let x = 0, y = 0;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
    const l = Math.hypot(x, y) || 1;
    this.move.x = x / l * (x || y ? 1 : 0);
    this.move.y = y / l * (x || y ? 1 : 0);
  }

  _inJoyZone(t) {
    return t.clientX < window.innerWidth * 0.46 && t.clientY > window.innerHeight * 0.5;
  }

  _touchStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.onAnyPress?.();
    for (const t of e.changedTouches) {
      if (this._joyId === null && this._inJoyZone(t)) {
        this._joyId = t.identifier;
        this._joyBase = { x: t.clientX, y: t.clientY };
        this._joyBaseEl.style.left = `${t.clientX - this._joyBaseEl.offsetWidth / 2}px`;
        this._joyBaseEl.style.top = `${t.clientY - this._joyBaseEl.offsetHeight / 2}px`;
        this._joyBaseEl.style.bottom = 'auto';
        this._joyBaseEl.style.opacity = '1';
      } else if (this._aimId === null) {
        this._aimId = t.identifier;
        this._aimStart = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _touchMove(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        const R = 52;
        let dx = t.clientX - this._joyBase.x;
        let dy = t.clientY - this._joyBase.y;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        this._knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.move.x = dx / R;
        this.move.y = -dy / R;
      } else if (t.identifier === this._aimId) {
        this.onAim?.(t.clientX - this._aimStart.x, t.clientY - this._aimStart.y);
      }
    }
  }

  _touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this._joyId) {
        this._joyId = null;
        this.move.x = 0; this.move.y = 0;
        this._knobEl.style.transform = 'translate(-50%, -50%)';
        this._joyBaseEl.style.opacity = '0.7';
      } else if (t.identifier === this._aimId) {
        this._aimId = null;
        if (this.enabled) this.onAimEnd?.(t.clientX - this._aimStart.x, t.clientY - this._aimStart.y);
      }
    }
  }
}

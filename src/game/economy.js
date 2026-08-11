// ============================================================================
// Cash Cows economy: every cow — standard or special — pays the same RTP.
//
// RTP = 0.96. For a bet b on a cow with win multiplier M:
//   win  (prob p): payout M*b
//   lose (prob 1-p): the rope snaps at a uniform-random fraction u of the
//     wrangle; consolation "wrangling time bonus" = CONS_MAX * u * b,
//     so E[consolation | lose] = CONS_MAX/2 = CONS_EV.
// p solves  p*M + (1-p)*CONS_EV = RTP  =>  p = (RTP - CONS_EV) / (M - CONS_EV)
//
// Crash bull uses the classic crash-game distribution: crash point C with
// P(C >= x) = RTP / x  (C = RTP/U, U~Uniform(0,1), clamped), so cashing out at
// any x returns x*b with probability RTP/x — EV = RTP*b at every moment.
// ============================================================================

export const RTP = 0.96;
export const CONS_MAX = 0.5;              // max consolation multiplier (full-length hold)
export const CONS_EV = CONS_MAX / 2;

export const LASSO_TIERS = [
  { bet: 5,   color: 0xb98a5a, name: 'Hemp' },
  { bet: 10,  color: 0xcf3b30, name: 'Red Rider' },
  { bet: 25,  color: 0x3f7fd6, name: 'Blue Steel' },
  { bet: 100, color: 0xf2b632, name: 'Gold Rush' },
];

export const START_BALANCE = 1000;

// Standard cow size draw, biased toward smaller (frequent-win) cows.
export function drawStandardSize() {
  return 0.85 + 0.7 * Math.pow(Math.random(), 2);
}

// Standard cow multiplier from its size scale s in [0.85, 1.55].
// Kept low-slung so everyday cows hold often: 1.2x smalls win ~75% of the
// time, and only the true monsters get long odds.
export function multiplierForSize(s) {
  const t = clamp01((s - 0.85) / (1.55 - 0.85));
  const m = 1.2 + Math.pow(t, 1.6) * 6.3; // 1.2x (small, safe) .. 7.5x (huge, risky)
  return round2(m);
}

export function winProbForMultiplier(m) {
  return (RTP - CONS_EV) / (m - CONS_EV);
}

// Wrangle duration scales with prize size — bigger fish, longer fight.
export function wrangleDuration(m) {
  return 2.6 + Math.min(m, 12) * 0.45; // seconds
}

// Resolve a standard/mystery/offer wrangle up-front. The visual struggle just
// plays out this pre-drawn result.
export function drawOutcome(mult) {
  const p = winProbForMultiplier(mult);
  const T = wrangleDuration(mult);
  if (Math.random() < p) {
    return { win: true, duration: T, mult };
  }
  const u = Math.random(); // rope snaps at fraction u of the full fight
  return {
    win: false,
    duration: Math.max(0.35, u * T),
    holdFrac: u,
    consMult: round2(CONS_MAX * u),
    mult,
  };
}

// Mystery cows: hidden multiplier drawn from a spread of tiers.
export function drawMysteryMultiplier() {
  const r = Math.random();
  if (r < 0.50) return round2(1.3 + Math.random() * 1.2);   // 1.3–2.5x
  if (r < 0.85) return round2(2.5 + Math.random() * 2.5);   // 2.5–5x
  if (r < 0.97) return round2(5 + Math.random() * 5);       // 5–10x
  return round2(10 + Math.random() * 10);                   // 10–20x jackpot tail
}

// Offer cows: a take-it-or-leave-it deal, drawn on lasso.
export function drawOffer() {
  const mult = round2(1.6 + Math.random() * 6.4);
  return { mult, p: winProbForMultiplier(mult) };
}

// Crash bull: sample the crash multiplier. P(C >= x) = RTP/x.
export const CRASH_MAX = 50;
export function drawCrashPoint() {
  const u = Math.max(Math.random(), 1e-9);
  return Math.min(CRASH_MAX, RTP / u); // < 1 (4% of draws) = near-instant crash
}
// Multiplier curve over time: exponential climb, ~7s to reach 2x.
export function crashMultAt(t) {
  return Math.exp(t * 0.099);
}

// ---------------- wallet ----------------
const LS_KEY = 'cashcows.v1';

export class Wallet {
  constructor() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { /* ignore */ }
    this.balance = saved && Number.isFinite(saved.balance) ? saved.balance : START_BALANCE;
    this.custom = (saved && saved.custom) || { cowboy: 0, horse: 0, lasso: 1 };
  }
  save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ balance: this.balance, custom: this.custom }));
    } catch (_) { /* private mode */ }
  }
  canBet(amount) { return this.balance >= amount; }
  take(amount) { this.balance = round2(this.balance - amount); this.save(); }
  give(amount) { this.balance = round2(this.balance + amount); this.save(); }
  topUpIfBroke() {
    const minBet = LASSO_TIERS[0].bet;
    if (this.balance < minBet) { this.balance = START_BALANCE; this.save(); return true; }
    return false;
  }
}

export function clamp01(x) { return Math.min(1, Math.max(0, x)); }
export function round2(x) { return Math.round(x * 100) / 100; }
export function fmt(x) {
  return (Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

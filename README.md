# 🤠 Cash Cows

A casual 3D lasso betting game, playable as a PWA on desktop and mobile.
You're a cowboy on horseback in a huge free-range pen. Spin up your lasso,
rope a cow, and hold on — every cow is a bet.

## Quick start

```bash
npm install
npm run dev        # local dev server
npm run build      # production build → dist/ (deploy any static host)
npm run preview    # serve the production build
npm run icons      # regenerate PWA icons (zero-dep PNG writer)
```

The app is a PWA: `manifest.json` + a cache-first service worker make it
installable and playable offline after the first visit.

## Controls

|          | Move                    | Lasso                                   |
| -------- | ----------------------- | --------------------------------------- |
| Mobile   | left-side virtual joystick | swipe anywhere else in the throw direction |
| Desktop  | WASD / arrow keys       | click-drag & release toward a cow       |

Swipe/drag length sets throw distance; a dashed arc and landing ring preview
the throw while aiming.

## The game

- **Lasso = bet size.** Pick your rope in the menu (5 / 10 / 25 / 100 coins) or
  tap the bet pill in-game to cycle. Missed throws cost nothing.
- **Aim assist.** Throws magnetize to a cow near the landing point (the aim
  ring locks on and turns green) and the loop tracks it in flight, so fleeing
  cows are hittable without pixel-perfect swipes.
- **Cow size = risk/reward.** Standard cows vary from 1.15× (small — holds
  ~79% of the time) to 7.5× (huge, likely to snap the rope). 65% of spawns
  are low-risk runts, so the average catch holds ~58% of wrangles. The popup
  shows each cow's multiplier and hold chance. Win the full multiplier, or
  the rope snaps and you get a **wrangling-time bonus** proportional to how
  long you held on.
- **Cows flee** when you ride close. Fundamentals apply: herds bunch up and are
  easier to hit, and cows can be cornered against the fence. The range carries
  ~156 head at a time, with distance culling + animation LOD keeping it cheap.
- **Radar minimap** (top-right): cream dots are standard cows, purple/gold/red
  dots are mystery/offer/crash specials, pale-blue dots are rival cowboys.
  Specials beyond radar range clamp to the rim as direction markers — ride
  toward them to hunt specials.
- **Simulated multiplayer**: five named bot cowboys (Dusty, Big Tex, Maribel,
  Cactus Joe, Sundown) roam the range hunting standard cows with their own
  lassos and bet sizes, drawn from the same odds tables as the player. Wins pop
  a floating +amount over the rider and a feed toast (big multipliers get a
  "lucky herd!" call-out). They leave special cows — and any cow near you —
  alone, and cows flee from whichever rider is closest.
- **Special cows** (all the same average RTP as everything else):
  - 🟣 **Mystery cow** — glowing purple, every one is the same size; the
    multiplier (1.3×–20×) is hidden until the wrangle resolves.
  - 🟡 **Offer cow** — golden; once roped it shows a take-it-or-leave-it deal
    above your rider. Pass and the bet is never placed.
  - ⚫🔴 **Crash bull** — a mini crash game. Once roped, your stake climbs
    exponentially while the bull stomps and gets madder (anger is a pure
    function of time — it never leaks the crash point). Cash out before he
    breaks loose or lose the bet.
- Broke? The bank stakes you fresh coins (balance and customization persist in
  `localStorage`).

## Economy (RTP = 96%)

All math lives in [`src/game/economy.js`](src/game/economy.js), verified by
Monte Carlo (2M draws per cow type ⇒ 0.952–0.962 across every type/strategy):

- For a multiplier `M`, the win probability solves
  `p·M + (1−p)·E[consolation] = RTP`, where the consolation is
  `0.5 · u · bet` and `u ~ U(0,1)` is the fraction of the fight survived
  (so `E[consolation] = 0.25·bet` on a loss).
- The crash bull uses the classic crash distribution `P(C ≥ x) = RTP / x`
  (capped at 50×), making the EV of cashing out `RTP · bet` at every moment.
- Outcomes are drawn up-front from `Math.random()`; the on-screen struggle is
  presentation only.

## Tech notes

- **Three.js, no external assets.** Horse, rider, and cows are procedurally
  built, many-jointed rigs (neck/head/jaw/ears/tails, 3-joint horse legs,
  2-joint cow legs, articulated rider) with code-driven idle/walk/gallop,
  graze, struggle, and stomp cycles. Cow hides are procedural canvas textures.
- **Seeded world gen.** Each session rolls a new seed: rolling value-noise
  terrain, patchy colouring, trees/rocks/bushes, perimeter fence that follows
  the terrain, drifting clouds, and a grass carpet that re-lays itself around
  the player. The pen is a 520 m × 520 m free-range enclosure — big enough to
  feel open, bounded so that cornering cows against the fence stays part of
  the game.
- The rope is a per-frame rebuilt CatmullRom tube: overhead spin at idle, a
  ballistic arc with trailing line on throw, and a taut, jittering line with a
  cinched loop during a wrangle.
- Sound effects are synthesized with WebAudio — no audio files.
- `window.__cc` exposes a small debug handle used by the Playwright smoke
  tests.

## Project layout

```
src/
  main.js              game orchestration: states, throw/hook logic, bet flows, camera
  game/economy.js      RTP model, wallet, bet tiers
  world/world.js       seeded terrain, fence, decor, sky, grass, clouds
  entities/horse.js    horse+rider rig, gaits, player movement
  entities/cow.js      cow rig, variants, flee/herd AI
  entities/herd.js     spawning & population upkeep
  lasso/lasso.js       rope rendering & throw states
  input/input.js       joystick / swipe / WASD / mouse-drag
  ui/ui.js             menu, HUD, toasts, rider popups
  core/                rng & noise, particles, WebAudio sfx
public/                manifest, service worker, icons
tools/make-icons.mjs   dependency-free PNG icon generator
```

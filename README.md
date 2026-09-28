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

- **The Stable (horse storefront).** From the menu, spend winnings on horses
  across five types — **Draft, Gaited, Warmblood, Light, Pony** — each with
  its own movement tendencies (speed / agility / handling) and a signature
  gait. Twenty species span Common → Legendary rarity ($5–$250) with rising
  beauty, price and small stat bonuses (a black Friesian, a leopard-spotted Pony of
  the Americas, a metallic-gold Akhal-Teke…). Selecting a card previews the
  horse live on the menu; buy once, equip any time. Stats drive real handling:
  a Light horse hits 15 m/s but scrubs speed in sharp turns, a Draft is slow
  to get going but rock steady, a Pony turns on a dime.
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

- **Rigged horse breeds.** Five fully rigged quadruped models (27-bone
  skeletons: 4-joint legs, 5-bone tails, ear bones) ship as meshopt-compressed
  GLBs (~120KB each, converted from the FBX sources in `models-src/` by
  `npm run models`). The procedural gait code is unchanged: `animate()` poses
  a set of virtual joints and `SkinnedHorseRider.postPose()` retargets them
  onto the skeleton as deltas over the bind pose. Gaits come from a
  biomechanical engine (`entities/gait.js`): footfall-timed stance/swing
  cycles per limb (4-beat walk, diagonal trot or 4-beat running walk, 4-beat
  transverse gallop with suspension), stride frequency derived from speed so
  hooves plant, anatomically-signed joints (fetlocks sink under load and snap
  at breakover, elbow + carpus fold in swing, stifle + hock flex
  reciprocally), footfall-locked body bob/pitch/spine flex and head nod, a
  spring-simulated tail chain, ear flicks, idle breathing and a cocked hind
  leg — all cross-faded through a shared phase so walk→trot→gallop re-times
  the legs smoothly. Per-type profiles set cadence, stride, suspension, knee
  action and head/tail carriage. Four of the five source rigs have no front
  knee (forearm and cannon share one bone), so `horseModel.js` inserts a
  carpus bone between elbow and fetlock at load time and re-skins the
  forearm/cannon vertices onto it, so the lifted foreleg folds like a
  competition trot: forearm up, cannon hanging vertical, hoof pointing down.
  The single neck+head bone is likewise split with a skull bone at the poll,
  so at a full gallop the neck drops and pumps while the nose reaches out
  (per-type `stretch` sets how flat-out each breed gets). `tools/gait-viewer.html` renders one stride
  as a side-view filmstrip for tuning. Coats are painted into vertex
  colours from bind-pose position + bone weights — points, socks, blazes,
  dapples, pinto patches, leopard spots, roan, dorsal stripes, mane/tail and
  saddle leather — so no texture is required (a hide texture can be layered
  in later via the preserved UVs).
- **Rigged cattle.** Cows and bulls are two rigged models (`cow.glb`,
  `bull.glb`, same skeleton naming as the horses) driven by the same gait
  engine with a bovine profile: shorter flatter strides, a low level head,
  little knee action, a stiff back and a rocking gallop where the hind feet
  land almost together. On top of the gaits: grazing (neck and poll drop to
  the grass, chewing), the lassoed struggle (head shaking, legs bracing and
  stamping) and the Crash Bull's stomp (head down, horns tossing, a fore hoof
  pawing). Hides are painted into vertex colours — Holstein patches (with
  mostly-white and mostly-black variants), brown and Hereford white-face,
  black Angus, plus the glowing mystery / offer / crash looks — and the
  painted hides are shared between cows of the same look, with vertex buffers
  shared with the template, so a 156-head herd costs one skinned draw per cow.
  The loader also fixes a rig quirk: the cow's belly was skinned to its head
  bone, so those vertices are handed back to the chest and pelvis by position.
- **Rigged cowboys.** Three rigged humanoid models (`cowboy1..3.glb`:
  Ranger, Drifter in a duster, Wrangler in chaps) ride the skinned horses.
  The menu picks the player's model; every rival is a random model in a
  random outfit. Outfits are painted into vertex colours by region (hat,
  hair, face, hands, shirt, coat, pants, boots, belt, scarf) from a palette
  of skin tones, hair and clothing colours. The riding pose is composed from
  world-axis limb rotations over the T-pose (legs astride, reins hand, lasso
  arm for rest / spin / throw / pull, curled fingers) and driven by the same
  torso lean, posting and jump two-point as the built-in rider, which keeps
  being posed invisibly underneath.
- **Three.js, no external assets** for everything else. The built-in rider
  is a procedurally built, articulated rig used until the cowboy model loads.
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
  main.js              game orchestration: states, throw/hook logic, bet flows, camera, stable
  game/economy.js      RTP model, wallet, bet tiers
  game/horses.js       horse types, species catalogue, stats & gait profiles
  world/world.js       seeded terrain, fence, decor, sky, grass, clouds
  entities/horse.js    procedural rider + virtual horse joints, gaits, jumps, player movement
  entities/horseModel.js  GLB breed loader, coat painter, skeleton retargeting
  entities/cow.js      cow entity, variants, flee/herd AI (+ placeholder rig)
  entities/cowModel.js rigged cattle: bovine gait profile, hides, graze/struggle/stomp
  entities/cowboyModel.js rigged cowboys: outfit painter, riding pose, lasso arm poses
  entities/herd.js     spawning & population upkeep
  entities/bots.js     rival cowboys (simulated multiplayer)
  lasso/lasso.js       verlet rope + dynamic loop
  input/input.js       joystick / swipe / WASD / mouse-drag
  ui/ui.js             menu, stable storefront, HUD, toasts, rider popups
  ui/minimap.js        radar minimap
  core/                rng & noise, loft geometry, particles, WebAudio sfx
public/models/         compressed horse, cattle + cowboy GLBs (built from models-src/*.fbx)
tools/                 model pipeline (FBX → GLB), rig inspector, gait/cow filmstrip viewers, icon generator
```

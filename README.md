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
  use the arrows on the bet chip in-game. Missed throws cost nothing.
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
- **Rope a rival** (just for laughs, no bet, no payout): land the loop on a
  bot cowboy and he comes off his horse and gets dragged along behind you for
  a couple of seconds by one limb: the loop cinches round a random wrist or
  ankle and that limb leads, the rest of him trailing and flailing like a
  ragdoll (the faster you drag, the more he flails, with tension jerks and
  kicks). Let go and he sits up and throws
  a tantrum, steam coming out of his ears, then gets up, dusts himself off
  and jogs back to his horse, which walks over to meet him halfway; he hops
  on and carries on as if nothing happened. Every phase blends into the next
  and a floor clamp keeps him above the turf throughout. Aim assist will
  pick a rival when no cow is closer.
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
  of skin tones, hair and clothing colours. The rider is not glued to the
  saddle: spring-damper states for seat compression, torso pitch and roll
  integrate the saddle's vertical, fore-aft and lateral accelerations each
  frame, so landings press him into the seat, acceleration rocks him back,
  braking and the horse's pitch tip him forward and turns lean him in. Lean
  is spread up the spine with the head counter-rotating to keep the gaze
  level, the pelvis and shoulders counter-yaw with the stride, the legs
  absorb the bob and brace on a pull, and he breathes at rest. Arm work is
  layered on top with per-bone slerp smoothing: the spin arm circles with
  the loop's actual spin angle while the torso counter-turns and he watches
  the loop; the throw whips the arm over the top and forward toward the
  target with a torso twist, then follows through; the pull braces him back
  with the arm reaching to the rope and rhythmic tugs; the reins hand follows
  the horse's head. He looks at the cow he is working and into turns.
- **Textured cowboys with recolourable garments.** Each cowboy model wears
  its own painted texture set (1024² albedo + normal, 512² roughness, WebP,
  `public/models/tex/`), so faces and clothes are real. On top, every
  garment (hat, shirt, bandana, pants, boots, and the Drifter's coat) can
  keep its painted look or take a palette colour: the mesh is classified
  into regions by bone weights, refined by the texture's own colours (each
  vertex takes the nearest of its bone group's candidate regions by albedo),
  and the shader re-tints a region by luminance against the region's mean,
  so shading, seams and folds survive the recolour. Rivals roll a random
  mix of painted and recoloured garments.
- **Three.js, no external assets** for everything else. The built-in rider
  is a procedurally built, articulated rig used until the cowboy model loads.
- **Seeded world gen: a mountain valley.** Each session rolls a new seed
  (`?seed=N` pins one) and builds a 1.5 km square heightmap at 2 m texels: a
  valley running north–south with a river winding down its floor through
  water gaps in the end ridges, creeks that run from springs in the side
  hollows down to the river (never climbing, never below their outlet, each
  cutting its own small hollow), rolling foothills and broad swells, wooded
  slopes with clearings, grassy balds on the high tops, rock on the steep
  faces and layered ridges walling the horizon in blue haze. The ranch pen
  (340 m square, fence following the ground, two gates standing open, a red
  barn) sits on the valley floor; dirt trails lead out of the gates to a
  wooden bridge over the river and up to a lookout with a lone big tree.
  Riders and cattle roam a 1.1 km range around it. Terrain is rendered on the
  GPU from the height texture — a fine 1.25 m disc and a 3 m mid disc that
  follow the rider, displacing flat grids with the same bilinear fetch the
  CPU uses for hooves, so ground contact is exact, over a static 8 m far
  mesh whose vertices drop to the lowest ground in their footprint wherever
  water lies within it, so the coarse triangles never cut up through a
  river — coloured from a
  painted map (meadow, forest floor, bald, rock, sand, dirt) with a detail
  noise tile. Water is a ribbon per river/creek with rippled normals, fresnel
  and sun glint. The fence is a real obstacle (open at the gates), tree
  trunks and the barn push bodies out, cattle steer along the rails, take
  the open gate when fleeing, and won't walk into deep water; horses wade
  (slower, with spray) or take the bridge. Rival cowboys route through the
  nearest gate when their target is across the fence. Canopies between the
  camera and the rider dissolve with a screen-door dither so the woods never
  hide the horse. The chase camera eases down from 44° to 24° above the
  horizon as the horse gallops, opening up the ridges and the valley ahead.
- **Long grass with brushing physics.** Sparse tufts of tall tapered,
  curving blades (most bare, some with seed heads) are hashed into 5–7 m
  cells out to 90 m around the rider (toroidally addressed so tufts keep
  their state as the window slides); they sway in the wind on the GPU and
  fade at the edge. Every tuft carries a spring: any body moving through
  (player, rivals, cattle, a dragged cowboy) pushes the blades over
  radially and along its motion — the tips arc down as they go over — and
  an under-damped spring wobbles them back upright over a couple of swings.
  The grass only reacts — nothing pushes back on the horse.
- **Hills cost pace.** Riders and cattle read the ground grade along their
  heading each frame (smoothed): ground speed projects onto the horizontal,
  a climb slows them (a 1-in-4 grade runs at ~55%) and a descent gives a
  controlled bit back (~120% at most), with the gait cadence following the
  actual pace.
- The rope is a per-frame rebuilt CatmullRom tube (80 segments, 8 sides)
  over a 26-particle verlet rope with bending constraints, so it curves
  instead of kinking, and the particles are kept out of the animals by three
  capsule colliders per body (torso, neck, head; radii measured once from each
  model's mesh, endpoints riding the bones) for both the roped cow and the
  rider's horse: overhead spin at idle (the spoke stays near straight — 1%
  slack, fine segments, the spin's outward acceleration on every particle and
  a rigid drag toward the hand–honda line so the whirling knot never trails
  a bight), a coil hanging beside the rider's leg whenever the arm is down
  (start screen, ride-out sweep), a ballistic arc with trailing line on
  throw, and a taut, sagging line with a cinched loop during a wrangle. On a
  catch the loop cinches: it closes from its landing size down
  onto the neck in a third of a second, seated on a ring the cow rig measures
  from its own model (neck axis between throat and poll, girth from the mesh's
  half-width there) so it sits perpendicular to the neck and fits every size
  of cow and bull. The loop is a 28-point ring deformed by centrifugal lag, gravity
  sag on the side away from the spoke and noise-driven flutter sampled on a
  circle, with a torus-knot honda. Ropes wear a procedural three-strand
  twisted texture (colour + bump, one lay per 12 cm of rope, UVs rescaled per
  frame); the lasso tier shows as a coloured tracer strand and a faint tint
  rather than a solid colour.
- **UI.** Dark tooled leather, brass and cream: a frosted leather panel with
  saddle stitching, a western display face (Rye) over Nunito (system fonts
  offline), inline SVG icon sprites (coin, rope, hat, horseshoe, cow, horse
  head coloured by coat) and procedural SVG grain. The start screen is a
  full layout: the live rider orbits beside the panel (above it on phones),
  the cowboy picker shows real portraits rendered from the three models in
  the chosen shirt (`ui/portraits.js`, an offscreen renderer, cached per
  shirt), lasso tiers are cards, and the horse card carries rarity and
  stats. The panel is laid out to fit without scrolling (cowboys beside the
  outfit rows on wide screens, a one-row horse card) and the lasso tiers sit
  in the fixed footer next to the ride-out button so the bet is never
  scrolled out of view. The HUD is glass chips with a leather-bezelled
  radar; the bet chip carries arrow buttons that step the tier down and up.
- **Cattle colliders.** Cows near the player are hashed into 4 m cells each
  frame and pushed apart pairwise (a roped cow mostly holds its ground), and
  out of every horse; only the cow moves, so riders never feel a bump. A
  roped cow dragged during a wrangle goes through the same fence/tree/barn
  confinement as a free one, so it can't be pulled through the rails.
- Sound effects are synthesized with WebAudio — no audio files.
- `window.__cc` exposes a small debug handle used by the Playwright smoke
  tests.

## Project layout

```
src/
  main.js              game orchestration: states, throw/hook logic, bet flows, camera, stable
  game/economy.js      RTP model, wallet, bet tiers
  game/horses.js       horse types, species catalogue, stats & gait profiles
  world/world.js       the range: sky, fence & gates, barn, bridge, woods, collision, spawn sampling
  world/terrain.js     heightmap generation (valley, river, creeks, trails), GPU terrain, water
  world/grass.js       blade tufts, wind, brushing springs
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

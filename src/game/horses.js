// Horse catalogue: five types with shared movement tendencies and gait
// signatures, and species within each type varying in rarity, beauty
// (coat patterns), value and small stat bonuses.
//
// Stats are 0..1 tendencies that Player/Bot movement maps to real numbers:
//   speed    -> max gallop speed
//   agility  -> turn rate
//   handling -> acceleration/braking and how much a sharp turn scrubs speed
//
// Gait profiles nudge the shared animation code so each type moves in its
// own recognisable way (all values are multipliers of / offsets to the base
// gait; 1 and 0 mean "as the base animation").

// Gait profiles feed the biomechanical gait engine (entities/gait.js):
//   midGait       'trot' or 'runwalk' (gaited breeds' smooth 4-beat)
//   midMin/gallopMin  speeds (m/s) where the mid gait / gallop take over
//   strideScale, freqScale   stride length & cadence
//   bobScale, suspension, pitchScale   how much the body rises and rocks
//   kneeLift, hockLift   fore/hind leg fold height in swing ("knee action")
//   neckCarriage (rad, + = lower/forward), headNod, tailCarriage

export const HORSE_TYPES = {
  draft: {
    name: 'Draft',
    model: 'draft',
    height: 2.05, // metres to the ear tips at scale 1
    blurb: 'Big, calm and powerful. Slow to get going and slow to turn, but nothing unsettles a draft — rock-steady handling.',
    stats: { speed: 0.42, agility: 0.32, handling: 0.95 },
    gait: { midGait: 'trot', midMin: 2.8, gallopMin: 7.8, strideScale: 1.08, freqScale: 0.9, bobScale: 1.3, suspension: 0.9, pitchScale: 1.1, kneeLift: 1.35, hockLift: 1.2, neckCarriage: -0.05, headNod: 1.3, tailCarriage: -0.1 },
  },
  gaited: {
    name: 'Gaited',
    model: 'gaited',
    height: 1.8,
    blurb: 'Bred for a smooth four-beat running walk. Quick, busy legs with almost no bounce, head carried high and proud.',
    stats: { speed: 0.6, agility: 0.62, handling: 0.82 },
    gait: { midGait: 'runwalk', midMin: 2.2, gallopMin: 7.6, strideScale: 0.92, freqScale: 1.2, bobScale: 0.35, suspension: 0.5, pitchScale: 0.5, kneeLift: 1.4, hockLift: 1.3, neckCarriage: -0.2, headNod: 1.4, tailCarriage: 0.1 },
  },
  warmblood: {
    name: 'Warmblood',
    model: 'warmblood',
    height: 1.95,
    blurb: 'The sport horse. Long floating strides with real suspension, balanced and athletic — the all-rounder.',
    stats: { speed: 0.76, agility: 0.7, handling: 0.74 },
    gait: { midGait: 'trot', midMin: 2.6, gallopMin: 7.2, strideScale: 1.12, freqScale: 0.95, bobScale: 1.15, suspension: 1.3, pitchScale: 1.0, kneeLift: 1.0, hockLift: 1.05, neckCarriage: -0.02, headNod: 1.0, tailCarriage: 0.02 },
  },
  light: {
    name: 'Light',
    model: 'light',
    height: 1.85,
    blurb: 'Hot-blooded speed horses. Fastest on the range and quick on their feet, but they get away from you in a hurry.',
    stats: { speed: 1.0, agility: 0.86, handling: 0.5 },
    gait: { midGait: 'trot', midMin: 2.6, gallopMin: 6.8, strideScale: 1.15, freqScale: 1.05, bobScale: 0.85, suspension: 1.0, pitchScale: 0.9, kneeLift: 0.8, hockLift: 0.9, neckCarriage: 0.06, headNod: 0.8, tailCarriage: 0.3 },
  },
  pony: {
    name: 'Pony',
    model: 'pony',
    height: 1.45,
    blurb: 'Small, nimble and cheeky. Short choppy strides and the tightest turning circle out here.',
    stats: { speed: 0.5, agility: 1.0, handling: 0.68 },
    gait: { midGait: 'trot', midMin: 2.3, gallopMin: 6.5, strideScale: 0.78, freqScale: 1.35, bobScale: 0.7, suspension: 0.8, pitchScale: 0.8, kneeLift: 1.05, hockLift: 1.0, neckCarriage: 0, headNod: 1.1, tailCarriage: 0 },
  },
};

export const RARITY = {
  common:    { label: 'Common',    color: '#b9b1a4', bonus: 0.0 },
  uncommon:  { label: 'Uncommon',  color: '#7ed072', bonus: 0.04 },
  rare:      { label: 'Rare',      color: '#5fb0ff', bonus: 0.08 },
  epic:      { label: 'Epic',      color: '#c48cff', bonus: 0.12 },
  legendary: { label: 'Legendary', color: '#ffc94d', bonus: 0.16 },
};

// coat: base body colour, mane/tail colour, optional points (legs/muzzle
// darkening), socks (which legs are white: 'none' | 'all' | [FL,FR,HL,HR]),
// blaze (face marking), pattern ('solid' | 'dapple' | 'pinto' | 'leopard' |
// 'roan' | 'dun' | 'sheen'), and an optional metallic sheen.
export const HORSE_SPECIES = [
  // ---------------- draft ----------------
  { id: 'belgian', type: 'draft', name: 'Belgian', rarity: 'common', price: 12,
    blurb: 'Chestnut with a flaxen mane — the classic farm horse.',
    coat: { base: 0xa8623a, mane: 0xe8d6b0, socks: 'all', blaze: true, pattern: 'solid' } },
  { id: 'clydesdale', type: 'draft', name: 'Clydesdale', rarity: 'uncommon', price: 40,
    blurb: 'Bay with a bold blaze and feathered white legs.',
    coat: { base: 0x6b4025, mane: 0x1e140d, points: 0x2a1c12, socks: 'all', blaze: true, pattern: 'solid' } },
  { id: 'percheron', type: 'draft', name: 'Percheron', rarity: 'rare', price: 110,
    blurb: 'Dapple grey and elegant for a heavy horse.',
    coat: { base: 0xa9a5a0, mane: 0x3a3634, socks: 'none', blaze: false, pattern: 'dapple' } },
  { id: 'shire', type: 'draft', name: 'Shire', rarity: 'epic', price: 190,
    blurb: 'The tallest horse in the world: jet black with white feathers.',
    coat: { base: 0x1c1a1b, mane: 0x0d0c0d, socks: 'all', blaze: true, pattern: 'solid' } },

  // ---------------- gaited ----------------
  { id: 'walker', type: 'gaited', name: 'Tennessee Walker', rarity: 'common', price: 10,
    blurb: 'Smooth running walk, plain bay, all business.',
    coat: { base: 0x7a4a2a, mane: 0x241812, points: 0x2a1c12, socks: [false, true, false, true], blaze: false, pattern: 'solid' } },
  { id: 'foxtrotter', type: 'gaited', name: 'Fox Trotter', rarity: 'uncommon', price: 35,
    blurb: 'Sorrel with a star, a sure-footed trail horse.',
    coat: { base: 0xb0623a, mane: 0x8a4a2a, socks: [true, false, false, true], blaze: true, pattern: 'solid' } },
  { id: 'icelandic', type: 'gaited', name: 'Icelandic', rarity: 'rare', price: 100,
    blurb: 'Dun with a dorsal stripe and a huge shaggy mane.',
    coat: { base: 0xc9a870, mane: 0x2b2118, points: 0x4a3a28, socks: 'none', blaze: false, pattern: 'dun' } },
  { id: 'paso', type: 'gaited', name: 'Paso Fino', rarity: 'epic', price: 180,
    blurb: 'Palomino gold with a white mane — pure showmanship.',
    coat: { base: 0xd9a24a, mane: 0xf6ecd4, socks: 'all', blaze: true, pattern: 'sheen' } },

  // ---------------- warmblood ----------------
  { id: 'hanoverian', type: 'warmblood', name: 'Hanoverian', rarity: 'common', price: 15,
    blurb: 'Bay sport horse, the dependable all-rounder.',
    coat: { base: 0x6a3f24, mane: 0x1e140d, points: 0x2a1c12, socks: [false, false, true, true], blaze: true, pattern: 'solid' } },
  { id: 'dutch', type: 'warmblood', name: 'Dutch Warmblood', rarity: 'uncommon', price: 45,
    blurb: 'Dark bay with four white socks and a blaze.',
    coat: { base: 0x4e3020, mane: 0x1a1210, points: 0x201610, socks: 'all', blaze: true, pattern: 'solid' } },
  { id: 'holsteiner', type: 'warmblood', name: 'Holsteiner', rarity: 'rare', price: 120,
    blurb: 'Steel grey with dapples, a jumping dynasty.',
    coat: { base: 0x8e8b8a, mane: 0x2e2c2c, socks: 'none', blaze: false, pattern: 'dapple' } },
  { id: 'friesian', type: 'warmblood', name: 'Friesian', rarity: 'legendary', price: 250,
    blurb: 'Coal black, flowing mane, the most beautiful horse on the range.',
    coat: { base: 0x141214, mane: 0x070607, socks: 'none', blaze: false, pattern: 'sheen' } },

  // ---------------- light ----------------
  { id: 'quarter', type: 'light', name: 'Quarter Horse', rarity: 'common', price: 0,
    blurb: 'Your first horse. Sorrel, quick off the mark, born for cattle work.',
    coat: { base: 0xa85a34, mane: 0x8a4526, socks: [false, false, true, false], blaze: true, pattern: 'solid' } },
  { id: 'mustang', type: 'light', name: 'Mustang', rarity: 'uncommon', price: 30,
    blurb: 'Wild-caught paint, brown and white patches.',
    coat: { base: 0x6d4428, mane: 0x2a1c12, socks: 'all', blaze: true, pattern: 'pinto' } },
  { id: 'thoroughbred', type: 'light', name: 'Thoroughbred', rarity: 'rare', price: 130,
    blurb: 'Racing bloodlines: bay, lean and blisteringly fast.',
    coat: { base: 0x5c3a22, mane: 0x1a1210, points: 0x201610, socks: [false, true, false, false], blaze: false, pattern: 'solid' } },
  { id: 'arabian', type: 'light', name: 'Arabian', rarity: 'epic', price: 200,
    blurb: 'Flea-bitten grey, dished face, tail held high.',
    coat: { base: 0xe6e1d8, mane: 0xc9c2b6, socks: 'none', blaze: false, pattern: 'roan' } },
  { id: 'akhalteke', type: 'light', name: 'Akhal-Teke', rarity: 'legendary', price: 250,
    blurb: 'A golden coat with a metallic shine — the horses of kings.',
    coat: { base: 0xd6a84c, mane: 0x8a6a2c, socks: 'none', blaze: false, pattern: 'sheen', metal: true } },

  // ---------------- pony ----------------
  { id: 'shetland', type: 'pony', name: 'Shetland', rarity: 'common', price: 5,
    blurb: 'Tiny, shaggy, chestnut and stubborn.',
    coat: { base: 0x9a5a34, mane: 0x6a3a1e, socks: 'none', blaze: false, pattern: 'solid' } },
  { id: 'welsh', type: 'pony', name: 'Welsh Pony', rarity: 'uncommon', price: 25,
    blurb: 'Pretty grey pony with a bright eye.',
    coat: { base: 0xd5d0c8, mane: 0xb9b2a8, socks: 'none', blaze: false, pattern: 'dapple' } },
  { id: 'fjord', type: 'pony', name: 'Fjord', rarity: 'rare', price: 90,
    blurb: 'Norwegian dun with a two-tone standing mane and dorsal stripe.',
    coat: { base: 0xc8a66c, mane: 0xe9dcbf, points: 0x5a4630, socks: 'none', blaze: false, pattern: 'dun' } },
  { id: 'poa', type: 'pony', name: 'Pony of the Americas', rarity: 'epic', price: 160,
    blurb: 'Leopard-spotted like an Appaloosa, and just as flashy.',
    coat: { base: 0xf1ede6, mane: 0x3a3230, spot: 0x3a3230, socks: 'none', blaze: false, pattern: 'leopard' } },
];

export const STARTER_SPECIES = 'quarter';

export function getSpecies(id) {
  return HORSE_SPECIES.find((s) => s.id === id) || HORSE_SPECIES.find((s) => s.id === STARTER_SPECIES);
}

// species stats = type tendencies + rarity bonus (capped at 1)
export function speciesStats(species) {
  const t = HORSE_TYPES[species.type].stats;
  const b = RARITY[species.rarity].bonus;
  return {
    speed: Math.min(1, t.speed + b),
    agility: Math.min(1, t.agility + b),
    handling: Math.min(1, t.handling + b),
  };
}

// map 0..1 tendencies to the movement numbers the physics uses
export function movementParams(stats) {
  return {
    maxSpeed: 10 + stats.speed * 5,          // 10 .. 15 m/s
    turnSpeed: 2.6 + stats.agility * 1.8,     // rad/s at low speed
    accel: 10 + stats.handling * 9,
    decel: 9 + stats.handling * 8,
    alignFloor: 0.15 + stats.handling * 0.2,  // how much a sharp turn scrubs speed
  };
}

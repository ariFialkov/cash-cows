// Procedural twisted-rope textures: a three-strand lay with rounded strands,
// dark grooves between them, fibre streaks along the twist and a coloured
// "tracer" strand in the lasso tier's colour. Returns a colour map and a
// matching bump map; the tube's U axis runs along the rope so one texture
// repeat is one full twist of the lay.

import * as THREE from 'three';

const cache = new Map();
const W = 256, H = 64;

function fibre(x, y, seed) {
  // cheap streaky noise running with the strand direction
  const s = Math.sin(x * 0.55 + y * 1.7 + seed) * 0.5 + Math.sin(x * 1.3 - y * 0.9 + seed * 1.7) * 0.3 + Math.sin(x * 3.1 + y * 4.3 + seed * 0.4) * 0.2;
  return s * 0.5 + 0.5;
}

export function ropeTextures(tierHex) {
  if (cache.has(tierHex)) return cache.get(tierHex);
  const tier = new THREE.Color(tierHex);
  const natural = new THREE.Color(0xb9945f);
  // tint the whole rope a little toward the tier colour; the tracer strand
  // carries the full colour
  const base = natural.clone().lerp(tier, 0.1);
  const dark = base.clone().multiplyScalar(0.55);
  const tracer = natural.clone().lerp(tier, 0.9);

  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
  const cg = cc.getContext('2d'), bg = bc.getContext('2d');
  const ci = cg.createImageData(W, H), bi = bg.createImageData(W, H);
  const c = new THREE.Color();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      // three strands laid at a right-hand twist: strand phase advances
      // around the rope and along it (one full lay per texture repeat)
      const ph = ((v * 3 + u) % 1 + 1) % 1;             // 0..1 across one strand
      const round = Math.sin(ph * Math.PI);              // rounded strand profile
      const groove = Math.pow(1 - round, 3);             // dark valley between strands
      const strand = Math.floor(((v * 3 + u) % 3 + 3) % 3); // which of the three
      const f = fibre(x * 0.35 + y * 0.6, y * 0.4 - x * 0.12, strand * 2.1);
      c.copy(strand === 1 ? tracer : base);
      c.lerp(dark, groove * 0.85);
      c.offsetHSL(0, 0, (f - 0.5) * 0.12 + round * 0.06);
      const i = (y * W + x) * 4;
      ci.data[i] = c.r * 255; ci.data[i + 1] = c.g * 255; ci.data[i + 2] = c.b * 255; ci.data[i + 3] = 255;
      const hgt = (round * 0.8 + (f - 0.5) * 0.15) * 255;
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = hgt; bi.data[i + 3] = 255;
    }
  }
  cg.putImageData(ci, 0, 0);
  bg.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 4;
  const out = { map, bump };
  cache.set(tierHex, out);
  return out;
}

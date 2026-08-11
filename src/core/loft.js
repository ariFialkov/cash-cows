// Loft geometry: sweep elliptical cross-sections along an axis to sculpt
// smooth organic bodies (torsos, necks, heads, limbs) without model files.
// Each section: { z, rx, ry?, ryT?, ryB?, y? }
//   z    — position along the sweep axis
//   rx   — half-width (side to side)
//   ryT  — vertical radius above the section center (back/withers line)
//   ryB  — vertical radius below (belly/jaw line); ry sets both
//   y    — vertical offset of the section center (spine curve)
// Indexed + computeVertexNormals => smooth shading; u wraps the girth,
// v runs nose-to-tail so canvas hide textures map naturally.

import * as THREE from 'three';

// opts: { thetaStart, thetaLength, caps, inflate }
//   thetaStart/Length — sweep a partial arc instead of the full ring, giving a
//     contour-hugging shell (blazes, dorsal stripes) when laid over a body
//     loft built from the same sections with a small `inflate`.
export function loft(sections, radial = 14, opts = {}) {
  const thetaStart = opts.thetaStart ?? 0;
  const thetaLength = opts.thetaLength ?? Math.PI * 2;
  const full = thetaLength >= Math.PI * 2 - 1e-5;
  const grow = 1 + (opts.inflate || 0);
  const doCaps = (opts.caps ?? true) && full;
  const pos = [];
  const uvs = [];
  const idx = [];
  const rings = sections.length;
  const w = radial + 1;

  for (let i = 0; i < rings; i++) {
    const s = sections[i];
    const ryT = (s.ryT ?? s.ry ?? s.rx) * grow;
    const ryB = (s.ryB ?? s.ry ?? s.rx) * grow;
    const yOff = s.y || 0;
    for (let j = 0; j <= radial; j++) {
      const th = thetaStart + (j / radial) * thetaLength;
      const c = Math.cos(th), sn = Math.sin(th);
      pos.push(c * s.rx * grow, sn * (sn >= 0 ? ryT : ryB) + yOff, s.z);
      uvs.push(j / radial, i / (rings - 1));
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  // cap the ends with small fans so pinholes close
  const capCenter = (s, sign) => {
    const ci = pos.length / 3;
    pos.push(0, (s.y || 0), s.z);
    uvs.push(0.5, sign > 0 ? 1 : 0);
    const ring0 = sign > 0 ? (rings - 1) * w : 0;
    for (let j = 0; j < radial; j++) {
      if (sign > 0) idx.push(ci, ring0 + j, ring0 + j + 1);
      else idx.push(ci, ring0 + j + 1, ring0 + j);
    }
  };
  if (doCaps) {
    capCenter(sections[0], -1);
    capCenter(sections[rings - 1], 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// loft oriented upward: section z becomes height along +y
export function loftUp(sections, radial = 12) {
  const g = loft(sections, radial);
  g.rotateX(-Math.PI / 2);
  return g;
}

// loft oriented downward: section z becomes distance along -y (limbs)
export function loftDown(sections, radial = 10) {
  const g = loft(sections, radial);
  g.rotateX(Math.PI / 2);
  return g;
}

// Generates public/icons/icon-192.png and icon-512.png with zero deps:
// draws a gold coin + cow face into an RGBA buffer and writes a PNG by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(S) {
  const img = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
  };
  const cx = S / 2, cy = S / 2;
  const R = S * 0.46;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) { set(x, y, 44, 26, 14); continue; }          // wood bg
      if (d > R * 0.94) { set(x, y, 138, 93, 10); continue; }   // coin rim
      // coin face with soft highlight
      const hl = Math.max(0, 1 - Math.hypot(x - cx * 0.75, y - cy * 0.7) / (S * 0.5));
      const r = 242 + hl * 13, g = 182 + hl * 40, b = 50 + hl * 60;
      set(x, y, Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }
  }
  // cow head silhouette (dark brown) — head box, muzzle, ears, horns
  const dark = [74, 47, 24];
  const box = (x0, y0, x1, y1, col) => {
    for (let y = Math.round(y0 * S); y < y1 * S; y++)
      for (let x = Math.round(x0 * S); x < x1 * S; x++) set(x, y, ...col);
  };
  const ellipse = (ex, ey, rx, ry, col) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const nx = (x - ex * S) / (rx * S), ny = (y - ey * S) / (ry * S);
        if (nx * nx + ny * ny <= 1) set(x, y, ...col);
      }
  };
  ellipse(0.5, 0.46, 0.16, 0.15, dark);                 // head
  ellipse(0.32, 0.4, 0.07, 0.045, dark);                // ear L
  ellipse(0.68, 0.4, 0.07, 0.045, dark);                // ear R
  ellipse(0.5, 0.585, 0.115, 0.075, [232, 183, 168]);   // muzzle
  ellipse(0.455, 0.585, 0.018, 0.026, [60, 35, 18]);    // nostril
  ellipse(0.545, 0.585, 0.018, 0.026, [60, 35, 18]);
  ellipse(0.44, 0.43, 0.022, 0.03, [255, 240, 210]);    // eyes
  ellipse(0.56, 0.43, 0.022, 0.03, [255, 240, 210]);
  box(0.30, 0.30, 0.36, 0.345, [245, 235, 215]);        // horns
  box(0.64, 0.30, 0.70, 0.345, [245, 235, 215]);
  return png(S, S, img);
}

mkdirSync(join(root, 'public/icons'), { recursive: true });
for (const s of [192, 512]) {
  writeFileSync(join(root, `public/icons/icon-${s}.png`), makeIcon(s));
  console.log(`icon-${s}.png written`);
}

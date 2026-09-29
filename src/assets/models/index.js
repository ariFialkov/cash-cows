// Every runtime-loaded asset (rigged GLBs, cowboy texture maps) is imported
// here so Vite bundles it: with assetsInlineLimit raised in vite.config.js
// each one becomes a base64 data URL inside the JS bundle, so the built
// game is nothing but .html/.js/.css (+ PNG icons and manifest.json) — hosts
// that only accept "static WebGL build" extensions take it as is, and the
// loaders don't care whether a URL is a file or a data: URI.
const glbs = import.meta.glob('./*.glb', { eager: true, query: '?url', import: 'default' });
const texs = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });

export function modelUrl(name) {
  const u = glbs[`./${name}.glb`];
  if (!u) throw new Error(`unknown model ${name}`);
  return u;
}

export function textureUrl(name) {
  const u = texs[`./tex/${name}.webp`];
  if (!u) throw new Error(`unknown texture ${name}`);
  return u;
}

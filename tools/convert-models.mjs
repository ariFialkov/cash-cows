// Model pipeline: models-src/*.fbx -> src/assets/models/*.glb (meshopt-compressed).
// Run: node tools/convert-models.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync, statSync as stat } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.fbx': 'application/octet-stream' };
const server = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(8951);

mkdirSync(join(ROOT, 'src/assets/models'), { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const names = readdirSync(join(ROOT, 'models-src')).filter((f) => f.endsWith('.fbx')).map((f) => f.replace('.fbx', ''));
for (const name of names) {
  await page.goto(`http://localhost:8951/tools/fbx2glb.html?m=${name}`);
  await page.waitForFunction(() => document.title === 'done', null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__err);
  if (err) { console.error(name, 'FAILED:', err); continue; }
  const bytes = await page.evaluate(() => Array.from(window.__glb));
  const raw = join(ROOT, `src/assets/models/${name}.raw.glb`);
  const out = join(ROOT, `src/assets/models/${name}.glb`);
  writeFileSync(raw, Buffer.from(bytes));
  execSync(`npx gltf-transform optimize "${raw}" "${out}" --compress meshopt --texture-compress false --simplify false --prune-attributes false`, { cwd: ROOT, stdio: 'pipe' });
  execSync(`rm "${raw}"`);
  console.log(`${name}: fbx ${(stat(join(ROOT, `models-src/${name}.fbx`)).size / 1e6).toFixed(2)}MB -> glb ${(stat(out).size / 1e6).toFixed(2)}MB`);
}
await browser.close();
server.close();

// The range: a seeded mountain valley (see terrain.js) with the ranch pen in
// the middle of the valley floor. Two gates stand open, dirt trails lead out
// to a bridge over the river and up to a lookout, and the hills beyond are
// wooded with clearings. World also owns the fence/tree collision, the
// open-ground sampler that spawns use, the grass carpet, sky and clouds.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { Terrain, WORLD_HALF, RANGE_HALF, PEN_HALF, K_OPEN, smoothstep } from './terrain.js';
import { Grass } from './grass.js';

export { WORLD_HALF, RANGE_HALF, PEN_HALF };

const GATE_HALF = 2.7;             // half-width of a gate opening
const GRID = 8;                    // spatial hash cell (metres)

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const YAXIS = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const NONE = [];

export class World {
  constructor(scene, seed, { quality = 'high' } = {}) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this.quality = quality;

    this.terrain = new Terrain(this.seed, this.rand);
    this.rivers = this.terrain.rivers;
    this.trails = this.terrain.trails;
    this.bridge = this.terrain.bridge;
    // gate openings in the pen fence: { axis, P, at }
    this.gates = this.terrain.gates.map((g) =>
      g.side === 'N' ? { axis: 'z', P: -PEN_HALF, at: g.at }
      : g.side === 'S' ? { axis: 'z', P: PEN_HALF, at: g.at }
      : g.side === 'W' ? { axis: 'x', P: -PEN_HALF, at: g.at }
      : { axis: 'x', P: PEN_HALF, at: g.at });
    this.statics = [];                  // solid circles (barn etc.)
    this._trees = new Map();            // grid -> [{x,z,r}]
    this._obst = new Map();             // grid -> [obstacles of the 3x3 neighbourhood]

    this._buildLights();
    this._buildSky();
    this.terrain.build(scene);
    this._buildFence();
    this._buildBarn();
    this._buildBridge();
    this._buildDecor();
    this.grass = new Grass(scene, this.terrain, this.seed, quality);
    this._buildClouds();
  }

  // ---- ground queries ---------------------------------------------------------
  heightAt(x, z) { return this.terrain.heightAt(x, z); }
  groundNormal(x, z, out) { return this.terrain.groundNormal(x, z, out); }
  waterDepthAt(x, z) { return this.terrain.waterDepthAt(x, z); }
  insidePen(x, z) { return Math.abs(x) < PEN_HALF && Math.abs(z) < PEN_HALF; }

  // ground fit to stand, graze or spawn on: not water, not a track or building,
  // not too steep, not deep woods
  isOpen(x, z, forestMax = 0.45) {
    const T = this.terrain;
    if (Math.abs(x) > RANGE_HALF - 8 || Math.abs(z) > RANGE_HALF - 8) return false;
    if (T.kindAt(x, z) !== K_OPEN) return false;
    if (T.forestAt(x, z) > forestMax) return false;
    if (T.slopeAt(x, z) > 0.55) return false;
    for (const s of this.statics) if (Math.hypot(x - s.x, z - s.z) < s.r + 3) return false;
    if (this._treesAt(x, z).length) return false;
    return true;
  }

  // random open point: inPen true/false/undefined(anywhere), keep away from a spot
  randomPoint({ inPen, minFromCenter = 0, avoid = null, avoidR = 0, margin = 10 } = {}) {
    const half = inPen ? PEN_HALF - margin : RANGE_HALF - margin;
    for (let tries = 0; tries < 60; tries++) {
      const x = (Math.random() * 2 - 1) * half;
      const z = (Math.random() * 2 - 1) * half;
      if (inPen === false && this.insidePen(x, z)) continue;
      if (Math.hypot(x, z) < minFromCenter) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoidR) continue;
      if (!this.isOpen(x, z)) continue;
      return [x, z];
    }
    return inPen === false ? [PEN_HALF + 40, PEN_HALF + 40] : [PEN_HALF * 0.5, PEN_HALF * 0.5];
  }

  // ---- collision ------------------------------------------------------------
  _key(x, z) { return (Math.floor(x / GRID) + 4096) * 8192 + (Math.floor(z / GRID) + 4096); }
  _treesAt(x, z) { return this._trees.get(this._key(x, z)) || NONE; }
  obstaclesNear(x, z) { return this._obst.get(this._key(x, z)) || NONE; }
  addObstacle(o) { this._addGrid(this._obst, o.x, o.z, o, 1); }

  _addGrid(map, x, z, item, spread) {
    for (let dx = -spread; dx <= spread; dx++) for (let dz = -spread; dz <= spread; dz++) {
      const k = this._key(x + dx * GRID, z + dz * GRID);
      let a = map.get(k);
      if (!a) map.set(k, (a = []));
      a.push(item);
    }
  }

  // keep a body of radius r inside the range and out of the fence, trees and buildings.
  // prev is where it was before this frame's move (decides which side of the fence it stays on)
  confine(pos, prev, r) {
    const B = RANGE_HALF - r;
    if (pos.x > B) pos.x = B; else if (pos.x < -B) pos.x = -B;
    if (pos.z > B) pos.z = B; else if (pos.z < -B) pos.z = -B;
    this._fencePlane(pos, prev, r, 'x', PEN_HALF);
    this._fencePlane(pos, prev, r, 'x', -PEN_HALF);
    this._fencePlane(pos, prev, r, 'z', PEN_HALF);
    this._fencePlane(pos, prev, r, 'z', -PEN_HALF);
    for (const t of this._treesAt(pos.x, pos.z)) this._pushOut(pos, t.x, t.z, t.r + r);
    for (const s of this.statics) if (Math.abs(pos.x - s.x) < s.r + r && Math.abs(pos.z - s.z) < s.r + r) this._pushOut(pos, s.x, s.z, s.r + r);
  }

  _pushOut(pos, cx, cz, R) {
    const dx = pos.x - cx, dz = pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= R) return;
    if (d < 1e-4) { pos.x = cx + R; return; }
    pos.x = cx + (dx / d) * R; pos.z = cz + (dz / d) * R;
  }

  _inGate(axis, P, along) {
    for (const g of this.gates) if (g.axis === axis && g.P === P && Math.abs(along - g.at) < GATE_HALF) return true;
    return false;
  }

  _fencePlane(pos, prev, r, axis, P) {
    const o = axis === 'x' ? 'z' : 'x';
    if (Math.abs(pos[o]) > PEN_HALF + r) return;
    const d = pos[axis] - P;
    if (Math.abs(d) >= r) return;
    if (this._inGate(axis, P, pos[o])) return;
    const side = Math.sign((prev ? prev[axis] : pos[axis]) - P) || 1;
    pos[axis] = P + side * r;
  }

  // next point to head for on the way to (tx, tz): the target itself, or the
  // near side of the closest gate when the fence stands between
  routeTo(pos, tx, tz) {
    const inside = this.insidePen(pos.x, pos.z), tIn = this.insidePen(tx, tz);
    if (inside === tIn) return [tx, tz];
    let best = null, bestD = Infinity;
    for (const g of this.gates) {
      const gx = g.axis === 'x' ? g.P : g.at, gz = g.axis === 'z' ? g.P : g.at;
      const d = Math.hypot(gx - pos.x, gz - pos.z) + Math.hypot(gx - tx, gz - tz);
      if (d < bestD) { bestD = d; best = g; }
    }
    // line up square with the opening on this side first, then go on through
    const o = best.axis === 'x' ? 'z' : 'x';
    const toward = (inside ? -1 : 1) * Math.sign(best.P);      // from the fence toward this side
    const lined = Math.abs(pos[o] - best.at) < 2.5 && Math.abs(pos[best.axis] - best.P) < 10;
    const off = lined ? -5 * toward : 8 * toward;
    return best.axis === 'x' ? [best.P + off, best.at] : [best.at, best.P + off];
  }

  // steer a heading vector along walls it's about to hit (cattle use this so they
  // run the rails instead of pinning into them). Returns true when cornered.
  wallSteer(pos, dir, M) {
    let pinned = 0;
    const walls = [['x', PEN_HALF], ['x', -PEN_HALF], ['z', PEN_HALF], ['z', -PEN_HALF]];
    for (const [axis, P] of walls) {
      const o = axis === 'x' ? 'z' : 'x';
      if (Math.abs(pos[o]) > PEN_HALF + M) continue;
      const d = pos[axis] - P;
      if (Math.abs(d) > M) continue;
      if (Math.sign(dir[axis]) === Math.sign(d) || dir[axis] === 0) continue;   // heading away
      if (this._inGate(axis, P, pos[o])) continue;
      dir[axis] *= 0.15;
      dir[o] += Math.sign(dir[o] || (Math.random() - 0.5)) * 0.9;
      pinned++;
    }
    const R = RANGE_HALF - M;
    if (pos.x > R && dir.x > 0) { dir.x *= 0.15; dir.z += Math.sign(dir.z || (Math.random() - 0.5)) * 0.9; pinned++; }
    if (pos.x < -R && dir.x < 0) { dir.x *= 0.15; dir.z += Math.sign(dir.z || (Math.random() - 0.5)) * 0.9; pinned++; }
    if (pos.z > R && dir.z > 0) { dir.z *= 0.15; dir.x += Math.sign(dir.x || (Math.random() - 0.5)) * 0.9; pinned++; }
    if (pos.z < -R && dir.z < 0) { dir.z *= 0.15; dir.x += Math.sign(dir.x || (Math.random() - 0.5)) * 0.9; pinned++; }
    return pinned >= 2;
  }

  // ---- lights & sky -----------------------------------------------------------
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6a8a48, 0.8);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.5);
    sun.position.set(60, 78, 30);
    sun.castShadow = true;
    const sm = this.quality === 'low' ? 1536 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const s = 58;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunDir = new THREE.Vector3(60, 78, 30).normalize();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d86cc) },
        mid: { value: new THREE.Color(0x9ccbeb) },
        bottom: { value: new THREE.Color(0xd9e4ea) },
        sunDir: { value: this.sunDir },
      },
      vertexShader: `
        varying vec3 vPos;
        void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir;
        void main(){
          vec3 d = normalize(vPos);
          float h = clamp(d.y, -0.05, 1.0);
          vec3 c = h < 0.16 ? mix(bottom, mid, smoothstep(-0.05, 0.16, h))
                            : mix(mid, top, smoothstep(0.16, 0.7, h));
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.93, 0.75) * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.22);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    // blue mountain haze: the far ridges fade into the sky
    this.scene.fog = new THREE.Fog(0xc6d7e5, 230, 1300);
  }

  // ---- ranch ------------------------------------------------------------------
  _buildFence() {
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 1.35, 6);
    postGeo.translate(0, 0.62, 0);
    const railGeo = new THREE.BoxGeometry(1, 0.1, 0.055);
    const wood = new THREE.MeshStandardMaterial({ color: 0x74532e, roughness: 0.9 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5d411f, roughness: 0.95 });

    const spacing = 3.2;
    const H = PEN_HALF;
    const runs = [];
    for (let x = -H; x < H; x += spacing) runs.push([x, -H, x + spacing, -H, 'z', -H, x]);
    for (let z = -H; z < H; z += spacing) runs.push([H, z, H, z + spacing, 'x', H, z]);
    for (let x = H; x > -H; x -= spacing) runs.push([x, H, x - spacing, H, 'z', H, x]);
    for (let z = H; z > -H; z -= spacing) runs.push([-H, z, -H, z - spacing, 'x', -H, z]);

    // a panel is skipped where it overlaps a gate opening
    const spans = runs.filter(([, , , , axis, P, along]) => !this.gates.some((g) => g.axis === axis && g.P === P && along + spacing > g.at - GATE_HALF && along < g.at + GATE_HALF));

    const posts = new THREE.InstancedMesh(postGeo, wood, spans.length);
    const rails = new THREE.InstancedMesh(railGeo, woodDark, spans.length * 2);
    spans.forEach(([x, z, nx, nz], i) => {
      const y = this.heightAt(x, z), ny = this.heightAt(nx, nz);
      _m.compose(_v.set(x, y, z), _q.identity(), _s.set(1, 1, 1));
      posts.setMatrixAt(i, _m);
      for (let r = 0; r < 2; r++) {
        const ry = 0.55 + r * 0.5;
        const a = new THREE.Vector3(x, y + ry, z), b = new THREE.Vector3(nx, ny + ry, nz);
        const mid = a.clone().lerp(b, 0.5), dir = b.clone().sub(a);
        const len = dir.length();
        _q.setFromUnitVectors(XAXIS, dir.normalize());
        _m.compose(mid, _q, _s.set(len, 1, 1));
        rails.setMatrixAt(i * 2 + r, _m);
      }
    });
    posts.castShadow = true;
    this.scene.add(posts, rails);

    // gates: tall posts either side of the opening, the gate itself swung open outward
    const gpGeo = new THREE.CylinderGeometry(0.13, 0.16, 2.1, 7);
    gpGeo.translate(0, 1.0, 0);
    for (const g of this.gates) {
      const o = g.axis === 'x' ? 'z' : 'x';
      const ends = [g.at - GATE_HALF, g.at + GATE_HALF];
      for (const e of ends) {
        const p = { x: 0, z: 0 }; p[g.axis] = g.P; p[o] = e;
        const post = new THREE.Mesh(gpGeo, wood);
        post.position.set(p.x, this.heightAt(p.x, p.z), p.z);
        post.castShadow = true;
        this.scene.add(post);
      }
      // the gate leaf: a frame of rails hinged on the first post, open ~110° to the outside
      const leaf = new THREE.Group();
      const L = GATE_HALF * 2 - 0.3;
      for (let r = 0; r < 3; r++) {
        const bar = new THREE.Mesh(railGeo, woodDark);
        bar.position.set(L / 2, 0.35 + r * 0.42, 0);
        bar.scale.set(L, 1, 1);
        bar.castShadow = true;
        leaf.add(bar);
      }
      for (let k = 0; k < 2; k++) {
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.07), wood);
        up.position.set(k ? L - 0.05 : 0.05, 0.75, 0);
        leaf.add(up);
      }
      const diag = new THREE.Mesh(railGeo, woodDark);
      diag.position.set(L / 2, 0.77, 0.02);
      diag.scale.set(Math.hypot(L, 0.84), 0.8, 0.8);
      diag.rotation.z = Math.atan2(0.84, L);
      leaf.add(diag);
      const hinge = { x: 0, z: 0 }; hinge[g.axis] = g.P; hinge[o] = ends[0];
      leaf.position.set(hinge.x, this.heightAt(hinge.x, hinge.z) + 0.05, hinge.z);
      // closed, the leaf lies along the fence from the hinge post; it stands
      // swung 110° outward, away from the pen
      const open = 110 * Math.PI / 180;
      leaf.rotation.y = g.axis === 'z' ? -Math.sign(g.P) * open : -Math.PI / 2 + Math.sign(g.P) * open;
      this.scene.add(leaf);
      (this.gateLeaves || (this.gateLeaves = [])).push(leaf);
    }
  }

  _buildBarn() {
    // a red barn in the north-west corner of the pen
    const x = -118, z = -112, yaw = 0.35;
    const y = this.heightAt(x, z);
    const barn = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0x8e3b2c, roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x4d4238, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 5.2, 9), wall);
    body.position.y = 2.6;
    body.castShadow = body.receiveShadow = true;
    barn.add(body);
    // gable ends
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(0, 6.4, 14, 4, 1), wall);
    gable.rotation.z = Math.PI / 2; gable.rotation.y = Math.PI / 4;
    gable.scale.set(1, 1, 0.62);
    gable.position.y = 5.2 + 2.2;
    gable.castShadow = true;
    barn.add(gable);
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.22, 5.9), roof);
      slab.position.set(0, 5.2 + 2.25, s * 2.55);
      slab.rotation.x = s * -0.72;
      slab.castShadow = true;
      barn.add(slab);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }));
    door.position.set(7.05, 1.8, 0);
    barn.add(door);
    for (const s of [-1, 1]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.9, 0.08), trim);
      cross.position.set(7.15, 1.8, 0); cross.rotation.x = s * 0.75;
      barn.add(cross);
    }
    const trough = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 0.9), new THREE.MeshStandardMaterial({ color: 0x5c4a35, roughness: 1 }));
    trough.position.set(3, 0.3, 7.2);
    barn.add(trough);
    barn.position.set(x, y - 0.15, z);
    barn.rotation.y = yaw;
    this.scene.add(barn);
    this.statics.push({ x, z, r: 9 });
    this.terrain.reserve(x, z, 10);
  }

  _buildBridge() {
    const b = this.bridge;
    if (!b) return;
    const plank = new THREE.MeshStandardMaterial({ color: 0x7d5a35, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x55391e, roughness: 0.95 });
    const segLen = 2.4;
    const total = (b.halfLen + b.ramp) * 2;
    const nSeg = Math.ceil(total / segLen);
    const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen + 0.08, 0.24, b.halfW * 2), plank, nSeg);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), dark, nSeg * 2 + 2);
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen + 0.1, 0.09, 0.07), dark, nSeg * 4);
    let pi = 0, ri = 0;
    for (let i = 0; i < nSeg; i++) {
      const u0 = -b.halfLen - b.ramp + i * segLen, u1 = u0 + segLen;
      const um = (u0 + u1) / 2;
      const y0 = b.deckY(u0), y1 = b.deckY(u1), ym = (y0 + y1) / 2;
      const pitch = Math.atan2(y1 - y0, segLen);
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
      _m.compose(_v.set(b.x + um, ym - 0.12, b.z), _q, _s.set(1, 1, 1));
      deck.setMatrixAt(i, _m);
      for (const s of [-1, 1]) {
        _m.compose(_v.set(b.x + u0, y0 + 0.5, b.z + s * (b.halfW - 0.12)), _q.identity(), _s.set(1, 1, 1));
        posts.setMatrixAt(pi++, _m);
        _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
        _m.compose(_v.set(b.x + um, ym + 1.0, b.z + s * (b.halfW - 0.12)), _q, _s.set(1, 1, 1));
        rails.setMatrixAt(ri++, _m);
        _m.compose(_v.set(b.x + um, ym + 0.55, b.z + s * (b.halfW - 0.12)), _q, _s.set(1, 1, 1));
        rails.setMatrixAt(ri++, _m);
      }
    }
    for (const s of [-1, 1]) {
      const uE = b.halfLen + b.ramp;
      _m.compose(_v.set(b.x + uE, b.deckY(uE) + 0.5, b.z + s * (b.halfW - 0.12)), _q.identity(), _s.set(1, 1, 1));
      posts.setMatrixAt(pi++, _m);
    }
    deck.castShadow = deck.receiveShadow = true;
    posts.castShadow = true;
    this.scene.add(deck, posts, rails);
    // piles down into the water
    const pile = new THREE.CylinderGeometry(0.22, 0.26, 6, 7);
    pile.translate(0, -2.6, 0);
    const piles = new THREE.InstancedMesh(pile, dark, 6);
    let k = 0;
    for (const u of [-b.halfLen * 0.55, 0, b.halfLen * 0.55]) for (const s of [-1, 1]) {
      _m.compose(_v.set(b.x + u, b.deckY(u), b.z + s * (b.halfW - 0.5)), _q.identity(), _s.set(1, 1, 1));
      piles.setMatrixAt(k++, _m);
    }
    this.scene.add(piles);
  }

  // ---- vegetation & rocks ----------------------------------------------------
  _buildDecor() {
    const T = this.terrain;
    const rand = this.rand;
    const inPen = (x, z, m = 0) => Math.abs(x) < PEN_HALF + m && Math.abs(z) < PEN_HALF + m;
    const nearStatic = (x, z, m) => this.statics.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + m);

    // trees: the woods follow the forest mask, thicker on the slopes; a few lone
    // trees dot the meadows, and the far ranges get a sparser backdrop
    const decid = [], conif = [];
    const MAX = this.quality === 'low' ? 3000 : 4600;
    for (let tries = 0; tries < 90000 && decid.length + conif.length < MAX; tries++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 20), z = (rand() * 2 - 1) * (WORLD_HALF - 20);
      const far = Math.max(Math.abs(x), Math.abs(z)) > RANGE_HALF;
      const forest = T.forestAt(x, z);
      const h = T.heightAt(x, z);
      let p = forest * (far ? 0.3 : 1.0);
      if (forest < 0.2 && !far) p = 0.012;                   // lone meadow trees
      if (rand() > p) continue;
      if (T.kindAt(x, z) !== K_OPEN) continue;
      if (T.slopeAt(x, z) > 1.2) continue;
      if (inPen(x, z, 6) && rand() > 0.03) continue;
      if (nearStatic(x, z, 4)) continue;
      const item = { x, z, s: 0.7 + rand() * (far ? 0.9 : 0.8), h };
      // conifers climb the high ground
      const conifer = rand() < smoothstep(35, 120, h) * 0.85 + 0.08;
      (conifer ? conif : decid).push(item);
    }
    // the lookout: one big tree at the end of the north trail
    const end = this.trails[0][this.trails[0].length - 1];
    decid.push({ x: end.x + 6, z: end.z - 4, s: 2.1, h: T.heightAt(end.x + 6, end.z - 4), lone: true });

    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.3, 2.8, 5);
    trunkGeo.translate(0, 1.4, 0);
    const blobA = new THREE.IcosahedronGeometry(1.7, 0); blobA.translate(0, 3.6, 0);
    const blobB = new THREE.IcosahedronGeometry(1.15, 0); blobB.translate(0.9, 4.6, 0.5);
    const blobC = new THREE.IcosahedronGeometry(1.0, 0); blobC.translate(-0.8, 4.3, -0.6);
    const canopyGeo = mergeGeometries([blobA, blobB, blobC]);
    const coneA = new THREE.ConeGeometry(1.6, 3.6, 7); coneA.translate(0, 3.2, 0);
    const coneB = new THREE.ConeGeometry(1.15, 3.0, 7); coneB.translate(0, 5.3, 0);
    const coneC = new THREE.ConeGeometry(0.7, 2.2, 6); coneC.translate(0, 7.0, 0);
    const conifGeo = mergeGeometries([coneA, coneB, coneC]);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const needleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    // canopies between the camera and the rider dissolve (screen-door dither)
    // so the woods never hide the horse
    this._canopyU = { uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } };
    const seeThrough = (mat) => {
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this._canopyU);
        shader.vertexShader = 'varying vec2 vWp;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec4 wp4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4;
          #endif
          vWp = (modelMatrix * wp4).xz;
        `);
        shader.fragmentShader = 'uniform vec3 uPlayer; uniform vec3 uCam; varying vec2 vWp;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
          #include <clipping_planes_fragment>
          vec2 toCam = uCam.xz - uPlayer.xz;
          vec2 rel = vWp - uPlayer.xz;
          float along = dot(rel, normalize(toCam));
          float side = length(rel - normalize(toCam) * along);
          float keep = max(smoothstep(-2.0, 0.5, -along), smoothstep(6.0, 10.0, side));
          float th = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
          if (keep < th) discard;
        `);
      };
    };
    seeThrough(leafMat); seeThrough(needleMat);

    const all = decid.concat(conif);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, decid.length);
    const conifers = new THREE.InstancedMesh(conifGeo, needleMat, conif.length);
    const col = new THREE.Color();
    all.forEach((t, i) => {
      const y = T.heightAt(t.x, t.z) - 0.15;
      _q.setFromAxisAngle(YAXIS, rand() * Math.PI * 2);
      const sy = t.s * (0.9 + rand() * 0.3);
      _m.compose(_v.set(t.x, y, t.z), _q, _s.set(t.s, sy, t.s));
      trunks.setMatrixAt(i, _m);
      if (i < decid.length) {
        canopies.setMatrixAt(i, _m);
        col.setHex(0x3f7d34).offsetHSL(rand() * 0.06 - 0.03, rand() * 0.1 - 0.05, rand() * 0.1 - 0.05);
        if (t.h > 60) col.offsetHSL(-0.02, 0, 0.04);
        canopies.setColorAt(i, col);
      } else {
        conifers.setMatrixAt(i - decid.length, _m);
        col.setHex(0x2f5f3a).offsetHSL(rand() * 0.03 - 0.015, 0, rand() * 0.08 - 0.04);
        conifers.setColorAt(i - decid.length, col);
      }
      if (!(Math.max(Math.abs(t.x), Math.abs(t.z)) > RANGE_HALF)) this._addGrid(this._trees, t.x, t.z, { x: t.x, z: t.z, r: 0.32 * t.s }, 0);
    });
    trunks.castShadow = canopies.castShadow = conifers.castShadow = true;
    this.scene.add(trunks, canopies, conifers);
    this.treeCount = all.length;

    // rocks and bushes double as jumpable obstacles; boulders favour the slopes
    const obstacles = [];
    const rockGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1, flatShading: true });
    const rockPts = [];
    for (let tries = 0; tries < 6000 && rockPts.length < 520; tries++) {
      const x = (rand() * 2 - 1) * (RANGE_HALF - 6), z = (rand() * 2 - 1) * (RANGE_HALF - 6);
      if (Math.hypot(x, z) < 16 || T.kindAt(x, z) !== K_OPEN || nearStatic(x, z, 3)) continue;
      const slope = T.slopeAt(x, z);
      if (rand() > 0.25 + slope * 1.5 + T.heightAt(x, z) / 200) continue;
      rockPts.push([x, z]);
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockPts.length);
    rockPts.forEach(([x, z], i) => {
      const s = 0.4 + rand() * 1.5;
      _q.setFromAxisAngle(YAXIS, rand() * Math.PI * 2);
      _m.compose(_v.set(x, T.heightAt(x, z) + 0.1 * s, z), _q, _s.set(s, s * (0.6 + rand() * 0.5), s));
      rocks.setMatrixAt(i, _m);
      obstacles.push({ x, z, r: 0.62 * s, h: 0.55 * s });
    });
    rocks.castShadow = true;

    const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
    bushGeo.scale(1, 0.65, 1);
    bushGeo.translate(0, 0.3, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x4c8a3f, roughness: 0.95, flatShading: true });
    const bushPts = [];
    for (let tries = 0; tries < 9000 && bushPts.length < 900; tries++) {
      const x = (rand() * 2 - 1) * (RANGE_HALF - 6), z = (rand() * 2 - 1) * (RANGE_HALF - 6);
      if (Math.hypot(x, z) < 12 || T.kindAt(x, z) !== K_OPEN || nearStatic(x, z, 3)) continue;
      if (T.slopeAt(x, z) > 0.9) continue;
      const f = T.forestAt(x, z);
      if (rand() > 0.35 + f * 0.6) continue;
      bushPts.push([x, z]);
    }
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushPts.length);
    bushPts.forEach(([x, z], i) => {
      const s = 0.7 + rand() * 1.1;
      _q.setFromAxisAngle(YAXIS, rand() * Math.PI * 2);
      _m.compose(_v.set(x, T.heightAt(x, z), z), _q, _s.set(s, s, s));
      bushes.setMatrixAt(i, _m);
      obstacles.push({ x, z, r: 0.58 * s, h: 0.55 * s });
    });
    this.scene.add(rocks, bushes);
    for (const o of obstacles) this._addGrid(this._obst, o.x, o.z, o, 1);
    this.obstacleCount = obstacles.length;
  }

  _buildClouds() {
    this.clouds = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, emissive: 0x667788, emissiveIntensity: 0.25 });
    for (let i = 0; i < 22; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(this.rand() * 4);
      for (let j = 0; j < n; j++) {
        const s = 9 + this.rand() * 16;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), mat);
        puff.position.set((j - n / 2) * s * 0.9, this.rand() * 4, (this.rand() - 0.5) * 12);
        puff.scale.y = 0.5;
        cloud.add(puff);
      }
      cloud.position.set((this.rand() * 2 - 1) * 1100, 300 + this.rand() * 90, (this.rand() * 2 - 1) * 1100);
      cloud.userData.drift = 1.6 + this.rand() * 2.2;
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  // movers: bodies brushing through the grass this frame [{x, z, vx, vz, r}]
  update(playerPos, dt, time, movers = NONE, camPos = null) {
    this.sun.position.set(playerPos.x + 60, playerPos.y + 78, playerPos.z + 30);
    this.sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    this._canopyU.uPlayer.value.copy(playerPos);
    if (camPos) this._canopyU.uCam.value.copy(camPos);
    this.terrain.update(playerPos, dt, time);
    this.grass.update(playerPos, dt, time, movers);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 1150) c.position.x = -1150;
    }
  }
}

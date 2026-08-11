// Procedurally generated free-range enclosure: rolling terrain, perimeter
// fence, scattered trees/rocks/bushes, drifting clouds and a grass carpet that
// follows the player. Layout is seeded per session.

import * as THREE from 'three';
import { mulberry32, fbm2 } from '../core/rng.js';

export const PEN_HALF = 260;          // playable half-extent (fence at ±PEN_HALF)
const TERRAIN_SIZE = PEN_HALF * 2 + 60;
const TERRAIN_SEGS = 170;
const HEIGHT_AMP = 3.2;
const HEIGHT_FREQ = 1 / 55;

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this._grassCell = null;

    this._buildLights();
    this._buildSky();
    this._buildTerrain();
    this._buildFence();
    this._buildDecor();
    this._buildGrass();
    this._buildClouds();
  }

  heightAt(x, z) {
    let h = (fbm2(x * HEIGHT_FREQ, z * HEIGHT_FREQ, this.seed, 4) - 0.5) * 2 * HEIGHT_AMP;
    // flatten gently toward the center so the starting area is friendly
    const d = Math.hypot(x, z);
    h *= Math.min(1, 0.35 + d / 120);
    return h;
  }

  groundNormal(x, z) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6d8f4e, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    sun.position.set(60, 90, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 55;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;   sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1500, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x3f8fd4) },
        mid: { value: new THREE.Color(0x9fd0ef) },
        bottom: { value: new THREE.Color(0xf6e7c5) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main(){
          float h = clamp(normalize(vPos).y, -0.05, 1.0);
          vec3 c = h < 0.18 ? mix(bottom, mid, smoothstep(-0.05, 0.18, h))
                            : mix(mid, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.fog = new THREE.Fog(0xcfe3ea, 140, 620);
  }

  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x69a84f);
    const cDry = new THREE.Color(0x9aa04e);
    const cDirt = new THREE.Color(0x8a6a3d);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      // patchy grass/dirt colouring
      const n = fbm2(x * 0.02 + 40, z * 0.02 - 17, this.seed + 7, 3);
      const d = fbm2(x * 0.09 - 8, z * 0.09 + 23, this.seed + 13, 2);
      tmp.copy(cGrass).lerp(cDry, Math.max(0, (n - 0.45) * 2.2));
      if (d > 0.68) tmp.lerp(cDirt, Math.min(1, (d - 0.68) * 4));
      tmp.offsetHSL(0, 0, (h / HEIGHT_AMP) * 0.02);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  _buildFence() {
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 1.35, 6);
    postGeo.translate(0, 0.62, 0);
    const railGeo = new THREE.BoxGeometry(1, 0.1, 0.055);
    const wood = new THREE.MeshStandardMaterial({ color: 0x74532e, roughness: 0.9 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5d411f, roughness: 0.95 });

    const spacing = 3.2;
    const pts = [];
    const H = PEN_HALF;
    for (let x = -H; x < H; x += spacing) pts.push([x, -H]);
    for (let z = -H; z < H; z += spacing) pts.push([H, z]);
    for (let x = H; x > -H; x -= spacing) pts.push([x, H]);
    for (let z = H; z > -H; z -= spacing) pts.push([-H, z]);

    const posts = new THREE.InstancedMesh(postGeo, wood, pts.length);
    const rails = new THREE.InstancedMesh(railGeo, woodDark, pts.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const y = this.heightAt(x, z);
      m.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(i, m);

      const [nx, nz] = pts[(i + 1) % pts.length];
      const ny = this.heightAt(nx, nz);
      for (let r = 0; r < 2; r++) {
        const ry = 0.55 + r * 0.5;
        const a = new THREE.Vector3(x, y + ry, z);
        const b = new THREE.Vector3(nx, ny + ry, nz);
        const mid = a.clone().lerp(b, 0.5);
        const dir = b.clone().sub(a);
        const len = dir.length();
        q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        m.compose(mid, q, new THREE.Vector3(len, 1, 1));
        rails.setMatrixAt(i * 2 + r, m);
      }
      q.identity();
    }
    posts.castShadow = true;
    posts.instanceMatrix.needsUpdate = true;
    rails.instanceMatrix.needsUpdate = true;
    this.scene.add(posts, rails);
    void up;
  }

  _scatter(count, minR = 14) {
    // random points inside the pen, away from spawn
    const out = [];
    for (let i = 0; i < count; i++) {
      const x = (this.rand() * 2 - 1) * (PEN_HALF - 6);
      const z = (this.rand() * 2 - 1) * (PEN_HALF - 6);
      if (Math.hypot(x, z) < minR) continue;
      out.push([x, z]);
    }
    return out;
  }

  _buildDecor() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const YAXIS = new THREE.Vector3(0, 1, 0);

    // --- trees: trunk + foliage blobs
    const treePts = this._scatter(130, 20);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.6, 7);
    trunkGeo.translate(0, 1.3, 0);
    const folGeo = new THREE.IcosahedronGeometry(1.5, 1);
    folGeo.translate(0, 3.4, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.95 });
    const folMat = new THREE.MeshStandardMaterial({ color: 0x3e7a34, roughness: 0.9, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePts.length);
    const fols = new THREE.InstancedMesh(folGeo, folMat, treePts.length);
    const folColor = new THREE.Color();
    treePts.forEach(([x, z], i) => {
      const s = 0.8 + this.rand() * 0.9;
      q.setFromAxisAngle(YAXIS, this.rand() * Math.PI * 2);
      m.compose(v.set(x, this.heightAt(x, z) - 0.1, z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      fols.setMatrixAt(i, m);
      folColor.setHex(0x3e7a34).offsetHSL(this.rand() * 0.04 - 0.02, 0, this.rand() * 0.08 - 0.04);
      fols.setColorAt(i, folColor);
    });
    trunks.castShadow = fols.castShadow = true;

    // --- rocks
    const rockPts = this._scatter(110, 16);
    const rockGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockPts.length);
    rockPts.forEach(([x, z], i) => {
      const s = 0.4 + this.rand() * 1.4;
      q.setFromAxisAngle(YAXIS, this.rand() * Math.PI * 2);
      m.compose(v.set(x, this.heightAt(x, z) + 0.1 * s, z), q, new THREE.Vector3(s, s * (0.6 + this.rand() * 0.5), s));
      rocks.setMatrixAt(i, m);
    });
    rocks.castShadow = true;

    // --- bushes
    const bushPts = this._scatter(180, 12);
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
    bushGeo.scale(1, 0.65, 1);
    bushGeo.translate(0, 0.3, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x4c8a3f, roughness: 0.95, flatShading: true });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushPts.length);
    bushPts.forEach(([x, z], i) => {
      const s = 0.7 + this.rand() * 1.1;
      q.setFromAxisAngle(YAXIS, this.rand() * Math.PI * 2);
      m.compose(v.set(x, this.heightAt(x, z), z), q, new THREE.Vector3(s, s, s));
      bushes.setMatrixAt(i, m);
    });

    this.scene.add(trunks, fols, rocks, bushes);
  }

  _buildGrass() {
    // a carpet of tufts hashed into 3m cells, re-laid around the player as they move
    const RADIUS_CELLS = 13;
    this._grassRadius = RADIUS_CELLS;
    const per = (RADIUS_CELLS * 2 + 1) ** 2 * 2;
    const blade = new THREE.ConeGeometry(0.055, 0.42, 4);
    blade.translate(0, 0.18, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x82c25f, roughness: 1 });
    this.grass = new THREE.InstancedMesh(blade, mat, per);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grass.frustumCulled = false;
    this.scene.add(this.grass);
  }

  _layGrass(cx, cz) {
    const R = this._grassRadius;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const YAXIS = new THREE.Vector3(0, 1, 0);
    let i = 0;
    const CELL = 3;
    for (let gx = cx - R; gx <= cx + R; gx++) {
      for (let gz = cz - R; gz <= cz + R; gz++) {
        for (let k = 0; k < 2; k++) {
          const h1 = frac(Math.sin(gx * 127.1 + gz * 311.7 + k * 74.7 + this.seed * 0.001) * 43758.5453);
          const h2 = frac(Math.sin(gx * 269.5 + gz * 183.3 + k * 246.1) * 43758.5453);
          const x = (gx + h1) * CELL;
          const z = (gz + h2) * CELL;
          if (Math.abs(x) > PEN_HALF - 1 || Math.abs(z) > PEN_HALF - 1 || h1 < 0.25) {
            m.makeScale(0, 0, 0);
          } else {
            const s = 0.7 + h2 * 1.1;
            q.setFromAxisAngle(YAXIS, h1 * Math.PI * 2);
            m.compose(new THREE.Vector3(x, this.heightAt(x, z), z), q, new THREE.Vector3(s, s * (0.8 + h1 * 0.6), s));
          }
          this.grass.setMatrixAt(i++, m);
        }
      }
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  _buildClouds() {
    this.clouds = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, emissive: 0x667788, emissiveIntensity: 0.25 });
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(this.rand() * 4);
      for (let j = 0; j < n; j++) {
        const s = 6 + this.rand() * 10;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), mat);
        puff.position.set((j - n / 2) * s * 0.9, this.rand() * 3, (this.rand() - 0.5) * 8);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set((this.rand() * 2 - 1) * 700, 90 + this.rand() * 60, (this.rand() * 2 - 1) * 700);
      cloud.userData.drift = 1.2 + this.rand() * 1.6;
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  update(playerPos, dt) {
    // shadow camera follows the player
    this.sun.position.set(playerPos.x + 60, 90, playerPos.z + 30);
    this.sun.target.position.set(playerPos.x, 0, playerPos.z);

    // re-lay grass when crossing a cell boundary
    const cx = Math.round(playerPos.x / 3), cz = Math.round(playerPos.z / 3);
    if (!this._grassCell || Math.abs(cx - this._grassCell[0]) > 2 || Math.abs(cz - this._grassCell[1]) > 2) {
      this._grassCell = [cx, cz];
      this._layGrass(cx, cz);
    }

    for (const c of this.clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 750) c.position.x = -750;
    }
  }
}

function frac(x) { return x - Math.floor(x); }

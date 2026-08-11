// Tiny particle bursts (coin showers, dust poofs, snap flashes).

import * as THREE from 'three';

const MAX = 260;

export class Effects {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
  }

  burst(pos, hex, n = 30, speed = 5, up = 4) {
    const c = new THREE.Color(hex);
    for (let i = 0; i < n && this.parts.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.3 + Math.random() * 0.7) * speed;
      this.parts.push({
        p: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.6, (Math.random() - 0.5) * 0.4)),
        v: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s),
        life: 0.7 + Math.random() * 0.6,
        c,
      });
    }
  }

  update(dt) {
    let i = 0;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const pt = this.parts[k];
      pt.life -= dt;
      if (pt.life <= 0) { this.parts.splice(k, 1); continue; }
      pt.v.y -= 12 * dt;
      pt.p.addScaledVector(pt.v, dt);
    }
    for (const pt of this.parts) {
      this.positions[i * 3] = pt.p.x;
      this.positions[i * 3 + 1] = pt.p.y;
      this.positions[i * 3 + 2] = pt.p.z;
      this.colors[i * 3] = pt.c.r;
      this.colors[i * 3 + 1] = pt.c.g;
      this.colors[i * 3 + 2] = pt.c.b;
      i++;
    }
    this.geo.setDrawRange(0, i);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

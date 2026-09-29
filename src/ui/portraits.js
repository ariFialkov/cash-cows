// Character portraits for the menu: each cowboy model is rendered once into a
// small offscreen canvas (in the rider's rest pose, in the currently picked
// shirt) and handed back as a data URL, so the picker shows the real models
// rather than a name.

import * as THREE from 'three';
import { COWBOYS, loadCowboy, SkinnedCowboy } from '../entities/cowboyModel.js';

const W = 192, H = 232;
let renderer = null, scene = null, camera = null;
const cache = new Map();

function ensure() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6a5238, 0.9));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.3);
  key.position.set(2.2, 3.2, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd9a0, 1.1);
  rim.position.set(-2.5, 2, -2.2);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(24, W / H, 0.1, 20);
}

// bust portrait of cowboy `idx` in `outfit`; cached per (idx, outfit)
export async function cowboyPortrait(idx, outfit) {
  const key = idx + ':' + JSON.stringify(outfit);
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    ensure();
    const ct = await loadCowboy(idx);
    const cb = new SkinnedCowboy(ct, outfit);
    // settle the rest pose (the pose smoother eases toward its target)
    const args = { lean: 0.06, roll: 0, lift: 0, horse: null, speed: 0, turn: 0, dt: 1 / 30, lassoAngle: null, heading: 0, look: new THREE.Vector3(0.35, 0.05, 1) };
    for (let i = 0; i < 50; i++) cb.pose(args);
    cb.group.rotation.y = -0.38;
    scene.add(cb.group);
    const h = COWBOYS[idx].height;
    // hips sit at the origin: frame from the belt to just above the hat
    camera.position.set(0.42, h * 0.36, 2.55);
    camera.lookAt(0, h * 0.27, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(cb.group);
    return url;
  })();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

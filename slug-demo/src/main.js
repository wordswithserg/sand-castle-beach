import * as THREE from 'three';
import { createSlug, updateSlug, BASE } from './slug.js';
import { buildWorld, overlaps2D } from './world.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <canvas id="scene"></canvas>
  <div id="hud">
    <div id="hud-controls">
      <strong>Move</strong> W/S &nbsp; <strong>Turn</strong> A/D<br/>
      <strong>Skulk wide</strong> hold C &nbsp; <strong>Skulk tall</strong> hold V<br/>
      <strong>Roll</strong> hold Shift
    </div>
    <div id="hud-state">Mode: <span id="mode-label">normal</span></div>
  </div>
`;

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8e8);
scene.fog = new THREE.Fog(0x9fd8e8, 20, 55);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

const hemi = new THREE.HemisphereLight(0xfff6df, 0xb98a4e, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
sun.position.set(-6, 10, -4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.far = 30;
scene.add(sun);

const { obstacles } = buildWorld(scene);

const slug = createSlug();
scene.add(slug);

const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.__debug = { keys, slug, obstacles, frames: 0, step: (dt) => step(dt) };

const modeLabel = document.querySelector('#mode-label');

let yaw = 0;
let slugHeight = BASE.height;
const camOffsetLocal = new THREE.Vector3(0, 2.3, -4.2);
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 3, -5);

function currentMode() {
  if (keys.has('shift')) return 'roll';
  if (keys.has('c')) return 'wide';
  if (keys.has('v')) return 'tall';
  return 'normal';
}

function collides(x, z, hw, hl) {
  // Rotated footprint approximated as an axis-aligned box (conservative but simple).
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const projX = hw * c + hl * s;
  const projZ = hw * s + hl * c;
  for (const o of obstacles) {
    if (o.bottomY > 0 && slugHeight <= o.bottomY) continue; // fits under this overhang
    if (o.bottomY === 0 && o.topY < slugHeight) continue; // slug taller than a low obstacle: irrelevant
    if (overlaps2D(x, z, projX, projZ, o.x, o.z, o.halfWidth, o.halfDepth)) return true;
  }
  return false;
}

function resolveMove(nx, nz, hw, hl) {
  if (!collides(nx, nz, hw, hl)) return [nx, nz];
  if (!collides(nx, slug.position.z, hw, hl)) return [nx, slug.position.z];
  if (!collides(slug.position.x, nz, hw, hl)) return [slug.position.x, nz];
  return [slug.position.x, slug.position.z];
}

let lastTime = performance.now();

function step(dt) {
  window.__debug.frames++;
  const mode = currentMode();
  modeLabel.textContent = mode;

  const turnSpeed = mode === 'roll' ? 1.4 : mode === 'wide' ? 2.9 : 2.4;
  let turn = 0;
  if (keys.has('a')) turn += 1;
  if (keys.has('d')) turn -= 1;
  yaw += turn * turnSpeed * dt;

  const moving = keys.has('w') || keys.has('s') ? 1 : 0;
  const dims = updateSlug(slug, mode, moving, dt);
  slugHeight = dims.height;

  const baseSpeed = 3.0;
  let moveDir = 0;
  if (keys.has('w')) moveDir += 1;
  if (keys.has('s')) moveDir -= 0.6;
  const speed = baseSpeed * dims.speedMultiplier * moveDir;

  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const desiredX = slug.position.x + forward.x * speed * dt;
  const desiredZ = slug.position.z + forward.z * speed * dt;

  const [rx, rz] = resolveMove(desiredX, desiredZ, dims.halfWidth, dims.halfLength);
  slug.position.x = rx;
  slug.position.z = rz;
  slug.rotation.y = yaw;

  const desiredCamPos = camOffsetLocal.clone().applyEuler(new THREE.Euler(0, yaw, 0)).add(slug.position);
  desiredCamPos.y = slug.position.y + camOffsetLocal.y;
  camPos.lerp(desiredCamPos, 1 - Math.exp(-6 * dt));
  camera.position.copy(camPos);
  camTarget.lerp(new THREE.Vector3(slug.position.x, slug.position.y + 0.5, slug.position.z), 1 - Math.exp(-8 * dt));
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
}

function animate() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  step(dt);
  requestAnimationFrame(animate);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

animate();

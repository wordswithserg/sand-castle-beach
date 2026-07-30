import * as THREE from 'three';
import { createSlug, updateSlug, BASE } from './slug.js';
import { buildWorld, obbOverlap, obbPushOut } from './world.js';
import { input } from './input.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <canvas id="scene"></canvas>
  <div id="hud">
    <div id="hud-controls">
      <strong>Move</strong> W/S / left stick &nbsp; <strong>Turn</strong> A/D / left stick<br/>
      <strong>Skulk wide</strong> C / Square &nbsp; <strong>Skulk tall</strong> V / Triangle<br/>
      <strong>Jump</strong> Space / Cross &nbsp; <strong>Roll</strong> Shift / R1
    </div>
    <div id="hud-state">
      Mode: <span id="mode-label">normal</span>
      &nbsp;·&nbsp; <span id="gamepad-label">no controller</span>
    </div>
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

window.__debug = { keys: input.keys, slug, obstacles, frames: 0, step: (dt) => step(dt), getSpeed: () => currentSpeed };

const modeLabel = document.querySelector('#mode-label');
const gamepadLabel = document.querySelector('#gamepad-label');

let yaw = 0;
let slugHeight = BASE.height;
let slugY = 0;
let vy = 0;
let grounded = true;
let jumpWasHeld = false;
const GRAVITY = 20;
const JUMP_VELOCITY = 5.9; // peak height v^2/2g ~= 0.87, clears the 0.55-tall wall with margin

// Actual speed lags behind the target speed a mode implies, instead of
// snapping to it — fast to speed up, slow to bleed off. This is what lets a
// roll's speed carry through into a skulk (or a jump) as a "slide" rather
// than instantly dropping to the skulk's own slower pace; the same system
// applies uniformly, no roll/skulk-specific special-casing needed. Letting
// go of movement entirely still stops crisply (STOP_DECEL) so it doesn't
// feel floaty when lining up a gap.
let currentSpeed = 0;
const ACCEL_UP = 16;
const SLIDE_DECEL = 5;
const STOP_DECEL = 20;
const camOffsetLocal = new THREE.Vector3(0, 2.3, -4.2);
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 3, -5);

function currentMode() {
  if (input.roll()) return 'roll';
  if (input.wide()) return 'wide';
  if (input.tall()) return 'tall';
  return 'normal';
}

// The slug's vertical span is [slugY, slugY + slugHeight] (feet at slugY),
// so an obstacle only matters if that span overlaps the obstacle's own
// [bottomY, topY] band — this is what makes jumping clear a low wall and
// skulking-short clear an overhang, independently of each other.
function collides(x, z, yawAtTest, hw, hl) {
  for (const o of obstacles) {
    if (slugY + slugHeight <= o.bottomY || slugY >= o.topY) continue;
    if (obbOverlap(x, z, yawAtTest, hw, hl, o.x, o.z, 0, o.halfWidth, o.halfDepth)) return true;
  }
  return false;
}

function resolveMove(nx, nz, hw, hl) {
  if (!collides(nx, nz, yaw, hw, hl)) return [nx, nz];
  if (!collides(nx, slug.position.z, yaw, hw, hl)) return [nx, slug.position.z];
  if (!collides(slug.position.x, nz, yaw, hw, hl)) return [slug.position.x, nz];
  return [slug.position.x, slug.position.z];
}

let lastTime = performance.now();

function step(dt) {
  window.__debug.frames++;
  const mode = currentMode();
  modeLabel.textContent = mode;
  const gp = input.gamepadInfo();
  gamepadLabel.textContent = gp ? `controller: ${gp.id} (${gp.mapping || 'no mapping'})` : 'no controller';

  const turnSpeed = mode === 'roll' ? 1.4 : mode === 'wide' ? 2.9 : 2.4;
  yaw += input.turnAxis() * turnSpeed * dt;

  const dims = updateSlug(slug, mode, Math.abs(input.moveAxis()) > 0 ? 1 : 0, dt);
  slugHeight = dims.height;

  // Depenetrate first: turning is never collision-gated, so the slug can
  // rotate itself into a wedged overlap it wasn't in a moment ago. Clear
  // that before resolving movement so it's never permanently stuck.
  for (const o of obstacles) {
    if (slugY + slugHeight <= o.bottomY || slugY >= o.topY) continue;
    const push = obbPushOut(slug.position.x, slug.position.z, yaw, dims.halfWidth, dims.halfLength, o.x, o.z, 0, o.halfWidth, o.halfDepth);
    if (push) {
      slug.position.x += push.x;
      slug.position.z += push.z;
    }
  }

  // Jump: edge-triggered so holding the button doesn't re-fire mid-air,
  // but a jump lands and re-triggers naturally if still held (bunny-hop).
  const jumpHeld = input.jumpHeld();
  if (jumpHeld && !jumpWasHeld && grounded) {
    vy = JUMP_VELOCITY;
    grounded = false;
  }
  jumpWasHeld = jumpHeld;

  vy -= GRAVITY * dt;
  slugY += vy * dt;
  if (slugY <= 0) {
    slugY = 0;
    vy = 0;
    grounded = true;
  }

  const baseSpeed = 3.0;
  const moveAxis = input.moveAxis();
  const targetSpeed = baseSpeed * dims.speedMultiplier * moveAxis;
  const speedingUp = Math.abs(targetSpeed) > Math.abs(currentSpeed);
  const decelRate = Math.abs(moveAxis) > 0.01 ? SLIDE_DECEL : STOP_DECEL;
  const rate = speedingUp ? ACCEL_UP : decelRate;
  const maxDelta = rate * dt;
  const diff = targetSpeed - currentSpeed;
  currentSpeed += Math.sign(diff) * Math.min(Math.abs(diff), maxDelta);
  const speed = currentSpeed;

  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const desiredX = slug.position.x + forward.x * speed * dt;
  const desiredZ = slug.position.z + forward.z * speed * dt;

  const [rx, rz] = resolveMove(desiredX, desiredZ, dims.halfWidth, dims.halfLength);
  slug.position.x = rx;
  slug.position.z = rz;
  slug.position.y = slugY;
  slug.rotation.y = yaw;

  const desiredCamPos = camOffsetLocal.clone().applyEuler(new THREE.Euler(0, yaw, 0)).add(slug.position);
  desiredCamPos.y = slugY + camOffsetLocal.y;
  camPos.lerp(desiredCamPos, 1 - Math.exp(-6 * dt));
  camera.position.copy(camPos);
  camTarget.lerp(new THREE.Vector3(slug.position.x, slugY + 0.5, slug.position.z), 1 - Math.exp(-8 * dt));
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

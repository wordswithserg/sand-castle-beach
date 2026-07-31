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
      &nbsp;·&nbsp; <span id="wallhop-label"></span>
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

window.__debug = { keys: input.keys, slug, obstacles, frames: 0, step: (dt) => step(dt), getSpeed: () => currentSpeed, isGrounded: () => grounded, getYaw: () => yaw, setY: (y) => { slugY = y; slug.position.y = y; }, setVy: (v) => { vy = v; }, getWallHop: () => wallHop };

const modeLabel = document.querySelector('#mode-label');
const gamepadLabel = document.querySelector('#gamepad-label');
const wallhopLabel = document.querySelector('#wallhop-label');

let yaw = 0;
let slugHeight = BASE.height;
let slugY = 0;
let vy = 0;
let grounded = true;
let jumpWasHeld = false;
const GRAVITY = 20;
const JUMP_VELOCITY = 5.9; // peak height v^2/2g ~= 0.87, clears the 0.55-tall wall with margin

// Wall hop: flying into a wall while airborne doesn't bounce automatically.
// Contact instead freezes the slug into a brief "cling" against the wall —
// gravity and horizontal drift both pause — during which the player aims
// with the stick/A-D. Only an explicit Jump press during that window
// launches the slug, in the aimed direction (blended with the wall's normal
// so it can't fire back into the wall). Letting the window expire with no
// jump press just releases into an ordinary fall — no free bounce. A short
// cooldown after launching (or timing out) stops the same wall contact from
// immediately re-triggering a cling the instant movement resumes.
let wallHop = null; // { normal: {x, z}, timer } while clinging; null otherwise
let wallHopCooldown = 0;
const WALL_HOP_WINDOW = 0.19; // 65% shorter than the original 0.55s
const WALL_HOP_AIM_TURN_SPEED = 6;
const WALL_HOP_LAUNCH_SPEED = 4.5;
const WALL_HOP_POP = 3.0;
const WALL_HOP_COOLDOWN_TIME = 0.3;

// Actual speed lags behind the target speed a mode implies, instead of
// snapping to it — fast to speed up, slow to bleed off. This is what lets a
// roll's speed carry through into a skulk (or a jump) as a "slide" rather
// than instantly dropping to the skulk's own slower pace; the same system
// applies uniformly, no roll/skulk-specific special-casing needed. Deceleration
// is grounded-dependent: there's no traction to bleed speed off mid-air, so
// AIR_DECEL barely touches it while airborne (a roll carried into a jump keeps
// almost all its speed for the whole arc), then the gentler ground SLIDE_DECEL
// takes over once you land — landing off a roll-jump into a skulk holds a
// noticeably higher speed for noticeably longer than a same-mode transition
// that never left the ground. Letting go of movement entirely while grounded
// still stops crisply (STOP_DECEL) so it doesn't feel floaty lining up a gap.
let currentSpeed = 0;
const ACCEL_UP = 16;
const SLIDE_DECEL = 3;
const AIR_DECEL = 1.2;
const STOP_DECEL = 20;
const camOffsetLocal = new THREE.Vector3(0, 2.3, -4.2);
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 3, -5);

function currentMode() {
  // Skulk overrides roll (not the other way around): hitting a skulk button
  // mid-roll is a deliberate interrupt into that shape, e.g. bailing out of
  // a roll into a crevice the moment a guard rounds the corner.
  if (input.wide()) return 'wide';
  if (input.tall()) return 'tall';
  if (input.roll()) return 'roll';
  return 'normal';
}

// The slug's vertical span is [slugY, slugY + slugHeight] (feet at slugY),
// so an obstacle only matters if that span overlaps the obstacle's own
// [bottomY, topY] band — this is what makes jumping clear a low wall and
// skulking-short clear an overhang, independently of each other.
function collides(x, z, yawAtTest, hw, hl) {
  for (const o of obstacles) {
    if (slugY + slugHeight <= o.bottomY || slugY >= o.topY) continue;
    if (obbOverlap(x, z, yawAtTest, hw, hl, o.x, o.z, o.yaw, o.halfWidth, o.halfDepth)) return true;
  }
  return false;
}

// Which obstacle (if any) is blocking the hypothetical position (x, z), and
// which direction to bounce off it — reuses the depenetration push vector as
// the wall's outward normal, since that's exactly the direction that clears
// the overlap fastest.
function findWallNormal(x, z, yawAtTest, hw, hl) {
  for (const o of obstacles) {
    if (slugY + slugHeight <= o.bottomY || slugY >= o.topY) continue;
    const push = obbPushOut(x, z, yawAtTest, hw, hl, o.x, o.z, o.yaw, o.halfWidth, o.halfDepth);
    if (push) {
      const len = Math.hypot(push.x, push.z);
      if (len > 1e-5) return { x: push.x / len, z: push.z / len };
    }
  }
  return null;
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

  // Aiming a wall hop turns faster than normal movement does, since there's
  // no forward motion to also be steering.
  const turnSpeed = wallHop ? WALL_HOP_AIM_TURN_SPEED : (mode === 'roll' ? 1.4 : mode === 'wide' ? 2.9 : 2.4);
  yaw += input.turnAxis() * turnSpeed * dt;

  const dims = updateSlug(slug, mode, Math.abs(input.moveAxis()) > 0 ? 1 : 0, dt);
  slugHeight = dims.height;

  // Depenetrate first: turning is never collision-gated (including while
  // aiming a wall hop), so the slug can rotate itself into a wedged overlap
  // it wasn't in a moment ago. Clear that before anything else so it's
  // never permanently stuck — and so aiming visibly pivots against the wall
  // surface instead of clipping into it.
  for (const o of obstacles) {
    if (slugY + slugHeight <= o.bottomY || slugY >= o.topY) continue;
    const push = obbPushOut(slug.position.x, slug.position.z, yaw, dims.halfWidth, dims.halfLength, o.x, o.z, o.yaw, o.halfWidth, o.halfDepth);
    if (push) {
      slug.position.x += push.x;
      slug.position.z += push.z;
    }
  }

  // Edge-triggered so holding the button doesn't re-fire every frame — a
  // fresh press is required both for a grounded jump and for launching out
  // of a wall-hop cling, so simply holding Jump through the wall contact
  // does not auto-launch you.
  const jumpHeld = input.jumpHeld();
  const jumpPressed = jumpHeld && !jumpWasHeld;
  jumpWasHeld = jumpHeld;

  if (wallHop) {
    // Clinging: position and gravity are both frozen. The player aims via
    // the turn above; only an explicit Jump press launches, in the aimed
    // direction blended with the wall's normal so it can't fire back into
    // the wall. Timing out with no press just releases into a normal fall.
    wallHop.timer += dt;
    if (jumpPressed) {
      const aimX = Math.sin(yaw);
      const aimZ = Math.cos(yaw);
      let dirX = aimX * 0.75 + wallHop.normal.x * 0.25;
      let dirZ = aimZ * 0.75 + wallHop.normal.z * 0.25;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
      yaw = Math.atan2(dirX, dirZ);
      currentSpeed = WALL_HOP_LAUNCH_SPEED;
      vy = WALL_HOP_POP;
      grounded = false;
      wallHop = null;
      wallHopCooldown = WALL_HOP_COOLDOWN_TIME;
    } else if (wallHop.timer >= WALL_HOP_WINDOW) {
      wallHop = null;
      wallHopCooldown = WALL_HOP_COOLDOWN_TIME;
    }
    slug.position.y = slugY;
    slug.rotation.y = yaw;
  } else {
    if (jumpPressed && grounded) {
      vy = JUMP_VELOCITY;
      grounded = false;
    }

    const prevSlugY = slugY;
    vy -= GRAVITY * dt;
    slugY += vy * dt;

    // The floor is the base ground (0) unless we're falling down onto the
    // top of a platform (a ledge) — "were at or above its top a moment ago"
    // is what keeps a platform from also acting as a solid floor when it's
    // really being approached from the side/below, where it should behave
    // like any other wall instead (handled by collides() below).
    let floor = 0;
    for (const o of obstacles) {
      if (!o.platform || prevSlugY < o.topY - 0.01) continue;
      if (!obbOverlap(slug.position.x, slug.position.z, yaw, dims.halfWidth, dims.halfLength, o.x, o.z, o.yaw, o.halfWidth, o.halfDepth)) continue;
      if (o.topY > floor) floor = o.topY;
    }

    if (slugY <= floor) {
      slugY = floor;
      vy = 0;
      grounded = true;
    } else {
      grounded = false;
    }

    const baseSpeed = 3.0;
    const moveAxis = input.moveAxis();
    const targetSpeed = baseSpeed * dims.speedMultiplier * moveAxis;
    const speedingUp = Math.abs(targetSpeed) > Math.abs(currentSpeed);
    let decelRate;
    if (!grounded) decelRate = AIR_DECEL;
    else decelRate = Math.abs(moveAxis) > 0.01 ? SLIDE_DECEL : STOP_DECEL;
    const rate = speedingUp ? ACCEL_UP : decelRate;
    const maxDelta = rate * dt;
    const diff = targetSpeed - currentSpeed;
    currentSpeed += Math.sign(diff) * Math.min(Math.abs(diff), maxDelta);
    const speed = currentSpeed;

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let desiredX = slug.position.x + forward.x * speed * dt;
    let desiredZ = slug.position.z + forward.z * speed * dt;

    // Contact with a wall while airborne starts a cling instead of moving
    // into it — the actual launch only happens above, on a Jump press.
    // Grounded contact is unaffected: walking into a wall on the ground
    // still just blocks/slides, same as always.
    wallHopCooldown = Math.max(0, wallHopCooldown - dt);
    if (!grounded && wallHopCooldown <= 0 && collides(desiredX, desiredZ, yaw, dims.halfWidth, dims.halfLength)) {
      const normal = findWallNormal(desiredX, desiredZ, yaw, dims.halfWidth, dims.halfLength);
      if (normal) {
        wallHop = { normal, timer: 0 };
        currentSpeed = 0;
        vy = 0;
      }
      desiredX = slug.position.x;
      desiredZ = slug.position.z;
    }

    const [rx, rz] = resolveMove(desiredX, desiredZ, dims.halfWidth, dims.halfLength);
    slug.position.x = rx;
    slug.position.z = rz;
    slug.position.y = slugY;
    slug.rotation.y = yaw;
  }

  wallhopLabel.textContent = wallHop ? 'wall hop: aim + press Jump!' : '';

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

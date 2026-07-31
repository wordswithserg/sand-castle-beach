import * as THREE from 'three';

// Base (Normal-state) half-extents of the slug's footprint, in world units.
export const BASE = {
  halfWidth: 0.28,   // x
  height: 0.5,        // y (feet sit at y = 0)
  halfLength: 0.55,   // z
};

// Target non-uniform scale for each skulk mode. z (length) stays 1 for the
// skulk modes — only the cross-section morphs there, which is the whole
// point of the mechanic. `cling` (pressed flat against a wall mid wall-hop)
// is the one mode that also squashes z, since it's meant to read as "splatted
// against a flat surface" rather than a cross-section change.
const MODE_SCALE = {
  normal: { x: 1.0, y: 1.0, z: 1.0 },
  wide: { x: 1.5, y: 0.5, z: 1.0 },   // short & wide — ducks under overhangs
  tall: { x: 0.5, y: 1.7, z: 1.0 },   // tall & narrow — slips through slits
  roll: { x: 0.75, y: 0.75, z: 1.0 }, // curled into a rough ball
  cling: { x: 1.3, y: 0.85, z: 0.3 }, // pressed flat against a wall
};

const MODE_SPEED = {
  normal: 1.0,
  wide: 0.75,
  tall: 0.85,
  roll: 2.2,
  cling: 0,
};

function speckleMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.6 });
}

function bodyMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xd8c23a, roughness: 0.35, metalness: 0.05 });
}

function makeBodyGeometry() {
  // Profile traced tail -> nose (radius, heightAlongAxis), revolved into a
  // tapered, football-ish slug body.
  const pts = [
    new THREE.Vector2(0.02, 0.0),
    new THREE.Vector2(0.22, 0.12),
    new THREE.Vector2(0.34, 0.32),
    new THREE.Vector2(0.36, 0.52),
    new THREE.Vector2(0.32, 0.72),
    new THREE.Vector2(0.2, 0.9),
    new THREE.Vector2(0.08, 0.98),
    new THREE.Vector2(0.0, 1.0),
  ].map((v) => new THREE.Vector2(v.x, v.y * 1.1));
  return new THREE.LatheGeometry(pts, 20);
}

function makeEyeStalk() {
  const group = new THREE.Group();
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0xcdb84a, roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.2 });

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.26, 8), stalkMat);
  stalk.position.y = 0.13;
  group.add(stalk);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), eyeMat);
  eye.position.y = 0.27;
  group.add(eye);

  group.rotation.x = -0.35; // splay forward/up
  return group;
}

export function createSlug() {
  const root = new THREE.Group(); // sits at ground level, yaw lives here
  const visual = new THREE.Group(); // everything that squashes/stretches
  root.add(visual);

  // Body: built vertically by LatheGeometry, then laid flat along +Z (nose forward).
  const body = new THREE.Mesh(makeBodyGeometry(), bodyMaterial());
  body.rotation.x = Math.PI / 2;
  body.position.z = -BASE.halfLength; // tail at back, nose toward +Z
  body.scale.set(0.85, 0.85, BASE.halfLength * 2);
  body.castShadow = true;
  body.receiveShadow = true;
  visual.add(body);

  // Mantle / saddle bump near the front third of the back.
  const mantle = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    bodyMaterial(),
  );
  mantle.scale.set(1.0, 0.35, 0.75);
  mantle.position.set(0, 0.28, 0.05);
  mantle.castShadow = true;
  visual.add(mantle);

  // A handful of speckles scattered on the back.
  const speckleGeo = new THREE.SphereGeometry(0.035, 6, 6);
  const specklePositions = [
    [0.12, 0.22, 0.3], [-0.14, 0.2, 0.15], [0.05, 0.24, -0.1],
    [-0.08, 0.18, -0.3], [0.16, 0.16, -0.25], [0.0, 0.26, 0.45],
    [-0.15, 0.15, 0.4], [0.1, 0.14, -0.45],
  ];
  for (const [x, y, z] of specklePositions) {
    const s = new THREE.Mesh(speckleGeo, speckleMaterial());
    s.position.set(x, y, z);
    s.scale.y = 0.5;
    visual.add(s);
  }

  // Eye stalks (rhinophores) up near the nose.
  const eyeGroup = new THREE.Group();
  const leftEye = makeEyeStalk();
  leftEye.position.set(-0.09, 0.22, 0.62);
  leftEye.rotation.z = 0.15;
  const rightEye = makeEyeStalk();
  rightEye.position.set(0.09, 0.22, 0.62);
  rightEye.rotation.z = -0.15;
  eyeGroup.add(leftEye, rightEye);
  visual.add(eyeGroup);

  root.userData = {
    visual,
    eyeGroup,
    mode: 'normal',
    currentScale: new THREE.Vector3(1, 1, 1),
    rollSpin: 0,
  };

  return root;
}

// Smoothly drives the slug's visual toward `mode`, spins it while rolling,
// and returns the CURRENT (already-interpolated) world half-extents so
// collision reflects what the slug actually looks like right now.
export function updateSlug(slug, mode, speedAlongForward, dt) {
  const state = slug.userData;
  state.mode = mode;
  const target = MODE_SCALE[mode];

  // Cling gets the fastest lerp of all — the wall-hop aim window is very
  // short (0.1s in main.js), so the squash needs to read as "already stuck
  // to the wall" almost immediately on contact rather than still easing in
  // by the time the window closes.
  const lerpSpeed = mode === 'roll' ? 10 : mode === 'cling' ? 22 : 7;
  const t = 1 - Math.exp(-lerpSpeed * dt);
  state.currentScale.x += (target.x - state.currentScale.x) * t;
  state.currentScale.y += (target.y - state.currentScale.y) * t;
  state.currentScale.z += (target.z - state.currentScale.z) * t;

  state.visual.scale.copy(state.currentScale);

  // Tuck eye stalks in while rolling or clinging, otherwise keep them out.
  const eyeTarget = mode === 'roll' ? 0.05 : mode === 'cling' ? 0.6 : 1.0;
  state.eyeGroup.scale.setScalar(
    state.eyeGroup.scale.x + (eyeTarget - state.eyeGroup.scale.x) * t,
  );

  if (mode === 'roll') {
    // Wrapped to (-PI, PI] on every accumulation, not left to grow
    // unbounded — a long roll (especially one carried through a jump) would
    // otherwise build up many full turns, and unwinding that on exit would
    // visibly spin the model through all of them instead of a small offset.
    let spin = (state.rollSpin + speedAlongForward * dt * 3.2) % (Math.PI * 2);
    if (spin > Math.PI) spin -= Math.PI * 2;
    else if (spin < -Math.PI) spin += Math.PI * 2;
    state.rollSpin = spin;
    state.visual.rotation.x = state.rollSpin;
  } else {
    state.visual.rotation.x *= 1 - Math.min(1, t * 2);
  }

  return {
    halfWidth: BASE.halfWidth * state.currentScale.x,
    height: BASE.height * state.currentScale.y,
    halfLength: BASE.halfLength * state.currentScale.z,
    speedMultiplier: MODE_SPEED[mode],
  };
}

export { MODE_SCALE, MODE_SPEED };

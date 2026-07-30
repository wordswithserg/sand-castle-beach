import * as THREE from 'three';

function sandTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e3c88f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random() * 40 - 20;
    ctx.fillStyle = `rgba(${140 + shade}, ${110 + shade}, ${60 + shade}, 0.25)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 60);
  return tex;
}

function makeSignSprite(text, color = '#2b2b2b') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,250,235,0.92)';
  roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 20);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 20);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, text, canvas.width / 2, canvas.height / 2, canvas.width - 40, 42);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.6, 0.98, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, cx, cy, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

function wallMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xb99a63, roughness: 0.9 });
}

function platformMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xd7a94a, roughness: 0.75 });
}

// obstacles: array of boxes { x, z, yaw, halfWidth, halfDepth, bottomY, topY, id, platform }.
// `yaw` lets a wall sit at an angle instead of only ever facing the corridor
// straight-on — that's what makes a wall-hop bounce actually redirect you
// somewhere new rather than straight back the way you came. `platform: true`
// marks an obstacle as something you can land and stand on top of (a ledge)
// rather than a pure side wall — see the landing check in main.js.
export function buildWorld(scene) {
  const obstacles = [];
  const group = new THREE.Group();
  scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 100),
    new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 35);
  ground.receiveShadow = true;
  group.add(ground);

  function addBox({ x, z, yaw = 0, halfWidth, halfDepth, bottomY, topY, id, platform = false }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2, topY - bottomY, halfDepth * 2),
      platform ? platformMaterial() : wallMaterial(),
    );
    mesh.position.set(x, (bottomY + topY) / 2, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    obstacles.push({ x, z, yaw, halfWidth, halfDepth, bottomY, topY, id, platform });
  }

  // --- Corridor boundary walls (too tall to skulk or jump over) so every
  // gate actually has to be engaged with, not walked around in open sand ---
  const CORRIDOR_HALF = 2.7;
  const CORRIDOR_Z = 23;
  const CORRIDOR_HALF_LEN = 27;
  addBox({ x: -CORRIDOR_HALF, z: CORRIDOR_Z, halfWidth: 0.15, halfDepth: CORRIDOR_HALF_LEN, bottomY: 0, topY: 2.6, id: 'boundaryL' });
  addBox({ x: CORRIDOR_HALF, z: CORRIDOR_Z, halfWidth: 0.15, halfDepth: CORRIDOR_HALF_LEN, bottomY: 0, topY: 2.6, id: 'boundaryR' });

  // --- Gate 1: crawlspace overhang (forces WIDE & SHORT) ---
  const GATE1_Z = 9;
  addBox({ x: 0, z: GATE1_Z, halfWidth: 2.5, halfDepth: 0.3, bottomY: 0.35, topY: 2.2, id: 'gate1' });
  group.add(placeSign(makeSignSprite('Duck low — hold C to go WIDE'), 0, 1.6, GATE1_Z - 1.6));

  // --- Gate 2: narrow slit (forces TALL & NARROW) ---
  const GATE2_Z = 16;
  const OPENING = 0.45;
  addBox({ x: -(OPENING / 2 + 1.1375), z: GATE2_Z, halfWidth: 1.1375, halfDepth: 0.3, bottomY: 0, topY: 2.2, id: 'gate2L' });
  addBox({ x: (OPENING / 2 + 1.1375), z: GATE2_Z, halfWidth: 1.1375, halfDepth: 0.3, bottomY: 0, topY: 2.2, id: 'gate2R' });
  group.add(placeSign(makeSignSprite('Squeeze through — hold V to go TALL'), 0, 1.6, GATE2_Z - 1.6));

  // --- Low wall (forces JUMP — solid to the ground, too tall to skulk under) ---
  const JUMP_Z = 20;
  addBox({ x: 0, z: JUMP_Z, halfWidth: 2.5, halfDepth: 0.22, bottomY: 0, topY: 0.55, id: 'jumpwall' });
  group.add(placeSign(makeSignSprite('Hop over — press Space to JUMP'), 0, 1.6, JUMP_Z - 1.6));

  // --- Roll runway with weave pillars ---
  const pillarXs = [-1.4, 1.4, -0.9, 0.9];
  pillarXs.forEach((x, i) => {
    const z = 24 + i * 2.5;
    addBox({ x, z, halfWidth: 0.25, halfDepth: 0.25, bottomY: 0, topY: 1.2, id: `pillar${i}` });
  });
  group.add(placeSign(makeSignSprite('Open stretch — hold Shift to ROLL'), 0, 1.6, 23));

  // --- Wall hop zone: jump into an angled wall while airborne to bounce off
  // it. Each wall is yawed so a straight-on approach gets redirected toward
  // the ledge past it rather than just bouncing back the way you came. ---
  const HOP_Z = 34;
  addBox({ x: -1.0, z: HOP_Z, yaw: 0.4, halfWidth: 1.3, halfDepth: 0.15, bottomY: 0, topY: 2.0, id: 'hopWallA' });
  addBox({ x: 1.6, z: HOP_Z + 1.5, halfWidth: 0.9, halfDepth: 0.9, bottomY: 0, topY: 1.1, id: 'ledgeA', platform: true });
  addBox({ x: 1.0, z: HOP_Z + 5, yaw: -0.4, halfWidth: 1.3, halfDepth: 0.15, bottomY: 0, topY: 2.0, id: 'hopWallB' });
  addBox({ x: -1.6, z: HOP_Z + 6.5, halfWidth: 0.9, halfDepth: 0.9, bottomY: 0, topY: 1.5, id: 'ledgeB', platform: true });
  group.add(placeSign(makeSignSprite('Wall hop: jump into an angled wall to bounce off it'), 0, 1.6, HOP_Z - 1.6));

  // --- Start sign ---
  group.add(placeSign(makeSignSprite('W/S move, A/D turn, C wide, V tall, Space jump, Shift roll'), 0, 1.6, -1.5));

  // --- Goal marker ---
  const goal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.35, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd35c, roughness: 0.2, metalness: 0.3, emissive: 0x553600, emissiveIntensity: 0.3 }),
  );
  goal.position.set(0, 0.6, 48);
  goal.castShadow = true;
  group.add(goal);
  group.add(placeSign(makeSignSprite('Treasure! Demo course complete'), 0, 1.7, 47));

  return { obstacles, goalMesh: goal };
}

function placeSign(sprite, x, y, z) {
  sprite.position.set(x, y, z);
  return sprite;
}

function boxAxes(yaw) {
  return [
    { x: Math.cos(yaw), z: -Math.sin(yaw) }, // local right
    { x: Math.sin(yaw), z: Math.cos(yaw) },  // local forward
  ];
}

function boxCorners(cx, cz, yaw, halfWidth, halfDepth) {
  const [right, fwd] = boxAxes(yaw);
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corners.push({
        x: cx + right.x * halfWidth * sx + fwd.x * halfDepth * sz,
        z: cz + right.z * halfWidth * sx + fwd.z * halfDepth * sz,
      });
    }
  }
  return corners;
}

function project(corners, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const d = c.x * axis.x + c.z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// Exact SAT overlap test between two rectangles in the XZ plane, each with
// its own yaw. Obstacles in this world are axis-aligned (yaw 0), but the
// slug rotates freely, so a true rotated-box test is required — a
// rotated-AABB approximation over-penalizes long thin shapes at even a
// small facing angle.
export function obbOverlap(ax, az, ayaw, ahw, ahd, bx, bz, byaw, bhw, bhd) {
  const cornersA = boxCorners(ax, az, ayaw, ahw, ahd);
  const cornersB = boxCorners(bx, bz, byaw, bhw, bhd);
  const axes = [...boxAxes(ayaw), ...boxAxes(byaw)];
  for (const axis of axes) {
    const [minA, maxA] = project(cornersA, axis);
    const [minB, maxB] = project(cornersB, axis);
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

// Turning happens in place with no collision check (rotation shouldn't be
// gated on obstacles the way translation is), so a rotated long-thin box can
// end up wedged into a wall corner it wasn't touching before it turned.
// Move-only sliding can then get permanently stuck: every forward-biased
// single-axis option still leaves a corner inside the wall. This returns the
// minimum-translation push (least-penetration axis, à la MTV) to clear box A
// out of box B, or null if they don't currently overlap — call once per
// obstacle per frame before resolving movement, so the slug is never left
// wedged no matter how it got there.
export function obbPushOut(ax, az, ayaw, ahw, ahd, bx, bz, byaw, bhw, bhd) {
  const cornersA = boxCorners(ax, az, ayaw, ahw, ahd);
  const cornersB = boxCorners(bx, bz, byaw, bhw, bhd);
  const axes = [...boxAxes(ayaw), ...boxAxes(byaw)];
  let minOverlap = Infinity;
  let pushAxis = null;
  for (const axis of axes) {
    const [minA, maxA] = project(cornersA, axis);
    const [minB, maxB] = project(cornersB, axis);
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      pushAxis = axis;
    }
  }
  const dot = (ax - bx) * pushAxis.x + (az - bz) * pushAxis.z;
  const dir = dot < 0 ? -1 : 1;
  return { x: pushAxis.x * minOverlap * dir, z: pushAxis.z * minOverlap * dir };
}

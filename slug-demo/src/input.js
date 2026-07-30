// Keyboard + gamepad (DualSense/Xbox, anything Chrome maps to the
// "standard" gamepad layout) merged into one input surface.
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

window.addEventListener('gamepadconnected', (e) => {
  console.log(`[gamepad] connected: "${e.gamepad.id}" mapping=${e.gamepad.mapping || '(none)'}`);
});
window.addEventListener('gamepaddisconnected', (e) => {
  console.log(`[gamepad] disconnected: "${e.gamepad.id}"`);
});

const DEADZONE = 0.2;

// The 'gamepadconnected' event only fires for a connection that happens
// while the page is listening — it's unreliable if the controller was
// already on before the page loaded, or on some Bluetooth stacks. Poll
// navigator.getGamepads() directly instead and just take the first
// non-null slot; this is what actually detects the controller reliably.
function pad() {
  if (!navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  for (const p of pads) {
    if (p) return p;
  }
  return null;
}

function axis(i) {
  const p = pad();
  if (!p) return 0;
  const v = p.axes[i] || 0;
  return Math.abs(v) > DEADZONE ? v : 0;
}

function button(i) {
  const p = pad();
  return !!(p && p.buttons[i] && p.buttons[i].pressed);
}

export const input = {
  keys,
  isGamepadConnected: () => pad() !== null,
  gamepadInfo: () => {
    const p = pad();
    return p ? { id: p.id, mapping: p.mapping } : null;
  },

  // -1..1, forward positive
  moveAxis() {
    let v = 0;
    if (keys.has('w')) v += 1;
    if (keys.has('s')) v -= 0.6;
    const stick = -axis(1); // left stick Y: up is negative on the axis
    if (stick !== 0) v = stick > 0 ? stick : stick * 0.6;
    return v;
  },

  // -1..1, positive turns left (matches the keyboard A/D convention)
  turnAxis() {
    let v = 0;
    if (keys.has('a')) v += 1;
    if (keys.has('d')) v -= 1;
    const stick = axis(0);
    if (stick !== 0) v = -stick;
    return v;
  },

  wide: () => keys.has('c') || button(2), // Square
  tall: () => keys.has('v') || button(3), // Triangle
  roll: () => keys.has('shift') || button(5) || button(7), // R1 / R2
  jumpHeld: () => keys.has(' ') || button(0), // Cross
};

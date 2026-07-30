// Keyboard + gamepad (DualSense/Xbox, anything Chrome maps to the
// "standard" gamepad layout) merged into one input surface.
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

let gamepadIndex = null;
window.addEventListener('gamepadconnected', (e) => {
  gamepadIndex = e.gamepad.index;
});
window.addEventListener('gamepaddisconnected', (e) => {
  if (gamepadIndex === e.gamepad.index) gamepadIndex = null;
});

const DEADZONE = 0.2;

function pad() {
  if (gamepadIndex === null) return null;
  // Firefox/Chrome invalidate cached Gamepad objects; re-poll every call.
  return navigator.getGamepads()[gamepadIndex] || null;
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
  isGamepadConnected: () => gamepadIndex !== null,

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

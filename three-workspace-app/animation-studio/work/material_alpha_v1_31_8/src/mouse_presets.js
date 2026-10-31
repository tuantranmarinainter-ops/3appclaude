// SPDX-License-Identifier: GPL-3.0-or-later
// Camera bindings expressed using the existing App 3 settings fields.
// Blender, Maya and Cinema 4D gestures follow the upstream keymap files at
// Blockbench ec0b282; these factual bindings are mapped onto App 3 controls.
export const MOUSE_PRESETS = Object.freeze({
  mouse: { orbitButton:'0', orbitModifier:'none', panButton:'1', panModifier:'none', zoomButton:'2', zoomModifier:'none', zoomWheel:true },
  trackpad: { orbitButton:'0', orbitModifier:'none', panButton:'0', panModifier:'shift', zoomButton:'0', zoomModifier:'ctrl', zoomWheel:true },
  blender: { orbitButton:'1', orbitModifier:'none', panButton:'1', panModifier:'shift', zoomButton:'1', zoomModifier:'ctrl', zoomWheel:true },
  maya: { orbitButton:'0', orbitModifier:'alt', panButton:'1', panModifier:'alt', zoomButton:'2', zoomModifier:'alt', zoomWheel:true },
  cinema4d: { orbitButton:'0', orbitModifier:'alt', panButton:'1', panModifier:'alt', zoomButton:'0', zoomModifier:'shift', zoomWheel:true },
});
export function mousePreset(name) {
  const preset = MOUSE_PRESETS[name];
  return preset ? { ...preset } : null;
}

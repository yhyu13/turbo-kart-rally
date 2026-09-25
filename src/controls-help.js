// The key/gamepad legend, shared by the character-select screen, the pause panel and the in-race HUD
// corner. One source of truth so a new binding never shows up in only one of them.
export const CONTROLS_HTML = `
  <div class="ctl"><span class="kc">↑</span><span class="kc">W</span> Accelerate</div>
  <div class="ctl"><span class="kc">↓</span><span class="kc">S</span> Brake / Reverse</div>
  <div class="ctl"><span class="kc">←→</span><span class="kc">A D</span> Steer</div>
  <div class="ctl"><span class="kc wide">SPACE</span> Hop / Drift</div>
  <div class="ctl"><span class="kc">E</span><span class="kc">X</span><span class="kc wide">L-SHIFT</span> Use item</div>
  <div class="ctl"><span class="kc">C</span> Look back</div>
  <div class="ctl"><span class="kc wide">ESC</span><span class="kc">P</span> Pause</div>
  <div class="ctl"><span class="kc">M</span> Mute</div>`;

/** The one-liner that sits in the HUD corner: the keys you actually need while driving. */
export const CONTROLS_STRIP_HTML = `
  <span class="kc">W</span> GAS
  <span class="kc wide">SPACE</span> DRIFT
  <span class="kc">E</span> ITEM
  <span class="kc">C</span> LOOK
  <span class="kc">H</span> KEYS`;

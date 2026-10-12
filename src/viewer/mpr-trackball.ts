/**
 * mpr-trackball.ts — MPR Trackball UI component skeleton (spec 007, TK-30 Phase 2).
 *
 * Programmatic DOM construction for the trackball control group on the MPR toolbar.
 * WCAG 2.2 AA compliant structure:
 *  - Native <input type="range"> sliders provide accessible 1-pointer / keyboard controls (2.5.7).
 *  - Virtual sphere element is marked aria-hidden="true".
 *  - Readout output has aria-live="off" to avoid spamming screen readers per drag event.
 */

export interface MprTrackballHandle {
  el: HTMLElement;
  sphere: HTMLElement;
  pitchInput: HTMLInputElement;
  yawInput: HTMLInputElement;
  readout: HTMLOutputElement;
  resetButton: HTMLButtonElement;
  destroy: () => void;
}

/**
 * Creates and returns the DOM skeleton for the MPR trackball control group.
 */
export function createMprTrackball(): MprTrackballHandle {
  const root = document.createElement("div");
  root.className = "mpr-trackball";
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", "mpr-trackball-label");

  // Accessible group title
  const labelSpan = document.createElement("span");
  labelSpan.id = "mpr-trackball-label";
  labelSpan.setAttribute("data-i18n", "viewer.mpr.trackball.label");
  root.appendChild(labelSpan);

  // Pointer-only virtual trackball sphere (aria-hidden)
  const sphere = document.createElement("div");
  sphere.className = "mpr-trackball-sphere";
  sphere.setAttribute("aria-hidden", "true");
  root.appendChild(sphere);

  // Pitch accessible slider (range [-90, 90])
  const pitchLabel = document.createElement("label");
  const pitchSpan = document.createElement("span");
  pitchSpan.setAttribute("data-i18n", "viewer.mpr.trackball.pitch");
  pitchLabel.appendChild(pitchSpan);

  const pitchInput = document.createElement("input");
  pitchInput.type = "range";
  pitchInput.className = "mpr-trackball-pitch";
  pitchInput.min = "-90";
  pitchInput.max = "90";
  pitchInput.step = "1";
  pitchInput.value = "0";
  pitchLabel.appendChild(pitchInput);
  root.appendChild(pitchLabel);

  // Yaw accessible slider (range [-180, 180])
  const yawLabel = document.createElement("label");
  const yawSpan = document.createElement("span");
  yawSpan.setAttribute("data-i18n", "viewer.mpr.trackball.yaw");
  yawLabel.appendChild(yawSpan);

  const yawInput = document.createElement("input");
  yawInput.type = "range";
  yawInput.className = "mpr-trackball-yaw";
  yawInput.min = "-180";
  yawInput.max = "180";
  yawInput.step = "1";
  yawInput.value = "0";
  yawLabel.appendChild(yawInput);
  root.appendChild(yawLabel);

  // Angle readout output
  const readout = document.createElement("output");
  readout.className = "mpr-trackball-readout";
  readout.setAttribute("aria-live", "off");
  root.appendChild(readout);

  // Reset button to return to canonical orthogonal axes
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mpr-trackball-reset";
  resetButton.setAttribute(
    "data-i18n-attr",
    "aria-label:viewer.mpr.trackball.reset; title:viewer.mpr.trackball.reset",
  );
  root.appendChild(resetButton);

  const destroy = (): void => {
    // Teardown placeholder for event listeners (wired in later phases)
  };

  return {
    el: root,
    sphere,
    pitchInput,
    yawInput,
    readout,
    resetButton,
    destroy,
  };
}

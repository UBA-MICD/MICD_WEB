import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { createMprTrackball } from "./mpr-trackball.ts";
import { mprCoordinator } from "./mpr-coordinator.ts";
import { view3DViewer } from "./view-3d.ts";
import { state } from "./state.ts";
import { initViewportManager } from "./viewport-registry.ts";

test.before(() => {
  installDom();
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
});
test.after(() => uninstallDom());

beforeEach(() => {
  document.body.innerHTML = "";
  state.is3DMode = false;
  mprCoordinator.resetToOrthogonal();
  view3DViewer.resetCamera();
});

afterEach(() => {
  document.body.innerHTML = "";
  state.is3DMode = false;
  mprCoordinator.resetToOrthogonal();
  view3DViewer.resetCamera();
});

test("createMprTrackball: returns root container with role='group' and aria-labelledby", () => {
  const handle = createMprTrackball();
  assert.equal(handle.el.tagName.toLowerCase(), "div");
  assert.ok(handle.el.classList.contains("mpr-trackball"));
  assert.equal(handle.el.getAttribute("role"), "group");
  assert.equal(
    handle.el.getAttribute("aria-labelledby"),
    "mpr-trackball-label",
  );
});

test("createMprTrackball: contains accessible label span with data-i18n key", () => {
  const { el } = createMprTrackball();
  const label = el.querySelector("#mpr-trackball-label");
  assert.ok(label, "label span with id='mpr-trackball-label' exists");
  assert.equal(label?.getAttribute("data-i18n"), "viewer.mpr.trackball.label");
});

test("createMprTrackball: contains virtual trackball sphere marked aria-hidden='true'", () => {
  const handle = createMprTrackball();
  const sphere = handle.el.querySelector(".mpr-trackball-sphere");
  assert.ok(sphere, "sphere div exists");
  assert.equal(handle.sphere, sphere);
  assert.equal(sphere?.getAttribute("aria-hidden"), "true");
});

test("createMprTrackball: contains pitch slider with correct range constraints", () => {
  const handle = createMprTrackball();
  const pitchInput = handle.el.querySelector(
    "input.mpr-trackball-pitch",
  ) as HTMLInputElement;
  assert.ok(pitchInput, "pitch input exists");
  assert.equal(handle.pitchInput, pitchInput);
  assert.equal(pitchInput.type, "range");
  assert.equal(pitchInput.min, "-90");
  assert.equal(pitchInput.max, "90");
  assert.equal(pitchInput.step, "1");
  assert.equal(pitchInput.value, "0");

  const label = pitchInput.closest("label");
  assert.ok(label, "pitch input is wrapped in label");
  const span = label?.querySelector("span");
  assert.equal(span?.getAttribute("data-i18n"), "viewer.mpr.trackball.pitch");
});

test("createMprTrackball: contains yaw slider with correct range constraints", () => {
  const handle = createMprTrackball();
  const yawInput = handle.el.querySelector(
    "input.mpr-trackball-yaw",
  ) as HTMLInputElement;
  assert.ok(yawInput, "yaw input exists");
  assert.equal(handle.yawInput, yawInput);
  assert.equal(yawInput.type, "range");
  assert.equal(yawInput.min, "-180");
  assert.equal(yawInput.max, "180");
  assert.equal(yawInput.step, "1");
  assert.equal(yawInput.value, "0");

  const label = yawInput.closest("label");
  assert.ok(label, "yaw input is wrapped in label");
  const span = label?.querySelector("span");
  assert.equal(span?.getAttribute("data-i18n"), "viewer.mpr.trackball.yaw");
});

test("createMprTrackball: contains angle readout element with aria-live='off'", () => {
  const handle = createMprTrackball();
  const readout = handle.el.querySelector("output.mpr-trackball-readout");
  assert.ok(readout, "readout element exists");
  assert.equal(handle.readout, readout);
  assert.equal(readout?.getAttribute("aria-live"), "off");
});

test("createMprTrackball: contains reset button with type='button' and data-i18n-attr", () => {
  const handle = createMprTrackball();
  const button = handle.el.querySelector(
    "button.mpr-trackball-reset",
  ) as HTMLButtonElement;
  assert.ok(button, "reset button exists");
  assert.equal(handle.resetButton, button);
  assert.equal(button.type, "button");
  assert.equal(
    button.getAttribute("data-i18n-attr"),
    "aria-label:viewer.mpr.trackball.reset; title:viewer.mpr.trackball.reset",
  );
});

test("createMprTrackball: destroy() executes cleanly without throwing", () => {
  const handle = createMprTrackball();
  assert.equal(typeof handle.destroy, "function");
  assert.doesNotThrow(() => handle.destroy());
});

test("mpr-trackball: pointerdown on sphere sets data-dragging only for primary button", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // Non-primary click (e.g. right-click button = 2)
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", { button: 2, bubbles: true }),
  );
  assert.equal(handle.el.hasAttribute("data-dragging"), false);
  assert.equal(handle.sphere.hasAttribute("data-dragging"), false);

  // Primary click (button = 0)
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );
  assert.equal(handle.el.getAttribute("data-dragging"), "true");
  assert.equal(handle.sphere.getAttribute("data-dragging"), "true");

  handle.destroy();
});

test("mpr-trackball: dragging sphere updates pitch, yaw, and readout", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // Start drag at (100, 100)
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );

  // Move right by 10px (dx = 10 -> yaw ~ 10°) and down by 5px (dy = 5 -> pitch ~ 5°)
  handle.sphere.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 110,
      clientY: 105,
      bubbles: true,
    }),
  );

  const { pitch, yaw } = mprCoordinator.getPitchYawDegrees();
  assert.ok(Math.abs(yaw - 10) < 0.5, `expected yaw ~10, got ${yaw}`);
  assert.ok(handle.readout.textContent?.includes(`Pitch ${pitch.toFixed(1)}°`));
  assert.ok(handle.readout.textContent?.includes(`Yaw ${yaw.toFixed(1)}°`));

  // Release drag
  handle.sphere.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  assert.equal(handle.el.hasAttribute("data-dragging"), false);
  assert.equal(handle.sphere.hasAttribute("data-dragging"), false);

  handle.destroy();
});

test("mpr-trackball: dragging with Shift key applies 0.1x fine sensitivity", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );

  // Move right 10px with Shift held -> 10 * 0.1 = 1.0° yaw
  handle.sphere.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 110,
      clientY: 100,
      shiftKey: true,
      bubbles: true,
    }),
  );

  const { pitch, yaw } = mprCoordinator.getPitchYawDegrees();
  assert.ok(Math.abs(yaw - 1.0) < 0.2, `expected fine yaw ~1.0, got ${yaw}`);
  assert.ok(
    Math.abs(pitch - 0.0) < 0.1,
    `expected fine pitch ~0.0, got ${pitch}`,
  );

  handle.sphere.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  handle.destroy();
});

test("mpr-trackball: pointercancel ends dragging cleanly", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );
  assert.equal(handle.sphere.getAttribute("data-dragging"), "true");

  handle.sphere.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true }),
  );
  assert.equal(handle.sphere.hasAttribute("data-dragging"), false);

  handle.destroy();
});

test("mpr-trackball: accessible slider input updates coordinator pitch and yaw", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.pitchInput.value = "25";
  handle.pitchInput.dispatchEvent(new Event("input", { bubbles: true }));

  let degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.pitch - 25) < 0.5,
    `expected pitch ~25, got ${degrees.pitch}`,
  );

  mprCoordinator.resetToOrthogonal();

  handle.yawInput.value = "-40";
  handle.yawInput.dispatchEvent(new Event("input", { bubbles: true }));

  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.yaw - -40) < 0.5,
    `expected yaw ~ -40, got ${degrees.yaw}`,
  );

  handle.destroy();
});

test("mpr-trackball: slider keyboard controls increment / decrement values", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // ArrowUp on pitch slider -> +1 deg
  handle.pitchInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    }),
  );
  let degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.pitch - 1) < 0.2,
    `expected pitch ~1, got ${degrees.pitch}`,
  );

  // Shift+ArrowUp on pitch slider -> +10 deg
  handle.pitchInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowUp",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.pitch - 11) < 0.3,
    `expected pitch ~11, got ${degrees.pitch}`,
  );

  // PageDown on pitch slider -> -15 deg
  handle.pitchInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.pitch - -4) < 0.3,
    `expected pitch ~ -4, got ${degrees.pitch}`,
  );

  // ArrowRight on yaw slider -> +1 deg
  handle.yawInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.yaw - 1) < 0.2,
    `expected yaw ~1, got ${degrees.yaw}`,
  );

  // Shift+ArrowLeft on yaw slider -> -10 deg
  handle.yawInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.yaw - -9) < 0.3,
    `expected yaw ~ -9, got ${degrees.yaw}`,
  );

  // PageUp on yaw slider -> +15 deg
  handle.yawInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "PageUp",
      bubbles: true,
      cancelable: true,
    }),
  );
  degrees = mprCoordinator.getPitchYawDegrees();
  assert.ok(
    Math.abs(degrees.yaw - 6) < 0.3,
    `expected yaw ~6, got ${degrees.yaw}`,
  );

  handle.destroy();
});

test("mpr-trackball: reset button restores orthogonal axes and announces via live region", () => {
  const announceEl = document.createElement("div");
  announceEl.id = "measure-announce";
  document.body.appendChild(announceEl);

  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // Rotate first
  mprCoordinator.rotatePitchYaw(0.5, 0.5, "axial");
  assert.notEqual(mprCoordinator.getPitchYawDegrees().pitch, 0);

  // Click reset
  handle.resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const { pitch, yaw } = mprCoordinator.getPitchYawDegrees();
  assert.equal(pitch, 0);
  assert.equal(yaw, 0);
  assert.equal(handle.pitchInput.value, "0");
  assert.equal(handle.yawInput.value, "0");
  assert.ok(handle.readout.textContent?.includes("Pitch 0.0°"));
  assert.ok(handle.readout.textContent?.includes("Yaw 0.0°"));
  assert.ok(
    announceEl.textContent?.includes("Planos restablecidos a ortogonales") ||
      announceEl.textContent!.length > 0,
  );

  handle.destroy();
});

test("mpr-trackball: synchronizes reactively with external coordinator rotation changes", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  const DEG_TO_RAD = Math.PI / 180;
  mprCoordinator.rotatePitchYaw(20 * DEG_TO_RAD, 0, "axial");

  assert.equal(handle.pitchInput.value, "20");
  assert.equal(handle.yawInput.value, "0");
  assert.ok(handle.readout.textContent?.includes("Pitch 20.0°"));
  assert.ok(handle.readout.textContent?.includes("Yaw 0.0°"));

  handle.destroy();
});

test("mpr-trackball: destroy removes coordinator listener and DOM listeners", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.destroy();

  const initialText = handle.readout.textContent;
  mprCoordinator.rotatePitchYaw(0.3, 0.3, "axial");
  assert.equal(handle.readout.textContent, initialText);
});

test("mpr-trackball: toggleButton toggles popover panel visibility", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  assert.ok(handle.toggleButton, "toggleButton exists");
  assert.ok(handle.popover, "popover exists");
  assert.ok(
    handle.popover.classList.contains("hidden"),
    "popover starts hidden",
  );
  assert.equal(handle.toggleButton.getAttribute("aria-expanded"), "false");

  // Click toggleButton to open
  handle.toggleButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(handle.popover.classList.contains("hidden"), false);
  assert.equal(handle.toggleButton.getAttribute("aria-expanded"), "true");
  assert.ok(handle.toggleButton.classList.contains("active"));

  // Click toggleButton to close
  handle.toggleButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(handle.popover.classList.contains("hidden"), true);
  assert.equal(handle.toggleButton.getAttribute("aria-expanded"), "false");
  assert.equal(handle.toggleButton.classList.contains("active"), false);

  handle.destroy();
});

test("mpr-trackball: Escape key closes the popover menu", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.openPopover();
  assert.equal(handle.popover.classList.contains("hidden"), false);

  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(handle.popover.classList.contains("hidden"), true);
  assert.equal(handle.toggleButton.getAttribute("aria-expanded"), "false");

  handle.destroy();
});

test("mpr-trackball: clicking outside closes the popover menu", () => {
  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.openPopover();
  assert.equal(handle.popover.classList.contains("hidden"), false);

  // Click outside (document.body directly)
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(handle.popover.classList.contains("hidden"), true);

  handle.destroy();
});

test("mpr-trackball: routes dragging to view3DViewer camera safely when is3DMode is active (without forced render)", () => {
  state.is3DMode = true;
  view3DViewer.resetCamera();
  const initTheta = view3DViewer.camera.theta;
  const initPhi = view3DViewer.camera.phi;

  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // Drag sphere right 10px, down 5px
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );
  handle.sphere.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 110,
      clientY: 105,
      bubbles: true,
    }),
  );

  assert.notEqual(view3DViewer.camera.phi, initPhi);
  assert.notEqual(view3DViewer.camera.theta, initTheta);

  const { pitch, yaw } = view3DViewer.getPitchYawDegrees();
  assert.ok(handle.readout.textContent?.includes(`Pitch ${pitch.toFixed(1)}°`));
  assert.ok(handle.readout.textContent?.includes(`Yaw ${yaw.toFixed(1)}°`));

  handle.destroy();
  state.is3DMode = false;
});

test("mpr-trackball: slider input updates view3DViewer camera safely in 3D mode", () => {
  state.is3DMode = true;
  view3DViewer.resetCamera();

  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.pitchInput.value = "20";
  handle.pitchInput.dispatchEvent(new Event("input", { bubbles: true }));

  const { pitch } = view3DViewer.getPitchYawDegrees();
  assert.ok(Math.abs(pitch - 20) < 1, `expected pitch ~20, got ${pitch}`);

  handle.destroy();
  state.is3DMode = false;
});

test("mpr-trackball: reset button resets view3DViewer camera safely in 3D mode", () => {
  state.is3DMode = true;
  view3DViewer.rotatePitchYaw(0.4, 0.5);

  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  handle.resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.equal(view3DViewer.camera.theta, 0.3);
  assert.equal(view3DViewer.camera.phi, 0.8);

  handle.destroy();
  state.is3DMode = false;
});

test("mpr-trackball: context routing between 2x2 combined 3D viewport (vp-3) and orthogonal MPR viewport (vp-0)", () => {
  const container = document.createElement("div");
  container.id = "viewport-container";
  document.body.appendChild(container);
  const manager = initViewportManager(container);
  manager.setLayout("2x2");

  state.is3DMode = false;
  state.isMprMode = true;
  mprCoordinator.resetToOrthogonal();
  view3DViewer.resetCamera();

  const handle = createMprTrackball();
  document.body.appendChild(handle.el);

  // 1. With vp-3 (combined 3D) active, drag should rotate view3DViewer camera
  manager.setActiveViewport("vp-3");
  const init3DTheta = view3DViewer.camera.theta;
  const init3DPhi = view3DViewer.camera.phi;

  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );
  handle.sphere.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 110,
      clientY: 105,
      bubbles: true,
    }),
  );
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
    }),
  );

  assert.notEqual(view3DViewer.camera.phi, init3DPhi);
  assert.notEqual(view3DViewer.camera.theta, init3DTheta);

  // 2. Switch active viewport to vp-0 (Axial MPR), drag should rotate mprCoordinator
  manager.setActiveViewport("vp-0");
  const initMprPitchYaw = mprCoordinator.getPitchYawDegrees();

  handle.sphere.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }),
  );
  handle.sphere.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: 120,
      clientY: 110,
      bubbles: true,
    }),
  );
  handle.sphere.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
    }),
  );

  const newMprPitchYaw = mprCoordinator.getPitchYawDegrees();
  assert.notEqual(newMprPitchYaw.yaw, initMprPitchYaw.yaw);

  handle.destroy();
  state.isMprMode = false;
  manager.destroy();
  container.remove();
});

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { createMprTrackball } from "./mpr-trackball.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
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

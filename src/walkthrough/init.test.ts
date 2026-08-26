/**
 * Tests for init.ts — the Help-button wiring. jsdom for the DOM; the content
 * catalog is still empty at this step, so a launched tour ends immediately.
 * The real "Help launches a visible tour" flow is covered once steps land.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { initWalkthrough } from "./init.ts";
import { isTourActive } from "./walkthrough.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

beforeEach(() => {
  document.body.innerHTML = `<button id="btn-help"></button>`;
});

test("initWalkthrough wires the Help button and clicking it runs the engine", () => {
  initWalkthrough();
  const help = document.getElementById("btn-help") as HTMLButtonElement;
  assert.doesNotThrow(() => help.click());
  // Empty catalog → the run completes without leaving a tour active.
  assert.equal(isTourActive(), false);
  assert.equal(document.querySelector(".walkthrough"), null);
});

test("initWalkthrough tolerates a missing Help button", () => {
  document.body.innerHTML = "";
  assert.doesNotThrow(() => initWalkthrough());
});

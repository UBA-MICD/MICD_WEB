/**
 * Tests for init.ts — the Help-button wiring. jsdom for the DOM. Clicking Help
 * launches the tour for the current role; with no session that's a guest, who
 * gets the common core beginning with the centered welcome step.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { initWalkthrough, maybeAutoStartTour } from "./init.ts";
import { isTourActive, stopTour } from "./walkthrough.ts";
import { markTourSeen, clearTourSeen } from "./tour-state.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await raf();
    await Promise.resolve();
  }
}

beforeEach(() => {
  // Note: importing init.ts pulls the viewer's locale listeners, so we don't
  // switch locale here (it would fire re-renders that need the full viewer DOM).
  document.body.innerHTML = `<button id="btn-help"></button>`;
  clearTourSeen();
});

afterEach(() => {
  stopTour();
  clearTourSeen();
});

test("clicking Help launches the tour for a guest (common core)", async () => {
  initWalkthrough();
  (document.getElementById("btn-help") as HTMLButtonElement).click();
  await flush();

  assert.equal(isTourActive(), true);
  const pop = document.querySelector(".walkthrough__popover");
  assert.ok(pop, "popover mounted");
  assert.match(
    document.querySelector(".walkthrough__progress")?.textContent ?? "",
    /^(Step 1 of|Paso 1 de) \d+$/,
  );
});

test("initWalkthrough tolerates a missing Help button", () => {
  document.body.innerHTML = "";
  assert.doesNotThrow(() => initWalkthrough());
});

test("maybeAutoStartTour: no session (guest) never auto-starts", async () => {
  maybeAutoStartTour(null);
  await flush();
  assert.equal(isTourActive(), false);
});

test("maybeAutoStartTour: a role's first login auto-starts once", async () => {
  maybeAutoStartTour("admin");
  await flush();
  assert.equal(isTourActive(), true, "first login starts the tour");

  // A second auth change mid-tour (e.g. a token refresh) must not restart it.
  maybeAutoStartTour("admin");
  await flush();
  assert.equal(isTourActive(), true);

  // Once the role has seen it, later logins don't re-open it.
  stopTour();
  markTourSeen("admin");
  maybeAutoStartTour("admin");
  await flush();
  assert.equal(isTourActive(), false, "seen role does not auto-start again");
});

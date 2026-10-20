/**
 * Tests for ml-view.ts: notifyPredictionLoaded, clearMLView, initMLView.
 * Uses jsdom + stubCanvas2DContext so ViewportManager can build viewport cells.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { stubCanvas2DContext } from "../../test/viewer-fixture.ts";
import { initViewportManager } from "./viewport-registry.ts";
import { notifyPredictionLoaded, clearMLView, initMLView } from "./ml-view.ts";
import { state } from "./state.ts";
import type { MLPredictionRecord } from "./prediction-api.ts";
import type { ViewportManager } from "./viewport-manager.ts";

const MOCK_PREDICTION: MLPredictionRecord = {
  predictionId: 1,
  studyId: "study-abc",
  label: "normal",
  confidence: 0.87,
  analyzedBy: "admin@micd.local",
  analyzedAt: "2026-09-06T10:00:00.000Z",
};

test.before(() => {
  installDom();
  stubCanvas2DContext();
});
test.after(() => uninstallDom());

let manager: ViewportManager;

beforeEach(() => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  manager = initViewportManager(container);
  // ml-view now seeds viewports from global state; start each test from a
  // known baseline so leftover values don't bleed across tests.
  state.source = "local";
  state.files = [];
  state.serverStudyId = null;
  state.serverInstances = [];
  state.currentIndex = 0;
  state.parsed = null;
});

afterEach(() => {
  // Reset module-level mlLayoutActive flag before destroying the manager.
  clearMLView();
  manager.destroy();
  document.body.innerHTML = "";
});

// ── initMLView ────────────────────────────────────────────────────────────────

test("initMLView is a no-op and does not throw", () => {
  assert.doesNotThrow(() => initMLView());
});

// ── notifyPredictionLoaded: null / applyLayout=false paths ───────────────────

test("notifyPredictionLoaded(null) keeps 1x1 layout", () => {
  notifyPredictionLoaded(null, false);
  assert.equal(manager.getLayout(), "1x1");
});

test("notifyPredictionLoaded with prediction but applyLayout=false keeps 1x1", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, false);
  assert.equal(manager.getLayout(), "1x1");
});

test("notifyPredictionLoaded(null, true) also keeps 1x1 (prediction is null)", () => {
  notifyPredictionLoaded(null, true);
  assert.equal(manager.getLayout(), "1x1");
});

// ── notifyPredictionLoaded: applyLayout=true path ────────────────────────────

test("notifyPredictionLoaded with prediction and applyLayout=true switches to 1x2", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  assert.equal(manager.getLayout(), "1x2");
});

test("notifyPredictionLoaded leaves viewport sync off by default", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  assert.ok(
    !manager.isSynchronized,
    "sync must start disabled after ML layout (the user enables it manually)",
  );
});

test("notifyPredictionLoaded sets AI label on vp1 with capitalized label and percentage", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  const vp1 = manager.getAllViewports()[1]!;
  assert.ok(vp1.data.mlLabel?.includes("IA:"), "label must start with IA:");
  assert.ok(
    vp1.data.mlLabel?.includes("Normal"),
    "label must capitalize first letter",
  );
  assert.ok(
    vp1.data.mlLabel?.includes("87%"),
    "label must include confidence %",
  );
});

test("notifyPredictionLoaded does not set mlLabel on vp0", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  const vp0 = manager.getAllViewports()[0]!;
  assert.equal(vp0.data.mlLabel ?? null, null);
});

test("notifyPredictionLoaded seeds both viewports from global state", () => {
  state.source = "server";
  state.serverStudyId = "study-xyz";
  state.currentIndex = 5;
  state.serverInstances = ["i1", "i2"];

  notifyPredictionLoaded(MOCK_PREDICTION, true);

  // Both panels take the loaded study from global state (not by copying vp0),
  // so the left panel is always populated even if vp1 was the active viewport.
  for (const vp of manager.getAllViewports()) {
    assert.equal(vp.data.source, "server");
    assert.equal(vp.data.serverStudyId, "study-xyz");
    assert.equal(vp.data.currentIndex, 5);
    assert.deepEqual(vp.data.serverInstances, ["i1", "i2"]);
  }
});

test("notifyPredictionLoaded rounds confidence to nearest integer", () => {
  const pred: MLPredictionRecord = { ...MOCK_PREDICTION, confidence: 0.876 };
  notifyPredictionLoaded(pred, true);
  const vp1 = manager.getAllViewports()[1]!;
  assert.ok(vp1.data.mlLabel?.includes("88%"), "0.876 should round to 88%");
});

// ── clearMLView ───────────────────────────────────────────────────────────────

test("clearMLView after ML layout resets to 1x1", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  clearMLView();
  assert.equal(manager.getLayout(), "1x1");
});

test("clearMLView disables viewport sync", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  clearMLView();
  assert.ok(!manager.isSynchronized, "sync must be disabled after clearMLView");
});

test("clearMLView clears mlLabel on all remaining viewports", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  clearMLView();
  for (const vp of manager.getAllViewports()) {
    assert.equal(vp.data.mlLabel ?? null, null);
  }
});

test("clearMLView without prior ML activation preserves a user-chosen 2x2 layout", () => {
  manager.setLayout("2x2");
  clearMLView(); // mlLayoutActive is false
  assert.equal(manager.getLayout(), "2x2", "user 2x2 must not be reset");
});

test("clearMLView after null prediction does not reset layout", () => {
  manager.setLayout("2x2");
  notifyPredictionLoaded(null, false); // triggers clearMLView internally
  assert.equal(manager.getLayout(), "2x2");
});

test("clearMLView after applyLayout=false prediction does not reset layout", () => {
  manager.setLayout("2x2");
  notifyPredictionLoaded(MOCK_PREDICTION, false); // triggers clearMLView
  assert.equal(manager.getLayout(), "2x2");
});

test("second clearMLView call is idempotent and does not reset layout again", () => {
  notifyPredictionLoaded(MOCK_PREDICTION, true);
  clearMLView(); // layout → 1x1
  manager.setLayout("2x2"); // user picks 2x2
  clearMLView(); // second call — mlLayoutActive is false now
  assert.equal(
    manager.getLayout(),
    "2x2",
    "second clear must not reset user layout",
  );
});

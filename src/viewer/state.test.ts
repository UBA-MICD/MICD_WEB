/**
 * Tests for state.ts — AppState initial values, mutations, and the itemCount()
 * helper that abstracts over local vs. server sources.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 *
 * state.ts exports a plain object and a pure function. No DOM, no fetch, no
 * side-effects — tests can read and write the exported singleton directly.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, itemCount, type AppState } from "./state.ts";

// Reset the singleton to its documented defaults before every test so each
// case starts from a clean, predictable baseline.
function resetState(): void {
  state.source = "local";
  state.files = [];
  state.serverStudyId = null;
  state.serverInstances = [];
  state.currentIndex = 0;
  state.parsed = null;
  state.viewport = {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  state.activeTool = "wl";
  state.isDragging = false;
  state.lastMouseX = 0;
  state.lastMouseY = 0;
  state.isMetadataOpen = false;
  state.isWlPanelOpen = false;
  state.is3DMode = false;
  state.annotations = {};
}

beforeEach(resetState);

// ── Initial values ────────────────────────────────────────────────────────────

test("state initializes with source set to local", () => {
  assert.equal(state.source, "local");
});

test("state initializes with an empty files array", () => {
  assert.deepEqual(state.files, []);
});

test("state initializes with null serverStudyId", () => {
  assert.equal(state.serverStudyId, null);
});

test("state initializes with an empty serverInstances array", () => {
  assert.deepEqual(state.serverInstances, []);
});

test("state initializes currentIndex at 0", () => {
  assert.equal(state.currentIndex, 0);
});

test("state initializes parsed to null", () => {
  assert.equal(state.parsed, null);
});

test("state initializes activeTool to wl", () => {
  assert.equal(state.activeTool, "wl");
});

test("state initializes isDragging to false", () => {
  assert.equal(state.isDragging, false);
});

test("state initializes lastMouseX and lastMouseY to 0", () => {
  assert.equal(state.lastMouseX, 0);
  assert.equal(state.lastMouseY, 0);
});

test("state initializes isMetadataOpen to false", () => {
  assert.equal(state.isMetadataOpen, false);
});

test("state initializes isWlPanelOpen to false", () => {
  assert.equal(state.isWlPanelOpen, false);
});

test("state initializes is3DMode to false", () => {
  assert.equal(state.is3DMode, false);
});

test("viewport initializes with zoom 1 and zero pan/window values", () => {
  assert.equal(state.viewport.zoom, 1);
  assert.equal(state.viewport.panX, 0);
  assert.equal(state.viewport.panY, 0);
  assert.equal(state.viewport.windowCenter, 0);
  assert.equal(state.viewport.windowWidth, 0);
});

// ── State is mutable ──────────────────────────────────────────────────────────

test("state.source can be changed to server", () => {
  state.source = "server";
  assert.equal(state.source, "server");
});

test("state.activeTool accepts all valid tool values", () => {
  const tools: AppState["activeTool"][] = ["wl", "zoom", "pan", "crosshair"];
  for (const tool of tools) {
    state.activeTool = tool;
    assert.equal(state.activeTool, tool);
  }
});

test("state.isDragging can be toggled on and off", () => {
  state.isDragging = true;
  assert.equal(state.isDragging, true);
  state.isDragging = false;
  assert.equal(state.isDragging, false);
});

test("state.is3DMode can be toggled on and off", () => {
  state.is3DMode = true;
  assert.equal(state.is3DMode, true);
  state.is3DMode = false;
  assert.equal(state.is3DMode, false);
});

test("state.isMetadataOpen can be toggled", () => {
  state.isMetadataOpen = true;
  assert.equal(state.isMetadataOpen, true);
});

test("state.isWlPanelOpen can be toggled", () => {
  state.isWlPanelOpen = true;
  assert.equal(state.isWlPanelOpen, true);
});

test("state.currentIndex can be updated to reflect the loaded slice", () => {
  state.currentIndex = 7;
  assert.equal(state.currentIndex, 7);
});

test("state.serverStudyId can be set to a study id string", () => {
  state.serverStudyId = "orthanc-study-abc";
  assert.equal(state.serverStudyId, "orthanc-study-abc");
});

test("state.serverInstances can be populated with instance ids", () => {
  state.serverInstances = ["inst-1", "inst-2", "inst-3"];
  assert.deepEqual(state.serverInstances, ["inst-1", "inst-2", "inst-3"]);
});

test("state.files can be populated with File objects", () => {
  const f = new File([], "slice.dcm");
  state.files = [f];
  assert.equal(state.files.length, 1);
  assert.equal(state.files[0].name, "slice.dcm");
});

test("state.lastMouseX and lastMouseY can be updated by pointer events", () => {
  state.lastMouseX = 320;
  state.lastMouseY = 240;
  assert.equal(state.lastMouseX, 320);
  assert.equal(state.lastMouseY, 240);
});

test("state.viewport fields can be mutated independently", () => {
  state.viewport.windowCenter = 50;
  state.viewport.windowWidth = 350;
  state.viewport.zoom = 2;
  state.viewport.panX = -10;
  state.viewport.panY = 15;

  assert.equal(state.viewport.windowCenter, 50);
  assert.equal(state.viewport.windowWidth, 350);
  assert.equal(state.viewport.zoom, 2);
  assert.equal(state.viewport.panX, -10);
  assert.equal(state.viewport.panY, 15);
});

test("reassigning state.viewport replaces the whole object", () => {
  state.viewport = {
    windowCenter: 100,
    windowWidth: 400,
    zoom: 1.5,
    panX: 5,
    panY: -5,
  };
  assert.equal(state.viewport.windowCenter, 100);
  assert.equal(state.viewport.zoom, 1.5);
});

// ── itemCount() ───────────────────────────────────────────────────────────────

test("itemCount returns 0 for local source with no files", () => {
  state.source = "local";
  state.files = [];
  assert.equal(itemCount(), 0);
});

test("itemCount returns the number of local files when source is local", () => {
  state.source = "local";
  state.files = [
    new File([], "a.dcm"),
    new File([], "b.dcm"),
    new File([], "c.dcm"),
  ];
  assert.equal(itemCount(), 3);
});

test("itemCount returns 0 for server source with no instances", () => {
  state.source = "server";
  state.serverInstances = [];
  assert.equal(itemCount(), 0);
});

test("itemCount returns serverInstances.length when source is server", () => {
  state.source = "server";
  state.serverInstances = ["i1", "i2", "i3", "i4"];
  assert.equal(itemCount(), 4);
});

test("itemCount ignores serverInstances when source is local", () => {
  state.source = "local";
  state.files = [new File([], "x.dcm")];
  state.serverInstances = ["i1", "i2", "i3"];
  assert.equal(itemCount(), 1);
});

test("itemCount ignores files when source is server", () => {
  state.source = "server";
  state.serverInstances = ["i1"];
  state.files = [new File([], "a.dcm"), new File([], "b.dcm")];
  assert.equal(itemCount(), 1);
});

test("itemCount reflects changes to state.files after the fact", () => {
  state.source = "local";
  state.files = [new File([], "a.dcm")];
  assert.equal(itemCount(), 1);

  state.files = [new File([], "a.dcm"), new File([], "b.dcm")];
  assert.equal(itemCount(), 2);

  state.files = [];
  assert.equal(itemCount(), 0);
});

test("itemCount reflects changes to state.serverInstances after the fact", () => {
  state.source = "server";
  state.serverInstances = ["i1", "i2"];
  assert.equal(itemCount(), 2);

  state.serverInstances = [];
  assert.equal(itemCount(), 0);
});

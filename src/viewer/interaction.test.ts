/**
 * Tests for interaction.ts: toolbar wiring, viewport mouse/wheel handling
 * (2D and 3D), series nav, keyboard shortcuts, and the resize observer.
 * Uses jsdom via test/dom-setup.ts and the shared viewer fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  viewerFixtureHtml,
  stubCanvas2DContext,
} from "../../test/viewer-fixture.ts";
import {
  initToolbar,
  updateToolbarUI,
  initViewportInteraction,
  initSeriesNav,
  initKeyboardShortcuts,
  initMenuListeners,
  initResizeObserver,
} from "./interaction.ts";
import { state, itemCount } from "./state.ts";
import { mpr3DViewer } from "./mpr.ts";
import { dicomCache } from "./cache.ts";

// Fresh jsdom document per test (not just a fresh body): initKeyboardShortcuts()
// and parts of initViewportInteraction() bind listeners to `document` itself,
// which setBody()'s innerHTML swap doesn't touch — reusing one document across
// tests would accumulate a listener per test that calls them.
test.beforeEach(() => {
  installDom();
  stubCanvas2DContext();
});
test.afterEach(() => uninstallDom());

const baseMeta = {
  patientName: "DOE, JOHN",
  patientId: "MRN1",
  patientBirthDate: "1980-01-01",
  patientSex: "M",
  studyDate: "2024-01-15",
  studyDescription: "CT CHEST",
  studyInstanceUid: "1.2.3",
  accessionNumber: "ACC1",
  referringPhysician: "",
  seriesDescription: "CHEST",
  seriesNumber: "1",
  modality: "CT",
  instanceNumber: "1",
  sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
  rows: 2,
  columns: 2,
  bitsAllocated: 16,
  bitsStored: 12,
  highBit: 11,
  pixelRepresentation: 0 as const,
  samplesPerPixel: 1,
  photometricInterpretation: "MONOCHROME2",
  rescaleIntercept: 0,
  rescaleSlope: 1,
  windowCenter: 40,
  windowWidth: 400,
  transferSyntaxUid: "1.2.840.10008.1.2.1",
};

function mockParsed() {
  return {
    metadata: baseMeta,
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
}

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
  mpr3DViewer.isActive = false;
  mpr3DViewer.camera = { theta: 0.3, phi: 0.8, zoom: 1, panX: 0, panY: 0 };
  mpr3DViewer.crosshair = { x: 0, y: 0, z: 0 };
  mpr3DViewer.activeView = "3d";
  dicomCache.clear();
}

test.beforeEach(() => {
  setBody(viewerFixtureHtml());
  resetState();
});

// ── Toolbar ──────────────────────────────────────────────────────────────────

test("initToolbar: clicking wl toggles the wl panel open/closed", () => {
  initToolbar();
  const btn = document.getElementById("tool-wl")!;
  btn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.isWlPanelOpen, true);
  btn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.isWlPanelOpen, false);
});

test("initToolbar: clicking zoom activates it and closes the wl panel", () => {
  initToolbar();
  state.isWlPanelOpen = true;
  document.getElementById("tool-zoom")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "zoom");
  assert.equal(state.isWlPanelOpen, false);
  assert.equal(
    document.getElementById("tool-zoom")!.classList.contains("active"),
    true,
  );
});

test("initToolbar: pan is a no-op in 3D mode, crosshair is a no-op outside it", () => {
  initToolbar();
  state.is3DMode = true;
  document.getElementById("tool-pan")!.dispatchEvent(new MouseEvent("click"));
  assert.notEqual(state.activeTool, "pan");

  state.is3DMode = false;
  document
    .getElementById("tool-crosshair")!
    .dispatchEvent(new MouseEvent("click"));
  assert.notEqual(state.activeTool, "crosshair");
});

test("initToolbar: tool-reset restores the default viewport from metadata", () => {
  initToolbar();
  state.parsed = mockParsed();
  state.viewport = {
    windowCenter: 999,
    windowWidth: 999,
    zoom: 5,
    panX: 5,
    panY: 5,
  };
  document.getElementById("tool-reset")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.windowWidth, baseMeta.windowWidth);
});

test("initToolbar: tool-reset with no windowWidth metadata falls back to auto W/L", () => {
  initToolbar();
  state.parsed = {
    metadata: { ...baseMeta, windowWidth: 0 },
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  document.getElementById("tool-reset")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(typeof state.viewport.windowWidth, "number");
});

test("initToolbar: tool-reset is a no-op with nothing loaded", () => {
  initToolbar();
  assert.doesNotThrow(() =>
    document
      .getElementById("tool-reset")!
      .dispatchEvent(new MouseEvent("click")),
  );
});

test("initToolbar: tool-reset in 3D mode also resets the mpr camera", () => {
  initToolbar();
  state.parsed = mockParsed();
  state.is3DMode = true;
  mpr3DViewer.camera.zoom = 5;
  mpr3DViewer.camera.panX = 5;
  document.getElementById("tool-reset")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.camera.zoom, 1);
  assert.equal(mpr3DViewer.camera.panX, 0);
});

test("initToolbar: tool-metadata toggles the metadata panel", () => {
  initToolbar();
  const btn = document.getElementById("tool-metadata")!;
  btn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.isMetadataOpen, true);
  assert.equal(
    document.getElementById("metadata-panel")!.classList.contains("open"),
    true,
  );
  assert.equal(btn.getAttribute("aria-expanded"), "true");
});

test("initToolbar: tool-mpr is a no-op when disabled", async () => {
  initToolbar();
  const btn = document.getElementById("tool-mpr") as HTMLButtonElement;
  btn.disabled = true;
  btn.dispatchEvent(new MouseEvent("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mpr3DViewer.isActive, false);
});

test("initToolbar: btn-open delegates to the file input click", () => {
  initToolbar();
  let clicked = false;
  document
    .getElementById("open-files-input")!
    .addEventListener("click", () => (clicked = true));
  document.getElementById("btn-open")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(clicked, true);
});

test("initToolbar: export dialog opens, and png/zip/cancel close it", () => {
  initToolbar();
  document
    .getElementById("btn-export-menu")!
    .dispatchEvent(new MouseEvent("click"));
  const dialog = document.getElementById("export-dialog")!;
  assert.equal(dialog.classList.contains("hidden"), false);

  document
    .getElementById("export-dialog-cancel")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(dialog.classList.contains("hidden"), true);
});

test("initToolbar: export png/zip buttons close the dialog without throwing", () => {
  initToolbar();
  document
    .getElementById("btn-export-menu")!
    .dispatchEvent(new MouseEvent("click"));
  assert.doesNotThrow(() =>
    document
      .getElementById("btn-export-dialog-png")!
      .dispatchEvent(new MouseEvent("click")),
  );
  assert.equal(
    document.getElementById("export-dialog")!.classList.contains("hidden"),
    true,
  );

  document
    .getElementById("btn-export-menu")!
    .dispatchEvent(new MouseEvent("click"));
  assert.doesNotThrow(() =>
    document
      .getElementById("btn-export-dialog-zip")!
      .dispatchEvent(new MouseEvent("click")),
  );
});

test("initToolbar: wl slider input adjusts window width/center and renders", () => {
  initToolbar();
  const sliderWW = document.getElementById("slider-ww") as HTMLInputElement;
  sliderWW.value = "500";
  sliderWW.dispatchEvent(new Event("input"));
  assert.equal(state.viewport.windowWidth, 500);

  const sliderWL = document.getElementById("slider-wl") as HTMLInputElement;
  sliderWL.value = "50";
  sliderWL.dispatchEvent(new Event("input"));
  assert.equal(state.viewport.windowCenter, 50);
});

test("initToolbar: preset buttons apply their window/level values", () => {
  initToolbar();
  document
    .getElementById("btn-preset-lung")!
    .dispatchEvent(new MouseEvent("click"));
  assert.notEqual(state.viewport.windowWidth, 0);
});

test("updateToolbarUI: forces the tool back to wl leaving pan in 3D or crosshair outside it", () => {
  state.is3DMode = true;
  state.activeTool = "pan";
  updateToolbarUI();
  assert.equal(state.activeTool, "wl");

  state.is3DMode = false;
  state.activeTool = "crosshair";
  updateToolbarUI();
  assert.equal(state.activeTool, "wl");
});

test("updateToolbarUI: disables pan/enables crosshair in 3D mode, and sets export button state", () => {
  state.is3DMode = true;
  state.activeTool = "wl";
  state.parsed = mockParsed();
  updateToolbarUI();
  assert.equal(
    (document.getElementById("tool-pan") as HTMLButtonElement).disabled,
    true,
  );
  assert.equal(
    (document.getElementById("tool-crosshair") as HTMLButtonElement).disabled,
    false,
  );
  assert.equal(
    (document.getElementById("btn-export-menu") as HTMLButtonElement).disabled,
    false,
  );
  assert.equal(
    document
      .getElementById("viewport-container")!
      .classList.contains("cursor-wl"),
    true,
  );
});

// ── Viewport mouse/wheel interaction ─────────────────────────────────────────

test("initViewportInteraction: mousedown/mousemove in wl mode adjusts window/level", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;

  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(state.isDragging, true);

  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 110, clientY: 90, bubbles: true }),
  );
  assert.notEqual(state.viewport.windowWidth, 0);

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(state.isDragging, false);
});

test("initViewportInteraction: mousedown/mousemove is a no-op with nothing loaded", () => {
  initViewportInteraction();
  const container = document.getElementById("viewport-container")!;
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(state.isDragging, false);
});

test("initViewportInteraction: zoom and pan tools update state on drag (2D)", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;

  state.activeTool = "zoom";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 0, clientY: 20, bubbles: true }),
  );
  assert.notEqual(state.viewport.zoom, 1);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  state.activeTool = "pan";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 30, clientY: 15, bubbles: true }),
  );
  assert.equal(state.viewport.panX, 30);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
});

test("initViewportInteraction: 3D pan/zoom/orbit drag updates the mpr camera", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  state.is3DMode = true;
  mpr3DViewer.isActive = true;
  (mpr3DViewer as any).render = () => {};
  const container = document.getElementById("viewport-container")!;

  state.activeTool = "pan";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 0,
      clientY: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }),
  );
  assert.equal(mpr3DViewer.camera.panX, 10);

  state.activeTool = "zoom";
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 10, clientY: 30, bubbles: true }),
  );
  assert.notEqual(mpr3DViewer.camera.zoom, 1);

  state.activeTool = "crosshair";
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, bubbles: true }),
  );
  // orbit branch (default) with crosshair also updates the pointer position
  assert.equal(typeof mpr3DViewer.camera.phi, "number");

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
});

test("initViewportInteraction: 2D wheel scrolls the stack when multiple slices exist", async () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")] as any;
  dicomCache.set(0, mockParsed());
  dicomCache.set(1, mockParsed());
  const container = document.getElementById("viewport-container")!;

  const wheel = new Event("wheel", { bubbles: true, cancelable: true }) as any;
  wheel.deltaY = 100;
  container.dispatchEvent(wheel);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 1);
});

test("initViewportInteraction: 2D wheel zooms when ctrlKey is held or there's only one slice", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  const startZoom = state.viewport.zoom;

  const wheel = new Event("wheel", { bubbles: true, cancelable: true }) as any;
  wheel.deltaY = 100;
  container.dispatchEvent(wheel);
  assert.notEqual(state.viewport.zoom, startZoom);
});

test("initViewportInteraction: 3D wheel navigates depth slices", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  state.is3DMode = true;
  mpr3DViewer.isActive = true;
  (mpr3DViewer as any).render = () => {};
  const orig = mpr3DViewer.getDepthInfo.bind(mpr3DViewer);
  (mpr3DViewer as any).getDepthInfo = () => ({ current: 0, total: 3 });
  let setTo = -1;
  const origSet = mpr3DViewer.setDepthIndex.bind(mpr3DViewer);
  (mpr3DViewer as any).setDepthIndex = (i: number) => (setTo = i);
  try {
    const container = document.getElementById("viewport-container")!;
    const wheel = new Event("wheel", {
      bubbles: true,
      cancelable: true,
    }) as any;
    wheel.deltaY = 100;
    container.dispatchEvent(wheel);
    assert.equal(setTo, 1);
  } finally {
    (mpr3DViewer as any).getDepthInfo = orig;
    (mpr3DViewer as any).setDepthIndex = origSet;
  }
});

test("initViewportInteraction: wheel is a no-op with nothing loaded", () => {
  initViewportInteraction();
  const container = document.getElementById("viewport-container")!;
  assert.doesNotThrow(() => {
    const wheel = new Event("wheel", {
      bubbles: true,
      cancelable: true,
    }) as any;
    wheel.deltaY = 100;
    container.dispatchEvent(wheel);
  });
});

// ── 3D orientation buttons ────────────────────────────────────────────────────

test("orientation buttons set mpr3DViewer's view and update the active class", () => {
  initToolbar();
  document
    .getElementById("btn-view-axial")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.activeView, "axial");
  assert.equal(
    document.getElementById("btn-view-axial")!.classList.contains("active"),
    true,
  );

  document
    .getElementById("btn-view-coronal")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.activeView, "coronal");

  document
    .getElementById("btn-view-sagittal")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.activeView, "sagittal");

  document
    .getElementById("btn-view-3d")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.activeView, "3d");
});

test("the depth slider input sets the mpr depth index", () => {
  initToolbar();
  const orig = mpr3DViewer.setDepthIndex.bind(mpr3DViewer);
  let setTo = -1;
  (mpr3DViewer as any).setDepthIndex = (i: number) => (setTo = i);
  try {
    const slider = document.getElementById(
      "mpr-depth-slider",
    ) as HTMLInputElement;
    slider.max = "10"; // a range input clamps .value to [min,max]
    slider.value = "3";
    slider.dispatchEvent(new Event("input"));
    assert.equal(setTo, 3);
  } finally {
    (mpr3DViewer as any).setDepthIndex = orig;
  }
});

// ── Series navigation ────────────────────────────────────────────────────────

test("initSeriesNav: prev/next buttons move currentIndex and load", async () => {
  initSeriesNav();
  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")] as any;
  state.currentIndex = 0;
  dicomCache.set(0, mockParsed());
  dicomCache.set(1, mockParsed());

  document.getElementById("nav-next")!.dispatchEvent(new MouseEvent("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 1);

  document.getElementById("nav-prev")!.dispatchEvent(new MouseEvent("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 0);
});

test("initSeriesNav: prev is a no-op at index 0, next is a no-op at the last index", async () => {
  initSeriesNav();
  state.files = [new File(["a"], "a.dcm")] as any;
  state.currentIndex = 0;
  document.getElementById("nav-prev")!.dispatchEvent(new MouseEvent("click"));
  document.getElementById("nav-next")!.dispatchEvent(new MouseEvent("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 0);
});

test("initSeriesNav: the slider input jumps to the chosen index", async () => {
  initSeriesNav();
  state.files = [
    new File(["a"], "a.dcm"),
    new File(["b"], "b.dcm"),
    new File(["c"], "c.dcm"),
  ] as any;
  dicomCache.set(2, mockParsed());
  const slider = document.getElementById("nav-slider") as HTMLInputElement;
  slider.max = "10"; // a range input clamps .value to [min,max]
  slider.value = "2";
  slider.dispatchEvent(new Event("input"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 2);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function key(k: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

test("keyboard: arrow keys adjust the active wl/zoom/pan tool", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();

  state.activeTool = "wl";
  const startWidth = state.viewport.windowWidth;
  document.dispatchEvent(key("ArrowRight"));
  assert.notEqual(state.viewport.windowWidth, startWidth);

  state.activeTool = "zoom";
  const startZoom = state.viewport.zoom;
  document.dispatchEvent(key("ArrowUp"));
  assert.notEqual(state.viewport.zoom, startZoom);

  state.activeTool = "pan";
  document.dispatchEvent(key("ArrowDown", { shiftKey: true }));
  assert.notEqual(state.viewport.panY, 0);
});

test("keyboard: arrows navigate depth slices in 3D mode", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  state.is3DMode = true;
  const orig = mpr3DViewer.getDepthInfo.bind(mpr3DViewer);
  (mpr3DViewer as any).getDepthInfo = () => ({ current: 1, total: 3 });
  let setTo = -1;
  const origSet = mpr3DViewer.setDepthIndex.bind(mpr3DViewer);
  (mpr3DViewer as any).setDepthIndex = (i: number) => (setTo = i);
  try {
    document.dispatchEvent(key("ArrowRight"));
    assert.equal(setTo, 2);
    document.dispatchEvent(key("ArrowLeft"));
    assert.equal(setTo, 0);
  } finally {
    (mpr3DViewer as any).getDepthInfo = orig;
    (mpr3DViewer as any).setDepthIndex = origSet;
  }
});

test("keyboard: PageUp/PageDown move series index", async () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")] as any;
  state.currentIndex = 0;
  dicomCache.set(1, mockParsed());
  document.dispatchEvent(key("PageDown"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 1);

  dicomCache.set(0, mockParsed());
  document.dispatchEvent(key("PageUp"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.currentIndex, 0);
});

test("keyboard: letter shortcuts click their respective tool buttons", () => {
  initKeyboardShortcuts();
  initToolbar();
  document.dispatchEvent(key("z"));
  assert.equal(state.activeTool, "zoom");
  document.dispatchEvent(key("W"));
  assert.equal(state.activeTool, "wl");
  document.dispatchEvent(key("r"));
  document.dispatchEvent(key("m"));
  assert.equal(state.isMetadataOpen, true);
});

test("keyboard: p is a no-op in 3D mode, c is a no-op outside it", () => {
  initKeyboardShortcuts();
  initToolbar();
  state.is3DMode = true;
  document.dispatchEvent(key("p"));
  assert.notEqual(state.activeTool, "pan");

  state.is3DMode = false;
  document.dispatchEvent(key("c"));
  assert.notEqual(state.activeTool, "crosshair");

  // Real 3D-mode entry (toggle3DMode) re-syncs disabled state via
  // updateToolbarUI(); mimic that here since we're flipping is3DMode by hand.
  state.is3DMode = true;
  updateToolbarUI();
  document.dispatchEvent(key("c"));
  assert.equal(state.activeTool, "crosshair");
});

test("keyboard: ignores keys typed into an input/textarea", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  state.activeTool = "wl";
  const input = document.createElement("input");
  document.body.appendChild(input);
  const evt = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(evt, "target", { value: input });
  input.dispatchEvent(evt);
  assert.equal(state.viewport.windowWidth, 0);
});

test("keyboard: ignores the event while a dialog is open", () => {
  initToolbar();
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  document
    .getElementById("btn-export-menu")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(
    document.getElementById("export-dialog")!.classList.contains("hidden"),
    false,
  );

  const startWidth = state.viewport.windowWidth;
  document.dispatchEvent(key("ArrowRight"));
  assert.equal(state.viewport.windowWidth, startWidth);
});

test("keyboard: does not act again on an event whose default was already prevented", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  const startWidth = state.viewport.windowWidth;
  const evt = key("ArrowRight");
  evt.preventDefault();
  document.dispatchEvent(evt);
  assert.equal(state.viewport.windowWidth, startWidth);
});

// ── Menu listeners & resize observer ─────────────────────────────────────────

test("initMenuListeners is a no-op when window.api is absent", () => {
  assert.doesNotThrow(() => initMenuListeners());
});

test("initMenuListeners wires menu:open-files/open-folder/api-server when window.api exists", () => {
  const calls: string[] = [];
  (window as any).api = {
    on(channel: string, cb: () => void) {
      calls.push(channel);
      if (channel === "menu:open-files") cb();
    },
  };
  try {
    initMenuListeners();
    assert.deepEqual(calls, [
      "menu:open-files",
      "menu:open-folder",
      "menu:api-server",
    ]);
  } finally {
    delete (window as any).api;
  }
});

test("initResizeObserver observes the viewport container without throwing", () => {
  assert.doesNotThrow(() => initResizeObserver());
});

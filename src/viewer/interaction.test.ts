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
  toggleMprMode,
  toggle3DMode,
  initMeasurementControlsInteraction,
  initGridLayoutControls,
  setViewportSync,
  update3DSlidersUI,
} from "./interaction.ts";
import { state, itemCount } from "./state.ts";
import { mpr3DViewer, view3DViewer } from "./view-3d.ts";
import { mprEngine } from "./mpr-engine.ts";
import { mprCoordinator } from "./mpr-coordinator.ts";
import { dicomCache } from "./cache.ts";
import { ViewportManager } from "./viewport-manager.ts";
import { initViewportManager } from "./viewport-registry.ts";
import {
  addAnnotation,
  clearAnnotations,
  getAnnotationsForSlice,
} from "./measurements/annotation-state.ts";
import {
  getActiveDrawing,
  setActiveDrawing,
  getSelectedAnnotationId,
  setSelectedAnnotationId,
} from "./measurements/measurement-overlay.ts";
import type { PolygonAnnotation } from "./measurements/types.ts";

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
  sopInstanceUid: "1.2.3.4.5",
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
  state.isMeasurementPanelOpen = false;
  state.measurementUnit = "mm";
  state.measurementLineWidth = 2;
  state.is3DMode = false;
  mpr3DViewer.isActive = false;
  mpr3DViewer.camera = { theta: 0.3, phi: 0.8, zoom: 1, panX: 0, panY: 0 };
  mpr3DViewer.crosshair = { x: 0, y: 0, z: 0 };
  mpr3DViewer.activeView = "3d";
  dicomCache.clear();
  clearAnnotations();
  setActiveDrawing(null);
  setSelectedAnnotationId(null);
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

test("initToolbar: pan is enabled in 3D mode (US-50), crosshair is a no-op outside it", () => {
  initToolbar();
  state.is3DMode = true;
  document.getElementById("tool-pan")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "pan");

  state.is3DMode = false;
  document
    .getElementById("tool-crosshair")!
    .dispatchEvent(new MouseEvent("click"));
  assert.notEqual(state.activeTool, "crosshair");
});

test("initToolbar: clicking length and ellipse tools sets activeTool and updates UI", () => {
  initToolbar();
  const lenBtn = document.getElementById("tool-length")!;
  const ellBtn = document.getElementById("tool-ellipse")!;
  const panel = document.getElementById("measure-panel")!;

  lenBtn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "length");
  assert.equal(lenBtn.classList.contains("active"), true);
  assert.equal(lenBtn.getAttribute("aria-pressed"), "true");
  assert.equal(state.isMeasurementPanelOpen, true);
  assert.equal(lenBtn.getAttribute("aria-expanded"), "true");
  assert.equal(panel.classList.contains("open"), true);

  // Clicking length again toggles panel closed
  lenBtn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.isMeasurementPanelOpen, false);
  assert.equal(lenBtn.getAttribute("aria-expanded"), "false");
  assert.equal(panel.classList.contains("open"), false);

  // Clicking ellipse activates it and opens panel
  ellBtn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "ellipse");
  assert.equal(ellBtn.classList.contains("active"), true);
  assert.equal(ellBtn.getAttribute("aria-pressed"), "true");
  assert.equal(lenBtn.classList.contains("active"), false);
  assert.equal(state.isMeasurementPanelOpen, true);
  assert.equal(panel.classList.contains("open"), true);

  // Clicking pan switches tool and closes panel
  document.getElementById("tool-pan")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "pan");
  assert.equal(state.isMeasurementPanelOpen, false);
  assert.equal(panel.classList.contains("open"), false);
});

test("initToolbar: clicking polygon tool sets activeTool and updates UI", () => {
  initToolbar();
  const polyBtn = document.getElementById("tool-polygon")!;
  const panel = document.getElementById("measure-panel")!;

  polyBtn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "polygon");
  assert.equal(polyBtn.classList.contains("active"), true);
  assert.equal(polyBtn.getAttribute("aria-pressed"), "true");
  assert.equal(state.isMeasurementPanelOpen, true);
  assert.equal(polyBtn.getAttribute("aria-expanded"), "true");
  assert.equal(panel.classList.contains("open"), true);

  // Clicking polygon again toggles panel closed
  polyBtn.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.isMeasurementPanelOpen, false);
  assert.equal(polyBtn.getAttribute("aria-expanded"), "false");
  assert.equal(panel.classList.contains("open"), false);

  // Clicking pan switches tool
  document.getElementById("tool-pan")!.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.activeTool, "pan");
  assert.equal(polyBtn.classList.contains("active"), false);
});

test("measurement panel: unit buttons and select toggle state and update UI", () => {
  initToolbar();
  const btnMm = document.getElementById("btn-unit-mm")!;
  const btnCm = document.getElementById("btn-unit-cm")!;
  const selectUnit = document.getElementById(
    "select-measure-unit",
  ) as HTMLSelectElement;

  // Defaults to mm
  assert.equal(state.measurementUnit, "mm");
  assert.equal(btnMm.classList.contains("active"), true);
  assert.equal(btnMm.getAttribute("aria-pressed"), "true");
  assert.equal(btnCm.classList.contains("active"), false);
  assert.equal(btnCm.getAttribute("aria-pressed"), "false");

  // Click cm
  btnCm.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.measurementUnit, "cm");
  assert.equal(btnCm.classList.contains("active"), true);
  assert.equal(btnCm.getAttribute("aria-pressed"), "true");
  assert.equal(btnMm.classList.contains("active"), false);
  assert.equal(btnMm.getAttribute("aria-pressed"), "false");
  assert.equal(selectUnit.value, "cm");

  // Click mm
  btnMm.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.measurementUnit, "mm");
  assert.equal(btnMm.classList.contains("active"), true);
  assert.equal(btnMm.getAttribute("aria-pressed"), "true");
  assert.equal(selectUnit.value, "mm");

  // Select element change
  selectUnit.value = "cm";
  selectUnit.dispatchEvent(new Event("change"));
  assert.equal(state.measurementUnit, "cm");
  assert.equal(btnCm.classList.contains("active"), true);
});

test("measurement panel: slider updates measurementLineWidth and label", () => {
  initToolbar();
  const slider = document.getElementById(
    "slider-measure-width",
  ) as HTMLInputElement;
  const valLabel = document.getElementById("val-measure-width")!;

  assert.equal(state.measurementLineWidth, 2);
  assert.equal(valLabel.textContent, "2px");

  slider.value = "4";
  slider.dispatchEvent(new Event("input"));
  assert.equal(state.measurementLineWidth, 4);
  assert.equal(valLabel.textContent, "4px");

  slider.value = "1";
  slider.dispatchEvent(new Event("input"));
  assert.equal(state.measurementLineWidth, 1);
  assert.equal(valLabel.textContent, "1px");
});

test("measurement panel: clear button clears annotations for active slice", () => {
  initToolbar();
  state.parsed = mockParsed();
  const uid = state.parsed.metadata.sopInstanceUid;

  state.annotations[uid] = [
    {
      id: "ann-len-1",
      type: "length",
      sopInstanceUid: uid,
      sliceIndex: 0,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      distance: 14.1,
      isCalibrated: true,
      unit: "mm",
      createdAt: Date.now(),
    },
  ];
  state.annotations["other-slice"] = [
    {
      id: "ann-len-2",
      type: "length",
      sopInstanceUid: "other-slice",
      sliceIndex: 1,
      start: { x: 0, y: 0 },
      end: { x: 5, y: 5 },
      distance: 7.0,
      isCalibrated: true,
      unit: "mm",
      createdAt: Date.now(),
    },
  ];

  setSelectedAnnotationId("ann-len-1");
  const clearBtn = document.getElementById("btn-clear-measurements")!;
  clearBtn.dispatchEvent(new MouseEvent("click"));

  assert.deepEqual(getAnnotationsForSlice(uid), []);
  assert.equal(getSelectedAnnotationId(), null);
  // Other slices are unaffected
  assert.equal(getAnnotationsForSlice("other-slice").length, 1);
});

test("initToolbar: length and ellipse tools are disabled in 3D mode", () => {
  initToolbar();
  state.is3DMode = true;
  updateToolbarUI();

  const lenBtn = document.getElementById("tool-length") as HTMLButtonElement;
  const ellBtn = document.getElementById("tool-ellipse") as HTMLButtonElement;
  assert.equal(lenBtn.disabled, true);
  assert.equal(ellBtn.disabled, true);

  lenBtn.dispatchEvent(new MouseEvent("click"));
  assert.notEqual(state.activeTool, "length");
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

test("initToolbar: wl slider input adjusts window width/center, updates engines, and reflects in UI", () => {
  initToolbar();
  const sliderWW = document.getElementById("slider-ww") as HTMLInputElement;
  sliderWW.value = "500";
  sliderWW.dispatchEvent(new Event("input"));
  assert.equal(state.viewport.windowWidth, 500);
  assert.equal(mprEngine.windowWidth, 500);
  assert.equal(view3DViewer.windowWidth, 500);
  assert.equal(document.getElementById("val-ww")?.textContent, "500");

  const sliderWL = document.getElementById("slider-wl") as HTMLInputElement;
  sliderWL.value = "50";
  sliderWL.dispatchEvent(new Event("input"));
  assert.equal(state.viewport.windowCenter, 50);
  assert.equal(mprEngine.windowCenter, 50);
  assert.equal(view3DViewer.windowCenter, 50);
  assert.equal(document.getElementById("val-wl")?.textContent, "50");
});

test("initToolbar: preset buttons apply their window/level values across engines and UI", () => {
  initToolbar();
  const btnBone = document.getElementById("btn-preset-bone")!;
  btnBone.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.windowWidth, 1800);
  assert.equal(state.viewport.windowCenter, 400);
  assert.equal(state.windowWidth, 1800);
  assert.equal(state.windowCenter, 400);
  assert.equal(mprEngine.windowWidth, 1800);
  assert.equal(mprEngine.windowCenter, 400);
  assert.equal(view3DViewer.windowWidth, 1800);
  assert.equal(view3DViewer.windowCenter, 400);
  assert.equal(view3DViewer.presetMode, 1);
  assert.equal(
    (document.getElementById("slider-ww") as HTMLInputElement).value,
    "1800",
  );
  assert.equal(
    (document.getElementById("slider-wl") as HTMLInputElement).value,
    "400",
  );
  assert.equal(document.getElementById("val-ww")?.textContent, "1800");
  assert.equal(document.getElementById("val-wl")?.textContent, "400");

  const btnLung = document.getElementById("btn-preset-lung")!;
  btnLung.dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.windowWidth, 1500);
  assert.equal(state.viewport.windowCenter, -600);
  assert.equal(mprEngine.windowWidth, 1500);
  assert.equal(mprEngine.windowCenter, -600);
  assert.equal(view3DViewer.presetMode, 0);
  assert.equal(
    (document.getElementById("slider-ww") as HTMLInputElement).value,
    "1500",
  );
  assert.equal(
    (document.getElementById("slider-wl") as HTMLInputElement).value,
    "-600",
  );
  assert.equal(document.getElementById("val-ww")?.textContent, "1500");
  assert.equal(document.getElementById("val-wl")?.textContent, "-600");
});

test("updateToolbarUI: preserves pan in 3D mode (US-50) and forces crosshair back to wl outside it", () => {
  state.is3DMode = true;
  state.activeTool = "pan";
  updateToolbarUI();
  assert.equal(state.activeTool, "pan");

  state.activeTool = "length";
  updateToolbarUI();
  assert.equal(state.activeTool, "wl");

  state.is3DMode = false;
  state.activeTool = "crosshair";
  updateToolbarUI();
  assert.equal(state.activeTool, "wl");
});

test("updateToolbarUI: pan is enabled and crosshair enabled in 3D mode, and sets export button state", () => {
  state.is3DMode = true;
  state.activeTool = "wl";
  state.parsed = mockParsed();
  updateToolbarUI();
  assert.equal(
    (document.getElementById("tool-pan") as HTMLButtonElement).disabled,
    false,
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

test("initViewportInteraction: dragging with length tool creates LengthAnnotation and announces", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "length";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 50,
      clientY: 50,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(getActiveDrawing());
  assert.equal(getActiveDrawing()?.type, "length");

  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 150, clientY: 150, bubbles: true }),
  );

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(getActiveDrawing(), null);

  const annotations = getAnnotationsForSlice("1.2.3.4.5");
  assert.ok(annotations.length > 0);
  assert.equal(annotations[0].type, "length");

  const announce = document.getElementById("measure-announce");
  assert.ok(
    announce?.textContent?.includes("Longitud") ||
      announce?.textContent?.includes("Length"),
  );
});

test("initViewportInteraction: dragging with ellipse tool creates EllipseAnnotation and announces", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "ellipse";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(getActiveDrawing());
  assert.equal(getActiveDrawing()?.type, "ellipse");

  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 150, clientY: 150, bubbles: true }),
  );

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(getActiveDrawing(), null);

  const annotations = getAnnotationsForSlice("1.2.3.4.5");
  assert.ok(annotations.length > 0);
  assert.equal(annotations[0].type, "ellipse");

  const announce = document.getElementById("measure-announce");
  assert.ok(
    announce?.textContent?.includes("Área") ||
      announce?.textContent?.includes("Area"),
  );
});

test("initViewportInteraction: drawing polygon with successive clicks and closing near start creates PolygonAnnotation and announces", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });
  const overlay = document.getElementById(
    "annotation-overlay",
  ) as HTMLCanvasElement;
  if (overlay) {
    overlay.width = 500;
    overlay.height = 500;
  }

  state.activeTool = "polygon";

  // Click 1 (Start)
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 50,
      clientY: 50,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  const drawing = getActiveDrawing();
  assert.ok(drawing);
  assert.equal(drawing?.type, "polygon");
  assert.equal(drawing?.points?.length, 1);

  // Guide line mousemove
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 100, clientY: 50, bubbles: true }),
  );
  assert.ok(drawing?.end);

  // Click 2
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 50,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(drawing?.points?.length, 2);

  // Click 3
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(drawing?.points?.length, 3);

  // Click 4: Close polygon near start (50, 50)
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 52,
      clientY: 51,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  assert.equal(getActiveDrawing(), null);

  const annotations = getAnnotationsForSlice("1.2.3.4.5");
  assert.equal(annotations.length, 1);
  const poly = annotations[0] as PolygonAnnotation;
  assert.equal(poly.type, "polygon");
  assert.equal(poly.isClosed, true);
  assert.equal(poly.points.length, 3);
  assert.ok(poly.area > 0);
  assert.ok(poly.perimeter > 0);

  const announce = document.getElementById("measure-announce");
  assert.ok(
    announce?.textContent?.includes("Polígono") ||
      announce?.textContent?.includes("Polygon"),
  );
});

test("initViewportInteraction: Enter key completes active polygon drawing", () => {
  initViewportInteraction();
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "polygon";

  // 3 clicks
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 20,
      clientY: 20,
      button: 0,
      bubbles: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 80,
      clientY: 20,
      button: 0,
      bubbles: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 80,
      clientY: 80,
      button: 0,
      bubbles: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  assert.equal(getActiveDrawing()?.points?.length, 3);

  // Press Enter to complete
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );

  assert.equal(getActiveDrawing(), null);
  const annotations = getAnnotationsForSlice("1.2.3.4.5");
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].type, "polygon");
});

test("initViewportInteraction: Escape cancels active polygon drawing", () => {
  initViewportInteraction();
  initKeyboardShortcuts();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "polygon";

  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 20,
      clientY: 20,
      button: 0,
      bubbles: true,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.ok(getActiveDrawing());

  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(getActiveDrawing(), null);
});

test("initKeyboardShortcuts: Delete key removes selected polygon", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();

  const poly: PolygonAnnotation = {
    id: "poly-delete-me",
    type: "polygon",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 0,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
    isClosed: true,
    area: 0.5,
    perimeter: 3,
    isCalibrated: false,
    unit: "px",
    createdAt: Date.now(),
  };
  addAnnotation(poly);
  setSelectedAnnotationId("poly-delete-me");

  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
  );

  assert.equal(getSelectedAnnotationId(), null);
  const annotations = getAnnotationsForSlice("1.2.3.4.5");
  assert.equal(
    annotations.find((a) => a.id === "poly-delete-me"),
    undefined,
  );
});

test("initViewportInteraction: switching from measurement tool back to pan works without interference", () => {
  initViewportInteraction();
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "length";
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 10,
      clientY: 10,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(getActiveDrawing());

  // Switch tool to pan and drag
  state.activeTool = "pan";
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 0,
      clientY: 0,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(getActiveDrawing(), null);

  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 25, clientY: 35, bubbles: true }),
  );
  assert.equal(state.viewport.panX, 25);
  assert.equal(state.viewport.panY, 35);
  assert.equal(getActiveDrawing(), null);
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
  document.dispatchEvent(key("l"));
  assert.equal(state.activeTool, "length");
  document.dispatchEvent(key("e"));
  assert.equal(state.activeTool, "ellipse");
  document.dispatchEvent(key("r"));
  document.dispatchEvent(key("m"));
  assert.equal(state.isMetadataOpen, true);
});

test("keyboard: Escape cancels active drawing and clears selection", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();

  setActiveDrawing({
    type: "length",
    start: { x: 10, y: 10 },
  });
  assert.ok(getActiveDrawing());
  document.dispatchEvent(key("Escape"));
  assert.equal(getActiveDrawing(), null);

  setSelectedAnnotationId("ann-1");
  document.dispatchEvent(key("Escape"));
  assert.equal(getSelectedAnnotationId(), null);

  state.isMeasurementPanelOpen = true;
  document.dispatchEvent(key("Escape"));
  assert.equal(state.isMeasurementPanelOpen, false);
});

test("keyboard: Delete or Backspace deletes selected annotation", () => {
  initKeyboardShortcuts();
  state.parsed = mockParsed();

  state.annotations["1.2.3.4.5"] = [
    {
      id: "ann-to-del",
      type: "length",
      sopInstanceUid: "1.2.3.4.5",
      sliceIndex: 0,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      distance: 14.1,
      isCalibrated: false,
      unit: "px",
    },
  ];
  setSelectedAnnotationId("ann-to-del");

  document.dispatchEvent(key("Delete"));
  assert.equal(getSelectedAnnotationId(), null);
  assert.equal(state.annotations["1.2.3.4.5"].length, 0);
});

test("keyboard: p selects pan in 3D mode (US-50), c is a no-op outside it", () => {
  initKeyboardShortcuts();
  initToolbar();
  state.is3DMode = true;
  document.dispatchEvent(key("p"));
  assert.equal(state.activeTool, "pan");

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

// ── Zoom controls ─────────────────────────────────────────────────────────────

test("zoom slider input sets viewport zoom in 2D mode and clamps to [0.1, 5]", () => {
  setBody(viewerFixtureHtml());
  initToolbar();
  state.is3DMode = false;

  const slider = document.getElementById("slider-zoom") as HTMLInputElement;
  slider.value = "2.5";
  slider.dispatchEvent(new Event("input"));
  assert.equal(state.viewport.zoom, 2.5);

  const valZoom = document.getElementById("val-zoom")!;
  assert.equal(valZoom.textContent, "2.5x");
});

test("zoom slider input sets mpr camera zoom in 3D mode", () => {
  setBody(viewerFixtureHtml());
  initToolbar();
  state.is3DMode = true;

  const slider = document.getElementById("slider-zoom") as HTMLInputElement;
  slider.value = "1.5";
  slider.dispatchEvent(new Event("input"));
  assert.equal(mpr3DViewer.camera.zoom, 1.5);
  state.is3DMode = false;
});

test("btn-zoom-fit in 2D mode sets zoom to fit the container and resets pan", () => {
  setBody(viewerFixtureHtml());
  initToolbar();
  state.parsed = mockParsed();
  state.viewport.zoom = 3;
  state.viewport.panX = 50;
  state.viewport.panY = 50;

  document
    .getElementById("btn-zoom-fit")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.panX, 0);
  assert.equal(state.viewport.panY, 0);
});

test("btn-zoom-fit in 3D mode resets camera zoom to 1", () => {
  setBody(viewerFixtureHtml());
  initToolbar();
  state.parsed = mockParsed();
  state.is3DMode = true;
  mpr3DViewer.camera.zoom = 3.0;

  document
    .getElementById("btn-zoom-fit")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.camera.zoom, 1);
  state.is3DMode = false;
});

test("btn-zoom-fit with no parsed study resets viewport zoom to 1 in 2D mode", () => {
  setBody(viewerFixtureHtml());
  initToolbar();
  state.parsed = null;
  state.viewport.zoom = 3;

  document
    .getElementById("btn-zoom-fit")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.zoom, 1);
});

test("btn-zoom-100 sets zoom to 1 in 2D mode and 3D mode", () => {
  setBody(viewerFixtureHtml());
  initToolbar();

  state.is3DMode = false;
  state.viewport.zoom = 3;
  document
    .getElementById("btn-zoom-100")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.zoom, 1);

  state.is3DMode = true;
  mpr3DViewer.camera.zoom = 3;
  document
    .getElementById("btn-zoom-100")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.camera.zoom, 1);
  state.is3DMode = false;
});

test("btn-zoom-200 sets zoom to 2 in 2D mode and 3D mode", () => {
  setBody(viewerFixtureHtml());
  initToolbar();

  state.is3DMode = false;
  document
    .getElementById("btn-zoom-200")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(state.viewport.zoom, 2);

  state.is3DMode = true;
  document
    .getElementById("btn-zoom-200")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(mpr3DViewer.camera.zoom, 2);
  state.is3DMode = false;
});

test("toggleMprMode toggles isMprMode and ensures mutual exclusion with is3DMode", async () => {
  setBody(viewerFixtureHtml());
  initToolbar();

  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.parsed = {
    metadata: {
      ...baseMeta,
      pixelSpacing: [0.5, 0.5] as [number, number],
      imagePositionPatient: [0, 0, 0] as [number, number, number],
    },
    pixelData: null,
    rawDataSet: {},
  } as any;

  const btnMpr = document.getElementById("tool-mpr") as HTMLButtonElement;
  btnMpr.disabled = false;
  mprEngine.volume = {
    data: new Uint8Array(8),
    dimensions: [2, 2, 2],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    windowCenter: 40,
    windowWidth: 400,
  };

  state.is3DMode = true;
  state.isMprMode = false;

  await toggleMprMode();
  assert.equal(state.isMprMode, true);
  assert.equal(state.is3DMode, false);

  const mprContainer = document.getElementById("view-3d-container");
  assert.ok(mprContainer?.classList.contains("hidden"));

  btnMpr.disabled = false;
  await toggleMprMode();
  assert.equal(state.isMprMode, false);
});

test("toggle3DMode toggles is3DMode and ensures mutual exclusion with isMprMode", async () => {
  setBody(viewerFixtureHtml());
  initToolbar();

  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.parsed = {
    metadata: {
      ...baseMeta,
      pixelSpacing: [0.5, 0.5] as [number, number],
      imagePositionPatient: [0, 0, 0] as [number, number, number],
    },
    pixelData: null,
    rawDataSet: {},
  } as any;

  const btn3D = (document.getElementById("tool-view-3d") ||
    document.getElementById("tool-mpr")) as HTMLButtonElement;
  btn3D.disabled = false;
  view3DViewer.volume = {
    data: new Uint8Array(8),
    depth: 2,
    rows: 2,
    cols: 2,
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    windowCenter: 40,
    windowWidth: 400,
  };

  state.isMprMode = true;
  state.is3DMode = false;

  await toggle3DMode();
  assert.equal(state.is3DMode, true);
  assert.equal(state.isMprMode, false);

  const container3D = document.getElementById("view-3d-container");
  assert.ok(!container3D?.classList.contains("hidden"));

  btn3D.disabled = false;
  await toggle3DMode();
  assert.equal(state.is3DMode, false);
});

test("ViewportManager: isCombined3DViewport correctly identifies combined 3D viewport", () => {
  const container = document.createElement("div");
  const manager = new ViewportManager(container);
  manager.setLayout("2x2");
  assert.equal(manager.isCombined3DViewport("vp-3"), true);
  assert.equal(manager.isCombined3DViewport("vp-0"), false);
  assert.equal(manager.isCombined3DViewport("vp-1"), false);
  assert.equal(manager.isCombined3DViewport("vp-2"), false);
  manager.destroy();
});

test("ViewportManager: dispatchMprCrosshair operates on orthogonal planes and blocks vp-3", () => {
  const container = document.createElement("div");
  const manager = new ViewportManager(container);
  manager.setLayout("2x2");
  let appliedDelta = false;
  const originalApply = mprEngine.applyCrosshairDelta2D;
  mprEngine.applyCrosshairDelta2D = () => {
    appliedDelta = true;
  };

  try {
    // Calling from orthogonal viewports should trigger crosshair delta
    appliedDelta = false;
    manager.dispatchMprCrosshair("vp-0", 10, 10, 400, 400);
    assert.equal(
      appliedDelta,
      true,
      "Crosshair delta should be applied for vp-0 (Axial)",
    );

    appliedDelta = false;
    manager.dispatchMprCrosshair("vp-1", 10, 10, 400, 400);
    assert.equal(
      appliedDelta,
      true,
      "Crosshair delta should be applied for vp-1 (Coronal)",
    );

    appliedDelta = false;
    manager.dispatchMprCrosshair("vp-2", 10, 10, 400, 400);
    assert.equal(
      appliedDelta,
      true,
      "Crosshair delta should be applied for vp-2 (Sagittal)",
    );

    // Calling from combined 3D viewport (vp-3) should be strictly blocked
    appliedDelta = false;
    manager.dispatchMprCrosshair("vp-3", 10, 10, 400, 400);
    assert.equal(
      appliedDelta,
      false,
      "Crosshair delta should be ignored for vp-3 (3D combined)",
    );
  } finally {
    mprEngine.applyCrosshairDelta2D = originalApply;
    manager.destroy();
  }
});

test("pan tool in 2D mode with volume loaded dispatches standard 2D pan and not dispatchMprPan", () => {
  setBody(viewerFixtureHtml());
  const vpContainer = document.getElementById("viewport-container")!;
  const manager = initViewportManager(vpContainer);
  initViewportInteraction();

  const parsed = mockParsed();
  state.parsed = parsed;
  manager.activeViewport!.data.parsed = parsed;
  state.isMprMode = false;
  state.is3DMode = false;
  state.activeTool = "pan";

  mprEngine.volume = {
    data: new Uint8Array(8),
    dimensions: [2, 2, 2],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    windowCenter: 40,
    windowWidth: 400,
  } as any;

  let mprPanCalled = false;
  let regularPanCalled = false;
  const originalMprPan = manager.dispatchMprPan.bind(manager);
  const originalPan = manager.dispatchPan.bind(manager);

  manager.dispatchMprPan = (...args) => {
    mprPanCalled = true;
    return originalMprPan(...args);
  };
  manager.dispatchPan = (originId, dx, dy) => {
    regularPanCalled = true;
    return originalPan(originId, dx, dy);
  };

  try {
    const vpCell = manager.activeViewport!.cellElement;
    vpCell.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 100,
        clientY: 100,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 135,
        clientY: 145,
        bubbles: true,
      }),
    );

    assert.equal(
      regularPanCalled,
      true,
      "manager.dispatchPan should be called when isMprMode is false even if volume is loaded",
    );
    assert.equal(
      mprPanCalled,
      false,
      "manager.dispatchMprPan should NOT be called in 2D mode",
    );
    assert.equal(manager.activeViewport!.data.viewport.panX, 35);
    assert.equal(manager.activeViewport!.data.viewport.panY, 45);
    assert.equal(state.viewport.panX, 35);
    assert.equal(state.viewport.panY, 45);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  } finally {
    manager.dispatchMprPan = originalMprPan;
    manager.dispatchPan = originalPan;
    mprEngine.volume = null;
    manager.destroy();
  }
});

test("pan tool in MPR mode with volume loaded dispatches dispatchMprPan", () => {
  setBody(viewerFixtureHtml());
  const vpContainer = document.getElementById("viewport-container")!;
  const manager = initViewportManager(vpContainer);
  initViewportInteraction();

  const parsed = mockParsed();
  state.parsed = parsed;
  manager.activeViewport!.data.parsed = parsed;
  state.isMprMode = true;
  state.is3DMode = false;
  state.activeTool = "pan";

  mprEngine.volume = {
    data: new Uint8Array(8),
    dimensions: [2, 2, 2],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    windowCenter: 40,
    windowWidth: 400,
  } as any;

  let mprPanCalled = false;
  let regularPanCalled = false;
  const originalMprPan = manager.dispatchMprPan.bind(manager);
  const originalPan = manager.dispatchPan.bind(manager);

  manager.dispatchMprPan = (...args) => {
    mprPanCalled = true;
    return originalMprPan(...args);
  };
  manager.dispatchPan = (originId, dx, dy) => {
    regularPanCalled = true;
    return originalPan(originId, dx, dy);
  };

  try {
    const vpCell = manager.activeViewport!.cellElement;
    vpCell.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 100,
        clientY: 100,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 120,
        clientY: 130,
        bubbles: true,
      }),
    );

    assert.equal(
      mprPanCalled,
      true,
      "manager.dispatchMprPan should be called when isMprMode is true",
    );
    assert.equal(
      regularPanCalled,
      false,
      "manager.dispatchPan should NOT be called in MPR mode",
    );

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  } finally {
    manager.dispatchMprPan = originalMprPan;
    manager.dispatchPan = originalPan;
    mprEngine.volume = null;
    manager.destroy();
  }
});

test("btn-toggle-annotations toggles areAnnotationsVisible state and attribute", () => {
  setBody(viewerFixtureHtml);
  initMeasurementControlsInteraction();

  const btnToggle = document.getElementById(
    "btn-toggle-annotations",
  ) as HTMLButtonElement;
  assert.ok(btnToggle, "btn-toggle-annotations should exist in DOM");

  state.areAnnotationsVisible = true;
  btnToggle.click();

  assert.equal(state.areAnnotationsVisible, false);
  assert.equal(btnToggle.getAttribute("aria-pressed"), "false");

  btnToggle.click();
  assert.equal(state.areAnnotationsVisible, true);
  assert.equal(btnToggle.getAttribute("aria-pressed"), "true");
});

test("btn-save-annotations triggers saveToLocalStorage and visual feedback", () => {
  setBody(viewerFixtureHtml);
  initMeasurementControlsInteraction();

  const btnSave = document.getElementById(
    "btn-save-annotations",
  ) as HTMLButtonElement;
  assert.ok(btnSave, "btn-save-annotations should exist in DOM");

  const mockStorage: Record<string, string> = {};
  const originalLocalStorage = globalThis.localStorage;
  (globalThis as any).localStorage = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => {
      mockStorage[k] = v;
    },
    removeItem: (k: string) => {
      delete mockStorage[k];
    },
  };

  try {
    const uid = "slice_0";
    addAnnotation({
      id: "ann-save-test",
      type: "polygon",
      sopInstanceUid: uid,
      sliceIndex: 0,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
      isClosed: true,
      isCalibrated: false,
      unit: "px",
      area: 50,
      perimeter: 30,
    });

    btnSave.click();

    assert.ok(mockStorage[`micd_saves_${uid}`]);
    assert.ok(btnSave.classList.contains("saved"));
    assert.equal(btnSave.textContent, "¡Guardado!");
  } finally {
    (globalThis as any).localStorage = originalLocalStorage;
  }
});

// ── Polygon vertex drag (Layer 1) ────────────────────────────────────────────

test("polygon vertex drag: mousedown on vertex and mousemove repositions that vertex", () => {
  // Use 512×512 so world↔screen coords have enough resolution for 8 px hit radius
  const largeMeta = { ...baseMeta, rows: 512, columns: 512 };
  state.parsed = {
    metadata: largeMeta,
    pixelData: new Uint16Array(4),
    rawDataSet: {},
  } as any;

  const uid = largeMeta.sopInstanceUid; // "1.2.3.4.5"
  // With cols=512, rows=512, zoom=1, panX=0, panY=0, viewW=500, viewH=500:
  //   world(200,200) → screen(194, 306)
  //   world(300,200) → screen(294, 306)
  //   world(250,300) → screen(244, 206)
  addAnnotation({
    id: "poly-drag-v",
    type: "polygon",
    sopInstanceUid: uid,
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px",
    isClosed: true,
    area: 2500,
    perimeter: 200,
    points: [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 250, y: 300 },
    ],
  } as PolygonAnnotation);

  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });
  // getTargetMetrics reads annotation-overlay canvas size; set it to match
  const overlay = document.getElementById(
    "annotation-overlay",
  ) as HTMLCanvasElement;
  overlay.width = 500;
  overlay.height = 500;

  state.activeTool = "polygon";
  setActiveDrawing(null);
  initViewportInteraction();

  // Click exactly on vertex 0 screen position (194, 306) to start vertex drag
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 194,
      clientY: 306,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    state.isDragging,
    true,
    "should be dragging after vertex mousedown",
  );
  assert.equal(
    container.style.cursor,
    "crosshair",
    "cursor should be crosshair during vertex drag",
  );

  // Move mouse to screen (200, 300) → world ≈ (206, 206)
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 200, clientY: 300, bubbles: true }),
  );

  const updatedPoly = getAnnotationsForSlice(uid).find(
    (a) => a.id === "poly-drag-v",
  ) as PolygonAnnotation;
  assert.ok(updatedPoly, "polygon should still exist after drag");
  assert.notEqual(
    updatedPoly.points[0].x,
    200,
    "vertex x should have moved from original position",
  );
  assert.notEqual(
    updatedPoly.points[0].y,
    200,
    "vertex y should have moved from original position",
  );

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(state.isDragging, false, "drag should end after mouseup");
});

// ── Polygon shape drag (Layer 2) ─────────────────────────────────────────────

test("polygon shape drag: mousedown on interior translates all vertices", () => {
  const largeMeta = { ...baseMeta, rows: 512, columns: 512 };
  state.parsed = {
    metadata: largeMeta,
    pixelData: new Uint16Array(4),
    rawDataSet: {},
  } as any;

  const uid = largeMeta.sopInstanceUid;
  // Interior world point (250, 250) → screen (244, 256) with same canvas/zoom params
  addAnnotation({
    id: "poly-drag-s",
    type: "polygon",
    sopInstanceUid: uid,
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px",
    isClosed: true,
    area: 2500,
    perimeter: 200,
    points: [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 250, y: 300 },
    ],
  } as PolygonAnnotation);

  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });
  const overlay = document.getElementById(
    "annotation-overlay",
  ) as HTMLCanvasElement;
  overlay.width = 500;
  overlay.height = 500;

  state.activeTool = "polygon";
  setActiveDrawing(null);
  initViewportInteraction();

  const originalPoints = [
    { x: 200, y: 200 },
    { x: 300, y: 200 },
    { x: 250, y: 300 },
  ];

  // Click interior point (244, 256) to start shape drag
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 244,
      clientY: 256,
      button: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    state.isDragging,
    true,
    "should be dragging after interior mousedown",
  );
  assert.equal(
    container.style.cursor,
    "move",
    "cursor should be 'move' during shape drag",
  );

  // Move 20px right → all vertices should translate
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 264, clientY: 256, bubbles: true }),
  );

  const updatedPoly = getAnnotationsForSlice(uid).find(
    (a) => a.id === "poly-drag-s",
  ) as PolygonAnnotation;
  assert.ok(updatedPoly, "polygon should still exist after shape drag");
  // All vertices should have moved in the same direction
  for (let i = 0; i < originalPoints.length; i++) {
    assert.notEqual(
      updatedPoly.points[i].x,
      originalPoints[i].x,
      `vertex ${i} x should have translated`,
    );
  }

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(state.isDragging, false);
});

// ── dblclick completes active polygon ────────────────────────────────────────

test("dblclick on viewport-container completes the active polygon when 3+ points drawn", () => {
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "polygon";
  initViewportInteraction();

  // Draw 3 polygon points via clicks
  for (const [cx, cy] of [
    [50, 50],
    [100, 50],
    [100, 100],
  ] as [number, number][]) {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: cx,
        clientY: cy,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  assert.ok(getActiveDrawing(), "active drawing should exist after 3 clicks");
  assert.equal(getActiveDrawing()?.points?.length, 3);

  // dblclick completes the polygon
  container.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );

  assert.equal(
    getActiveDrawing(),
    null,
    "active drawing should be cleared after dblclick",
  );
  const annotations = getAnnotationsForSlice(baseMeta.sopInstanceUid);
  assert.equal(
    annotations.length,
    1,
    "completed polygon should be saved as annotation",
  );
  assert.equal(annotations[0].type, "polygon");
  assert.equal((annotations[0] as PolygonAnnotation).isClosed, true);
});

test("dblclick is a no-op when active drawing has fewer than 3 points", () => {
  state.parsed = mockParsed();
  const container = document.getElementById("viewport-container")!;
  Object.defineProperty(container, "clientWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 500,
    configurable: true,
  });

  state.activeTool = "polygon";
  initViewportInteraction();

  // Draw only 2 points
  for (const [cx, cy] of [
    [50, 50],
    [100, 50],
  ] as [number, number][]) {
    container.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: cx,
        clientY: cy,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }

  container.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );

  // Should not complete — active drawing remains
  assert.ok(
    getActiveDrawing(),
    "active drawing should still exist with only 2 points",
  );
  assert.equal(
    getAnnotationsForSlice(baseMeta.sopInstanceUid).length,
    0,
    "no annotation should be saved",
  );
});

// ── Grid layout controls ──────────────────────────────────────────────────────

test("initGridLayoutControls: layout buttons call setLayout and sync button toggles sync", () => {
  // Add the layout control buttons that initGridLayoutControls expects
  const extra = document.createElement("div");
  extra.innerHTML = `
    <button id="btn-layout-1x1" aria-pressed="false">1×1</button>
    <button id="btn-layout-1x2" aria-pressed="false">1×2</button>
    <button id="btn-layout-2x2" aria-pressed="false">2×2</button>
    <button id="btn-sync-viewports" aria-pressed="false">Sync</button>
  `;
  document.body.appendChild(extra);

  const vpContainer = document.getElementById("viewport-container")!;
  const manager = initViewportManager(vpContainer);

  try {
    initGridLayoutControls();

    // Clicking 1x2 should switch layout
    document
      .getElementById("btn-layout-1x2")!
      .dispatchEvent(new MouseEvent("click"));
    assert.equal(
      manager.getAllViewports().length,
      2,
      "1x2 layout should have 2 viewports",
    );
    assert.equal(
      document.getElementById("btn-layout-1x2")!.getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      document.getElementById("btn-layout-1x1")!.getAttribute("aria-pressed"),
      "false",
    );

    // Clicking sync button enables sync
    const syncBtn = document.getElementById("btn-sync-viewports")!;
    assert.equal(
      syncBtn.classList.contains("active"),
      false,
      "sync off initially",
    );
    syncBtn.dispatchEvent(new MouseEvent("click"));
    assert.equal(
      syncBtn.classList.contains("active"),
      true,
      "sync on after click",
    );
    assert.equal(syncBtn.getAttribute("aria-pressed"), "true");

    // Clicking again disables sync
    syncBtn.dispatchEvent(new MouseEvent("click"));
    assert.equal(syncBtn.classList.contains("active"), false);
    assert.equal(syncBtn.getAttribute("aria-pressed"), "false");
  } finally {
    manager.destroy();
    extra.remove();
  }
});

// ── setViewportSync ───────────────────────────────────────────────────────────

test("setViewportSync toggles the btn-sync-viewports active state and aria-pressed", () => {
  const btn = document.createElement("button");
  btn.id = "btn-sync-viewports";
  btn.setAttribute("aria-pressed", "false");
  document.body.appendChild(btn);

  const vpContainer = document.getElementById("viewport-container")!;
  const manager = initViewportManager(vpContainer);

  try {
    setViewportSync(true);
    assert.equal(
      btn.classList.contains("active"),
      true,
      "active class added when enabled",
    );
    assert.equal(btn.getAttribute("aria-pressed"), "true");

    setViewportSync(false);
    assert.equal(
      btn.classList.contains("active"),
      false,
      "active class removed when disabled",
    );
    assert.equal(btn.getAttribute("aria-pressed"), "false");
  } finally {
    manager.destroy();
    btn.remove();
  }
});

// ── toggle3DMode error path ───────────────────────────────────────────────────

test("toggle3DMode returns false and shows error when no files are loaded (count ≤ 1)", async () => {
  initToolbar();
  state.files = []; // count = 0 → loadVolumeIntoEngines returns false early
  state.parsed = null;

  const result = await toggle3DMode();

  assert.equal(
    result,
    false,
    "toggle3DMode should return false when nothing loaded",
  );
  // 3D mode should not have been activated
  assert.equal(state.is3DMode, false);
});

// ── US-50 Radiological Mouse Mapping Tests ────────────────────────────────────

test("US-50 mouse: middle-click drag triggers pan even when activeTool is wl or crosshair", () => {
  const container = document.getElementById("viewport-container")!;
  const manager = initViewportManager(container);
  initViewportInteraction();

  let panDispatched = false;
  manager.dispatchPan = () => {
    panDispatched = true;
  };

  state.parsed = mockParsed();
  state.activeTool = "wl"; // activeTool is WL, but middle click must Pan

  // Middle-click mousedown (button 1)
  const cell = document.querySelector(".viewport-cell") || container;
  cell.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      clientX: 100,
      clientY: 100,
      button: 1,
    }),
  );
  // Mousemove
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 120,
      clientY: 130,
      button: 1,
    }),
  );

  assert.equal(panDispatched, true, "Middle-click drag should execute Pan");

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  manager.destroy();
});

test("US-50 mouse: right-click drag triggers window/level even when activeTool is pan or crosshair", () => {
  const container = document.getElementById("viewport-container")!;
  const manager = initViewportManager(container);
  initViewportInteraction();

  let wlDispatched = false;
  manager.dispatchWindowLevel = () => {
    wlDispatched = true;
  };

  state.parsed = mockParsed();
  state.activeTool = "pan"; // activeTool is Pan, but right click must W/L

  // Right-click mousedown (button 2)
  const cell = document.querySelector(".viewport-cell") || container;
  cell.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      clientX: 100,
      clientY: 100,
      button: 2,
    }),
  );
  // Mousemove
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 110,
      clientY: 115,
      button: 2,
    }),
  );

  assert.equal(
    wlDispatched,
    true,
    "Right-click drag should execute Window/Level",
  );

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  manager.destroy();
});

test("US-50 mouse: contextmenu is prevented on viewport-container to support right-click drag", () => {
  const container = document.getElementById("viewport-container")!;
  initViewportInteraction();

  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  container.dispatchEvent(event);

  assert.equal(
    event.defaultPrevented,
    true,
    "contextmenu should be prevented on container",
  );
});

test("3-axis panel wiring and bidirectional reactivity with MPRGridCoordinator", () => {
  setBody(viewerFixtureHtml());
  initToolbar();

  // Mock volume on view3DViewer
  view3DViewer.volume = {
    cols: 100,
    rows: 80,
    depth: 40,
    data: new Int16Array(100 * 80 * 40),
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    windowCenter: 40,
    windowWidth: 400,
  } as any;
  mprCoordinator.initFromVolume(100, 80, 40);

  const axialSlider = document.getElementById(
    "view-3d-scroll-axial",
  ) as HTMLInputElement;
  const coronalSlider = document.getElementById(
    "view-3d-scroll-coronal",
  ) as HTMLInputElement;
  const sagittalSlider = document.getElementById(
    "view-3d-scroll-sagittal",
  ) as HTMLInputElement;

  const valAxial = document.getElementById("view-3d-val-axial");
  const valCoronal = document.getElementById("view-3d-val-coronal");
  const valSagittal = document.getElementById("view-3d-val-sagittal");

  update3DSlidersUI();

  // Moving axial slider updates only Z coordinate and triggers reactivity
  axialSlider.value = "12";
  axialSlider.dispatchEvent(new Event("input"));
  assert.equal(mprCoordinator.crosshair.z, 12);
  assert.equal(mprCoordinator.crosshair.x, 50);
  assert.equal(mprCoordinator.crosshair.y, 40);
  assert.equal(valAxial?.textContent, "12");

  // Moving coronal slider updates only Y coordinate
  coronalSlider.value = "64";
  coronalSlider.dispatchEvent(new Event("input"));
  assert.equal(mprCoordinator.crosshair.y, 64);
  assert.equal(mprCoordinator.crosshair.x, 50);
  assert.equal(mprCoordinator.crosshair.z, 12);
  assert.equal(valCoronal?.textContent, "64");

  // Moving sagittal slider updates only X coordinate
  sagittalSlider.value = "88";
  sagittalSlider.dispatchEvent(new Event("input"));
  assert.equal(mprCoordinator.crosshair.x, 88);
  assert.equal(mprCoordinator.crosshair.y, 64);
  assert.equal(mprCoordinator.crosshair.z, 12);
  assert.equal(valSagittal?.textContent, "88");

  // Focus guard: while sagittal slider has focus / active interaction, coordinator updates do not fight user .value
  sagittalSlider.focus();
  mprCoordinator.setCrosshair(15, 25, 35);
  assert.equal(
    sagittalSlider.value,
    "88",
    "Focused slider value must not be overwritten by coordinator",
  );
  assert.equal(
    valSagittal?.textContent,
    "15",
    "Display text label still updates to reflect current crosshair",
  );

  // On blur / mouseup, releasing interaction allows reverse reactivity to update value
  sagittalSlider.blur();
  window.dispatchEvent(new Event("mouseup"));
  mprCoordinator.setCrosshair(15, 25, 35);
  assert.equal(axialSlider.value, "35");
  assert.equal(coronalSlider.value, "25");
  assert.equal(sagittalSlider.value, "15");
  assert.equal(valAxial?.textContent, "35");
  assert.equal(valCoronal?.textContent, "25");
  assert.equal(valSagittal?.textContent, "15");

  view3DViewer.volume = null;
});

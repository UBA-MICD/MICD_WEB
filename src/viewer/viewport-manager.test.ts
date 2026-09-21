// Focused tests for ViewportManager mutation paths that were otherwise only
// exercised indirectly: Viewport.resetCamera (including the auto window/level
// fallback when the DICOM carries none) and the sync dispatch fan-out.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { stubCanvas2DContext } from "../../test/viewer-fixture.ts";
import { initViewportManager } from "./viewport-registry.ts";
import type { ViewportManager } from "./viewport-manager.ts";
import type { ParsedDicom } from "../dicom/dicom-parser-util.ts";

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
});

afterEach(() => {
  manager.destroy();
  document.body.innerHTML = "";
});

function fakeDicom(windowWidth: number): ParsedDicom {
  // A pixel ramp so calculateAutoWindowLevel has a real range to work with.
  const pixelData = new Uint16Array(16);
  for (let i = 0; i < pixelData.length; i++) pixelData[i] = i * 40;
  return {
    metadata: {
      rows: 4,
      columns: 4,
      windowWidth,
      windowCenter: windowWidth > 0 ? 40 : 0,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      modality: "CT",
    } as any,
    pixelData,
    rawDataSet: {},
  } as ParsedDicom;
}

test("resetCamera uses the DICOM's own window/level when present", () => {
  const vp = manager.activeViewport!;
  vp.data.parsed = fakeDicom(400);
  vp.data.viewport = {
    windowCenter: 5,
    windowWidth: 5,
    zoom: 3,
    panX: 9,
    panY: 9,
  };

  vp.resetCamera();

  assert.equal(vp.data.viewport.windowWidth, 400, "restored from metadata");
  assert.equal(vp.data.viewport.panX, 0, "pan is reset by fitImage");
  assert.equal(vp.data.viewport.panY, 0);
});

test("resetCamera derives an auto window/level when the DICOM carries none", () => {
  const vp = manager.activeViewport!;
  vp.data.parsed = fakeDicom(0); // windowWidth 0 → must not stay dark
  vp.data.viewport = {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  vp.resetCamera();

  assert.ok(
    vp.data.viewport.windowWidth > 0,
    "auto W/L must produce a visible (non-zero) window width",
  );
});

test("resetCamera is a no-op without parsed data", () => {
  const vp = manager.activeViewport!;
  vp.data.parsed = null;
  vp.data.viewport = {
    windowCenter: 7,
    windowWidth: 7,
    zoom: 2,
    panX: 1,
    panY: 1,
  };

  assert.doesNotThrow(() => vp.resetCamera());
  assert.equal(
    vp.data.viewport.windowWidth,
    7,
    "untouched when there is nothing to show",
  );
});

test("dispatchWindowLevel fans out to other viewports only when synced", () => {
  manager.setLayout("1x2");
  const [vp0, vp1] = manager.getAllViewports();
  vp0!.data.parsed = fakeDicom(400);
  vp1!.data.parsed = fakeDicom(400);
  vp0!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  vp1!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  // Not synced: only the origin changes.
  manager.setSync(false);
  manager.dispatchWindowLevel("vp-0", 100, 0);
  assert.equal(vp0!.data.viewport.windowWidth, 500);
  assert.equal(vp1!.data.viewport.windowWidth, 400, "untouched while unsynced");

  // Synced: the change fans out.
  manager.setSync(true);
  manager.dispatchWindowLevel("vp-0", 100, 0);
  assert.equal(vp0!.data.viewport.windowWidth, 600);
  assert.equal(
    vp1!.data.viewport.windowWidth,
    500,
    "follows the origin when synced",
  );
});

test("dispatchSliceDelta advances synced viewports that share a stack", async () => {
  manager.setLayout("1x2");
  const [vp0, vp1] = manager.getAllViewports();
  for (const vp of [vp0!, vp1!]) {
    vp.data.source = "local";
    vp.data.files = [new File(["a"], "0.dcm"), new File(["b"], "1.dcm")];
    vp.data.currentIndex = 0;
  }
  manager.setSync(true);

  const loaded: string[] = [];
  await manager.dispatchSliceDelta("vp-0", 1, async (vp) => {
    loaded.push(vp.id);
  });

  assert.equal(vp0!.data.currentIndex, 1);
  assert.equal(vp1!.data.currentIndex, 1, "synced viewport advanced too");
  assert.deepEqual(loaded.sort(), ["vp-0", "vp-1"]);
});

test("ViewportCell dynamically renders orientation labels from ImageOrientationPatient", () => {
  const vp = manager.activeViewport!;
  const dcm = fakeDicom(400);
  dcm.metadata.imageOrientationPatient = [1, 0, 0, 0, 1, 0]; // Axial: R->L, A->P
  vp.data.parsed = dcm;
  vp.render();

  const top = vp.cellElement.querySelector(".viewport-orient-label--top");
  const bottom = vp.cellElement.querySelector(".viewport-orient-label--bottom");
  const left = vp.cellElement.querySelector(".viewport-orient-label--left");
  const right = vp.cellElement.querySelector(".viewport-orient-label--right");

  assert.equal(top?.textContent, "A");
  assert.equal(bottom?.textContent, "P");
  assert.equal(left?.textContent, "R");
  assert.equal(right?.textContent, "L");

  // Coronal: [1, 0, 0, 0, 0, -1] -> S, I, R, L
  dcm.metadata.imageOrientationPatient = [1, 0, 0, 0, 0, -1];
  vp.render();
  assert.equal(top?.textContent, "S");
  assert.equal(bottom?.textContent, "I");
  assert.equal(left?.textContent, "R");
  assert.equal(right?.textContent, "L");

  // Missing IOP -> empty labels (AC-5)
  dcm.metadata.imageOrientationPatient = undefined;
  vp.render();
  assert.equal(top?.textContent, "");
  assert.equal(bottom?.textContent, "");
  assert.equal(left?.textContent, "");
  assert.equal(right?.textContent, "");
});

test("ViewportCell resetCamera sets flipY for inverted IOP", () => {
  const vp = manager.activeViewport!;
  const dcm = fakeDicom(400);
  dcm.metadata.imageOrientationPatient = [1, 0, 0, 0, -1, 0]; // Inverted axial (prone)
  vp.data.parsed = dcm;
  vp.resetCamera();

  assert.equal(vp.data.viewport.flipY, true);
});

test("dispatchPan fans out to synced viewports only", () => {
  manager.setLayout("1x2");
  const [vp0, vp1] = manager.getAllViewports();
  vp0!.data.parsed = fakeDicom(400);
  vp1!.data.parsed = fakeDicom(400);
  vp0!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  vp1!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  // Unsynced: only origin moves
  manager.setSync(false);
  manager.dispatchPan("vp-0", 20, 10);
  assert.equal(vp0!.data.viewport.panX, 20);
  assert.equal(vp1!.data.viewport.panX, 0, "vp-1 untouched while unsynced");

  // Synced: both move
  manager.setSync(true);
  manager.dispatchPan("vp-0", 5, 0);
  assert.equal(vp0!.data.viewport.panX, 25);
  assert.equal(vp1!.data.viewport.panX, 5, "vp-1 follows when synced");
});

test("dispatchZoom fans out to synced viewports only", () => {
  manager.setLayout("1x2");
  const [vp0, vp1] = manager.getAllViewports();
  vp0!.data.parsed = fakeDicom(400);
  vp1!.data.parsed = fakeDicom(400);
  vp0!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  vp1!.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  // Unsynced: only origin zooms
  manager.setSync(false);
  manager.dispatchZoom("vp-0", 2);
  assert.equal(vp0!.data.viewport.zoom, 2);
  assert.equal(vp1!.data.viewport.zoom, 1, "vp-1 untouched while unsynced");

  // Synced: both zoom
  manager.setSync(true);
  manager.dispatchZoom("vp-0", 0.5);
  assert.equal(vp0!.data.viewport.zoom, 1);
  assert.equal(vp1!.data.viewport.zoom, 0.5, "vp-1 follows when synced");
});

test("isTopRightViewport returns true for vp-1", () => {
  manager.setLayout("1x2");
  assert.equal(manager.isTopRightViewport("vp-1"), true);
  assert.equal(manager.isTopRightViewport("vp-0"), false);
  assert.equal(
    manager.isTopRightViewport("vp-99"),
    false,
    "unknown id returns false",
  );
});

test("applyZoomFactor with visible segmentation calls render and returns early", () => {
  const vp = manager.activeViewport!;
  vp.data.parsed = fakeDicom(400);
  vp.data.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  // contorno: [] makes renderSegmentationOverlay return early (length < 3)
  (vp.data as any).segmentation = { visible: true, contorno: [] };

  let renderCalled = false;
  const originalRender = vp.render.bind(vp);
  vp.render = () => {
    renderCalled = true;
    originalRender();
  };

  vp.applyZoomFactor(2);

  assert.equal(
    renderCalled,
    true,
    "render() should be called when segmentation is visible",
  );
  // Zoom is still applied before the early return
  assert.equal(vp.data.viewport.zoom, 2);
});

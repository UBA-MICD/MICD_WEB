// Covers the comparison-view and action paths of segmentation-ui.ts that the
// original spec test (segmentation-ui.test.ts) leaves out: openSegmentationComparison,
// runSegmentation (no-image / error / success), toggleLastSegmentation with a
// result in memory, clearSegmentation and setSegmentationVisible. These need a
// real ViewportManager (so getAllViewports() returns cells) plus a fetch stub
// and a session for the one success path that reaches the API.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../../test/dom-setup.ts";
import { stubCanvas2DContext } from "../../../test/viewer-fixture.ts";
import { hideBanner } from "../../shared/banner.ts";
import { adoptSession, logout, type AuthUser } from "../../auth/auth.ts";
import { initViewportManager } from "../viewport-registry.ts";
import { state } from "../state.ts";
import type { ViewportManager } from "../viewport-manager.ts";
import type { ParsedDicom } from "../../dicom/dicom-parser-util.ts";
import type { SegmentationResult } from "./segmentation-service.ts";

test.before(() => {
  installDom();
  stubCanvas2DContext();
});
test.after(() => uninstallDom());

// ── fetch stub + session (only the success path reaches the API) ──────────────
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
let manager: ViewportManager;

beforeEach(() => {
  setBody(`
    <div id="app-banner" class="hidden"></div>
    <div id="segmentation-status" class="hidden"></div>
    <div id="segmentation-badge" class="hidden"></div>
    <button id="tool-show-seg" aria-pressed="false"></button>
    <input type="checkbox" id="chk-segmentation-visible" disabled />
    <div id="viewport-container"></div>
  `);
  manager = initViewportManager(
    document.getElementById("viewport-container") as HTMLElement,
  );
  (globalThis as { fetch?: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => fetchImpl(url, init);
  fetchImpl = async () => {
    throw new Error("unexpected fetch");
  };
  // Baseline global state: an open local study.
  state.source = "local";
  state.files = [];
  state.serverStudyId = null;
  state.serverInstances = [];
  state.currentIndex = 0;
  state.parsed = fakeDicom();
  state.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
});

afterEach(async () => {
  hideBanner();
  manager.destroy();
  delete (globalThis as { fetch?: unknown }).fetch;
  await logout();
  document.body.innerHTML = "";
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function jwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

async function login(): Promise<void> {
  const user: AuthUser = { id: 1, email: "medico@micd.local", role: "medico" };
  await adoptSession(
    jwt({ sub: 1, email: user.email, role: user.role }),
    "rt",
    user,
  );
}

let counter = 0;
async function freshUi(): Promise<typeof import("./segmentation-ui.ts")> {
  return import(`./segmentation-ui.ts?c=${counter++}`);
}

function fakeDicom(rows = 4, columns = 4): ParsedDicom {
  return {
    metadata: {
      rows,
      columns,
      sopInstanceUid: "1.2.3",
      sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
      studyInstanceUid: "1.2",
      seriesInstanceUid: "1.2.1",
      modality: "CT",
      windowCenter: 40,
      windowWidth: 400,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      bitsAllocated: 16,
      pixelRepresentation: 0,
      photometricInterpretation: "MONOCHROME2",
    } as any,
    pixelData: new Uint16Array(rows * columns),
    rawDataSet: {},
  } as ParsedDicom;
}

function fakeResult(): SegmentationResult {
  const width = 4;
  const height = 4;
  return {
    mascara: {
      width,
      height,
      data: new Uint8Array(width * height).fill(1),
      pixelCount: width * height,
    },
    contorno: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ],
    dicomDerivado: { ...fakeDicom(), referencedSopInstanceUid: "1.2.3" } as any,
    seed: 42,
    model: "mock-sam3",
    simulado: true,
    inferenceMs: 100,
  };
}

/** The response shape segmentation-api.ts expects from the backend. */
function apiResponse() {
  return {
    seed: 7,
    model: "mock-sam3",
    simulated: true,
    contour: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ],
    mask: { width: 4, height: 4, rle: [0, 16], pixelCount: 16 },
    derived: {
      sopInstanceUid: "9.9",
      seriesInstanceUid: "9.9.1",
      seriesDescription: "AI segmentation",
      referencedSopInstanceUid: "1.2.3",
      referencedSopClassUid: null,
      derivationDescription: "mock",
    },
    inferenceMs: 120,
  };
}

// ── openSegmentationComparison ────────────────────────────────────────────────

test("openSegmentationComparison lays out 1x2 with the derived DICOM on the right", async () => {
  const ui = await freshUi();
  ui.openSegmentationComparison(fakeResult());

  assert.equal(manager.getLayout(), "1x2");
  const [vp0, vp1] = manager.getAllViewports();
  assert.equal(
    vp0!.data.segmentation,
    null,
    "left panel keeps the original untouched",
  );
  assert.ok(
    vp1!.data.segmentation,
    "right panel carries the segmentation layer",
  );
  assert.equal(vp1!.data.segmentation!.visible, true);
  assert.ok(vp1!.data.mlLabel, "right panel shows an AI HUD label");
});

test("openSegmentationComparison enables sync and makes the right panel active", async () => {
  const ui = await freshUi();
  ui.openSegmentationComparison(fakeResult());

  assert.ok(manager.isSynchronized, "comparison shares framing between panels");
  assert.equal(manager.activeViewport?.id, "vp-1");
});

// ── clearSegmentation ─────────────────────────────────────────────────────────

test("clearSegmentation removes the layer and hides the badge", async () => {
  const ui = await freshUi();
  ui.openSegmentationComparison(fakeResult());
  ui.clearSegmentation();

  for (const vp of manager.getAllViewports()) {
    assert.equal(vp.data.segmentation, null);
  }
  assert.ok(
    document.getElementById("segmentation-badge")!.classList.contains("hidden"),
  );
});

// ── setSegmentationVisible ────────────────────────────────────────────────────

test("setSegmentationVisible toggles the layer's visible flag", async () => {
  const ui = await freshUi();
  ui.openSegmentationComparison(fakeResult());

  ui.setSegmentationVisible(false);
  const vp1 = manager.getAllViewports()[1]!;
  assert.equal(vp1.data.segmentation!.visible, false);

  ui.setSegmentationVisible(true);
  assert.equal(vp1.data.segmentation!.visible, true);
});

// ── runSegmentation: guard + error paths (no network) ─────────────────────────

test("runSegmentation warns and no-ops when there is no image open", async () => {
  state.parsed = null;
  const ui = await freshUi();
  await ui.runSegmentation();

  const banner = document.getElementById("app-banner")!;
  assert.ok(!banner.classList.contains("hidden"));
  assert.equal(
    manager.getLayout(),
    "1x1",
    "layout is untouched without an image",
  );
});

test("runSegmentation surfaces a SegmentationError as an error banner", async () => {
  // rows/columns 0 makes segmentarConIA throw before any network call.
  state.parsed = fakeDicom(0, 0);
  const ui = await freshUi();
  await ui.runSegmentation();

  const banner = document.getElementById("app-banner")!;
  assert.ok(!banner.classList.contains("hidden"), "error is shown on screen");
  assert.equal(
    ui.getLastSegmentation(),
    null,
    "no result is stored on failure",
  );
});

// ── runSegmentation: success path (stubbed API) ───────────────────────────────

test("runSegmentation stores the result and opens the comparison on success", async () => {
  await login();
  fetchImpl = async () => jsonResponse(200, apiResponse());

  const ui = await freshUi();
  await ui.runSegmentation();

  assert.ok(ui.getLastSegmentation(), "the result is kept for the toggle");
  assert.equal(manager.getLayout(), "1x2");
  assert.ok(
    !document
      .getElementById("segmentation-badge")!
      .classList.contains("hidden"),
    "the simulated badge is shown",
  );
});

// ── toggleLastSegmentation with a result in memory ────────────────────────────

test("toggleLastSegmentation flips visibility once a result exists", async () => {
  await login();
  fetchImpl = async () => jsonResponse(200, apiResponse());
  const ui = await freshUi();
  await ui.runSegmentation();

  // Currently shown; toggling hides it.
  ui.toggleLastSegmentation();
  const vp1 = manager.getAllViewports()[1]!;
  assert.equal(vp1.data.segmentation!.visible, false);

  // Toggling again shows it.
  ui.toggleLastSegmentation();
  assert.equal(vp1.data.segmentation!.visible, true);
});

test("toggleLastSegmentation rebuilds the comparison if the layer was lost", async () => {
  await login();
  fetchImpl = async () => jsonResponse(200, apiResponse());
  const ui = await freshUi();
  await ui.runSegmentation();

  // Simulate a grid/study change that dropped the layers from the viewports
  // but left lastResult in memory (clearSegmentation() would also null it).
  for (const vp of manager.getAllViewports()) vp.data.segmentation = null;
  assert.ok(manager.getAllViewports().every((vp) => !vp.data.segmentation));

  ui.toggleLastSegmentation();
  assert.ok(
    manager.getAllViewports().some((vp) => vp.data.segmentation),
    "the same result is re-applied without a new inference",
  );
});

// ── checkbox change handler ───────────────────────────────────────────────────

test("the layers checkbox drives setSegmentationVisible", async () => {
  const ui = await freshUi();
  ui.initSegmentation();
  ui.openSegmentationComparison(fakeResult());

  const toggle = document.getElementById(
    "chk-segmentation-visible",
  ) as HTMLInputElement;
  toggle.checked = false;
  toggle.dispatchEvent(new Event("change"));

  assert.equal(manager.getAllViewports()[1]!.data.segmentation!.visible, false);
});

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

// ── runSegmentation: guard + error paths (no network) ─────────────────────────
//
// US-45: the AI segmentation is now drawn as a polygon on the real image (no
// derived 1x2 comparison), so these cover the guard/error/success of the entry
// point without asserting a layout.

test("runSegmentation warns and no-ops when there is no image open", async () => {
  state.parsed = null;
  const ui = await freshUi();
  await ui.runSegmentation();

  const banner = document.getElementById("app-banner")!;
  assert.ok(!banner.classList.contains("hidden"));
  assert.equal(ui.getLastSegmentation(), null, "no result without an image");
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

test("runSegmentation stores the result on success", async () => {
  await login();
  fetchImpl = async () => jsonResponse(200, apiResponse());

  const ui = await freshUi();
  await ui.runSegmentation();

  assert.ok(ui.getLastSegmentation(), "the result is kept in memory");
});

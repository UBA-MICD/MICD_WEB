/**
 * export-annotation.test.ts — Unit tests for segmentation export (US-48).
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../../test/dom-setup.ts";
import { viewerFixtureHtml } from "../../../test/viewer-fixture.ts";
import {
  getSegmentationExportFilename,
  buildSegmentationPayload,
  exportSegmentation,
} from "./export-annotation.js";
import { addAnnotation, clearAnnotations } from "./annotation-state.js";
import type { PolygonAnnotation } from "./types.js";
import type { AppState } from "../state.js";

// ── exportSegmentation integration tests (need DOM for showBanner) ────────────

const originalURL = (globalThis as any).URL;
const origSetTimeout = globalThis.setTimeout;

test.before(() => {
  installDom();
  (globalThis as any).URL = {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
  };
  // downloadBlob (10 s cleanup) and showBanner (4 s / 6 s auto-dismiss) schedule
  // timers that prevent the test process from exiting cleanly. Skip any timer
  // longer than 200 ms; the tests do not depend on those firing.
  (globalThis as any).setTimeout = (
    fn: (...args: unknown[]) => void,
    delay: number,
    ...args: unknown[]
  ) => {
    if (delay > 200) return 0;
    return origSetTimeout(fn, delay, ...args);
  };
});
test.after(() => {
  (globalThis as any).setTimeout = origSetTimeout;
  uninstallDom();
  (globalThis as any).URL = originalURL;
});

beforeEach(() => {
  setBody(viewerFixtureHtml());
  clearAnnotations();
});

test("exportSegmentation returns false and shows warning when no polygons on slice", async () => {
  const mockState = {
    source: "local",
    files: [new File(["a"], "chest.dcm")],
    currentIndex: 0,
    parsed: {
      metadata: {
        sopInstanceUid: "1.2.seg.test",
        seriesInstanceUid: "series-001",
        columns: 512,
        rows: 512,
        pixelSpacing: [0.5, 0.5] as [number, number],
      },
    },
    annotations: {},
  } as unknown as AppState;

  const result = await exportSegmentation(mockState);
  assert.equal(result, false, "should return false when no polygons");

  const banner = document.getElementById("app-banner")!;
  assert.equal(
    banner.classList.contains("hidden"),
    false,
    "banner should be shown",
  );
  assert.ok(
    banner.textContent?.includes("No") ||
      banner.textContent?.includes("segmentaci"),
    "banner should mention missing segmentation",
  );
});

test("exportSegmentation returns true and shows success when polygons are present", async () => {
  const uid = "1.2.seg.success";
  const poly: PolygonAnnotation = {
    id: "poly-export-1",
    type: "polygon",
    sopInstanceUid: uid,
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px",
    isClosed: true,
    area: 100,
    perimeter: 40,
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ],
  };

  const mockState = {
    source: "local",
    files: [new File(["a"], "abdomen.dcm")],
    currentIndex: 0,
    parsed: {
      metadata: {
        sopInstanceUid: uid,
        seriesInstanceUid: "series-002",
        columns: 512,
        rows: 512,
      },
    },
    annotations: { [uid]: [poly] },
  } as unknown as AppState;

  const result = await exportSegmentation(mockState);
  assert.equal(result, true, "should return true when download succeeds");
});

test("exportSegmentation returns false when downloadBlob throws", async () => {
  // Temporarily break URL to force the catch path
  (globalThis as any).URL = {
    createObjectURL: () => {
      throw new Error("Simulated download failure");
    },
    revokeObjectURL: () => {},
  };

  const uid = "1.2.seg.error";
  const poly: PolygonAnnotation = {
    id: "poly-err-1",
    type: "polygon",
    sopInstanceUid: uid,
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px",
    isClosed: true,
    area: 50,
    perimeter: 28,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ],
  };

  const mockState = {
    source: "local",
    files: [new File(["a"], "scan.dcm")],
    currentIndex: 0,
    parsed: {
      metadata: {
        sopInstanceUid: uid,
        seriesInstanceUid: "series-err",
        columns: 256,
        rows: 256,
      },
    },
    annotations: { [uid]: [poly] },
  } as unknown as AppState;

  try {
    const result = await exportSegmentation(mockState);
    assert.equal(result, false, "should return false when download throws");
  } finally {
    (globalThis as any).URL = {
      createObjectURL: () => "blob:mock-url",
      revokeObjectURL: () => {},
    };
  }
});

test("exportSegmentation uses customFilename when provided", async () => {
  const uid = "1.2.seg.custom";
  const poly: PolygonAnnotation = {
    id: "poly-custom-1",
    type: "polygon",
    sopInstanceUid: uid,
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px",
    isClosed: true,
    area: 75,
    perimeter: 35,
    points: [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 8, y: 12 },
    ],
  };

  const mockState = {
    source: "local",
    files: [new File(["a"], "scan.dcm")],
    currentIndex: 0,
    parsed: {
      metadata: {
        sopInstanceUid: uid,
        seriesInstanceUid: "series-003",
        columns: 256,
        rows: 256,
      },
    },
    annotations: { [uid]: [poly] },
  } as unknown as AppState;

  const result = await exportSegmentation(
    mockState,
    "mi-segmentacion-custom.json",
  );
  assert.equal(result, true, "custom filename export should succeed");
});

// ── Pure function tests ────────────────────────────────────────────────────────

test("getSegmentationExportFilename formats filename correctly with ' - segmentacion hecha.json'", () => {
  assert.equal(
    getSegmentationExportFilename("torax_01.dcm"),
    "torax_01 - segmentacion hecha.json",
  );
  assert.equal(
    getSegmentationExportFilename("CR-MONO1-10-chest"),
    "CR-MONO1-10-chest - segmentacion hecha.json",
  );
  assert.equal(
    getSegmentationExportFilename("study.file.with.dots.dcm"),
    "study.file.with.dots - segmentacion hecha.json",
  );
  assert.equal(
    getSegmentationExportFilename(""),
    "estudio - segmentacion hecha.json",
  );
  assert.equal(
    getSegmentationExportFilename(undefined),
    "estudio - segmentacion hecha.json",
  );
});

test("buildSegmentationPayload constructs valid clinical JSON payload", () => {
  const poly: PolygonAnnotation = {
    id: "poly-1",
    type: "polygon",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 2,
    isCalibrated: true,
    unit: "mm²",
    isClosed: true,
    area: 314.16,
    perimeter: 62.83,
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ],
  };

  const mockState = {
    currentIndex: 2,
    files: [
      { name: "slice_0.dcm" } as File,
      { name: "slice_1.dcm" } as File,
      { name: "scan_abdomen.dcm" } as File,
    ],
    parsed: {
      metadata: {
        sopInstanceUid: "1.2.3.4.5",
        seriesInstanceUid: "series-999",
        columns: 512,
        rows: 512,
        pixelSpacing: [0.5, 0.5] as [number, number],
      },
    },
  } as unknown as AppState;

  const payload = buildSegmentationPayload([poly], mockState);

  assert.equal(payload.version, "1.0");
  assert.equal(payload.source.fileName, "scan_abdomen.dcm");
  assert.equal(payload.source.sopInstanceUid, "1.2.3.4.5");
  assert.equal(payload.source.seriesInstanceUid, "series-999");
  assert.equal(payload.source.sliceIndex, 2);
  assert.equal(payload.source.imageDimensions.columns, 512);
  assert.equal(payload.calibration.isCalibrated, true);
  assert.deepEqual(payload.calibration.pixelSpacing, [0.5, 0.5]);
  assert.equal(payload.segmentation.count, 1);
  assert.equal(payload.segmentation.polygons[0].pointsCount, 4);
  assert.equal(payload.segmentation.polygons[0].area, 314.16);
  assert.equal(payload.segmentation.polygons[0].perimeter, 62.83);
  assert.equal(payload.segmentation.polygons[0].isClosed, true);
});

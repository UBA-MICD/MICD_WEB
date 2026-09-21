/**
 * export-annotation.test.ts — Unit tests for segmentation export (US-48).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getSegmentationExportFilename,
  buildSegmentationPayload,
} from "./export-annotation.js";
import type { PolygonAnnotation } from "./types.js";
import type { AppState } from "../state.js";

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

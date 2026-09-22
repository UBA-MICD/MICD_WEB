/**
 * segmentation-correction.test.ts — pure logic for correcting the AI's
 * segmentation (US-45): contour → editable polygon, polygon → RLE mask.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { decodeMaskRle, encodeMaskRle } from "./segmentation-api.js";
import {
  contourToPolygonAnnotation,
  rasterizePolygon,
  buildCorrectionPayload,
} from "./segmentation-correction.js";
import type { SegmentationResult } from "./segmentation-service.js";
import type {
  DicomCalibration,
  PolygonAnnotation,
} from "../measurements/types.js";

const CAL_UNCAL: DicomCalibration = {
  pixelSpacing: [1, 1],
  isCalibrated: false,
  rescaleSlope: 1,
  rescaleIntercept: 0,
};

function fakeResult(
  contour: { x: number; y: number }[],
  segmentationId: number | null,
): SegmentationResult {
  return {
    segmentationId,
    contorno: contour,
    mascara: { width: 8, height: 8, data: new Uint8Array(64), pixelCount: 0 },
    // Only the metadata shape used by callers matters for these pure tests.
    dicomDerivado: {
      metadata: {},
    } as unknown as SegmentationResult["dicomDerivado"],
    seed: 1,
    model: "mock-sam3",
    simulado: true,
    inferenceMs: 0,
  };
}

test("encodeMaskRle is the inverse of decodeMaskRle", () => {
  const mask = new Uint8Array([0, 0, 1, 1, 1, 0, 1, 0]);
  const rle = encodeMaskRle(mask);
  assert.deepEqual(Array.from(decodeMaskRle(rle, 8, 1)), Array.from(mask));
});

test("encodeMaskRle starts with a background run (0-length if it opens on 1)", () => {
  const mask = new Uint8Array([1, 1, 0, 0]);
  assert.deepEqual(encodeMaskRle(mask), [0, 2, 2]);
});

test("rasterizePolygon fills a square region (pixel centres inside)", () => {
  // Square covering pixel centres (1.5..3.5) → columns/rows 2..3 filled.
  const square = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 4 },
    { x: 1, y: 4 },
  ];
  const mask = rasterizePolygon(square, 6, 6);
  const inside = (x: number, y: number) => mask[y * 6 + x] === 1;
  assert.ok(inside(2, 2) && inside(3, 3), "interior filled");
  assert.ok(!inside(0, 0) && !inside(5, 5), "exterior empty");
  assert.equal(
    mask.reduce((a, b) => a + b, 0),
    9,
    "3×3 pixel block filled",
  );
});

test("rasterizePolygon → RLE round-trips through decodeMaskRle", () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 0, y: 6 },
  ];
  const mask = rasterizePolygon(tri, 6, 6);
  const rle = encodeMaskRle(mask);
  assert.deepEqual(
    Array.from(decodeMaskRle(rle, 6, 6)),
    Array.from(mask),
    "decode(encode(raster)) === raster",
  );
});

test("rasterizePolygon returns an empty mask for degenerate input", () => {
  assert.equal(rasterizePolygon([{ x: 0, y: 0 }], 4, 4).length, 16);
  assert.equal(
    rasterizePolygon([{ x: 0, y: 0 }], 4, 4).reduce((a, b) => a + b, 0),
    0,
  );
});

test("contourToPolygonAnnotation builds a plain editable polygon (tool untouched)", () => {
  const result = fakeResult(
    [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 1, y: 4 },
    ],
    42,
  );
  const ann = contourToPolygonAnnotation(result, "sop-1", CAL_UNCAL, 3);
  assert.equal(ann.type, "polygon");
  assert.equal(ann.isClosed, true);
  assert.equal(ann.sopInstanceUid, "sop-1");
  assert.equal(ann.sliceIndex, 3);
  assert.equal(ann.unit, "px²");
  assert.equal(ann.points.length, 4);
  assert.ok(ann.area > 0 && ann.perimeter > 0);
  // Tagged as AI so the overlay renders it turquoise with an "IA" badge.
  assert.equal(ann.origin, "ai");
});

test("buildCorrectionPayload produces RLE + [h,w] shape", () => {
  const ann: PolygonAnnotation = {
    id: "a",
    type: "polygon",
    sopInstanceUid: "sop-1",
    sliceIndex: 0,
    isCalibrated: false,
    unit: "px²",
    isClosed: true,
    points: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 1, y: 4 },
    ],
    area: 9,
    perimeter: 12,
  };
  const payload = buildCorrectionPayload(ann, 6, 6, { editedVertices: 4 });
  assert.deepEqual(payload.maskShape, [6, 6]);
  assert.deepEqual(payload.editSummary, { editedVertices: 4 });
  // The payload's RLE decodes back to the rasterized polygon.
  assert.deepEqual(
    Array.from(decodeMaskRle(payload.correctedRle, 6, 6)),
    Array.from(rasterizePolygon(ann.points, 6, 6)),
  );
});

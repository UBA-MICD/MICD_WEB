/**
 * annotation-state.test.ts — Unit tests for measurement state management and slice persistence (TK-26).
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  getAnnotationsForSlice,
  clearAnnotations,
  getActiveSopInstanceUid,
  saveToLocalStorage,
  loadFromLocalStorage,
} from "./annotation-state.js";
import type { LengthAnnotation, EllipseAnnotation } from "./types.js";
import { state } from "../state.js";

function makeLengthAnnotation(
  id: string,
  sopInstanceUid: string,
  distance: number = 25,
): LengthAnnotation {
  return {
    id,
    type: "length",
    sopInstanceUid,
    sliceIndex: 0,
    isCalibrated: true,
    unit: "mm",
    start: { x: 10, y: 10 },
    end: { x: 20, y: 20 },
    distance,
  };
}

function makeEllipseAnnotation(
  id: string,
  sopInstanceUid: string,
  area: number = 150,
): EllipseAnnotation {
  return {
    id,
    type: "ellipse",
    sopInstanceUid,
    sliceIndex: 0,
    isCalibrated: true,
    unit: "mm²",
    center: { x: 50, y: 50 },
    radiusX: 10,
    radiusY: 15,
    area,
    meanHu: 35,
    stdDevHu: 5,
  };
}

beforeEach(() => {
  state.annotations = {};
  state.currentIndex = 0;
  state.parsed = null;
});

test("getActiveSopInstanceUid uses parsed metadata SOPInstanceUID or falls back to slice index", () => {
  assert.equal(getActiveSopInstanceUid(), "slice_0");

  state.currentIndex = 3;
  assert.equal(getActiveSopInstanceUid(), "slice_3");

  state.parsed = {
    metadata: {
      sopInstanceUid: "1.2.840.10008.5.1.4.1.1.2.12345",
    } as any,
    pixelData: null,
    rawDataSet: null,
  };
  assert.equal(getActiveSopInstanceUid(), "1.2.840.10008.5.1.4.1.1.2.12345");
});

test("annotations persist and are strictly grouped by SOPInstanceUID across slices", () => {
  const slice1Uid = "1.2.840.slice.1";
  const slice2Uid = "1.2.840.slice.2";

  const annSlice1 = makeLengthAnnotation("line-1", slice1Uid, 40);
  const annSlice2A = makeLengthAnnotation("line-2", slice2Uid, 25);
  const annSlice2B = makeEllipseAnnotation("roi-1", slice2Uid, 314);

  addAnnotation(annSlice1);
  addAnnotation(annSlice2A);
  addAnnotation(annSlice2B);

  // When on Slice 1: only annSlice1 is returned
  const annotationsOn1 = getAnnotationsForSlice(slice1Uid);
  assert.equal(annotationsOn1.length, 1);
  assert.equal(annotationsOn1[0].id, "line-1");

  // When on Slice 2: both annSlice2A and annSlice2B are returned
  const annotationsOn2 = getAnnotationsForSlice(slice2Uid);
  assert.equal(annotationsOn2.length, 2);
  assert.deepEqual(
    annotationsOn2.map((a) => a.id),
    ["line-2", "roi-1"],
  );

  // A different slice has 0 annotations
  assert.deepEqual(getAnnotationsForSlice("1.2.840.slice.3"), []);
});

test("updateAnnotation modifies existing annotation properties in place", () => {
  const uid = "1.2.840.slice.1";
  const ann = makeLengthAnnotation("line-1", uid, 20);
  addAnnotation(ann);

  const updated = {
    ...ann,
    distance: 45.5,
    end: { x: 50, y: 50 },
  };
  const success = updateAnnotation(updated);
  assert.equal(success, true);

  const current = getAnnotationsForSlice(uid)[0] as LengthAnnotation;
  assert.equal(current.distance, 45.5);
  assert.deepEqual(current.end, { x: 50, y: 50 });

  // Updating non-existent returns false
  assert.equal(
    updateAnnotation({ ...ann, id: "missing", sopInstanceUid: uid }),
    false,
  );
});

test("deleteAnnotation removes specific annotation by id", () => {
  const uid = "1.2.840.slice.1";
  addAnnotation(makeLengthAnnotation("ann-1", uid));
  addAnnotation(makeLengthAnnotation("ann-2", uid));

  assert.equal(getAnnotationsForSlice(uid).length, 2);

  const deleted = deleteAnnotation("ann-1", uid);
  assert.equal(deleted, true);

  const remaining = getAnnotationsForSlice(uid);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "ann-2");

  // Deleting again returns false
  assert.equal(deleteAnnotation("ann-1", uid), false);
});

test("clearAnnotations removes either a specific slice group or all annotations", () => {
  addAnnotation(makeLengthAnnotation("a1", "slice-1"));
  addAnnotation(makeLengthAnnotation("a2", "slice-2"));

  // Clear slice-1
  clearAnnotations("slice-1");
  assert.equal(getAnnotationsForSlice("slice-1").length, 0);
  assert.equal(getAnnotationsForSlice("slice-2").length, 1);

  // Clear all
  clearAnnotations();
  assert.deepEqual(state.annotations, {});
});

test("saveToLocalStorage and loadFromLocalStorage persist and restore annotations", () => {
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
    clear: () => {
      for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    },
  };

  try {
    const uid = "1.2.840.test.save";
    const ann = makeLengthAnnotation("saved-1", uid, 30);
    addAnnotation(ann);

    const saved = saveToLocalStorage(uid);
    assert.equal(saved, true);
    assert.ok(mockStorage[`micd_saves_${uid}`]);

    // Clear state in-memory
    clearAnnotations(uid);
    assert.equal(getAnnotationsForSlice(uid).length, 0);

    // Restore from localStorage
    const restored = loadFromLocalStorage(uid);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, "saved-1");
    assert.equal(getAnnotationsForSlice(uid).length, 1);
  } finally {
    (globalThis as any).localStorage = originalLocalStorage;
  }
});

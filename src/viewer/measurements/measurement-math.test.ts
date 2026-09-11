/**
 * measurement-math.test.ts — Unit tests for pure mathematical engine of measurement tools (TK-26).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCalibration,
  calculateDistance,
  calculateEllipseArea,
  calculateEllipseHUStats,
  screenToWorld,
  worldToScreen,
} from "./measurement-math.js";

test("extractCalibration parses valid PixelSpacing and rescale tags", () => {
  const metadata = {
    pixelSpacing: [0.75, 0.5] as [number, number],
    rescaleSlope: 1.5,
    rescaleIntercept: -1000,
  };
  const cal = extractCalibration(metadata);
  assert.equal(cal.isCalibrated, true);
  assert.deepEqual(cal.pixelSpacing, [0.75, 0.5]);
  assert.equal(cal.rescaleSlope, 1.5);
  assert.equal(cal.rescaleIntercept, -1000);
});

test("extractCalibration handles missing/invalid PixelSpacing with fallback", () => {
  const calEmpty = extractCalibration({});
  assert.equal(calEmpty.isCalibrated, false);
  assert.deepEqual(calEmpty.pixelSpacing, [1.0, 1.0]);
  assert.equal(calEmpty.rescaleSlope, 1);
  assert.equal(calEmpty.rescaleIntercept, 0);

  const calZero = extractCalibration({
    pixelSpacing: [0, 0] as [number, number],
  });
  assert.equal(calZero.isCalibrated, false);
  assert.deepEqual(calZero.pixelSpacing, [1.0, 1.0]);

  const calNull = extractCalibration(null);
  assert.equal(calNull.isCalibrated, false);
  assert.deepEqual(calNull.pixelSpacing, [1.0, 1.0]);
});

test("calculateDistance computes standard Euclidean distance when uncalibrated (1.0, 1.0)", () => {
  const p1 = { x: 10, y: 10 };
  const p2 = { x: 13, y: 14 }; // dx = 3, dy = 4 -> dist = 5
  const dist = calculateDistance(p1, p2, [1.0, 1.0]);
  assert.equal(dist, 5);
});

test("calculateDistance computes anisotropic Pythagorean distance (rowSpacing 1.5, colSpacing 0.8)", () => {
  // dx = 10 px, dy = 10 px
  // physical dx = 10 * 0.8 = 8 mm
  // physical dy = 10 * 1.5 = 15 mm
  // distance = sqrt(8^2 + 15^2) = sqrt(64 + 225) = sqrt(289) = 17 mm
  const p1 = { x: 0, y: 0 };
  const p2 = { x: 10, y: 10 };
  const dist = calculateDistance(p1, p2, [1.5, 0.8]);
  assert.equal(dist, 17);
});

test("calculateEllipseArea calculates area in px² without calibration", () => {
  // rx = 10, ry = 5 -> Area = PI * 10 * 5 = 50 * PI
  const area = calculateEllipseArea(10, 5, [1.0, 1.0]);
  assert.ok(Math.abs(area - 50 * Math.PI) < 1e-6);
});

test("calculateEllipseArea calculates calibrated area in mm² with anisotropic spacing", () => {
  // rx = 10 px, ry = 10 px
  // colSpacing = 0.5, rowSpacing = 2.0
  // physical rx = 5 mm, physical ry = 20 mm
  // Area = PI * 5 * 20 = 100 * PI mm²
  const area = calculateEllipseArea(10, 10, [2.0, 0.5]);
  assert.ok(Math.abs(area - 100 * Math.PI) < 1e-6);
});

test("screenToWorld and worldToScreen invert each other consistently", () => {
  const viewportW = 800;
  const viewportH = 600;
  const cols = 512;
  const rows = 512;
  const zoom = 1.8;
  const panX = 45;
  const panY = -30;
  const baseScale = 0.95;

  const originalWorld = { x: 200, y: 150 };
  const screen = worldToScreen(
    originalWorld.x,
    originalWorld.y,
    viewportW,
    viewportH,
    cols,
    rows,
    zoom,
    panX,
    panY,
    baseScale,
  );

  const restoredWorld = screenToWorld(
    screen.x,
    screen.y,
    viewportW,
    viewportH,
    cols,
    rows,
    zoom,
    panX,
    panY,
    baseScale,
  );

  assert.ok(Math.abs(restoredWorld.x - originalWorld.x) < 1e-5);
  assert.ok(Math.abs(restoredWorld.y - originalWorld.y) < 1e-5);
});

test("screenToWorld and worldToScreen incorporate camera panX, panY, and zoom", () => {
  const viewportW = 800;
  const viewportH = 600;
  const cols = 512;
  const rows = 512;

  // Center of image: (256, 256)
  // At panX=50, panY=-20, zoom=2:
  // Screen center of image is (viewportW/2 + panX, viewportH/2 + panY) = (450, 280)
  const imageCenterWorld = { x: 256, y: 256 };
  const screenPt = worldToScreen(
    imageCenterWorld.x,
    imageCenterWorld.y,
    viewportW,
    viewportH,
    cols,
    rows,
    { zoom: 2, panX: 50, panY: -20 },
  );

  assert.equal(screenPt.x, 450);
  assert.equal(screenPt.y, 280);

  const restored = screenToWorld(450, 280, viewportW, viewportH, cols, rows, {
    zoom: 2,
    panX: 50,
    panY: -20,
  });

  assert.equal(restored.x, 256);
  assert.equal(restored.y, 256);
});

test("calculateEllipseHUStats computes exact mean, SD=0 and extremes on uniform CT buffer", () => {
  const cols = 100;
  const rows = 100;
  const pixelData = new Int16Array(cols * rows);
  // Raw pixel value 1024; with slope 1, intercept -1024 -> HU = 0
  pixelData.fill(1024);

  const stats = calculateEllipseHUStats(
    { x: 50, y: 50 },
    15,
    15,
    pixelData,
    cols,
    rows,
    1,
    -1024,
  );

  assert.ok(stats !== null);
  assert.ok(stats.count > 0);
  assert.equal(stats.mean, 0);
  assert.equal(stats.stdDev, 0);
  assert.equal(stats.min, 0);
  assert.equal(stats.max, 0);
});

test("calculateEllipseHUStats correctly samples diverse values inside ellipse", () => {
  const cols = 10;
  const rows = 10;
  const pixelData = new Int16Array(cols * rows);

  // Fill image with 100
  pixelData.fill(100);
  // Put high density lesion in the center
  pixelData[5 * cols + 5] = 200;

  const stats = calculateEllipseHUStats(
    { x: 5, y: 5 },
    1.5,
    1.5,
    pixelData,
    cols,
    rows,
    1,
    0,
  );

  assert.ok(stats !== null);
  assert.ok(stats.count >= 5); // At least center and 4 neighbors
  assert.equal(stats.max, 200);
  assert.equal(stats.min, 100);
  assert.ok(stats.mean > 100 && stats.mean < 200);
  assert.ok(stats.stdDev > 0);
});

test("calculateEllipseHUStats safely clamps to image boundaries when ROI extends off-screen", () => {
  const cols = 20;
  const rows = 20;
  const pixelData = new Int16Array(cols * rows);
  pixelData.fill(50);

  // Center at (0, 0) with radius 10 extends to negative coordinates
  const stats = calculateEllipseHUStats(
    { x: 0, y: 0 },
    10,
    10,
    pixelData,
    cols,
    rows,
    1,
    0,
  );

  assert.ok(stats !== null);
  assert.ok(stats.count > 0);
  assert.equal(stats.mean, 50);
});

test("calculateEllipseHUStats returns null for degenerate inputs", () => {
  const cols = 10;
  const rows = 10;
  const pixelData = new Int16Array(cols * rows);

  assert.equal(
    calculateEllipseHUStats({ x: 5, y: 5 }, 0, 5, pixelData, cols, rows),
    null,
  );
  assert.equal(
    calculateEllipseHUStats({ x: 5, y: 5 }, 5, -2, pixelData, cols, rows),
    null,
  );
  assert.equal(
    calculateEllipseHUStats({ x: 5, y: 5 }, 5, 5, null, cols, rows),
    null,
  );
  assert.equal(
    calculateEllipseHUStats({ x: -100, y: -100 }, 5, 5, pixelData, cols, rows),
    null,
  );
});

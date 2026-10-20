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
  formatLength,
  formatArea,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  isPointInPolygon,
  distancePointToSegment,
  getPolygonBoundingBox,
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

test("formatLength formats uncalibrated distance in pixels", () => {
  assert.equal(formatLength(42.3, false), "42 px");
  assert.equal(formatLength(42.8, false, "cm"), "43 px");
});

test("formatLength formats calibrated distance in mm by default", () => {
  assert.equal(formatLength(15.46, true), "15.5 mm");
  assert.equal(formatLength(15.46, true, "mm"), "15.5 mm");
});

test("formatLength formats calibrated distance in cm (divided by 10)", () => {
  assert.equal(formatLength(25.4, true, "cm"), "2.54 cm");
  assert.equal(formatLength(100.0, true, "cm"), "10.00 cm");
});

test("formatArea formats uncalibrated area in square pixels", () => {
  assert.equal(formatArea(150.2, false), "150 px²");
  assert.equal(formatArea(150.7, false, "cm"), "151 px²");
});

test("formatArea formats calibrated area in mm² by default", () => {
  assert.equal(formatArea(245.67, true), "245.7 mm²");
  assert.equal(formatArea(245.67, true, "mm"), "245.7 mm²");
});

test("formatArea formats calibrated area in cm² (divided by 100)", () => {
  assert.equal(formatArea(250.0, true, "cm"), "2.50 cm²");
  assert.equal(formatArea(1000.0, true, "cm"), "10.00 cm²");
});

test("calculatePolygonArea computes exact area of a known square (Shoelace algorithm)", () => {
  // 10x10 square -> Area = 100 px²
  const squareCCW = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(calculatePolygonArea(squareCCW), 100);

  // Winding order reversed (clockwise) -> Absolute value should still yield 100
  const squareCW = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];
  assert.equal(calculatePolygonArea(squareCW), 100);
});

test("calculatePolygonArea applies anisotropic PixelSpacing calibration correctly", () => {
  // 10x10 px square
  // colSpacing = 0.5 mm/px (width in mm = 10 * 0.5 = 5 mm)
  // rowSpacing = 2.0 mm/px (height in mm = 10 * 2.0 = 20 mm)
  // Calibrated area = 5 * 20 = 100 mm²
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const areaCalibrated = calculatePolygonArea(square, [2.0, 0.5]);
  assert.equal(areaCalibrated, 100);

  // rowSpacing = 1.5, colSpacing = 0.5 -> Area = 100 * (1.5 * 0.5) = 75 mm²
  const areaAnisotropic = calculatePolygonArea(square, [1.5, 0.5]);
  assert.equal(areaAnisotropic, 75);
});

test("calculatePolygonArea computes area for non-convex (L-shaped) polygon", () => {
  // 10x10 bounding square with a 5x5 quadrant removed -> Area = 100 - 25 = 75 px²
  const lShape = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(calculatePolygonArea(lShape), 75);
});

test("calculatePolygonArea handles degenerate polygon inputs gracefully", () => {
  assert.equal(calculatePolygonArea([]), 0);
  assert.equal(calculatePolygonArea([{ x: 5, y: 5 }]), 0);
  assert.equal(
    calculatePolygonArea([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]),
    0,
  );
  // Collinear points
  const collinear = [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ];
  assert.equal(calculatePolygonArea(collinear), 0);
});

test("calculatePolygonPerimeter computes perimeter for uncalibrated and calibrated polygons", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // Uncalibrated closed perimeter: 10 + 10 + 10 + 10 = 40 px
  assert.equal(calculatePolygonPerimeter(square, [1.0, 1.0], true), 40);

  // Uncalibrated open perimeter: 10 + 10 + 10 = 30 px
  assert.equal(calculatePolygonPerimeter(square, [1.0, 1.0], false), 30);

  // Anisotropic calibration:
  // Horizontal sides dx = 10, colSpacing = 0.5 -> 5 mm
  // Vertical sides dy = 10, rowSpacing = 2.0 -> 20 mm
  // Total perimeter = 5 + 20 + 5 + 20 = 50 mm
  assert.equal(calculatePolygonPerimeter(square, [2.0, 0.5], true), 50);

  // Degenerate inputs
  assert.equal(calculatePolygonPerimeter([]), 0);
  assert.equal(calculatePolygonPerimeter([{ x: 5, y: 5 }]), 0);
});

test("isPointInPolygon (Ray-Casting) correctly identifies points inside and outside a convex polygon", () => {
  const square = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ];

  // Point strictly inside
  assert.equal(isPointInPolygon({ x: 20, y: 20 }, square), true);
  assert.equal(isPointInPolygon({ x: 11, y: 11 }, square), true);
  assert.equal(isPointInPolygon({ x: 29, y: 29 }, square), true);

  // Points clearly outside
  assert.equal(isPointInPolygon({ x: 5, y: 20 }, square), false); // left
  assert.equal(isPointInPolygon({ x: 35, y: 20 }, square), false); // right
  assert.equal(isPointInPolygon({ x: 20, y: 5 }, square), false); // above
  assert.equal(isPointInPolygon({ x: 20, y: 35 }, square), false); // below
  assert.equal(isPointInPolygon({ x: 0, y: 0 }, square), false); // diagonal

  // Degenerate inputs
  assert.equal(isPointInPolygon({ x: 20, y: 20 }, []), false);
  assert.equal(isPointInPolygon({ x: 20, y: 20 }, [{ x: 10, y: 10 }]), false);
  assert.equal(
    isPointInPolygon({ x: 20, y: 20 }, [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]),
    false,
  );
});

test("isPointInPolygon (Ray-Casting) correctly handles non-convex concave (C-shaped) polygons", () => {
  // C-shaped polygon with an inner notch
  // (0,0) ----------- (30,0)
  //   |                 |
  //   |   (20,10) - (20,20)
  //   |     |         |
  // (0,10)-(20,10)   (0,20)-(30,20) ...
  const cShape = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
    { x: 0, y: 20 },
    { x: 20, y: 20 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ];

  // Inside bottom wing
  assert.equal(isPointInPolygon({ x: 10, y: 5 }, cShape), true);
  // Inside top wing
  assert.equal(isPointInPolygon({ x: 10, y: 25 }, cShape), true);
  // Inside vertical back bar
  assert.equal(isPointInPolygon({ x: 25, y: 15 }, cShape), true);

  // In the notch (cavity) -> Should be strictly OUTSIDE
  assert.equal(isPointInPolygon({ x: 10, y: 15 }, cShape), false);
  assert.equal(isPointInPolygon({ x: 5, y: 15 }, cShape), false);
});

test("distancePointToSegment computes exact perpendicular and endpoint distances", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  // Perpendicular projection directly onto the segment
  assert.equal(distancePointToSegment({ x: 5, y: 4 }, start, end), 4);
  assert.equal(distancePointToSegment({ x: 5, y: -6 }, start, end), 6);

  // Directly on the segment
  assert.equal(distancePointToSegment({ x: 3, y: 0 }, start, end), 0);

  // Beyond start point (t < 0): closest point is start (0, 0)
  // dist((-3, 4) to (0, 0)) = sqrt((-3)^2 + 4^2) = 5
  assert.equal(distancePointToSegment({ x: -3, y: 4 }, start, end), 5);

  // Beyond end point (t > 1): closest point is end (10, 0)
  // dist((13, 4) to (10, 0)) = sqrt((3)^2 + 4^2) = 5
  assert.equal(distancePointToSegment({ x: 13, y: 4 }, start, end), 5);

  // Degenerate segment where start == end
  assert.equal(
    distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }),
    5,
  );
});

test("getPolygonBoundingBox computes exact extents and dimensions", () => {
  const points = [
    { x: 10, y: 20 },
    { x: 50, y: 5 },
    { x: 30, y: 80 },
    { x: 5, y: 40 },
  ];
  const bbox = getPolygonBoundingBox(points);
  assert.equal(bbox.minX, 5);
  assert.equal(bbox.maxX, 50);
  assert.equal(bbox.minY, 5);
  assert.equal(bbox.maxY, 80);
  assert.equal(bbox.width, 45);
  assert.equal(bbox.height, 75);

  const empty = getPolygonBoundingBox([]);
  assert.equal(empty.width, 0);
  assert.equal(empty.height, 0);
});

test("worldToScreen accepts Point2D as first argument", () => {
  const pt = { x: 256, y: 256 };
  const vp = { zoom: 2, panX: 50, panY: -20 };
  const screenPt = worldToScreen(pt, vp, 800, 600, 512, 512);
  assert.equal(screenPt.x, 450);
  assert.equal(screenPt.y, 280);
});

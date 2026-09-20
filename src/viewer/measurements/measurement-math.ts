/**
 * measurement-math.ts — Pure mathematical calculations for DICOM measurements (TK-26).
 *
 * Implements:
 * - Spatial coordinate transformations (Screen-Space <-> World/Image-Space)
 * - Calibrated distance calculation (anisotropic Pythagorean theorem)
 * - Calibrated ellipse area calculation
 * - Single-pass bounded sampling for Hounsfield Unit (HU) statistics (mean, SD, min, max)
 * - Safe DICOM calibration metadata extraction
 */

import type { DicomMetadata } from "../../dicom/dicom-parser-util.js";
import type { DicomCalibration, EllipseHUStats, Point2D } from "./types.js";

/**
 * Safely extracts spatial and radiometric calibration from DICOM metadata.
 * Returns pixelSpacing [rowSpacing, colSpacing] and isCalibrated flag.
 */
export function extractCalibration(
  metadata?: Partial<DicomMetadata> | null,
): DicomCalibration {
  let isCalibrated = false;
  let pixelSpacing: [number, number] = [1.0, 1.0];

  if (metadata?.pixelSpacing && Array.isArray(metadata.pixelSpacing)) {
    const [rowSpacing, colSpacing] = metadata.pixelSpacing;
    if (
      typeof rowSpacing === "number" &&
      typeof colSpacing === "number" &&
      !isNaN(rowSpacing) &&
      !isNaN(colSpacing) &&
      rowSpacing > 0 &&
      colSpacing > 0
    ) {
      pixelSpacing = [rowSpacing, colSpacing];
      isCalibrated = true;
    }
  }

  const rescaleSlope =
    typeof metadata?.rescaleSlope === "number" && !isNaN(metadata.rescaleSlope)
      ? metadata.rescaleSlope
      : 1;

  const rescaleIntercept =
    typeof metadata?.rescaleIntercept === "number" &&
    !isNaN(metadata.rescaleIntercept)
      ? metadata.rescaleIntercept
      : 0;

  return {
    pixelSpacing,
    isCalibrated,
    rescaleSlope,
    rescaleIntercept,
  };
}

/**
 * Calculates physical linear distance between two points in image pixel coordinates.
 * If pixelSpacing is provided as [rowSpacing, colSpacing], distance is returned in millimeters (mm).
 * Otherwise, with default [1.0, 1.0], it returns standard Euclidean distance in pixels (px).
 *
 * Formula: d = sqrt((dx * colSpacing)^2 + (dy * rowSpacing)^2)
 */
export function calculateDistance(
  p1: Point2D,
  p2: Point2D,
  pixelSpacing: [number, number] = [1.0, 1.0],
): number {
  const [rowSpacing, colSpacing] = pixelSpacing;
  const dx = (p2.x - p1.x) * colSpacing;
  const dy = (p2.y - p1.y) * rowSpacing;
  return Math.hypot(dx, dy);
}

/**
 * Calculates the area of an ellipse defined by radii rx, ry in image pixels.
 * If calibrated with [rowSpacing, colSpacing], returns area in mm².
 * Otherwise returns area in px².
 *
 * Formula: Area = PI * (rx * colSpacing) * (ry * rowSpacing)
 */
export function calculateEllipseArea(
  radiusX: number,
  radiusY: number,
  pixelSpacing: [number, number] = [1.0, 1.0],
): number {
  const [rowSpacing, colSpacing] = pixelSpacing;
  const physicalRx = Math.abs(radiusX) * colSpacing;
  const physicalRy = Math.abs(radiusY) * rowSpacing;
  return Math.PI * physicalRx * physicalRy;
}

/**
 * Converts screen viewport coordinates to intrinsic image pixel coordinates (World-Space).
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  cols: number,
  rows: number,
  zoomOrViewport: number | { zoom: number; panX?: number; panY?: number },
  panX: number = 0,
  panY: number = 0,
  // NOTA: baseScale se mantiene en 1 asumiendo que el renderer DICOM mapea 1:1 con los píxeles CSS antes de aplicar viewport.zoom
  baseScale: number = 1,
  flipY: boolean = true,
): Point2D {
  let zoomVal = 1;
  let panXVal = panX;
  let panYVal = panY;

  if (typeof zoomOrViewport === "object" && zoomOrViewport !== null) {
    zoomVal = zoomOrViewport.zoom;
    panXVal = zoomOrViewport.panX ?? 0;
    panYVal = zoomOrViewport.panY ?? 0;
  } else if (typeof zoomOrViewport === "number") {
    zoomVal = zoomOrViewport;
  }

  const currentZoom =
    typeof zoomVal === "number" && !isNaN(zoomVal) && zoomVal > 0 ? zoomVal : 1;
  const currentPanX =
    typeof panXVal === "number" && !isNaN(panXVal) ? panXVal : 0;
  const currentPanY =
    typeof panYVal === "number" && !isNaN(panYVal) ? panYVal : 0;
  const effectiveScale = baseScale * currentZoom;
  if (effectiveScale <= 0) return { x: 0, y: 0 };

  const worldX =
    (screenX - viewportWidth / 2 - currentPanX) / effectiveScale + cols / 2;
  const dy = (screenY - viewportHeight / 2 - currentPanY) / effectiveScale;
  const worldY = (flipY ? -dy : dy) + rows / 2;

  return { x: worldX, y: worldY };
}

/**
 * Converts intrinsic image pixel coordinates (World-Space) to screen viewport coordinates.
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewportWidth: number,
  viewportHeight: number,
  cols: number,
  rows: number,
  zoomOrViewport: number | { zoom: number; panX?: number; panY?: number },
  panX: number = 0,
  panY: number = 0,
  // NOTA: baseScale se mantiene en 1 asumiendo que el renderer DICOM mapea 1:1 con los píxeles CSS antes de aplicar viewport.zoom
  baseScale: number = 1,
  flipY: boolean = true,
): Point2D {
  let zoomVal = 1;
  let panXVal = panX;
  let panYVal = panY;

  if (typeof zoomOrViewport === "object" && zoomOrViewport !== null) {
    zoomVal = zoomOrViewport.zoom;
    panXVal = zoomOrViewport.panX ?? 0;
    panYVal = zoomOrViewport.panY ?? 0;
  } else if (typeof zoomOrViewport === "number") {
    zoomVal = zoomOrViewport;
  }

  const currentZoom =
    typeof zoomVal === "number" && !isNaN(zoomVal) && zoomVal > 0 ? zoomVal : 1;
  const currentPanX =
    typeof panXVal === "number" && !isNaN(panXVal) ? panXVal : 0;
  const currentPanY =
    typeof panYVal === "number" && !isNaN(panYVal) ? panYVal : 0;
  const effectiveScale = baseScale * currentZoom;

  const screenX =
    viewportWidth / 2 + currentPanX + (worldX - cols / 2) * effectiveScale;
  const dy = (worldY - rows / 2) * effectiveScale;
  const screenY = viewportHeight / 2 + currentPanY + (flipY ? -dy : dy);

  return { x: screenX, y: screenY };
}

/**
 * Performs iterative bounded sampling inside an ellipse ROI to compute Hounsfield Unit statistics:
 * - Mean HU (arithmetic mean)
 * - Standard Deviation (SD, sample variance)
 * - Minimum and Maximum HU values
 *
 * Employs Bounding Box Clamping and single-pass accumulation:
 * O(4 * rx * ry) complexity.
 */
export function calculateEllipseHUStats(
  center: Point2D,
  radiusX: number,
  radiusY: number,
  pixelData: ArrayLike<number> | null,
  cols: number,
  rows: number,
  slope: number = 1,
  intercept: number = 0,
): EllipseHUStats | null {
  if (!pixelData || radiusX <= 0 || radiusY <= 0 || cols <= 0 || rows <= 0) {
    return null;
  }

  const rx = radiusX;
  const ry = radiusY;

  // If ellipse bounding box lies entirely outside image bounds
  if (
    center.x + rx < 0 ||
    center.x - rx >= cols ||
    center.y + ry < 0 ||
    center.y - ry >= rows
  ) {
    return null;
  }

  // 1. Bounding Box Clamping to image bounds [0, cols-1] x [0, rows-1]
  const iMin = Math.max(0, Math.floor(center.x - rx));
  const iMax = Math.min(cols - 1, Math.ceil(center.x + rx));
  const jMin = Math.max(0, Math.floor(center.y - ry));
  const jMax = Math.min(rows - 1, Math.ceil(center.y + ry));

  if (iMin > iMax || jMin > jMax) {
    return null;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;

  // 2. Iterative Point-in-Ellipse Evaluation
  for (let j = jMin; j <= jMax; j++) {
    const dy = j - center.y;
    const dySqNorm = (dy * dy) / rySq;
    if (dySqNorm > 1) continue;

    const rowOffset = j * cols;

    for (let i = iMin; i <= iMax; i++) {
      const dx = i - center.x;
      const insideNorm = (dx * dx) / rxSq + dySqNorm;

      if (insideNorm <= 1) {
        const rawValue = pixelData[rowOffset + i];
        if (rawValue !== undefined && !isNaN(rawValue)) {
          // 3. Radiometric Rescale to HU
          const hu = rawValue * slope + intercept;
          count++;
          sum += hu;
          sumSq += hu * hu;
          if (hu < min) min = hu;
          if (hu > max) max = hu;
        }
      }
    }
  }

  if (count === 0) {
    return null;
  }

  // 4. Single-pass Statistical Aggregation
  const mean = sum / count;
  const variance =
    count > 1 ? Math.max(0, (sumSq - (sum * sum) / count) / (count - 1)) : 0;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    mean,
    stdDev,
    min,
    max,
  };
}

/**
 * Formats a distance in millimeters (or pixels if uncalibrated).
 * When unit is 'cm', distance is divided by 10.
 */
export function formatLength(
  distanceMm: number,
  isCalibrated: boolean,
  unit: "mm" | "cm" = "mm",
): string {
  if (!isCalibrated) {
    return `${Math.round(distanceMm)} px`;
  }
  if (unit === "cm") {
    const cm = distanceMm / 10;
    return `${cm.toFixed(2)} cm`;
  }
  return `${distanceMm.toFixed(1)} mm`;
}

/**
 * Formats an area in square millimeters (or square pixels if uncalibrated).
 * When unit is 'cm', area is divided by 100 (1 cm² = 100 mm²).
 */
export function formatArea(
  areaMm2: number,
  isCalibrated: boolean,
  unit: "mm" | "cm" = "mm",
): string {
  if (!isCalibrated) {
    return `${Math.round(areaMm2)} px²`;
  }
  if (unit === "cm") {
    const cm2 = areaMm2 / 100;
    return `${cm2.toFixed(2)} cm²`;
  }
  return `${areaMm2.toFixed(1)} mm²`;
}

/**
 * Calculates the area of a polygon using the Shoelace algorithm (Gauss's area formula).
 * Points are in image pixel space (World-Space).
 *
 * If pixelSpacing is provided as [rowSpacing, colSpacing], the area is scaled
 * by (rowSpacing * colSpacing) and returned in square millimeters (mm²).
 * Otherwise returns area in square pixels (px²).
 *
 * Formula: Area = 0.5 * |sum_{i=0}^{N-1} (x_i * y_{i+1} - x_{i+1} * y_i)| * (colSpacing * rowSpacing)
 */
export function calculatePolygonArea(
  points: Point2D[],
  pixelSpacing: [number, number] = [1.0, 1.0],
): number {
  if (points.length < 3) return 0;

  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    sum += points[i].x * points[next].y - points[next].x * points[i].y;
  }

  const areaPx = Math.abs(sum) / 2;
  const [rowSpacing, colSpacing] = pixelSpacing;
  return areaPx * (rowSpacing * colSpacing);
}

/**
 * Calculates the perimeter of a polygon in image space.
 * If pixelSpacing is provided as [rowSpacing, colSpacing], the perimeter is calculated
 * with anisotropic physical distances in millimeters (mm).
 * Otherwise returns perimeter in pixels (px).
 *
 * @param points Ordered array of vertices
 * @param pixelSpacing [rowSpacing, colSpacing]
 * @param isClosed Whether the polygon is closed (connecting the last vertex to the first)
 */
export function calculatePolygonPerimeter(
  points: Point2D[],
  pixelSpacing: [number, number] = [1.0, 1.0],
  isClosed: boolean = true,
): number {
  if (points.length < 2) return 0;

  let totalDistance = 0;
  const segmentCount = isClosed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    totalDistance += calculateDistance(p1, p2, pixelSpacing);
  }

  return totalDistance;
}

/**
 * Determines whether a 2D point lies inside a polygon using the Ray-Casting algorithm
 * (even-odd rule / Jordan curve theorem).
 * Works for both convex and non-convex (concave) polygons.
 *
 * @param point The test point in image coordinates (World-Space)
 * @param polygonPoints Ordered array of polygon vertices
 */
export function isPointInPolygon(
  point: Point2D,
  polygonPoints: Point2D[],
): boolean {
  if (polygonPoints.length < 3) return false;

  let inside = false;
  const { x, y } = point;
  const n = polygonPoints.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygonPoints[i].x;
    const yi = polygonPoints[i].y;
    const xj = polygonPoints[j].x;
    const yj = polygonPoints[j].y;

    // Check if the horizontal ray from (x, y) extending to the right (+X)
    // crosses the segment between (xi, yi) and (xj, yj).
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Calculates the shortest Euclidean distance from a point to a finite line segment (lineStart to lineEnd).
 * Used for edge hit-testing on polygons and linear annotations.
 */
export function distancePointToSegment(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    point.x - (lineStart.x + t * dx),
    point.y - (lineStart.y + t * dy),
  );
}

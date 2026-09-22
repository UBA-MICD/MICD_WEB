/**
 * types.ts — Data models for measurement tools and annotations (TK-26).
 */

export interface Point2D {
  x: number; // Coordinate in image pixel space (World-Space)
  y: number;
}

export type MeasurementType = "length" | "ellipse" | "polygon";

export interface BaseAnnotation {
  id: string;
  type: MeasurementType;
  color?: string;
  sopInstanceUid: string;
  sliceIndex: number;
  isCalibrated: boolean;
  unit: "mm" | "px" | "mm²" | "px²";
  createdAt?: number;
}

export interface LengthAnnotation extends BaseAnnotation {
  type: "length";
  start: Point2D;
  end: Point2D;
  distance: number; // in mm if isCalibrated, else px
}

export interface EllipseAnnotation extends BaseAnnotation {
  type: "ellipse";
  center: Point2D;
  radiusX: number; // in image pixels
  radiusY: number;
  area: number; // in mm² if isCalibrated, else px²
  meanHu?: number;
  stdDevHu?: number;
  minHu?: number;
  maxHu?: number;
}

export interface PolygonAnnotation extends BaseAnnotation {
  type: "polygon";
  points: Point2D[]; // Ordered array of vertices in image pixel coordinates (World-Space)
  isClosed: boolean;
  area: number; // in mm² if isCalibrated, else px²
  perimeter: number; // in mm if isCalibrated, else px
  meanHu?: number;
  stdDevHu?: number;
  minHu?: number;
  maxHu?: number;
  /**
   * Provenance (US-45). Absent/"manual" = drawn by a person with the polygon
   * tool (rendered as usual). "ai" = seeded from the AI segmentation contour —
   * rendered turquoise with an "IA" tag so it stands apart from manual polygons.
   */
  origin?: "ai" | "manual";
}

export type Annotation =
  LengthAnnotation | EllipseAnnotation | PolygonAnnotation;

export interface DicomCalibration {
  pixelSpacing: [number, number]; // [rowSpacing, colSpacing] in mm/pixel
  isCalibrated: boolean;
  rescaleSlope: number;
  rescaleIntercept: number;
}

export interface EllipseHUStats {
  count: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
}

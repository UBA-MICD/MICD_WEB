/**
 * types.ts — Data models for measurement tools and annotations (TK-26).
 */

export interface Point2D {
  x: number; // Coordinate in image pixel space (World-Space)
  y: number;
}

export type MeasurementType = "length" | "ellipse";

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

export type Annotation = LengthAnnotation | EllipseAnnotation;

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

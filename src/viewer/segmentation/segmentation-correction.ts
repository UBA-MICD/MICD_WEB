// ── Corrección de la segmentación de la IA (US-45) ───────────────────────────
//
// Puente entre el contorno que propone la IA y la herramienta de polígono del
// visor. El validador edita el contorno con los MISMOS mecanismos del marking
// tool (arrastrar/agregar/quitar vértices); al guardar, el polígono editado se
// rasteriza a una máscara binaria, se codifica en RLE y se manda al backend
// como una corrección nueva (append-only, conserva el original de la IA).
//
// Módulo sin DOM: sólo geometría y llamadas de red, testeable bajo Node.

import type {
  DicomCalibration,
  PolygonAnnotation,
  Point2D,
} from "../measurements/types.js";
import {
  calculatePolygonArea,
  calculatePolygonPerimeter,
} from "../measurements/measurement-math.js";
import {
  encodeMaskRle,
  saveCorrection,
  type ApiResult,
  type CorrectionResponse,
} from "./segmentation-api.js";
import { maskToPolygon } from "./mask-to-polygon.js";
import type { SegmentationResult } from "./segmentation-service.js";

/**
 * Convierte la segmentación de la IA en un `PolygonAnnotation` común y corriente,
 * para que la herramienta de polígono ya existente lo edite sin código nuevo.
 *
 * Se traza a partir de la MÁSCARA (`maskToPolygon`), no del `contour` que manda
 * el backend: así obtenemos UN contorno limpio y simple, y el mismo camino sirve
 * cuando SAM3 devuelva una máscara real. Si el trazado fallara (máscara vacía),
 * cae al `contorno` que ya trae la respuesta.
 */
export function contourToPolygonAnnotation(
  result: SegmentationResult,
  sopInstanceUid: string,
  calibration: DicomCalibration,
  sliceIndex = 0,
): PolygonAnnotation {
  const traced = maskToPolygon(
    result.mascara.data,
    result.mascara.width,
    result.mascara.height,
  );
  const points =
    traced.length >= 3
      ? traced
      : result.contorno.map((p) => ({ x: p.x, y: p.y }));
  const spacing = calibration.pixelSpacing;
  const area = calculatePolygonArea(points, spacing);
  const perimeter = calculatePolygonPerimeter(points, spacing, true);
  return {
    id: `seg_ai_${result.segmentationId ?? "local"}_${Date.now()}`,
    type: "polygon",
    sopInstanceUid,
    sliceIndex,
    isClosed: true,
    isCalibrated: calibration.isCalibrated,
    unit: calibration.isCalibrated ? "mm²" : "px²",
    points,
    area,
    perimeter,
    origin: "ai",
    createdAt: Date.now(),
  };
}

/**
 * Rasteriza un polígono cerrado a una máscara binaria row-major de
 * `width × height` (1 = dentro). Relleno por scanline con regla par-impar,
 * evaluando el centro de cada píxel (x+0.5, y+0.5). Es la inversa práctica de
 * un contorno: `decodeMaskRle(encodeMaskRle(rasterizePolygon(...)))` reproduce
 * la misma máscara.
 */
export function rasterizePolygon(
  points: Point2D[],
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(Math.max(0, width * height));
  const n = points.length;
  if (n < 3 || width <= 0 || height <= 0) return mask;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(height - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    const cy = y + 0.5;
    // Ordenadas X donde el borde cruza la línea horizontal cy.
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const ay = a.y;
      const by = b.y;
      // El borde cruza cy si un extremo está por encima y el otro por debajo.
      if (ay <= cy ? by > cy : by <= cy) {
        const tX = a.x + ((cy - ay) / (by - ay)) * (b.x - a.x);
        xs.push(tX);
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xLeft = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xRight = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      const row = y * width;
      for (let x = xLeft; x <= xRight; x++) mask[row + x] = 1;
    }
  }
  return mask;
}

/**
 * Arma el cuerpo de la corrección a partir del polígono editado: rasteriza,
 * codifica en RLE y adjunta un resumen de la edición.
 */
export function buildCorrectionPayload(
  annotation: PolygonAnnotation,
  width: number,
  height: number,
  editSummary?: Record<string, unknown>,
): {
  correctedRle: number[];
  maskShape: [number, number];
  editSummary?: Record<string, unknown>;
} {
  const mask = rasterizePolygon(annotation.points, width, height);
  return {
    correctedRle: encodeMaskRle(mask),
    maskShape: [height, width],
    editSummary,
  };
}

/**
 * Guarda el polígono editado como una corrección del candidato de la IA.
 * Rechaza si el candidato no está persistido (sin `segmentationId`).
 */
export async function savePolygonCorrection(
  annotation: PolygonAnnotation,
  segmentationId: number | null,
  width: number,
  height: number,
  editSummary?: Record<string, unknown>,
): Promise<ApiResult<CorrectionResponse>> {
  if (segmentationId == null) {
    return {
      ok: false,
      status: 0,
      error: "La segmentación no está persistida; no se puede corregir.",
    };
  }
  const payload = buildCorrectionPayload(
    annotation,
    width,
    height,
    editSummary,
  );
  return saveCorrection(segmentationId, payload);
}

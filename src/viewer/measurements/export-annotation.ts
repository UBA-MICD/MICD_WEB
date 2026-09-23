/**
 * export-annotation.ts — Local segmentation export for ad-hoc manual marking (US-48).
 *
 * Serializes manual polygonal annotations into clinical JSON structure and
 * triggers client-side download named "{nombre del archivo original} - segmentacion hecha.json".
 */

import { state, type AppState } from "../state.js";
import {
  getAnnotationsForSlice,
  getActiveSopInstanceUid,
} from "./annotation-state.js";
import { extractCalibration } from "./measurement-math.js";
import type { PolygonAnnotation, Point2D } from "./types.js";
import { downloadBlob } from "../../services/export-service.js";
import { showBanner } from "../../shared/banner.js";
import { t } from "../../i18n/i18n.js";
import { $ } from "../../shared/dom.js";

export interface SerializedPolygon {
  id: string;
  type: "polygon";
  isClosed: boolean;
  area: number;
  perimeter: number;
  unitArea: string;
  unitPerimeter: string;
  pointsCount: number;
  points: Point2D[];
}

export interface SegmentationExportPayload {
  version: string;
  generatedBy: string;
  createdAt: string;
  source: {
    fileName: string;
    sopInstanceUid: string;
    seriesInstanceUid: string;
    sliceIndex: number;
    imageDimensions: {
      columns: number;
      rows: number;
    };
  };
  calibration: {
    isCalibrated: boolean;
    pixelSpacing: [number, number];
    unit: string;
  };
  segmentation: {
    count: number;
    polygons: SerializedPolygon[];
  };
}

/**
 * Derives the dynamic export filename from the original DICOM filename:
 * "{nombre del archivo original} - segmentacion hecha.json"
 */
export function getSegmentationExportFilename(sourceFileName?: string): string {
  const raw =
    sourceFileName && sourceFileName.trim() ? sourceFileName.trim() : "estudio";
  const base = raw.replace(/\.[^/.]+$/, "");
  return `${base} - segmentacion hecha.json`;
}

/**
 * Builds the structured JSON export payload from active annotations and DICOM metadata.
 */
export function buildSegmentationPayload(
  polygons: PolygonAnnotation[],
  appState: AppState = state,
): SegmentationExportPayload {
  const metadata = appState.parsed?.metadata;
  const cal = extractCalibration(metadata);
  const sopInstanceUid =
    metadata?.sopInstanceUid || getActiveSopInstanceUid(appState);
  const seriesInstanceUid = metadata?.seriesInstanceUid || "";
  const sliceIndex = appState.currentIndex ?? 0;
  const fileName =
    appState.files?.[appState.currentIndex]?.name || "estudio.dcm";

  const serializedPolygons: SerializedPolygon[] = polygons.map((poly) => ({
    id: poly.id,
    type: "polygon",
    isClosed: poly.isClosed,
    area: poly.area,
    perimeter: poly.perimeter,
    unitArea: poly.isCalibrated ? "mm²" : "px²",
    unitPerimeter: poly.isCalibrated ? "mm" : "px",
    pointsCount: poly.points.length,
    points: poly.points.map((p) => ({ x: p.x, y: p.y })),
  }));

  return {
    version: "1.0",
    generatedBy: "MICD Viewer (US-48)",
    createdAt: new Date().toISOString(),
    source: {
      fileName,
      sopInstanceUid,
      seriesInstanceUid,
      sliceIndex,
      imageDimensions: {
        columns: metadata?.columns || 0,
        rows: metadata?.rows || 0,
      },
    },
    calibration: {
      isCalibrated: cal.isCalibrated,
      pixelSpacing: cal.pixelSpacing,
      unit: cal.isCalibrated ? "mm" : "px",
    },
    segmentation: {
      count: serializedPolygons.length,
      polygons: serializedPolygons,
    },
  };
}

/**
 * Exports current polygonal segmentations as a downloadable JSON file.
 * Returns true if the export was initiated/saved, false if there was nothing to export or canceled.
 */
export async function exportSegmentation(
  appState: AppState = state,
  customFilename?: string,
): Promise<boolean> {
  const sopInstanceUid = getActiveSopInstanceUid(appState);
  const sliceAnnotations = getAnnotationsForSlice(sopInstanceUid, appState);
  const polygons = sliceAnnotations.filter(
    (a): a is PolygonAnnotation => a.type === "polygon",
  );

  if (polygons.length === 0) {
    showBanner(
      t("viewer.measure.noSegmentationToExport") ||
        "No hay segmentaciones poligonales para exportar en este corte.",
      "warning",
    );
    return false;
  }

  const payload = buildSegmentationPayload(polygons, appState);
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });

  const rawFileName = appState.files?.[appState.currentIndex]?.name;
  const fileName = customFilename || getSegmentationExportFilename(rawFileName);

  try {
    const saved = await downloadBlob(blob, fileName);
    if (saved) {
      showBanner(
        t("viewer.measure.exportSuccess") ||
          "Segmentación exportada exitosamente.",
        "success",
      );
      const announceEl = $("measure-announce");
      if (announceEl) {
        announceEl.textContent =
          t("viewer.measure.exportSuccess") ||
          "Segmentación exportada exitosamente.";
      }
    }
    return saved;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(msg, "error");
    return false;
  }
}

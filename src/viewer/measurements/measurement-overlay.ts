/**
 * measurement-overlay.ts — Canvas 2D overlay rendering for measurement tools (TK-26).
 *
 * Renders ruler (length) lines, ellipse ROIs, end/cardinal handles, and
 * clinical high-contrast information badges directly above the DICOM view.
 *
 * Adheres to Impeccable UX/UI styling:
 * - High-contrast clinical emerald (#2ee6a8) for calibrated measurements.
 * - PACS warning amber (#facc15) for uncalibrated pixel measurements.
 * - Dark semi-transparent badges (#121218 @ 82%) for readability over white/black tissues.
 * - Crisp JetBrains Mono / Inter typography.
 */

import { state } from "../state.js";
import type { DicomMetadata } from "../../dicom/dicom-parser-util.js";
import type { ViewportState } from "../../dicom/dicom-renderer.js";
import {
  calculateDistance,
  calculateEllipseArea,
  calculateEllipseHUStats,
  extractCalibration,
  worldToScreen,
} from "./measurement-math.js";
import { getAnnotationsForSlice } from "./annotation-state.js";
import type {
  Annotation,
  LengthAnnotation,
  EllipseAnnotation,
  Point2D,
} from "./types.js";
import { t } from "../../i18n/i18n.js";

export interface ActiveDrawing {
  type: "length" | "ellipse";
  start?: Point2D;
  end?: Point2D;
  center?: Point2D;
  radiusX?: number;
  radiusY?: number;
  cellId?: string | null;
}

let activeDrawing: ActiveDrawing | null = null;
let selectedAnnotationId: string | null = null;

export function getActiveDrawing(): ActiveDrawing | null {
  return activeDrawing;
}

export function setActiveDrawing(drawing: ActiveDrawing | null): void {
  activeDrawing = drawing;
}

export function getSelectedAnnotationId(): string | null {
  return selectedAnnotationId;
}

export function setSelectedAnnotationId(id: string | null): void {
  selectedAnnotationId = id;
}

// ── Color Tokens & Styling ───────────────────────────────────────────────────

export const COLORS = {
  calibrated: "#2ee6a8", // Clinical emerald
  uncalibrated: "#facc15", // PACS warning amber
  active: "#38bdf8", // Sky blue for in-progress drawing
  selected: "#ffffff",
  badgeBg: "rgba(18, 18, 24, 0.85)",
  badgeBorder: "rgba(255, 255, 255, 0.18)",
  badgeText: "#ffffff",
  badgeWarning: "#facc15",
  subText: "rgba(255, 255, 255, 0.75)",
};

export interface RenderOverlayOptions {
  canvas: HTMLCanvasElement | null;
  viewport: ViewportState;
  metadata?: DicomMetadata | null;
  pixelData?: ArrayLike<number> | null;
  sopInstanceUid?: string;
  sliceIndex?: number;
  cellId?: string | null;
}

/**
 * Draws all slice-associated annotations and any active in-progress drawing
 * on the 2D overlay canvas.
 */
export function renderMeasurementOverlay(options: RenderOverlayOptions): void {
  const { canvas, viewport, metadata, pixelData, sopInstanceUid, cellId } =
    options;
  if (!canvas || !metadata) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const cols = metadata.columns;
  const rows = metadata.rows;
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) return;

  const cal = extractCalibration(metadata);

  // 1. Render persisted annotations for this slice
  const annotations = getAnnotationsForSlice(sopInstanceUid);
  for (const ann of annotations) {
    const isSelected = ann.id === selectedAnnotationId;
    if (ann.type === "length") {
      drawLengthAnnotation(
        ctx,
        ann,
        viewport,
        cols,
        rows,
        width,
        height,
        isSelected,
      );
    } else if (ann.type === "ellipse") {
      drawEllipseAnnotation(
        ctx,
        ann,
        viewport,
        cols,
        rows,
        width,
        height,
        isSelected,
      );
    }
  }

  // 2. Render active in-progress drawing if belonging to this cell
  if (
    activeDrawing &&
    (!activeDrawing.cellId || activeDrawing.cellId === cellId)
  ) {
    drawActiveDrawing(
      ctx,
      activeDrawing,
      viewport,
      metadata,
      pixelData,
      cols,
      rows,
      width,
      height,
      cal,
    );
  }
}

// ── Annotation Drawing Helpers ───────────────────────────────────────────────

function drawLengthAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: LengthAnnotation,
  viewport: ViewportState,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
  isSelected: boolean,
): void {
  const p1 = worldToScreen(
    ann.start.x,
    ann.start.y,
    viewW,
    viewH,
    cols,
    rows,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    1,
    true,
  );
  const p2 = worldToScreen(
    ann.end.x,
    ann.end.y,
    viewW,
    viewH,
    cols,
    rows,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    1,
    true,
  );

  const color = isSelected
    ? COLORS.selected
    : ann.isCalibrated
      ? COLORS.calibrated
      : COLORS.uncalibrated;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  // Segment line
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // Endpoint handles (small circles with perpendicular ticks)
  drawHandle(ctx, p1.x, p1.y, color);
  drawHandle(ctx, p2.x, p2.y, color);

  // Measure label
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  const valueStr = ann.isCalibrated
    ? `${ann.distance.toFixed(1)} mm`
    : `${Math.round(ann.distance)} px`;

  const badgeLines = [{ text: valueStr, color: "#ffffff", bold: true }];
  if (!ann.isCalibrated) {
    badgeLines.push({
      text: t("annotations.uncalibrated") || "Sin calibración espacial",
      color: COLORS.badgeWarning,
      bold: false,
    });
  }

  drawBadge(ctx, midX, midY - 14, badgeLines);
  ctx.restore();
}

function drawEllipseAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: EllipseAnnotation,
  viewport: ViewportState,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
  isSelected: boolean,
): void {
  const center = worldToScreen(
    ann.center.x,
    ann.center.y,
    viewW,
    viewH,
    cols,
    rows,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    1,
    true,
  );
  const rxScreen = Math.abs(ann.radiusX * viewport.zoom);
  const ryScreen = Math.abs(ann.radiusY * viewport.zoom);

  const color = isSelected
    ? COLORS.selected
    : ann.isCalibrated
      ? COLORS.calibrated
      : COLORS.uncalibrated;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  // Draw ellipse outline
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, rxScreen, ryScreen, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Subtle interior tint
  ctx.fillStyle = "rgba(46, 230, 168, 0.05)";
  ctx.fill();

  // Center crosshair mark
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(center.x - 4, center.y);
  ctx.lineTo(center.x + 4, center.y);
  ctx.moveTo(center.x, center.y - 4);
  ctx.lineTo(center.x, center.y + 4);
  ctx.stroke();

  // 4 Cardinal handles
  drawHandle(ctx, center.x + rxScreen, center.y, color, 3);
  drawHandle(ctx, center.x - rxScreen, center.y, color, 3);
  drawHandle(ctx, center.x, center.y + ryScreen, color, 3);
  drawHandle(ctx, center.x, center.y - ryScreen, color, 3);

  // Badge lines
  const areaStr = ann.isCalibrated
    ? `${t("annotations.area") || "Área"}: ${ann.area.toFixed(1)} mm²`
    : `${t("annotations.area") || "Área"}: ${Math.round(ann.area)} px²`;

  const badgeLines = [{ text: areaStr, color: "#ffffff", bold: true }];

  if (typeof ann.meanHu === "number" && !isNaN(ann.meanHu)) {
    const meanLabel = t("annotations.mean") || "Media";
    const huText =
      typeof ann.stdDevHu === "number" && !isNaN(ann.stdDevHu)
        ? `${meanLabel}: ${ann.meanHu.toFixed(1)} HU (±${ann.stdDevHu.toFixed(1)})`
        : `${meanLabel}: ${ann.meanHu.toFixed(1)} HU`;
    badgeLines.push({ text: huText, color: COLORS.subText, bold: false });
  }

  if (!ann.isCalibrated) {
    badgeLines.push({
      text: t("annotations.uncalibrated") || "Sin calibración espacial",
      color: COLORS.badgeWarning,
      bold: false,
    });
  }

  drawBadge(ctx, center.x, center.y + ryScreen + 16, badgeLines);
  ctx.restore();
}

function drawActiveDrawing(
  ctx: CanvasRenderingContext2D,
  drawing: ActiveDrawing,
  viewport: ViewportState,
  metadata: DicomMetadata,
  pixelData: ArrayLike<number> | null | undefined,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
  cal: ReturnType<typeof extractCalibration>,
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.active;
  ctx.fillStyle = COLORS.active;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);

  if (drawing.type === "length" && drawing.start && drawing.end) {
    const p1 = worldToScreen(
      drawing.start.x,
      drawing.start.y,
      viewW,
      viewH,
      cols,
      rows,
      viewport.zoom,
      viewport.panX,
      viewport.panY,
      1,
      true,
    );
    const p2 = worldToScreen(
      drawing.end.x,
      drawing.end.y,
      viewW,
      viewH,
      cols,
      rows,
      viewport.zoom,
      viewport.panX,
      viewport.panY,
      1,
      true,
    );

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ctx.setLineDash([]);
    drawHandle(ctx, p1.x, p1.y, COLORS.active);
    drawHandle(ctx, p2.x, p2.y, COLORS.active);

    const dist = calculateDistance(
      drawing.start,
      drawing.end,
      cal.pixelSpacing,
    );
    const valueStr = cal.isCalibrated
      ? `${dist.toFixed(1)} mm`
      : `${Math.round(dist)} px`;

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    drawBadge(ctx, midX, midY - 14, [
      { text: valueStr, color: "#ffffff", bold: true },
    ]);
  } else if (
    drawing.type === "ellipse" &&
    drawing.center &&
    typeof drawing.radiusX === "number" &&
    typeof drawing.radiusY === "number"
  ) {
    const center = worldToScreen(
      drawing.center.x,
      drawing.center.y,
      viewW,
      viewH,
      cols,
      rows,
      viewport.zoom,
      viewport.panX,
      viewport.panY,
      1,
      true,
    );
    const rxScreen = Math.abs(drawing.radiusX * viewport.zoom);
    const ryScreen = Math.abs(drawing.radiusY * viewport.zoom);

    if (rxScreen > 0 && ryScreen > 0) {
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, rxScreen, ryScreen, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      drawHandle(ctx, center.x + rxScreen, center.y, COLORS.active, 3);
      drawHandle(ctx, center.x - rxScreen, center.y, COLORS.active, 3);
      drawHandle(ctx, center.x, center.y + ryScreen, COLORS.active, 3);
      drawHandle(ctx, center.x, center.y - ryScreen, COLORS.active, 3);

      const area = calculateEllipseArea(
        drawing.radiusX,
        drawing.radiusY,
        cal.pixelSpacing,
      );
      const areaStr = cal.isCalibrated
        ? `${t("annotations.area") || "Área"}: ${area.toFixed(1)} mm²`
        : `${t("annotations.area") || "Área"}: ${Math.round(area)} px²`;

      const lines = [{ text: areaStr, color: "#ffffff", bold: true }];

      // Realtime HU stats during drag if pixelData available
      if (pixelData && drawing.radiusX > 2 && drawing.radiusY > 2) {
        const hu = calculateEllipseHUStats(
          drawing.center,
          drawing.radiusX,
          drawing.radiusY,
          pixelData,
          cols,
          rows,
          cal.rescaleSlope,
          cal.rescaleIntercept,
        );
        if (hu) {
          lines.push({
            text: `${t("annotations.mean") || "Media"}: ${hu.mean.toFixed(1)} HU (±${hu.stdDev.toFixed(1)})`,
            color: COLORS.subText,
            bold: false,
          });
        }
      }

      drawBadge(ctx, center.x, center.y + ryScreen + 16, lines);
    }
  }

  ctx.restore();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  radius: number = 3.5,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000000";
  ctx.stroke();
  ctx.restore();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  lines: Array<{ text: string; color?: string; bold?: boolean }>,
): void {
  if (lines.length === 0) return;

  ctx.save();
  ctx.font =
    "11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = 15;
  const paddingX = 8;
  const paddingY = 5;

  let maxTextWidth = 0;
  for (const line of lines) {
    if (line.bold) {
      ctx.font =
        "bold 11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    } else {
      ctx.font =
        "11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    }
    const w = ctx.measureText(line.text).width;
    if (w > maxTextWidth) maxTextWidth = w;
  }

  const badgeWidth = maxTextWidth + paddingX * 2;
  const badgeHeight = lines.length * lineHeight + paddingY * 2;
  const x = centerX - badgeWidth / 2;
  const y = centerY - badgeHeight / 2;

  // Background Box with shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = COLORS.badgeBg;
  ctx.strokeStyle = COLORS.badgeBorder;
  ctx.lineWidth = 1;

  if (typeof (ctx as any).roundRect === "function") {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, badgeWidth, badgeHeight, 4);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x, y, badgeWidth, badgeHeight);
    ctx.strokeRect(x, y, badgeWidth, badgeHeight);
  }

  // Reset shadow for text
  ctx.shadowColor = "transparent";

  // Text Lines
  let textY = y + paddingY + lineHeight / 2;
  for (const line of lines) {
    ctx.font = line.bold
      ? "bold 11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
      : "11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = line.color || COLORS.badgeText;
    ctx.fillText(line.text, centerX, textY);
    textY += lineHeight;
  }

  ctx.restore();
}

/**
 * Checks if a pointer click in screen-space hits any annotation on the slice.
 * Returns the hit annotation or null.
 */
export function hitTestAnnotation(
  screenX: number,
  screenY: number,
  annotations: Annotation[],
  viewport: ViewportState,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.type === "length") {
      const p1 = worldToScreen(
        ann.start.x,
        ann.start.y,
        viewW,
        viewH,
        cols,
        rows,
        viewport.zoom,
        viewport.panX,
        viewport.panY,
        1,
        true,
      );
      const p2 = worldToScreen(
        ann.end.x,
        ann.end.y,
        viewW,
        viewH,
        cols,
        rows,
        viewport.zoom,
        viewport.panX,
        viewport.panY,
        1,
        true,
      );
      const dist = distToSegment(screenX, screenY, p1.x, p1.y, p2.x, p2.y);
      if (dist <= 8) return ann;
    } else if (ann.type === "ellipse") {
      const center = worldToScreen(
        ann.center.x,
        ann.center.y,
        viewW,
        viewH,
        cols,
        rows,
        viewport.zoom,
        viewport.panX,
        viewport.panY,
        1,
        true,
      );
      const rxScreen = Math.abs(ann.radiusX * viewport.zoom);
      const ryScreen = Math.abs(ann.radiusY * viewport.zoom);
      if (rxScreen > 0 && ryScreen > 0) {
        const norm =
          ((screenX - center.x) / rxScreen) ** 2 +
          ((screenY - center.y) / ryScreen) ** 2;
        if (norm <= 1.25) return ann;
      }
    }
  }
  return null;
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

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
  formatArea,
  formatLength,
  screenToWorld,
  worldToScreen,
  isPointInPolygon,
  getPolygonBoundingBox,
} from "./measurement-math.js";
import { getAnnotationsForSlice } from "./annotation-state.js";
import type {
  Annotation,
  LengthAnnotation,
  EllipseAnnotation,
  PolygonAnnotation,
  Point2D,
} from "./types.js";
import { t } from "../../i18n/i18n.js";

export interface ActiveDrawing {
  type: "length" | "ellipse" | "polygon";
  start?: Point2D;
  end?: Point2D;
  center?: Point2D;
  radiusX?: number;
  radiusY?: number;
  points?: Point2D[];
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
  // Let the measurement panel sync its pathology select to the new selection.
  // Guarded: this module is also imported under the Node test runner.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("annotation-selection-changed", { detail: { id } }),
    );
  }
}

// ── Color Tokens & Styling ───────────────────────────────────────────────────

export const COLORS = {
  calibrated: "#2ee6a8", // Clinical emerald
  uncalibrated: "#facc15", // PACS warning amber
  aiSegmentation: "#1ABC9C", // Turquoise — AI-seeded segmentation (US-45)
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
  cellId?: string | null;
  /**
   * US-45: hide the AI segmentation CANDIDATE on this viewport (the clean
   * "original" panel of the comparison view). Only unaccepted AI polygons are
   * suppressed — once transferred (`accepted`) they show here like any mark.
   */
  suppressAiCandidate?: boolean;
}

/**
 * Draws all slice-associated annotations and any active in-progress drawing
 * on the 2D overlay canvas.
 */
export function renderMeasurementOverlay(options: RenderOverlayOptions): void {
  const {
    canvas,
    viewport,
    metadata,
    pixelData,
    sopInstanceUid,
    cellId,
    suppressAiCandidate,
  } = options;
  if (!canvas || !metadata) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (state.areAnnotationsVisible === false) {
    return;
  }

  const cols = metadata.columns;
  const rows = metadata.rows;
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) return;

  const cal = extractCalibration(metadata);

  // 1. Render persisted annotations for this slice
  const annotations = getAnnotationsForSlice(sopInstanceUid);
  for (const ann of annotations) {
    // A discarded (soft-hidden) candidate renders nowhere until restored.
    if (ann.type === "polygon" && ann.hidden) continue;
    // On the clean "original" panel, skip the AI candidate until it's accepted.
    if (
      suppressAiCandidate &&
      ann.type === "polygon" &&
      ann.origin === "ai" &&
      !ann.accepted
    ) {
      continue;
    }
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
    } else if (ann.type === "polygon") {
      drawPolygonAnnotation(
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
  // Object overload throughout so measurements honour viewport.flipX/flipY
  // (canonical flip renders identically; only genuinely-flipped viewports differ
  // — and there this is the correct, non-mirrored placement).
  const p1 = worldToScreen(ann.start, viewport, viewW, viewH, cols, rows);
  const p2 = worldToScreen(ann.end, viewport, viewW, viewH, cols, rows);

  const color = isSelected
    ? COLORS.selected
    : ann.isCalibrated
      ? COLORS.calibrated
      : COLORS.uncalibrated;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = state.measurementLineWidth || 2;
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

  const valueStr = formatLength(
    ann.distance,
    ann.isCalibrated,
    state.measurementUnit,
  );

  const badgeLines = [{ text: valueStr, color: "#ffffff", bold: true }];
  if (!ann.isCalibrated) {
    badgeLines.push({
      text: t("annotations.uncalibrated") || "Sin calibración espacial",
      color: COLORS.badgeWarning,
      bold: false,
    });
  }

  if (state.areLabelsVisible !== false)
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
  // Object overload so the ellipse honours viewport.flipX/flipY (canonical flip
  // renders identically; only genuinely-flipped viewports differ, correctly).
  const center = worldToScreen(ann.center, viewport, viewW, viewH, cols, rows);
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
  ctx.lineWidth = state.measurementLineWidth || 2;

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
  const formattedArea = formatArea(
    ann.area,
    ann.isCalibrated,
    state.measurementUnit,
  );
  const areaStr = `${t("annotations.area") || "Área"}: ${formattedArea}`;

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

  if (state.areLabelsVisible !== false) {
    drawBadge(ctx, center.x, center.y + ryScreen + 16, badgeLines);
  }
  ctx.restore();
}

function drawPolygonAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: PolygonAnnotation,
  viewport: ViewportState,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
  isSelected: boolean,
): void {
  if (!ann.points || ann.points.length === 0) return;

  // Use the viewport-object overload so handles/bbox honour viewport.flipX/flipY
  // exactly like the polygon path below. The explicit overload hard-coded
  // flipX=false/flipY=true, so on a flipped viewport (e.g. the left panel of the
  // comparison) the handles rendered mirrored relative to the filled contour.
  const screenPts = ann.points.map((p) =>
    worldToScreen(p, viewport, viewW, viewH, cols, rows),
  );

  // US-45: an AI-seeded polygon ALWAYS keeps its turquoise colour — even while
  // selected/being edited — so it stays visible over bright CT tissue (the white
  // "selected" style made it look like it disappeared on Corregir). Manual
  // polygons are unchanged: a polygon with no `origin` renders exactly as before.
  const color =
    ann.origin === "ai"
      ? COLORS.aiSegmentation
      : isSelected
        ? COLORS.selected
        : ann.isCalibrated
          ? COLORS.calibrated
          : COLORS.uncalibrated;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = state.measurementLineWidth || 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Draw polygon perimeter path
  ctx.beginPath();
  const firstPt = worldToScreen(
    ann.points[0],
    viewport,
    viewW,
    viewH,
    cols,
    rows,
  );
  ctx.moveTo(firstPt.x, firstPt.y);
  for (let i = 1; i < ann.points.length; i++) {
    const pt = worldToScreen(ann.points[i], viewport, viewW, viewH, cols, rows);
    ctx.lineTo(pt.x, pt.y);
  }
  if (ann.isClosed && screenPts.length >= 3) {
    ctx.closePath();
  }
  ctx.stroke();

  // Semitransparent fill if closed
  if (ann.isClosed && screenPts.length >= 3) {
    ctx.fillStyle =
      ann.origin === "ai"
        ? "rgba(26, 188, 156, 0.20)"
        : isSelected
          ? "rgba(255, 255, 255, 0.15)"
          : ann.isCalibrated
            ? "rgba(46, 230, 168, 0.20)"
            : "rgba(250, 204, 21, 0.18)";
    ctx.fill();
  }

  // Draw handles (circles) on vertices only when selected AND editable. A locked
  // polygon (the AI candidate before "Corregir") shows just its contour — no
  // handles — so it reads as a read-only proposal. AI polygons keep a turquoise
  // body, so their handles are white for contrast while dragging.
  if (isSelected && !ann.locked) {
    const handleColor = ann.origin === "ai" ? "#ffffff" : color;
    for (const pt of screenPts) {
      drawHandle(ctx, pt.x, pt.y, handleColor, 4);
    }
  }

  // Badge with Area and Perimeter anchored below lowest vertex (highest Y in screen-space)
  if (ann.isClosed && screenPts.length >= 3) {
    const bbox = getPolygonBoundingBox(screenPts);
    const badgeX = (bbox.minX + bbox.maxX) / 2;
    const badgeY = bbox.maxY + 15;

    const areaStr = formatArea(
      ann.area,
      ann.isCalibrated,
      state.measurementUnit,
    );
    const perimeterStr = formatLength(
      ann.perimeter,
      ann.isCalibrated,
      state.measurementUnit,
    );

    const badgeLines: Array<{ text: string; color?: string; bold?: boolean }> =
      [];

    // US-45: tag the AI-seeded polygon so it's told apart from manual ones, and
    // show its chosen pathology type (from the upload catalog) when set.
    if (ann.origin === "ai") {
      const tag = t("viewer.segmentation.tagAi") || "IA";
      const label = ann.pathologyKey
        ? `${tag} · ${t(`classification.${ann.pathologyKey}`)}`
        : tag;
      badgeLines.push({
        text: label,
        color: COLORS.aiSegmentation,
        bold: true,
      });
    } else if (ann.pathologyKey) {
      // Manual polygon tagged with a pathology (US-45): show it on its badge.
      badgeLines.push({
        text: t(`classification.${ann.pathologyKey}`),
        color: COLORS.calibrated,
        bold: true,
      });
    }

    badgeLines.push(
      {
        text: `${t("annotations.area") || "Área"}: ${areaStr}`,
        color: "#ffffff",
        bold: true,
      },
      {
        text: `${t("annotations.perimeter") || "Perímetro"}: ${perimeterStr}`,
        color: COLORS.subText,
        bold: false,
      },
    );

    if (!ann.isCalibrated) {
      badgeLines.push({
        text: t("annotations.uncalibrated") || "Sin calibración espacial",
        color: COLORS.badgeWarning,
        bold: false,
      });
    }

    if (state.areLabelsVisible !== false) {
      drawBadge(ctx, badgeX, badgeY, badgeLines);
    }
  }

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
  ctx.lineWidth = state.measurementLineWidth || 2;
  ctx.setLineDash([4, 4]);

  if (drawing.type === "length" && drawing.start && drawing.end) {
    // Object overload so the in-progress preview honours viewport.flipX/flipY,
    // matching the click→world mapping and the finalized render — otherwise the
    // preview appears mirrored on a flipped viewport.
    const p1 = worldToScreen(drawing.start, viewport, viewW, viewH, cols, rows);
    const p2 = worldToScreen(drawing.end, viewport, viewW, viewH, cols, rows);

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
    const valueStr = formatLength(
      dist,
      cal.isCalibrated,
      state.measurementUnit,
    );

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
      drawing.center,
      viewport,
      viewW,
      viewH,
      cols,
      rows,
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
      const formattedArea = formatArea(
        area,
        cal.isCalibrated,
        state.measurementUnit,
      );
      const areaStr = `${t("annotations.area") || "Área"}: ${formattedArea}`;

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
  } else if (
    drawing.type === "polygon" &&
    drawing.points &&
    drawing.points.length > 0
  ) {
    // Object overload so the in-progress preview honours viewport.flipX/flipY,
    // matching the click→world mapping and the finalized render — otherwise the
    // polygon appears mirrored while drawing on a flipped viewport.
    const screenPts = drawing.points.map((p) =>
      worldToScreen(p, viewport, viewW, viewH, cols, rows),
    );

    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }

    if (drawing.end) {
      const endScreen = worldToScreen(
        drawing.end,
        viewport,
        viewW,
        viewH,
        cols,
        rows,
      );
      ctx.lineTo(endScreen.x, endScreen.y);
    }
    ctx.stroke();

    ctx.setLineDash([]);
    for (const pt of screenPts) {
      drawHandle(ctx, pt.x, pt.y, COLORS.active, 4);
    }

    // Highlight starting node when cursor is close enough to close (<= 10px)
    if (drawing.end && screenPts.length >= 3) {
      const endScreen = worldToScreen(
        drawing.end,
        viewport,
        viewW,
        viewH,
        cols,
        rows,
      );
      const distToStart = Math.hypot(
        endScreen.x - screenPts[0].x,
        endScreen.y - screenPts[0].y,
      );
      if (distToStart <= 10) {
        ctx.beginPath();
        ctx.arc(screenPts[0].x, screenPts[0].y, 7, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.calibrated;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
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
      const p1 = worldToScreen(ann.start, viewport, viewW, viewH, cols, rows);
      const p2 = worldToScreen(ann.end, viewport, viewW, viewH, cols, rows);
      const dist = distToSegment(screenX, screenY, p1.x, p1.y, p2.x, p2.y);
      if (dist <= 8) return ann;
    } else if (ann.type === "ellipse") {
      const center = worldToScreen(
        ann.center,
        viewport,
        viewW,
        viewH,
        cols,
        rows,
      );
      const rxScreen = Math.abs(ann.radiusX * viewport.zoom);
      const ryScreen = Math.abs(ann.radiusY * viewport.zoom);
      if (rxScreen > 0 && ryScreen > 0) {
        const norm =
          ((screenX - center.x) / rxScreen) ** 2 +
          ((screenY - center.y) / ryScreen) ** 2;
        if (norm <= 1.25) return ann;
      }
    } else if (ann.type === "polygon") {
      // A locked polygon (AI candidate before "Corregir") isn't hit-testable:
      // it can't be selected, moved or vertex-edited — only its contour shows.
      // A hidden (discarded) one isn't hit-testable either.
      if (ann.locked || ann.hidden) continue;
      if (ann.points && ann.points.length >= 2) {
        const screenPts = ann.points.map((p) =>
          worldToScreen(p, viewport, viewW, viewH, cols, rows),
        );

        // 1. Proximity to any edge
        const segmentCount = ann.isClosed
          ? screenPts.length
          : screenPts.length - 1;
        let hit = false;
        for (let j = 0; j < segmentCount; j++) {
          const p1 = screenPts[j];
          const p2 = screenPts[(j + 1) % screenPts.length];
          if (distToSegment(screenX, screenY, p1.x, p1.y, p2.x, p2.y) <= 8) {
            hit = true;
            break;
          }
        }
        if (hit) return ann;

        // 2. Interior check if closed
        if (ann.isClosed && screenPts.length >= 3) {
          const worldPt = screenToWorld(
            screenX,
            screenY,
            viewW,
            viewH,
            cols,
            rows,
            viewport,
          );
          if (isPointInPolygon(worldPt, ann.points)) {
            return ann;
          }
        }
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

export interface VertexHit {
  annotationId: string;
  vertexIndex: number;
}

/**
 * Checks if a pointer click in screen-space hits a polygon vertex (handle).
 * Prioritizes the currently selected annotation if it's a polygon, then checks all polygons.
 * Returns { annotationId, vertexIndex } if hit (within radius px), or null.
 */
export function hitTestPolygonVertex(
  screenX: number,
  screenY: number,
  annotations: Annotation[],
  selectedId: string | null,
  viewport: ViewportState,
  cols: number,
  rows: number,
  viewW: number,
  viewH: number,
  radius: number = 8,
): VertexHit | null {
  if (selectedId) {
    const selectedAnn = annotations.find((a) => a.id === selectedId);
    if (
      selectedAnn &&
      selectedAnn.type === "polygon" &&
      selectedAnn.points &&
      !selectedAnn.locked
    ) {
      for (let i = 0; i < selectedAnn.points.length; i++) {
        const pt = selectedAnn.points[i];
        // Object overload so hit-testing honours viewport.flipX/flipY exactly
        // like the rendered handles — otherwise dragging misses on a flipped
        // viewport (the handle is drawn mirrored from where the test looks).
        const s = worldToScreen(pt, viewport, viewW, viewH, cols, rows);
        if (Math.hypot(screenX - s.x, screenY - s.y) <= radius) {
          return { annotationId: selectedAnn.id, vertexIndex: i };
        }
      }
    }
  }

  for (let a = annotations.length - 1; a >= 0; a--) {
    const ann = annotations[a];
    if (ann.id === selectedId) continue;
    if (ann.type === "polygon" && ann.points && !ann.locked && !ann.hidden) {
      for (let i = 0; i < ann.points.length; i++) {
        const pt = ann.points[i];
        const s = worldToScreen(pt, viewport, viewW, viewH, cols, rows);
        if (Math.hypot(screenX - s.x, screenY - s.y) <= radius) {
          return { annotationId: ann.id, vertexIndex: i };
        }
      }
    }
  }

  return null;
}

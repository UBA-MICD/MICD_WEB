// ── Segmentación con IA — dibujado del overlay ───────────────────────────────
//
// Dibuja el contorno (y el relleno opcional) sobre el canvas de anotaciones del
// viewport, encima del DICOM ya renderizado. Se apoya en el mismo
// `worldToScreen` que las mediciones, así que la segmentación sigue el zoom y
// el paneo del visor sin trabajo extra.

import type { DicomMetadata } from "../../dicom/dicom-parser-util.js";
import type { ViewportState } from "../../dicom/dicom-renderer.js";
import { worldToScreen } from "../measurements/measurement-math.js";
import type { Point2D, SegmentationMask } from "./segmentation-api.js";

/** Capa de segmentación adjunta a un viewport. */
export interface SegmentationLayer {
  /** Contorno cerrado en coordenadas de píxel de la imagen. */
  contorno: Point2D[];
  mascara: SegmentationMask;
  /** Conmutable desde la herramienta de superposición. */
  visible: boolean;
  seed: number;
  simulado: boolean;
}

// Turquesa clínico. El verde esmeralda (#2ee6a8) ya identifica las mediciones
// calibradas, así que la segmentación usa un tono propio para que ambas capas
// se distingan cuando conviven en el mismo viewport.
export const SEGMENTATION_COLORS = {
  stroke: "#1ABC9C",
  fill: "rgba(26, 188, 156, 0.22)", // 22 % de opacidad
};

export const SEGMENTATION_LINE_WIDTH = 2; // px de pantalla

export interface RenderSegmentationOptions {
  canvas: HTMLCanvasElement | null;
  viewport: ViewportState;
  metadata?: DicomMetadata | null;
  layer?: SegmentationLayer | null;
  /** false para dibujar sólo el borde. */
  fill?: boolean;
}

/**
 * Dibuja la segmentación sobre el canvas de overlay.
 *
 * NO limpia el canvas: se llama después de `renderMeasurementOverlay`, que ya
 * lo limpió, para que mediciones y segmentación coexistan.
 */
export function renderSegmentationOverlay(
  options: RenderSegmentationOptions,
): void {
  const { canvas, viewport, metadata, layer } = options;
  if (!canvas || !metadata || !layer || !layer.visible) return;
  if (layer.contorno.length < 3) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const cols = metadata.columns;
  const rows = metadata.rows;
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) return;

  const path = new Path2D();
  for (let i = 0; i < layer.contorno.length; i++) {
    const p = layer.contorno[i];
    const s = worldToScreen(p.x, p.y, width, height, cols, rows, viewport);
    if (i === 0) path.moveTo(s.x, s.y);
    else path.lineTo(s.x, s.y);
  }
  path.closePath();

  ctx.save();
  if (options.fill !== false) {
    ctx.fillStyle = SEGMENTATION_COLORS.fill;
    ctx.fill(path);
  }
  ctx.strokeStyle = SEGMENTATION_COLORS.stroke;
  ctx.lineWidth = SEGMENTATION_LINE_WIDTH;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);
  ctx.restore();
}

/**
 * Área de la segmentación en mm², o null si la imagen no está calibrada
 * (sin PixelSpacing no hay forma honesta de convertir píxeles a milímetros).
 */
export function segmentationAreaMm2(
  layer: SegmentationLayer,
  metadata: DicomMetadata,
): number | null {
  const spacing = metadata.pixelSpacing;
  if (!spacing || spacing.length < 2) return null;
  return layer.mascara.pixelCount * spacing[0] * spacing[1];
}

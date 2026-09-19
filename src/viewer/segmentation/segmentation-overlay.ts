// ── Segmentación con IA — dibujado sobre la imagen ───────────────────────────
//
// El contorno se dibuja DENTRO del canvas del DICOM, en coordenadas de píxel de
// la imagen, igual que la capa de superposición (ver `renderDicom`).
//
// Es deliberado y es lo que hace que la segmentación acompañe al zoom y al
// paneo: ese canvas se mueve por CSS transform (`translate/scale/scaleY(-1)`),
// que aplica por igual a los píxeles y a lo que dibujemos encima. La alternativa
// —dibujar en el canvas de anotaciones, en coordenadas de pantalla— obliga a
// recalcular en cada gesto, y `applyPanDelta`/`applyZoomFactor` sólo tocan el
// transform sin redibujar: la imagen se movía y el contorno se quedaba fijo.

import type { DicomMetadata } from "../../dicom/dicom-parser-util.js";
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

/** Grosor del borde en píxeles de pantalla (se compensa por el zoom). */
export const SEGMENTATION_LINE_WIDTH = 2;

export interface RenderSegmentationOptions {
  /** El canvas de la imagen (Columns x Rows), no el de anotaciones. */
  canvas: HTMLCanvasElement | null;
  metadata?: DicomMetadata | null;
  layer?: SegmentationLayer | null;
  /** Zoom actual del viewport, para que el borde no engorde al ampliar. */
  zoom?: number;
  /** false para dibujar sólo el borde. */
  fill?: boolean;
}

/**
 * Dibuja la segmentación sobre el canvas de la imagen.
 *
 * Se llama justo después de `renderDicom`, que repinta el canvas entero con
 * `putImageData` — por eso el contorno se redibuja en cada render en vez de
 * quedar persistido.
 */
export function renderSegmentationOverlay(
  options: RenderSegmentationOptions,
): void {
  const { canvas, metadata, layer } = options;
  if (!canvas || !metadata || !layer || !layer.visible) return;
  if (layer.contorno.length < 3) return;
  if (metadata.columns <= 0 || metadata.rows <= 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(layer.contorno[0].x, layer.contorno[0].y);
  for (let i = 1; i < layer.contorno.length; i++) {
    ctx.lineTo(layer.contorno[i].x, layer.contorno[i].y);
  }
  ctx.closePath();

  if (options.fill !== false) {
    ctx.fillStyle = SEGMENTATION_COLORS.fill;
    ctx.fill();
  }

  // El canvas está en píxeles de imagen y la pantalla lo escala por `zoom`:
  // dividir mantiene el borde en ~2 px reales en cualquier ampliación.
  const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
  ctx.strokeStyle = SEGMENTATION_COLORS.stroke;
  ctx.lineWidth = SEGMENTATION_LINE_WIDTH / zoom;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
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

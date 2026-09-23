/**
 * dicom-renderer.ts — Canvas-based DICOM image rendering engine.
 * Handles Window/Level (brightness/contrast), zoom, pan, and
 * different photometric interpretations.
 */

import type { DicomMetadata } from "./dicom-parser-util.js";
import { getCanonicalFlip } from "./spatial-math.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ViewportState {
  windowCenter: number;
  windowWidth: number;
  zoom: number;
  panX: number;
  panY: number;
  layerOpacity?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface RenderParams {
  canvas: HTMLCanvasElement;
  pixelData: Int16Array | Uint16Array | Uint8Array;
  metadata: DicomMetadata;
  viewport: ViewportState;
  overlayPixelData?: Int16Array | Uint16Array | Uint8Array | null;
  overlayMetadata?: DicomMetadata | null;
  overlayViewport?: ViewportState | null;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export function renderDicom(params: RenderParams): void {
  const { canvas, pixelData, metadata, viewport } = params;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    rows,
    columns,
    photometricInterpretation,
    samplesPerPixel,
    rescaleSlope,
    rescaleIntercept,
  } = metadata;
  const { windowCenter, windowWidth, zoom, panX, panY } = viewport;

  if (rows === 0 || columns === 0) return;

  // Ensure canvas matches image dimensions
  if (canvas.width !== columns || canvas.height !== rows) {
    canvas.width = columns;
    canvas.height = rows;
  }

  const imageData = ctx.createImageData(columns, rows);
  const output = imageData.data;

  const isMonochrome1 = photometricInterpretation === "MONOCHROME1";
  const isRgb = photometricInterpretation === "RGB" && samplesPerPixel === 3;

  const flipX = viewport.flipX ?? false;
  const flipY = viewport.flipY ?? false;

  if (isRgb) {
    renderRgb(pixelData, output, columns, rows, flipX, flipY);
  } else {
    renderMonochrome(
      pixelData,
      output,
      columns,
      rows,
      windowCenter,
      windowWidth,
      rescaleSlope,
      rescaleIntercept,
      isMonochrome1,
      flipX,
      flipY,
    );
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Render base image
  ctx.putImageData(imageData, 0, 0);

  // Render secondary overlay layer if present
  if (params.overlayPixelData && params.overlayMetadata) {
    const ovMeta = params.overlayMetadata;
    const ovCanvas = document.createElement("canvas");
    ovCanvas.width = ovMeta.columns;
    ovCanvas.height = ovMeta.rows;
    const ovCtx = ovCanvas.getContext("2d");
    if (ovCtx) {
      const ovImageData = ovCtx.createImageData(ovMeta.columns, ovMeta.rows);
      const isOvMonochrome1 =
        ovMeta.photometricInterpretation === "MONOCHROME1";
      const isOvRgb =
        ovMeta.photometricInterpretation === "RGB" &&
        ovMeta.samplesPerPixel === 3;
      const ovFlipX = params.overlayViewport?.flipX ?? flipX;
      const ovFlipY = params.overlayViewport?.flipY ?? flipY;

      if (isOvRgb) {
        renderRgb(
          params.overlayPixelData,
          ovImageData.data,
          ovMeta.columns,
          ovMeta.rows,
          ovFlipX,
          ovFlipY,
        );
      } else {
        renderMonochrome(
          params.overlayPixelData,
          ovImageData.data,
          ovMeta.columns,
          ovMeta.rows,
          params.overlayViewport?.windowCenter ?? windowCenter,
          params.overlayViewport?.windowWidth ?? windowWidth,
          ovMeta.rescaleSlope,
          ovMeta.rescaleIntercept,
          isOvMonochrome1,
          ovFlipX,
          ovFlipY,
        );
      }
      ovCtx.putImageData(ovImageData, 0, 0);

      ctx.save();
      ctx.globalAlpha =
        typeof viewport.layerOpacity === "number" ? viewport.layerOpacity : 0.5;
      ctx.drawImage(ovCanvas, 0, 0, columns, rows);
      ctx.restore();
    }
  }
}

// ── Monochrome Rendering ─────────────────────────────────────────────────────

function renderMonochrome(
  pixelData: Int16Array | Uint16Array | Uint8Array,
  output: Uint8ClampedArray,
  columns: number,
  rows: number,
  windowCenter: number,
  windowWidth: number,
  rescaleSlope: number,
  rescaleIntercept: number,
  invert: boolean,
  flipX: boolean = false,
  flipY: boolean = false,
): void {
  const halfWindow = windowWidth / 2;
  const minValue = windowCenter - halfWindow;
  const range = windowWidth || 1;

  for (let r = 0; r < rows; r++) {
    const dstR = flipY ? rows - 1 - r : r;
    const srcRowOffset = r * columns;
    const dstRowOffset = dstR * columns;

    for (let c = 0; c < columns; c++) {
      const dstC = flipX ? columns - 1 - c : c;
      const rawValue = pixelData[srcRowOffset + c];
      const modalityValue = rawValue * rescaleSlope + rescaleIntercept;

      // Apply VOI LUT (window/level)
      let intensity: number;
      if (modalityValue <= minValue) {
        intensity = 0;
      } else if (modalityValue >= minValue + range) {
        intensity = 255;
      } else {
        intensity = ((modalityValue - minValue) / range) * 255;
      }

      // Invert for MONOCHROME1
      if (invert) {
        intensity = 255 - intensity;
      }

      const dstIdx = (dstRowOffset + dstC) * 4;
      output[dstIdx] = intensity; // R
      output[dstIdx + 1] = intensity; // G
      output[dstIdx + 2] = intensity; // B
      output[dstIdx + 3] = 255; // A
    }
  }
}

// ── RGB Rendering ────────────────────────────────────────────────────────────

function renderRgb(
  pixelData: Int16Array | Uint16Array | Uint8Array,
  output: Uint8ClampedArray,
  columns: number,
  rows: number,
  flipX: boolean = false,
  flipY: boolean = false,
): void {
  for (let r = 0; r < rows; r++) {
    const dstR = flipY ? rows - 1 - r : r;
    const srcRowOffset = r * columns;
    const dstRowOffset = dstR * columns;

    for (let c = 0; c < columns; c++) {
      const dstC = flipX ? columns - 1 - c : c;
      const srcIdx = (srcRowOffset + c) * 3;
      const dstIdx = (dstRowOffset + dstC) * 4;
      output[dstIdx] = pixelData[srcIdx]; // R
      output[dstIdx + 1] = pixelData[srcIdx + 1]; // G
      output[dstIdx + 2] = pixelData[srcIdx + 2]; // B
      output[dstIdx + 3] = 255; // A
    }
  }
}

// ── Viewport Helpers ─────────────────────────────────────────────────────────

export function createDefaultViewport(metadata: DicomMetadata): ViewportState {
  const { flipX, flipY } = getCanonicalFlip(metadata.imageOrientationPatient);
  const vp: ViewportState = {
    windowCenter: metadata.windowCenter,
    windowWidth: metadata.windowWidth,
    zoom: 1.0,
    panX: 0,
    panY: 0,
  };
  if (flipX) vp.flipX = true;
  if (flipY) vp.flipY = true;
  return vp;
}

export function applyCanvasTransform(
  containerCanvas: HTMLCanvasElement,
  imageCanvas: HTMLCanvasElement,
  viewport: ViewportState,
): void {
  const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
  imageCanvas.style.transform = transform;
}

export function resetViewport(metadata: DicomMetadata): ViewportState {
  return createDefaultViewport(metadata);
}

export function fitToContainer(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): number {
  if (imageWidth === 0 || imageHeight === 0) return 1;
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  return Math.min(scaleX, scaleY) * 0.9;
}

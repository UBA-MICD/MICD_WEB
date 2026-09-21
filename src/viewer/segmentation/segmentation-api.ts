// ── Segmentación con IA — cliente HTTP (mock SAM3) ───────────────────────────
//
// Módulo sin DOM: sólo fetch y transformación de datos, por lo que corre bajo
// el runner de Node sin jsdom (mismo criterio que prediction-api.ts).
//
// La geometría vive en el backend (`POST /api/v1/ml/segmentation`). Este
// módulo sólo la pide y decodifica la máscara RLE.

import { authFetch, API_BASE } from "../../auth/auth.js";
import { t } from "../../i18n/i18n.js";

export interface Point2D {
  x: number;
  y: number;
}

export interface SegmentationMask {
  width: number;
  height: number;
  /** 1 = dentro de la lesión, 0 = fuera. Longitud = width * height. */
  data: Uint8Array;
  pixelCount: number;
}

/** Respuesta cruda del endpoint, antes de decodificar la máscara. */
export interface SegmentationApiResponse {
  seed: number;
  model: string;
  simulated: boolean;
  contour: Point2D[];
  mask: { width: number; height: number; rle: number[]; pixelCount: number };
  derived: {
    sopInstanceUid: string;
    seriesInstanceUid: string;
    seriesDescription: string;
    referencedSopInstanceUid: string | null;
    referencedSopClassUid: string | null;
    derivationDescription: string;
  };
  inferenceMs: number;
}

export interface SegmentationRequest {
  columns: number;
  rows: number;
  /** Opcional: misma semilla ⇒ misma forma. Sin semilla, forma nueva. */
  seed?: number;
  sopInstanceUid?: string;
  sopClassUid?: string;
  studyInstanceUid?: string;
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: string };

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // cuerpo no-JSON: caer al mensaje genérico
  }
  return t("viewer.segmentation.failed");
}

/**
 * Decodifica la máscara RLE del backend: longitudes de tramo alternadas,
 * row-major, empezando por un tramo de ceros (que puede ser de longitud 0).
 */
export function decodeMaskRle(
  rle: number[],
  width: number,
  height: number,
): Uint8Array {
  const data = new Uint8Array(Math.max(0, width * height));
  let index = 0;
  let value = 0;
  for (const run of rle) {
    if (run > 0) {
      if (value === 1) data.fill(1, index, Math.min(index + run, data.length));
      index += run;
    }
    value = value ? 0 : 1;
    if (index >= data.length) break;
  }
  return data;
}

/** Pide una segmentación para una imagen. */
export async function requestSegmentation(
  body: SegmentationRequest,
): Promise<ApiResult<SegmentationApiResponse>> {
  let res: Response;
  try {
    res = await authFetch(`${API_BASE}/v1/ml/segmentation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: t("viewer.segmentation.failed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

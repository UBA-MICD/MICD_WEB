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
  /**
   * Id del candidato persistido (US-45), o null si no se persistió (imagen
   * abierta de disco local sin UID de origen). Necesario para corregirlo.
   */
  segmentationId: number | null;
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

/**
 * Inversa de {@link decodeMaskRle}: codifica una máscara binaria row-major como
 * longitudes de tramo alternadas empezando por un tramo de ceros (mismo formato
 * que produce y consume el backend). Un `decodeMaskRle(encodeMaskRle(m)) === m`.
 */
export function encodeMaskRle(mask: Uint8Array | number[]): number[] {
  const rle: number[] = [];
  let expected = 0; // el primer tramo es de ceros (puede ser de longitud 0)
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === expected) {
      run++;
    } else {
      rle.push(run);
      expected = expected ? 0 : 1;
      run = 1;
    }
  }
  rle.push(run);
  return rle;
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

// ── Correcciones (US-45) ─────────────────────────────────────────────────────

/** Cuerpo de una corrección: la máscara editada por la persona, en RLE. */
export interface CorrectionRequest {
  correctedRle: number[];
  /** [height, width] del espacio de la máscara. */
  maskShape: [number, number];
  /** Resumen estructurado de la edición (movió/agregó/quitó). Opcional. */
  editSummary?: Record<string, unknown>;
}

export interface CorrectionResponse {
  correctionId: number;
  segmentationId: number;
  correctedBy: string;
  correctedAt: string;
  editSummary: Record<string, unknown> | null;
}

export interface SegmentationHistory {
  segmentation: {
    segmentationId: number;
    status: string;
    model: string | null;
    maskRle: number[] | null;
    maskShape: [number, number] | null;
    createdBy: string;
    createdAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
  };
  corrections: CorrectionResponse[];
}

async function postJson<T>(
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await authFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, status: 0, error: t("viewer.segmentation.failed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

/** Guarda una corrección humana sobre el candidato `segmentationId`. */
export async function saveCorrection(
  segmentationId: number,
  body: CorrectionRequest,
): Promise<ApiResult<CorrectionResponse>> {
  return postJson<CorrectionResponse>(
    `/v1/ml/segmentation/${segmentationId}/corrections`,
    body,
  );
}

/** Aprueba el candidato tal cual (sin ediciones). */
export async function acceptSegmentation(
  segmentationId: number,
): Promise<ApiResult<SegmentationHistory>> {
  return postJson<SegmentationHistory>(
    `/v1/ml/segmentation/${segmentationId}/accept`,
  );
}

/** Descarta la segmentación entera. */
export async function discardSegmentation(
  segmentationId: number,
): Promise<ApiResult<SegmentationHistory>> {
  return postJson<SegmentationHistory>(
    `/v1/ml/segmentation/${segmentationId}/discard`,
  );
}

/** Segmentación actual de una imagen (original + última corrección), o null. */
export interface InstanceSegmentation {
  segmentationId: number;
  status: string;
  maskRle: number[] | null;
  maskShape: [number, number] | null;
  correctedRle: number[] | null;
  correctedMaskShape: [number, number] | null;
  correctedBy: string | null;
  correctedAt: string | null;
}

/**
 * Trae la segmentación persistida para (estudio, instancia) — para redibujar el
 * polígono al abrir/scrollear/recargar (bug 3). `data` es null si no hay ninguna.
 */
export async function getSegmentationForInstance(
  studyId: string,
  instanceId: string,
): Promise<ApiResult<InstanceSegmentation | null>> {
  const qs = `studyId=${encodeURIComponent(studyId)}&instanceId=${encodeURIComponent(instanceId)}`;
  let res: Response;
  try {
    res = await authFetch(`${API_BASE}/v1/ml/segmentation?${qs}`);
  } catch {
    return { ok: false, status: 0, error: t("viewer.segmentation.failed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

/** Candidato + cadena completa de correcciones (más nueva primero). */
export async function getSegmentationHistory(
  segmentationId: number,
): Promise<ApiResult<SegmentationHistory>> {
  let res: Response;
  try {
    res = await authFetch(
      `${API_BASE}/v1/ml/segmentation/${segmentationId}/corrections`,
    );
  } catch {
    return { ok: false, status: 0, error: t("viewer.segmentation.failed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

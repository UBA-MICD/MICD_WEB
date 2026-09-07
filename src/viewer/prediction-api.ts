// ── ML Prediction API (US-ML) ─────────────────────────────────────────────────
//
// DOM-free module — API calls for fetching and triggering ML predictions.
// Mirrors the pattern in validation-api.ts for testability under Node's bare
// test runner without jsdom.

import { authFetch, API_BASE } from "../auth/auth.js";
import { t } from "../i18n/i18n.js";

export interface MLPredictionRecord {
  predictionId: number;
  studyId: string;
  label: string;
  confidence: number;
  analyzedBy: string;
  analyzedAt: string;
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: string };

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // fall through to generic
  }
  return t("validation.analysisFailed");
}

/** Return the most recent ML prediction for a study, or null if none exists. */
export async function fetchPrediction(
  studyId: string,
): Promise<ApiResult<MLPredictionRecord | null>> {
  let res: Response;
  try {
    res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/ml/prediction`,
    );
  } catch {
    return { ok: false, status: 0, error: t("validation.analysisFailed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

/** Trigger ML analysis for a study (admin only). */
export async function triggerAnalysis(
  studyId: string,
): Promise<ApiResult<MLPredictionRecord>> {
  let res: Response;
  try {
    res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/ml/analyze`,
      { method: "POST" },
    );
  } catch {
    return { ok: false, status: 0, error: t("validation.analysisFailed") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

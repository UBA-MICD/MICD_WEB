// ── Validation API (US-26) ────────────────────────────────────────────────────
//
// DOM-free module — all API calls for registering diagnostic validations.
// Mirrors the pattern in src/admin/users-admin.ts so it can be unit-tested
// under Node's bare test runner without jsdom.

import { authFetch, API_BASE } from "../auth/auth.js";
import { t } from "../i18n/i18n.js";

export type ValidationAction = "approved" | "rejected" | "review";

export interface ValidationRecord {
  validationId: number;
  status: string;
  validatedBy: string;
  validatedAt: string;
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
  return t("validation.toast.error");
}

async function postValidation(
  url: string,
  action: ValidationAction,
  comment?: string,
): Promise<ApiResult<ValidationRecord>> {
  let res: Response;
  try {
    res = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(comment ? { comment } : {}) }),
    });
  } catch {
    return { ok: false, status: 0, error: t("validation.toast.error") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await res.json() };
}

/** Register a validation action (approve / reject / flag for review). */
export function submitValidation(
  studyId: string,
  action: ValidationAction,
  comment?: string,
): Promise<ApiResult<ValidationRecord>> {
  return postValidation(
    `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/validate`,
    action,
    comment,
  );
}

/** Register a correction over a prior validation (admin only). */
export function submitCorrection(
  studyId: string,
  action: ValidationAction,
  comment?: string,
): Promise<ApiResult<ValidationRecord>> {
  return postValidation(
    `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/validation-correction`,
    action,
    comment,
  );
}

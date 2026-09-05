import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { submitValidation, submitCorrection } from "./validation-api.ts";
import { API_BASE } from "../auth/auth.ts";

const STUDY_ID = "1.2.3.4.5";
const VALIDATE_URL = `${API_BASE}/v1/studies/${encodeURIComponent(STUDY_ID)}/validate`;
const CORRECTION_URL = `${API_BASE}/v1/studies/${encodeURIComponent(STUDY_ID)}/validation-correction`;

const MOCK_RECORD = {
  validationId: 1,
  status: "approved",
  validatedBy: "dr.house",
  validatedAt: "2026-09-04T10:00:00Z",
};

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  (globalThis as { fetch?: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => fetchImpl(url, init);
});

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

// ── submitValidation ──────────────────────────────────────────────────────────

test("submitValidation POSTs approved action to the correct URL", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, VALIDATE_URL);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init!.body as string), { action: "approved" });
    return jsonResponse(201, MOCK_RECORD);
  };
  const result = await submitValidation(STUDY_ID, "approved");
  assert.deepEqual(result, { ok: true, data: MOCK_RECORD });
});

test("submitValidation POSTs rejected action with comment", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, VALIDATE_URL);
    assert.deepEqual(JSON.parse(init!.body as string), {
      action: "rejected",
      comment: "Imagen borrosa",
    });
    return jsonResponse(201, { ...MOCK_RECORD, status: "rejected" });
  };
  const result = await submitValidation(STUDY_ID, "rejected", "Imagen borrosa");
  assert.equal(result.ok, true);
});

test("submitValidation POSTs review action without comment", async () => {
  fetchImpl = async (_url, init) => {
    assert.deepEqual(JSON.parse(init!.body as string), { action: "review" });
    return jsonResponse(201, { ...MOCK_RECORD, status: "review" });
  };
  const result = await submitValidation(STUDY_ID, "review");
  assert.equal(result.ok, true);
});

test("submitValidation returns ok:false with status and server error on failure", async () => {
  fetchImpl = async () =>
    jsonResponse(403, { error: "Solo médicos pueden validar." });
  const result = await submitValidation(STUDY_ID, "approved");
  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "Solo médicos pueden validar.",
  });
});

test("submitValidation falls back to generic message when body has no error field", async () => {
  fetchImpl = async () => jsonResponse(500, { unexpected: true });
  const result = await submitValidation(STUDY_ID, "approved");
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 500);
  assert.notEqual((result as { error: string }).error, "");
});

test("submitValidation falls back to generic when body is not JSON", async () => {
  fetchImpl = async () =>
    ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }) as Response;
  const result = await submitValidation(STUDY_ID, "approved");
  assert.equal(result.ok, false);
});

test("submitValidation returns status 0 on network failure", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await submitValidation(STUDY_ID, "approved");
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 0);
});

// ── submitCorrection ──────────────────────────────────────────────────────────

test("submitCorrection POSTs to the /validation-correction endpoint", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, CORRECTION_URL);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init!.body as string), {
      action: "approved",
      comment: "Corrección tras nueva revisión",
    });
    return jsonResponse(201, MOCK_RECORD);
  };
  const result = await submitCorrection(
    STUDY_ID,
    "approved",
    "Corrección tras nueva revisión",
  );
  assert.deepEqual(result, { ok: true, data: MOCK_RECORD });
});

test("submitCorrection returns ok:false on error", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "Solo admins." });
  const result = await submitCorrection(STUDY_ID, "rejected");
  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "Solo admins.",
  });
});

test("submitCorrection returns status 0 on network failure", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await submitCorrection(STUDY_ID, "review");
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 0);
});

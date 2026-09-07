import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchPrediction, triggerAnalysis } from "./prediction-api.ts";
import { API_BASE } from "../auth/auth.ts";

const STUDY_ID = "1.2.3.4.5";
const FETCH_URL = `${API_BASE}/v1/studies/${encodeURIComponent(STUDY_ID)}/ml/prediction`;
const ANALYZE_URL = `${API_BASE}/v1/studies/${encodeURIComponent(STUDY_ID)}/ml/analyze`;

const MOCK_RECORD = {
  predictionId: 1,
  studyId: STUDY_ID,
  label: "normal",
  confidence: 0.87,
  analyzedBy: "admin@micd.local",
  analyzedAt: "2026-09-06T10:00:00.000Z",
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

// ── fetchPrediction ───────────────────────────────────────────────────────────

test("fetchPrediction GETs the correct URL and returns the record", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, FETCH_URL);
    assert.equal(init?.method, undefined);
    return jsonResponse(200, MOCK_RECORD);
  };
  const result = await fetchPrediction(STUDY_ID);
  assert.deepEqual(result, { ok: true, data: MOCK_RECORD });
});

test("fetchPrediction returns ok:true with null data when no prediction exists", async () => {
  fetchImpl = async () => jsonResponse(200, null);
  const result = await fetchPrediction(STUDY_ID);
  assert.deepEqual(result, { ok: true, data: null });
});

test("fetchPrediction returns ok:false with status on non-200 response", async () => {
  fetchImpl = async () => jsonResponse(404, { error: "Estudio no encontrado" });
  const result = await fetchPrediction(STUDY_ID);
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 404);
});

test("fetchPrediction returns status 0 on network failure", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await fetchPrediction(STUDY_ID);
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 0);
});

// ── triggerAnalysis ───────────────────────────────────────────────────────────

test("triggerAnalysis POSTs to the correct URL and returns the record", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, ANALYZE_URL);
    assert.equal(init?.method, "POST");
    return jsonResponse(201, MOCK_RECORD);
  };
  const result = await triggerAnalysis(STUDY_ID);
  assert.deepEqual(result, { ok: true, data: MOCK_RECORD });
});

test("triggerAnalysis returns ok:false on 403", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "Solo admins." });
  const result = await triggerAnalysis(STUDY_ID);
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 403);
  assert.equal((result as { error: string }).error, "Solo admins.");
});

test("triggerAnalysis returns status 0 on network failure", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await triggerAnalysis(STUDY_ID);
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 0);
});

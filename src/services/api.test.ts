import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  validateServerUrl,
  getServerUrl,
  setServerUrl,
  getApiBaseUrl,
  fetchStudies,
  fetchStudyInstances,
  fetchInstanceFile,
  checkServerHealth,
} from "./api.ts";
import { persistServerUrl } from "../viewer/state.ts";
import { API_BASE, API_ORIGIN, updateApiOrigin } from "../auth/auth.ts";

let store: Map<string, string>;
let lastFetchUrl: string | null = null;
let lastFetchInit: RequestInit | undefined = undefined;
let fetchResponse: Response = {
  ok: true,
  status: 200,
  json: async () => ({}),
} as Response;

beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  lastFetchUrl = null;
  lastFetchInit = undefined;
  (globalThis as { fetch?: unknown }).fetch = async (
    url: string,
    init?: RequestInit,
  ) => {
    lastFetchUrl = url;
    lastFetchInit = init;
    return fetchResponse;
  };
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { fetch?: unknown }).fetch;
  // Restore default server URL
  persistServerUrl("http://localhost:3000");
  updateApiOrigin("http://localhost:3000");
});

test("validateServerUrl rejects empty or whitespace string", () => {
  assert.equal(validateServerUrl("").valid, false);
  assert.equal(validateServerUrl("   ").valid, false);
});

test("validateServerUrl auto-prefixes http:// for bare host/port", () => {
  const res = validateServerUrl("localhost:8042");
  assert.equal(res.valid, true);
  assert.equal(res.formattedUrl, "http://localhost:8042");
});

test("validateServerUrl handles https:// origin correctly", () => {
  const res = validateServerUrl("https://orthanc.clinic.example.org:8443");
  assert.equal(res.valid, true);
  assert.equal(res.formattedUrl, "https://orthanc.clinic.example.org:8443");
});

test("validateServerUrl strips paths, query params, and trailing slashes", () => {
  const res = validateServerUrl(
    "http://pacs.local:8080/dicom-web/studies?q=1#main",
  );
  assert.equal(res.valid, true);
  assert.equal(res.formattedUrl, "http://pacs.local:8080");
});

test("validateServerUrl rejects unsupported protocols", () => {
  const ftpRes = validateServerUrl("ftp://orthanc.server.com");
  assert.equal(ftpRes.valid, false);
  assert.match(ftpRes.error ?? "", /protocolo/i);

  const jsRes = validateServerUrl("javascript:void(0)");
  assert.equal(jsRes.valid, false);
});

test("setServerUrl updates state, localStorage, and API base origin", () => {
  setServerUrl("https://hospital-pacs.local:9000");

  assert.equal(getServerUrl(), "https://hospital-pacs.local:9000");
  assert.equal(getApiBaseUrl(), "https://hospital-pacs.local:9000/api");
  assert.equal(
    store.get("micd_server_url"),
    "https://hospital-pacs.local:9000",
  );
  assert.equal(
    store.get("micd_api_origin"),
    "https://hospital-pacs.local:9000",
  );
  assert.equal(API_ORIGIN, "https://hospital-pacs.local:9000");
  assert.equal(API_BASE, "https://hospital-pacs.local:9000/api");
});

test("fetchStudies calls dynamic server URL with query params", async () => {
  setServerUrl("http://custom-orthanc:8042");

  await fetchStudies("limit=10&page=2");
  assert.equal(
    lastFetchUrl,
    "http://custom-orthanc:8042/api/v1/studies?limit=10&page=2",
  );
});

test("fetchStudyInstances targets dynamic server URL with encoded studyId", async () => {
  setServerUrl("http://pacs-server:4000");

  await fetchStudyInstances("study-abc/123");
  assert.equal(
    lastFetchUrl,
    "http://pacs-server:4000/api/v1/studies/study-abc%2F123/instances",
  );
});

test("fetchInstanceFile targets dynamic server URL with encoded studyId and instanceId", async () => {
  setServerUrl("https://secure-pacs:5000");

  await fetchInstanceFile("study#1", "instance#2");
  assert.equal(
    lastFetchUrl,
    "https://secure-pacs:5000/api/v1/studies/study%231/instances/instance%232/file",
  );
});

test("checkServerHealth probes /api/health endpoint", async () => {
  fetchResponse = { ok: true, status: 200 } as Response;
  const ok = await checkServerHealth("http://probe-host:3000");
  assert.equal(ok, true);
  assert.equal(lastFetchUrl, "http://probe-host:3000/api/health");

  fetchResponse = { ok: false, status: 500 } as Response;
  const failed = await checkServerHealth("http://probe-host:3000");
  assert.equal(failed, false);
});

import { authFetch, API_BASE } from "./auth.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZenodoFile {
  key: string;
  size: number;
  checksum?: string;
}

export interface ZenodoRecord {
  id: number;
  doi: string;
  title: string;
  description: string;
  created: string;
  files: ZenodoFile[];
  importable: boolean;
}

export interface SearchResult {
  records: ZenodoRecord[];
  total: number;
  page: number;
  size: number;
}

export interface PublishResult {
  deposition_id: number;
  doi: string;
  files_uploaded: number;
  total_bytes: number;
}

export interface ImportFileResult {
  fileKey: string;
  status: "imported" | "duplicate" | "skipped" | "failed";
  error?: string;
}

export interface ImportResult {
  import_id: number;
  imported: number;
  duplicates: number;
  failed: number;
  results: ImportFileResult[];
}

export interface QuotaResult {
  environment: string;
  used_bytes: number;
  limit_bytes: number;
  percent_used: number;
  alert: boolean;
  alert_message: string | null;
  rate_limit: {
    requests_last_minute: number;
    throttle_at: number;
    limit: number;
  };
}

export interface SyncConfig {
  interval_hours: number | null;
  last_run_at: string | null;
  valid_intervals: number[];
}

export interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  records_checked: number;
  new_versions: number;
  errors: number;
}

export interface EnvironmentStatus {
  configured: boolean;
  status: "connected" | "error" | "unconfigured";
  hint?: string;
}

export interface ConfigStatus {
  sandbox: EnvironmentStatus;
  production: EnvironmentStatus;
}

export interface ZenodoApiError extends Error {
  code?: string;
  httpStatus?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function throwOnError(res: Response): Promise<Response> {
  if (res.ok || res.status === 204) return res;
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  const err: ZenodoApiError = new Error(
    (body.error as string) || `HTTP ${res.status}`,
  );
  err.code = body.code as string | undefined;
  err.httpStatus = res.status;
  throw err;
}

// ── Credential management ────────────────────────────────────────────────────

export async function getConfigStatus(): Promise<ConfigStatus> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config/status`);
  await throwOnError(res);
  return res.json();
}

export async function storeToken(
  environment: "sandbox" | "production",
  token: string,
): Promise<{ status: string; environment: string; hint: string }> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, token }),
  });
  await throwOnError(res);
  return res.json();
}

export async function deleteToken(
  environment: "sandbox" | "production",
): Promise<void> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config/${environment}`, {
    method: "DELETE",
  });
  await throwOnError(res);
}

// ── Publish ───────────────────────────────────────────────────────────────────

export interface PublishBody {
  orthanc_study_id: string;
  environment: "sandbox" | "production";
  title: string;
  description: string;
  authors: { name: string; affiliation?: string; orcid?: string }[];
  license?: string;
  keywords?: string[];
  force_large_upload?: boolean;
}

export async function publishStudy(body: PublishBody): Promise<PublishResult> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json();
}

export async function getDeposition(
  depositionId: number,
): Promise<{ deposition: Record<string, unknown>; files: ZenodoFile[] }> {
  const res = await authFetch(
    `${API_BASE}/v1/zenodo/depositions/${depositionId}`,
  );
  await throwOnError(res);
  return res.json();
}

// ── Search / Records ─────────────────────────────────────────────────────────

export async function searchRecords(params: {
  q: string;
  environment?: string;
  page?: number;
  size?: number;
  file_type?: string;
  date_from?: string;
  date_to?: string;
}): Promise<SearchResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  qs.set("environment", params.environment ?? "sandbox");
  if (params.page) qs.set("page", String(params.page));
  if (params.size) qs.set("size", String(params.size));
  if (params.file_type) qs.set("file_type", params.file_type);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  const res = await authFetch(`${API_BASE}/v1/zenodo/search?${qs}`);
  await throwOnError(res);
  return res.json();
}

export async function getRecord(
  recordId: number,
  environment: string,
): Promise<{ record: ZenodoRecord; files: ZenodoFile[] }> {
  const res = await authFetch(
    `${API_BASE}/v1/zenodo/records/${recordId}?environment=${environment}`,
  );
  await throwOnError(res);
  return res.json();
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function importFiles(body: {
  record_id: number;
  environment: string;
  files: { fileKey: string; fileSize?: number }[];
  overwrite_duplicates?: boolean;
}): Promise<ImportResult> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json();
}

// ── Quota ─────────────────────────────────────────────────────────────────────

export async function getQuota(environment: string): Promise<QuotaResult> {
  const res = await authFetch(
    `${API_BASE}/v1/zenodo/quota?environment=${environment}`,
  );
  await throwOnError(res);
  return res.json();
}

// ── Metadata sync ─────────────────────────────────────────────────────────────

export async function getSyncConfig(): Promise<SyncConfig> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync`);
  await throwOnError(res);
  return res.json();
}

export async function setSyncInterval(
  interval_hours: number | null,
): Promise<SyncConfig> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interval_hours }),
  });
  await throwOnError(res);
  return res.json();
}

export async function triggerSync(): Promise<{
  log_id: number;
  records_checked: number;
  new_versions: number;
  errors: number;
}> {
  const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync/run`, {
    method: "POST",
  });
  await throwOnError(res);
  return res.json();
}

export async function getSyncLogs(limit = 10): Promise<SyncLog[]> {
  const res = await authFetch(
    `${API_BASE}/v1/zenodo/config/sync/logs?limit=${limit}`,
  );
  await throwOnError(res);
  return res.json();
}

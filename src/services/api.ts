/**
 * api.ts — Dynamic DICOM & PACS API client layer (TK-29).
 * Consumes dynamically configured serverUrl from state/localStorage.
 */
import { persistServerUrl } from "../viewer/state.js";
import { authFetch, getApiOrigin } from "../auth/auth.js";

/** Validates a user-supplied server URL. Supports http:// and https://. */
export function validateServerUrl(rawUrl: string): {
  valid: boolean;
  formattedUrl?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: "La URL del servidor no puede estar vacía" };
  }

  // If scheme is provided (e.g. ftp://, file://, http://, javascript:...)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const isPortOnly = /^[a-zA-Z0-9.-]+:\d+/.test(trimmed);

  if (hasScheme && !isPortOnly) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          valid: false,
          error: "El protocolo debe ser http:// o https://",
        };
      }
      if (!parsed.hostname) {
        return { valid: false, error: "El nombre de host no es válido" };
      }
      return { valid: true, formattedUrl: parsed.origin };
    } catch {
      return {
        valid: false,
        error: "Formato de URL inválido (ej. http://localhost:3000)",
      };
    }
  }

  // Bare host or host:port — auto-prefix http://
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (!parsed.hostname) {
      return { valid: false, error: "El nombre de host no es válido" };
    }
    return { valid: true, formattedUrl: parsed.origin };
  } catch {
    return {
      valid: false,
      error: "Formato de URL inválido (ej. http://localhost:3000)",
    };
  }
}

/** Returns the active base API origin — the single origin auth.ts resolved. */
export function getServerUrl(): string {
  return getApiOrigin();
}

/** Returns the active /api prefix. */
export function getApiBaseUrl(): string {
  const origin = getServerUrl();
  return origin ? `${origin}/api` : "/api";
}

/** Updates the active server URL (persists + updates the resolved origin). */
export function setServerUrl(url: string): void {
  persistServerUrl(url);
}

/** Dynamic fetch wrapper targeting the configured server URL. */
export function serverFetch(
  endpoint: string,
  init?: RequestInit,
): Promise<Response> {
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const fullUrl = `${base}${cleanEndpoint}`;
  return authFetch(fullUrl, init);
}

/** Fetch studies list from configured server. */
export function fetchStudies(
  queryParams?: URLSearchParams | string,
): Promise<Response> {
  const qs = queryParams ? `?${queryParams.toString()}` : "";
  return serverFetch(`/v1/studies${qs}`);
}

/** Fetch instances metadata list for a study. */
export function fetchStudyInstances(studyId: string): Promise<Response> {
  return serverFetch(`/v1/studies/${encodeURIComponent(studyId)}/instances`);
}

/** Fetch raw DICOM instance file from server. */
export function fetchInstanceFile(
  studyId: string,
  instanceId: string,
): Promise<Response> {
  return serverFetch(
    `/v1/studies/${encodeURIComponent(studyId)}/instances/${encodeURIComponent(instanceId)}/file`,
  );
}

/** Quick health/connectivity probe to test PACS/Orthanc server connectivity. */
export async function checkServerHealth(customUrl?: string): Promise<boolean> {
  try {
    const origin = customUrl ? customUrl.replace(/\/+$/, "") : getServerUrl();
    const probeUrl = `${origin}/api/health`;
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

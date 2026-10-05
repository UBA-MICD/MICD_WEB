/**
 * local-anonymizer.ts — client for the DICOM anonymization service
 * (Imagenes-medicas-anonimizacion, PS3.15 via pydicom), run on the user's own
 * machine.
 *
 * US-16: an un-anonymized DICOM must never leave the computer. The service
 * listens on loopback only, so the raw bytes go browser → 127.0.0.1 and only
 * its anonymized output is uploaded to the backend. There is deliberately no
 * fallback: if the service is down or rejects a file, the upload fails
 * (fail closed) rather than sending something less anonymized.
 */

const DEFAULT_ANONYMIZER_URL = "http://127.0.0.1:8000";

/** The service ignores the profile today but requires the field. */
const PROFILE = "default";

/**
 * How long to wait on the local service before giving up. A hung anonymizer
 * must fail the upload (fail closed) rather than leaving it pending forever,
 * so every request carries an abort timeout.
 */
const TIMEOUT_MS = 30_000;

/** The service could not be reached at all (not running, wrong URL). */
export class AnonymizerUnavailableError extends Error {
  constructor(url: string, options?: { cause?: unknown }) {
    super(`Anonymizer not reachable at ${url}`, options);
    this.name = "AnonymizerUnavailableError";
  }
}

/** The service answered but did not return an anonymized DICOM. */
export class AnonymizationRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Anonymizer rejected the file (HTTP ${status}): ${detail}`);
    this.name = "AnonymizationRejectedError";
  }
}

/**
 * localStorage `micd_anonymizer_url`, then `window.MICD_ANONYMIZER_URL`, then
 * the loopback default. A custom URL must also be allowed by the page's CSP
 * connect-src (index.template.html).
 */
export function anonymizerUrl(): string {
  let stored: string | null = null;
  try {
    stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("micd_anonymizer_url")
        : null;
  } catch {
    // storage blocked — use the default
  }
  const configured =
    stored ||
    (globalThis as { MICD_ANONYMIZER_URL?: string }).MICD_ANONYMIZER_URL ||
    DEFAULT_ANONYMIZER_URL;
  return configured.trim().replace(/\/+$/, "");
}

/** True when the service answers its health check (`GET /`). */
export async function isAnonymizerAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${anonymizerUrl()}/`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends one file to the service and returns the anonymized DICOM bytes. */
export async function anonymizeWithLocalService(
  file: File,
): Promise<ArrayBuffer> {
  const url = anonymizerUrl();
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("profile", PROFILE);

  let res: Response;
  try {
    res = await fetch(`${url}/anonymize/`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network error or the abort timeout — either way the service did not
    // give us anonymized bytes, so fail closed.
    throw new AnonymizerUnavailableError(url, { cause: err });
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch {
      // non-JSON error body
    }
    throw new AnonymizationRejectedError(res.status, detail);
  }
  return res.arrayBuffer();
}

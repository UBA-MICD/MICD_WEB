/* cspell:disable */
/**
 * anonymizer-contract.ts — the contract this client depends on from the
 * external anonymization module (Imagenes-medicas-anonimizacion), pinned
 * explicitly so a change on their side breaks a test here rather than silently
 * shipping un-anonymized data (TK-15 / #73).
 *
 * This is the HTTP interface of local-anonymizer.ts. When the other team
 * deliberately releases a new version, update CONTRACT_VERSION and this
 * definition in the same commit — the diff is the record of what changed.
 *
 * Source of truth on their side: src/anonimizador/server/router.py
 * (`GET /` health, `POST /anonymize/` with form fields `file` + `profile`).
 */

/** Bump when the interface below is changed on purpose. */
export const CONTRACT_VERSION = 1;

export const ANONYMIZER_CONTRACT = {
  version: CONTRACT_VERSION,
  /** Health probe: any 2xx means "available". */
  health: { method: "GET", path: "/" },
  /** The anonymize call. */
  anonymize: {
    method: "POST",
    path: "/anonymize/",
    /** multipart/form-data fields the service requires. */
    formFields: ["file", "profile"] as const,
    /** A 2xx response body is the anonymized DICOM, as raw bytes. */
    successStatus: 2, // leading digit: any 2xx
    /** A non-2xx body may carry a human-readable reason here. */
    errorDetailField: "detail",
  },
} as const;

/** Prefix every mismatch so the failure is unmistakable in CI output. */
export function contractChanged(what: string): string {
  return `the external anonymization contract changed: ${what}`;
}

/**
 * Validate a request our client actually produced against the contract.
 * Returns the list of mismatches (each already prefixed); empty means OK.
 */
export function checkAnonymizeRequest(req: {
  url: string;
  method?: string;
  body: unknown;
}): string[] {
  const problems: string[] = [];
  const { anonymize } = ANONYMIZER_CONTRACT;

  if (!req.url.endsWith(anonymize.path)) {
    problems.push(
      contractChanged(`expected POST to ${anonymize.path}, got ${req.url}`),
    );
  }
  if ((req.method ?? "GET").toUpperCase() !== anonymize.method) {
    problems.push(contractChanged(`expected method ${anonymize.method}`));
  }
  const form = req.body;
  const isForm = typeof FormData !== "undefined" && form instanceof FormData;
  if (!isForm) {
    problems.push(contractChanged("request body is not multipart form-data"));
  } else {
    for (const field of anonymize.formFields) {
      if (!(form as FormData).has(field)) {
        problems.push(
          contractChanged(`request is missing the '${field}' field`),
        );
      }
    }
  }
  return problems;
}

/**
 * Validate that a response shape still matches what the client can consume.
 * `status` and the parsed JSON error body (if any) are checked.
 */
export function checkAnonymizeResponse(res: {
  status: number;
  errorBody?: unknown;
}): string[] {
  const problems: string[] = [];
  const ok =
    Math.floor(res.status / 100) ===
    ANONYMIZER_CONTRACT.anonymize.successStatus;
  if (!ok) {
    const field = ANONYMIZER_CONTRACT.anonymize.errorDetailField;
    const body = res.errorBody;
    const hasDetail =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>)[field] === "string";
    if (body !== undefined && !hasDetail) {
      problems.push(
        contractChanged(`error body no longer carries a string '${field}'`),
      );
    }
  }
  return problems;
}

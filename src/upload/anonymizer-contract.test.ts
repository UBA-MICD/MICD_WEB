/**
 * anonymizer-contract.test.ts — TK-15 / #73.
 *
 * Asserts our client produces requests that match the pinned contract, and
 * that the contract checks reject deviations (a renamed field, a changed type,
 * a new status code). A separate, skippable smoke test runs against the real
 * service when MICD_ANONYMIZER_SMOKE is set — it is never started here.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import dicomParser from "dicom-parser";
import { anonymizeWithLocalService } from "./local-anonymizer.ts";
import {
  ANONYMIZER_CONTRACT,
  CONTRACT_VERSION,
  checkAnonymizeRequest,
  checkAnonymizeResponse,
  contractChanged,
} from "./anonymizer-contract.ts";
import {
  buildSyntheticDicom,
  buildAnonymizedSyntheticDicom,
  expectNoPII,
} from "./__fixtures__/synthetic-dicom.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function syntheticFile(): File {
  return new File([new Uint8Array(buildSyntheticDicom())], "synthetic.dcm");
}

test("the client's request matches the pinned contract", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response(new Uint8Array(buildAnonymizedSyntheticDicom()), {
      status: 200,
    });
  }) as typeof fetch;

  await anonymizeWithLocalService(syntheticFile());

  const problems = checkAnonymizeRequest({
    url: captured!.url,
    method: captured!.init.method,
    body: captured!.init.body,
  });
  assert.deepEqual(problems, [], problems.join("; "));
});

test("checkAnonymizeRequest flags a dropped form field", () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1])]), "a.dcm");
  // 'profile' intentionally omitted.
  const problems = checkAnonymizeRequest({
    url: "http://127.0.0.1:8000/anonymize/",
    method: "POST",
    body: form,
  });
  assert.ok(
    problems.includes(
      contractChanged("request is missing the 'profile' field"),
    ),
  );
});

test("checkAnonymizeRequest flags a changed path or method", () => {
  const form = new FormData();
  form.append("file", new Blob([]), "a.dcm");
  form.append("profile", "default");
  const problems = checkAnonymizeRequest({
    url: "http://127.0.0.1:8000/scrub/",
    method: "PUT",
    body: form,
  });
  assert.equal(problems.length, 2);
  assert.ok(
    problems.every((p) =>
      p.startsWith("the external anonymization contract changed:"),
    ),
  );
});

test("checkAnonymizeResponse accepts a conforming error and rejects a renamed field", () => {
  // Conforming: { detail: string } on a non-2xx.
  assert.deepEqual(
    checkAnonymizeResponse({ status: 400, errorBody: { detail: "bad file" } }),
    [],
  );
  // Renamed field (detail -> message) is a breaking change.
  const problems = checkAnonymizeResponse({
    status: 400,
    errorBody: { message: "bad file" },
  });
  assert.ok(
    problems.includes(
      contractChanged("error body no longer carries a string 'detail'"),
    ),
  );
  // A changed type (detail is now a number) is likewise flagged.
  assert.equal(
    checkAnonymizeResponse({ status: 422, errorBody: { detail: 7 } }).length,
    1,
  );
  // A 2xx has no error body to check.
  assert.deepEqual(checkAnonymizeResponse({ status: 200 }), []);
});

test("the contract version is pinned", () => {
  assert.equal(ANONYMIZER_CONTRACT.version, CONTRACT_VERSION);
  assert.deepEqual(ANONYMIZER_CONTRACT.anonymize.formFields, [
    "file",
    "profile",
  ]);
});

// ── Real-service smoke test (opt-in; never starts docker) ───────────────────
// Run with: MICD_ANONYMIZER_SMOKE=1 [MICD_ANONYMIZER_URL=...] npm test
// Requires the Python anonymizer reachable (default http://127.0.0.1:8000).
test(
  "smoke: the real anonymizer returns a PII-free DICOM",
  { skip: !process.env.MICD_ANONYMIZER_SMOKE },
  async () => {
    const original = buildSyntheticDicom();
    const out = await anonymizeWithLocalService(
      new File([new Uint8Array(original)], "synthetic.dcm"),
    );
    const parsed = dicomParser.parseDicom(new Uint8Array(out));
    assert.ok(parsed.elements, "service did not return a parseable DICOM");
    assert.deepEqual(expectNoPII(out, original, dicomParser), []);
  },
);

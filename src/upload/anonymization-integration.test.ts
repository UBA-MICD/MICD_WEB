/**
 * anonymization-integration.test.ts — TK-15 / #73.
 *
 * Exercises the integration with the external anonymizer (local-anonymizer.ts,
 * which talks to Imagenes-medicas-anonimizacion) against a *fake* service, so
 * there is no network, no docker and no real patient data. The point is to
 * catch regressions in OUR integration when that team changes their module —
 * not to test their algorithm.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import dicomParser from "dicom-parser";
import {
  anonymizeWithLocalService,
  AnonymizationRejectedError,
  AnonymizerUnavailableError,
} from "./local-anonymizer.ts";
import {
  buildSyntheticDicom,
  buildAnonymizedSyntheticDicom,
  expectNoPII,
  SYNTHETIC_PII,
} from "./__fixtures__/synthetic-dicom.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function syntheticFile(): File {
  return new File([new Uint8Array(buildSyntheticDicom())], "synthetic.dcm", {
    type: "application/dicom",
  });
}

/** Install a fake service that returns `body` with `status` and records the request. */
function fakeService(body: BodyInit, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as typeof fetch;
  return calls;
}

test("happy path: a correct anonymizer's output comes back PII-free", async () => {
  const anonymized = buildAnonymizedSyntheticDicom();
  const calls = fakeService(anonymized);

  const out = await anonymizeWithLocalService(syntheticFile());

  // The bytes we got back are the service's output, verified clean against the
  // original the client started from.
  assert.deepEqual(expectNoPII(out, buildSyntheticDicom(), dicomParser), []);
  // And the request was shaped the way the service expects, with a timeout.
  assert.equal(calls[0].url, "http://127.0.0.1:8000/anonymize/");
  assert.equal(calls[0].init.method, "POST");
  assert.ok((calls[0].init.body as FormData).get("file"));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("not vacuous: a service that leaves PII in is caught by expectNoPII", async () => {
  // The "anonymizer" echoes the input back unchanged.
  fakeService(buildSyntheticDicom());

  const out = await anonymizeWithLocalService(syntheticFile());

  const violations = expectNoPII(out, buildSyntheticDicom(), dicomParser);
  assert.ok(
    violations.length > 0,
    "expectNoPII must fail when the anonymizer returned identifying data",
  );
});

test("output is still verified: empty and non-DICOM responses do not parse", async () => {
  // A 200 with no body: the client hands back the (empty) bytes, and anyone
  // treating them as a DICOM fails — which is why the backend re-verifies.
  fakeService(new Uint8Array(0));
  const empty = await anonymizeWithLocalService(syntheticFile());
  assert.equal(empty.byteLength, 0);
  assert.throws(() => dicomParser.parseDicom(new Uint8Array(empty)));

  // A 200 with junk bytes is likewise not a usable anonymized DICOM.
  fakeService(new Uint8Array([1, 2, 3, 4, 5]));
  const junk = await anonymizeWithLocalService(syntheticFile());
  assert.throws(() => dicomParser.parseDicom(new Uint8Array(junk)));
});

test("fail closed: a network error throws instead of returning the input", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(
    anonymizeWithLocalService(syntheticFile()),
    AnonymizerUnavailableError,
  );
});

test("fail closed: an abort timeout surfaces as unavailable, not as bytes", async () => {
  globalThis.fetch = (async () => {
    // What AbortSignal.timeout triggers in the real fetch.
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(
    anonymizeWithLocalService(syntheticFile()),
    AnonymizerUnavailableError,
  );
});

test("a non-2xx becomes AnonymizationRejectedError carrying the status", async () => {
  fakeService(JSON.stringify({ detail: "not a DICOM" }), 400);
  await assert.rejects(
    anonymizeWithLocalService(syntheticFile()),
    (err: unknown) =>
      err instanceof AnonymizationRejectedError && err.status === 400,
  );
});

test("errors never leak the file's PII values", async () => {
  const piiValues = Object.values(SYNTHETIC_PII).map((p) => p.value);

  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const unavailable = await anonymizeWithLocalService(syntheticFile()).catch(
    (e) => e as Error,
  );

  fakeService(JSON.stringify({ detail: "rejected" }), 422);
  const rejected = await anonymizeWithLocalService(syntheticFile()).catch(
    (e) => e as Error,
  );

  for (const value of piiValues) {
    assert.ok(
      !unavailable.message.includes(value),
      `unavailable error leaked ${value}`,
    );
    assert.ok(
      !rejected.message.includes(value),
      `rejected error leaked ${value}`,
    );
  }
});

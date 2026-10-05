import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  anonymizerUrl,
  anonymizeWithLocalService,
  AnonymizationRejectedError,
  AnonymizerUnavailableError,
  isAnonymizerAvailable,
} from "./local-anonymizer.ts";

// Minimal storage stand-in: these tests run without a DOM.
const store = new Map<string, string>();
(globalThis as any).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as any).MICD_ANONYMIZER_URL;
  localStorage.removeItem("micd_anonymizer_url");
});

function dcm(): File {
  return new File([new Uint8Array([1, 2, 3])], "a.dcm");
}

test("anonymizerUrl defaults to loopback and honours overrides (storage first)", () => {
  assert.equal(anonymizerUrl(), "http://127.0.0.1:8000");
  (globalThis as any).MICD_ANONYMIZER_URL = "http://localhost:9000/";
  assert.equal(anonymizerUrl(), "http://localhost:9000");
  localStorage.setItem("micd_anonymizer_url", "http://127.0.0.1:8100");
  assert.equal(anonymizerUrl(), "http://127.0.0.1:8100");
});

test("anonymizeWithLocalService posts the file and profile, returns the response bytes", async () => {
  let seen: { url: string; form: FormData } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, form: init.body as FormData };
    return new Response(new Uint8Array([9, 9]), { status: 200 });
  }) as typeof fetch;

  const out = new Uint8Array(await anonymizeWithLocalService(dcm()));

  assert.deepEqual(Array.from(out), [9, 9]);
  assert.equal(seen!.url, "http://127.0.0.1:8000/anonymize/");
  assert.equal((seen!.form.get("file") as File).name, "a.dcm");
  assert.equal(seen!.form.get("profile"), "default");
});

test("anonymizeWithLocalService: network failure → AnonymizerUnavailableError", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(anonymizeWithLocalService(dcm()), AnonymizerUnavailableError);
});

test("anonymizeWithLocalService: non-2xx → AnonymizationRejectedError with the detail", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: "El archivo no es un DICOM válido." }), {
      status: 400,
    })) as typeof fetch;
  await assert.rejects(
    anonymizeWithLocalService(dcm()),
    (err: unknown) =>
      err instanceof AnonymizationRejectedError &&
      err.status === 400 &&
      err.detail === "El archivo no es un DICOM válido.",
  );
});

test("isAnonymizerAvailable reflects the health check", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  assert.equal(await isAnonymizerAvailable(), true);
  globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
  assert.equal(await isAnonymizerAvailable(), false);
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  assert.equal(await isAnonymizerAvailable(), false);
});

/**
 * Tests for the password-recovery helpers: reading the code from the URL and
 * the request/validate fetchers' outcome mapping (fetch is stubbed). The DOM
 * wiring is not exercised here (no jsdom). Run: npm test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResetCode,
  requestPasswordReset,
  fetchResetEmail,
  submitPasswordReset,
} from "./password-reset.ts";

const realFetch = globalThis.fetch;
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as typeof fetch;
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("parseResetCode reads the reset query param", () => {
  assert.equal(parseResetCode("?reset=abc123"), "abc123");
  assert.equal(parseResetCode("?foo=1&reset=xyz&bar=2"), "xyz");
});

test("parseResetCode returns null when absent or blank", () => {
  assert.equal(parseResetCode(""), null);
  assert.equal(parseResetCode("?invite=abc"), null);
  assert.equal(parseResetCode("?reset="), null);
  assert.equal(parseResetCode("?reset=%20%20"), null);
});

test("parseResetCode trims surrounding whitespace", () => {
  assert.equal(parseResetCode("?reset=%20abc%20"), "abc");
});

test("requestPasswordReset posts the email and locale, ok on 202", async () => {
  let seen: { url: string; body: unknown } | null = null;
  stubFetch(async (url, init) => {
    seen = { url, body: JSON.parse(String(init?.body)) };
    return json(202, { ok: true });
  });
  assert.deepEqual(await requestPasswordReset("a@b.co"), { ok: true });
  assert.ok(seen!.url.endsWith("/auth/forgot-password"));
  assert.deepEqual(seen!.body, { email: "a@b.co", locale: "es" });
});

test("requestPasswordReset reports rate limiting and network failure", async () => {
  stubFetch(async () => json(429, { error: "Too many" }));
  const limited = await requestPasswordReset("a@b.co");
  assert.equal(limited.ok, false);

  stubFetch(async () => {
    throw new TypeError("network");
  });
  const offline = await requestPasswordReset("a@b.co");
  assert.equal(offline.ok, false);
});

test("fetchResetEmail returns the email, or invalid on 404", async () => {
  stubFetch(async () => json(200, { email: "a@b.co" }));
  assert.deepEqual(await fetchResetEmail("code"), { ok: true, email: "a@b.co" });

  stubFetch(async () => json(404, { error: "Invalid" }));
  const bad = await fetchResetEmail("code");
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.invalid, true);
});

test("fetchResetEmail distinguishes a network failure from an invalid code", async () => {
  stubFetch(async () => {
    throw new TypeError("network");
  });
  const res = await fetchResetEmail("code");
  assert.equal(!res.ok && res.invalid, false);
});

test("submitPasswordReset fails without adopting a session on 400", async () => {
  stubFetch(async () => json(400, { error: "Invalid or expired reset code" }));
  const res = await submitPasswordReset("code", "longenough");
  assert.equal(res.ok, false);
});

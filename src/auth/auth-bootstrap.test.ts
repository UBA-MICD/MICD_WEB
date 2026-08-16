/**
 * Tests for the two pieces of auth.ts that are decided before the app wires
 * itself up, and so cannot be reached from auth.test.ts:
 *
 *   - API_ORIGIN, resolved once at module load from window.MICD_API_ORIGIN.
 *   - ensureAuthenticated() with no login prompt registered, which is the state
 *     between module load and main.ts calling setLoginPrompt().
 *
 * Both need a module instance auth.test.ts has not already configured. Node's
 * test runner gives each file its own process, so importing auth.ts here after
 * setting the global is enough — hence the dynamic import, since a static one
 * would be hoisted above the assignment.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 */
import test from "node:test";
import assert from "node:assert/strict";

// The nginx deployment serves the page same-origin and proxies /api and /auth
// to the backend, so it sets this to "" — which must survive as "" rather than
// falling back to the localhost default. The trailing slash is there because
// hand-written config reliably has one and callers add their own.
(globalThis as { MICD_API_ORIGIN?: string }).MICD_API_ORIGIN =
  "https://micd.example.org/";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};

test("a configured origin overrides the localhost default", async () => {
  const { API_ORIGIN } = await import("./auth.js");
  assert.equal(API_ORIGIN, "https://micd.example.org");
});

test("API_BASE hangs /api off the configured origin", async () => {
  const { API_BASE } = await import("./auth.js");
  assert.equal(API_BASE, "https://micd.example.org/api");
});

test("ensureAuthenticated resolves false when no login prompt is registered", async () => {
  const { ensureAuthenticated, isAuthenticated } = await import("./auth.js");
  assert.equal(await ensureAuthenticated(), false);
  assert.equal(isAuthenticated(), false);
});

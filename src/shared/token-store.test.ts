/**
 * Tests for token-store.ts — the localStorage vs window.api.secureStore
 * branch. No DOM needed: this file only touches localStorage/window.api
 * inside functions, guarded exactly like auth.ts.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getRefreshToken, setRefreshToken, clearRefreshToken } from "./token-store.ts";

const REFRESH_KEY = "micd_refresh_token";

let store: Map<string, string>;

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
  delete (globalThis as { window?: unknown }).window;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

test("setRefreshToken/getRefreshToken/clearRefreshToken round-trip via localStorage", async () => {
  assert.equal(await getRefreshToken(), null);
  await setRefreshToken("abc123");
  assert.equal(store.get(REFRESH_KEY), "abc123");
  assert.equal(await getRefreshToken(), "abc123");
  await clearRefreshToken();
  assert.equal(await getRefreshToken(), null);
});

test("falls back to secureStore when window.api.secureStore is present", async () => {
  const calls: string[] = [];
  const secure = new Map<string, string>();
  (globalThis as any).window = {
    api: {
      secureStore: {
        get: async (k: string) => {
          calls.push(`get:${k}`);
          return secure.get(k) ?? null;
        },
        set: async (k: string, v: string) => {
          calls.push(`set:${k}`);
          secure.set(k, v);
        },
        delete: async (k: string) => {
          calls.push(`delete:${k}`);
          secure.delete(k);
        },
      },
    },
  };

  await setRefreshToken("secure-token");
  assert.equal(secure.get(REFRESH_KEY), "secure-token");
  assert.equal(store.size, 0); // localStorage untouched

  assert.equal(await getRefreshToken(), "secure-token");

  await clearRefreshToken();
  assert.equal(secure.get(REFRESH_KEY), undefined);

  assert.deepEqual(calls, [
    `set:${REFRESH_KEY}`,
    `get:${REFRESH_KEY}`,
    `delete:${REFRESH_KEY}`,
  ]);
});

test("getRefreshToken swallows a throwing localStorage and returns null", async () => {
  (globalThis as any).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(await getRefreshToken(), null);
});

test("setRefreshToken/clearRefreshToken swallow a throwing localStorage", async () => {
  (globalThis as any).localStorage = {
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  await assert.doesNotReject(() => setRefreshToken("x"));
  await assert.doesNotReject(() => clearRefreshToken());
});

test("no-op cleanly when localStorage is entirely unavailable", async () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(await getRefreshToken(), null);
  await assert.doesNotReject(() => setRefreshToken("x"));
  await assert.doesNotReject(() => clearRefreshToken());
});

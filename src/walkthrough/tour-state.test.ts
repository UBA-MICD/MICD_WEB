/**
 * Tests for tour-state.ts — the per-role localStorage seen-flags. No DOM: this
 * module only touches localStorage inside functions, guarded like token-store.ts.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasSeenTour, markTourSeen, clearTourSeen } from "./tour-state.ts";

let store: Map<string, string>;

function mockLocalStorage() {
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = mockLocalStorage();
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("markTourSeen then hasSeenTour is per-role", () => {
  assert.equal(hasSeenTour("admin"), false);
  markTourSeen("admin");
  assert.equal(store.get("micd.tour.seen.admin"), "1");
  assert.equal(hasSeenTour("admin"), true);
  assert.equal(hasSeenTour("medico"), false);
});

test("clearTourSeen(role) clears one role; clearTourSeen() clears all", () => {
  markTourSeen("admin");
  markTourSeen("medico");
  markTourSeen("investigador");

  clearTourSeen("admin");
  assert.equal(hasSeenTour("admin"), false);
  assert.equal(hasSeenTour("medico"), true);

  clearTourSeen();
  assert.equal(hasSeenTour("medico"), false);
  assert.equal(hasSeenTour("investigador"), false);
  assert.equal(store.size, 0);
});

test("a throwing localStorage is swallowed", () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
    get length(): number {
      throw new Error("blocked");
    },
    key: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(hasSeenTour("admin"), false);
  assert.doesNotThrow(() => markTourSeen("admin"));
  assert.doesNotThrow(() => clearTourSeen());
  assert.doesNotThrow(() => clearTourSeen("admin"));
});

test("no-op cleanly when localStorage is unavailable", () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(hasSeenTour("admin"), false);
  assert.doesNotThrow(() => markTourSeen("admin"));
  assert.doesNotThrow(() => clearTourSeen());
});

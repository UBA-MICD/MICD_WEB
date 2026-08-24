/**
 * Tests for desktop.ts — isDesktop detection and desktop-only UI initialization.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 *
 * desktop.ts touches document.querySelectorAll and document.getElementById, and
 * imports showToast (banner.ts → dom.ts → document) and t (i18n). We stub all
 * document access and window.api at module scope via globalThis. i18n is safe
 * under Node (it guards all browser globals). banner.ts/showToast is only
 * called on the save-button click path, which we test by checking that the
 * input/saveBtn guards work correctly.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isDesktop,
  initDesktopOnlyUI,
  initDesktopApiOriginSetting,
} from "./desktop.ts";

// ── Minimal DOM stubs ─────────────────────────────────────────────────────────

type FakeEl = {
  classList: { removed: string[]; remove: (...cls: string[]) => void };
  value: string;
  addEventListener: (ev: string, cb: () => void) => void;
};

function makeFakeEl(): FakeEl {
  return {
    classList: {
      removed: [] as string[],
      remove(...cls: string[]) {
        this.removed.push(...cls);
      },
    },
    value: "",
    addEventListener: () => {},
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset window.api between tests
  delete (globalThis as any).window;
  // Provide a safe default document stub (overridden per-test as needed)
  (globalThis as any).document = {
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({
      set textContent(_: string) {},
      get innerHTML() {
        return "";
      },
    }),
  };
});

// ── isDesktop ─────────────────────────────────────────────────────────────────

test("isDesktop returns false when window is undefined", () => {
  // window is not set — no globalThis.window
  assert.equal(isDesktop(), false);
});

test("isDesktop returns false when window.api is undefined", () => {
  (globalThis as any).window = { api: undefined };
  assert.equal(isDesktop(), false);
});

test("isDesktop returns false when window.api is null", () => {
  (globalThis as any).window = { api: null };
  assert.equal(isDesktop(), false);
});

test("isDesktop returns true when window.api is a non-null object", () => {
  (globalThis as any).window = { api: {} };
  assert.equal(isDesktop(), true);
});

test("isDesktop returns true with a full mock api bridge", () => {
  (globalThis as any).window = {
    api: {
      secureStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
      },
      saveFile: async () => true,
      getApiOrigin: async () => "http://localhost:3000",
      setApiOrigin: async () => {},
      on: () => {},
      removeAllListeners: () => {},
    },
  };
  assert.equal(isDesktop(), true);
});

// ── initDesktopOnlyUI ─────────────────────────────────────────────────────────

test("initDesktopOnlyUI is a no-op when not in desktop mode (window.api absent)", () => {
  let queryCalled = false;
  (globalThis as any).document = {
    querySelectorAll: () => {
      queryCalled = true;
      return [];
    },
    getElementById: () => null,
    createElement: () => ({}),
  };
  initDesktopOnlyUI();
  assert.equal(queryCalled, false);
});

test("initDesktopOnlyUI removes hidden class from all [data-desktop-only] elements", () => {
  (globalThis as any).window = { api: {} };

  const el1 = makeFakeEl();
  const el2 = makeFakeEl();
  const els = [el1, el2];

  (globalThis as any).document = {
    querySelectorAll: (_sel: string) => els,
    getElementById: () => null,
    createElement: () => ({}),
  };

  initDesktopOnlyUI();

  assert.deepEqual(el1.classList.removed, ["hidden"]);
  assert.deepEqual(el2.classList.removed, ["hidden"]);
});

test("initDesktopOnlyUI removes hidden only from the matching elements, not others", () => {
  (globalThis as any).window = { api: {} };

  const el = makeFakeEl();

  (globalThis as any).document = {
    querySelectorAll: (sel: string) =>
      sel === "[data-desktop-only]" ? [el] : [],
    getElementById: () => null,
    createElement: () => ({}),
  };

  initDesktopOnlyUI();
  assert.equal(el.classList.removed.includes("hidden"), true);
});

test("initDesktopOnlyUI handles an empty [data-desktop-only] node list", () => {
  (globalThis as any).window = { api: {} };

  (globalThis as any).document = {
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({}),
  };

  // Must not throw
  assert.doesNotThrow(() => initDesktopOnlyUI());
});

// ── initDesktopApiOriginSetting ───────────────────────────────────────────────

test("initDesktopApiOriginSetting is a no-op when not in desktop mode", async () => {
  let getIdCalled = false;
  (globalThis as any).document = {
    getElementById: () => {
      getIdCalled = true;
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initDesktopApiOriginSetting();
  assert.equal(getIdCalled, false);
});

test("initDesktopApiOriginSetting is a no-op when input element is missing", async () => {
  (globalThis as any).window = {
    api: {
      getApiOrigin: async () => "http://localhost:3000",
      setApiOrigin: async () => {},
    },
  };

  (globalThis as any).document = {
    getElementById: (_id: string) => null, // no elements found
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  // Must not throw even when elements are absent
  await assert.doesNotReject(() => initDesktopApiOriginSetting());
});

test("initDesktopApiOriginSetting is a no-op when save button is missing", async () => {
  const input = makeFakeEl();
  (globalThis as any).window = {
    api: {
      getApiOrigin: async () => "http://localhost:3000",
      setApiOrigin: async () => {},
    },
  };

  (globalThis as any).document = {
    getElementById: (id: string) =>
      id === "desktop-api-origin-input" ? input : null,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await assert.doesNotReject(() => initDesktopApiOriginSetting());
});

test("initDesktopApiOriginSetting pre-fills the input with the current API origin", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();

  (globalThis as any).window = {
    api: {
      getApiOrigin: async () => "http://backend.example.com",
      setApiOrigin: async () => {},
    },
  };

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initDesktopApiOriginSetting();
  assert.equal(input.value, "http://backend.example.com");
});

test("initDesktopApiOriginSetting attaches a click listener to the save button", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();
  let listenerAttached = false;
  saveBtn.addEventListener = (_ev: string, _cb: () => void) => {
    listenerAttached = true;
  };

  (globalThis as any).window = {
    api: {
      getApiOrigin: async () => "http://localhost:3000",
      setApiOrigin: async () => {},
    },
  };

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initDesktopApiOriginSetting();
  assert.equal(listenerAttached, true);
});

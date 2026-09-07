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
  initApiOriginSetting,
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
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({
      textContent: "",
      get innerHTML() {
        return "";
      },
    }),
  };
  // Reset localStorage stub
  delete (globalThis as any).localStorage;
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

// ── initApiOriginSetting (desktop path) ──────────────────────────────────────

test("initApiOriginSetting returns early when input element is missing", async () => {
  // querySelector returns a card but getElementById returns null for input
  (globalThis as any).document = {
    getElementById: (_id: string) => null,
    querySelector: () => makeFakeEl(),
    querySelectorAll: () => [],
    createElement: () => ({}),
  };
  // Must not throw
  await assert.doesNotReject(() => initApiOriginSetting());
});

test("initApiOriginSetting returns early when save button is missing", async () => {
  const input = makeFakeEl();
  (globalThis as any).document = {
    getElementById: (id: string) =>
      id === "desktop-api-origin-input" ? input : null,
    querySelector: () => makeFakeEl(),
    querySelectorAll: () => [],
    createElement: () => ({}),
  };
  await assert.doesNotReject(() => initApiOriginSetting());
});

test("initApiOriginSetting returns early when settings card element is missing", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();
  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelector: () => null, // no card
    querySelectorAll: () => [],
    createElement: () => ({}),
  };
  await assert.doesNotReject(() => initApiOriginSetting());
});

test("initApiOriginSetting pre-fills the input with origin from window.api on desktop", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();
  const card = makeFakeEl();

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
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initApiOriginSetting();
  assert.equal(input.value, "http://backend.example.com");
});

test("initApiOriginSetting attaches a click listener to the save button", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();
  const card = makeFakeEl();
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
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initApiOriginSetting();
  assert.equal(listenerAttached, true);
});

// ── initApiOriginSetting (browser path) ──────────────────────────────────────

test("initApiOriginSetting pre-fills input from localStorage on browser", async () => {
  const input = makeFakeEl();
  const saveBtn = makeFakeEl();
  const card = makeFakeEl();

  // No window.api → browser mode
  (globalThis as any).localStorage = {
    getItem: (key: string) =>
      key === "micd_api_origin" ? "http://my-server.local:3000" : null,
    setItem: () => {},
  };

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initApiOriginSetting();
  assert.equal(input.value, "http://my-server.local:3000");
});

test("initApiOriginSetting saves to localStorage and reloads on browser save", async () => {
  const input = makeFakeEl();
  let savedKey = "";
  let savedValue = "";
  let reloaded = false;

  const saveBtn = makeFakeEl();
  const card = makeFakeEl();
  let clickCb: (() => void) | null = null;
  saveBtn.addEventListener = (_ev: string, cb: () => void) => {
    clickCb = cb;
  };

  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: (key: string, val: string) => {
      savedKey = key;
      savedValue = val;
    },
  };

  (globalThis as any).window = {
    location: {
      reload: () => {
        reloaded = true;
      },
    },
    // no window.api → browser mode
  };

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initApiOriginSetting();
  // initApiOriginSetting pre-fills input.value from localStorage (null → "").
  // Simulate the user typing a new URL after the field is shown.
  input.value = "http://new-server.local:4000";
  assert.ok(clickCb, "click listener must be attached");
  clickCb!();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(savedKey, "micd_api_origin");
  assert.equal(savedValue, "http://new-server.local:4000");
  assert.equal(reloaded, true, "page must reload after saving");
});

test("initApiOriginSetting auto-prefixes http:// on browser for bare host:port", async () => {
  const input = makeFakeEl();
  let savedValue = "";

  const saveBtn = makeFakeEl();
  const card = makeFakeEl();
  let clickCb: (() => void) | null = null;
  saveBtn.addEventListener = (_ev: string, cb: () => void) => {
    clickCb = cb;
  };

  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: (_key: string, val: string) => {
      savedValue = val;
    },
  };
  (globalThis as any).window = {
    location: { reload: () => {} },
  };

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      return null;
    },
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };

  await initApiOriginSetting();
  input.value = "backend.local:3001";
  clickCb!();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(savedValue, "http://backend.local:3001");
});

test("initApiOriginSetting does not save and does not reload for an invalid URL", async () => {
  const input = makeFakeEl();
  let saved = false;
  let reloaded = false;

  const saveBtn = makeFakeEl();
  const card = makeFakeEl();
  let clickCb: (() => void) | null = null;
  saveBtn.addEventListener = (_ev: string, cb: () => void) => {
    clickCb = cb;
  };

  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {
      saved = true;
    },
  };
  (globalThis as any).window = {
    location: {
      reload: () => {
        reloaded = true;
      },
    },
  };

  // Minimal toast stub
  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "desktop-api-origin-input") return input;
      if (id === "desktop-api-origin-save") return saveBtn;
      if (id === "toast-container") return { appendChild: () => {} };
      return null;
    },
    querySelector: () => card,
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add: () => {} },
      setAttribute: () => {},
      querySelector: () => ({ addEventListener: () => {} }),
      addEventListener: () => {},
      textContent: "",
      appendChild: () => {},
    }),
  };

  await initApiOriginSetting();
  input.value = "not a url !!!";
  clickCb!();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(
    saved,
    false,
    "localStorage must not be written for invalid URL",
  );
  assert.equal(reloaded, false, "page must not reload for invalid URL");
});

// ── initDesktopApiOriginSetting (deprecated alias) ───────────────────────────

test("initDesktopApiOriginSetting delegates to initApiOriginSetting (deprecated alias)", async () => {
  // Returns early due to missing card — just verify it doesn't throw
  await assert.doesNotReject(() => initDesktopApiOriginSetting());
});

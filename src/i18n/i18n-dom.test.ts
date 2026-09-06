/**
 * DOM-dependent parts of i18n.ts (applyTranslations, initLocaleFromBrowser)
 * that i18n.test.ts deliberately skips (see its docstring — that file stays
 * DOM-free on purpose). Uses jsdom via test/dom-setup.ts.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  applyTranslations,
  initLocaleFromBrowser,
  setLocale,
  currentLocale,
} from "./i18n.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

beforeEach(() => {
  setLocale("es");
  localStorage.clear();
});

test("applyTranslations sets textContent for [data-i18n]", () => {
  setBody(`<button data-i18n="common.close"></button>`);
  applyTranslations(document);
  const btn = document.querySelector("button")!;
  assert.equal(btn.textContent, btn.textContent); // sanity: got some string
  assert.notEqual(btn.textContent, "");
});

test("applyTranslations leaves elements without a data-i18n key alone", () => {
  setBody(`<span data-i18n="">untouched</span>`);
  applyTranslations(document);
  assert.equal(document.querySelector("span")!.textContent, "untouched");
});

test("applyTranslations sets innerHTML for [data-i18n-html]", () => {
  setBody(`<p data-i18n-html="common.close"></p>`);
  applyTranslations(document);
  assert.notEqual(document.querySelector("p")!.innerHTML, "");
});

test("applyTranslations sets attributes for [data-i18n-attr] pairs", () => {
  setBody(`<img data-i18n-attr="alt:common.close; title:common.close" />`);
  applyTranslations(document);
  const img = document.querySelector("img")!;
  assert.notEqual(img.getAttribute("alt"), null);
  assert.notEqual(img.getAttribute("title"), null);
});

test("applyTranslations ignores an element with an empty data-i18n-attr", () => {
  setBody(`<img data-i18n-attr="" />`);
  applyTranslations(document);
  assert.equal(document.querySelector("img")!.getAttribute("alt"), null);
});

test("initLocaleFromBrowser adopts a supported navigator.language when nothing is stored", () => {
  Object.defineProperty(window.navigator, "language", {
    value: "en-US",
    configurable: true,
  });
  initLocaleFromBrowser();
  assert.equal(currentLocale(), "en");
});

test("initLocaleFromBrowser is a no-op once a locale is already stored", () => {
  localStorage.setItem("micd_lang", "es");
  Object.defineProperty(window.navigator, "language", {
    value: "en-US",
    configurable: true,
  });
  initLocaleFromBrowser();
  assert.equal(currentLocale(), "es");
});

test("initLocaleFromBrowser ignores an unsupported navigator.language", () => {
  Object.defineProperty(window.navigator, "language", {
    value: "fr-FR",
    configurable: true,
  });
  initLocaleFromBrowser();
  assert.equal(currentLocale(), "es");
});

function withThrowingLocalStorage(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    },
    configurable: true,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
  }
}

test("readStoredLocale (via initLocaleFromBrowser) swallows a throwing localStorage.getItem", () => {
  withThrowingLocalStorage(() => {
    Object.defineProperty(window.navigator, "language", {
      value: "en-US",
      configurable: true,
    });
    assert.doesNotThrow(() => initLocaleFromBrowser());
    // storage is unreadable, so it falls through to the navigator-based adopt path
    assert.equal(currentLocale(), "en");
  });
});

test("setLocale swallows a throwing localStorage.setItem", () => {
  withThrowingLocalStorage(() => {
    assert.doesNotThrow(() => setLocale("en"));
    assert.equal(currentLocale(), "en");
  });
});

test("initLocaleFromBrowser swallows a throwing navigator.language getter and keeps the default", () => {
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    get(): string {
      throw new Error("navigator unavailable");
    },
  });
  assert.doesNotThrow(() => initLocaleFromBrowser());
  assert.equal(currentLocale(), "es");
});

import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { showBanner, showToast, hideBanner } from "./banner.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

test.beforeEach(() => {
  setBody(`
    <div id="app-banner" class="hidden"></div>
    <div id="toast-container"></div>
  `);
});

test("showBanner sets text, class, and reveals it", () => {
  showBanner("Study loaded", "success", 0);
  const el = document.getElementById("app-banner")!;
  assert.equal(el.textContent, "Study loaded");
  assert.equal(el.className, "app-banner app-banner--success");
  assert.equal(el.classList.contains("hidden"), false);
});

test("showBanner auto-hides after the default success timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showBanner("ok");
  const el = document.getElementById("app-banner")!;
  assert.equal(el.classList.contains("hidden"), false);
  t.mock.timers.tick(4000);
  assert.equal(el.classList.contains("hidden"), true);
});

test("showBanner errors default to ms=0 and never auto-hide", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showBanner("boom", "error");
  const el = document.getElementById("app-banner")!;
  t.mock.timers.tick(60_000);
  assert.equal(el.classList.contains("hidden"), false);
});

test("showBanner warnings default to a 6s timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showBanner("careful", "warning");
  const el = document.getElementById("app-banner")!;
  t.mock.timers.tick(5999);
  assert.equal(el.classList.contains("hidden"), false);
  t.mock.timers.tick(1);
  assert.equal(el.classList.contains("hidden"), true);
});

test("a second showBanner call clears the previous dismiss timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showBanner("first", "success", 1000);
  showBanner("second", "success", 5000);
  t.mock.timers.tick(1000);
  const el = document.getElementById("app-banner")!;
  assert.equal(el.classList.contains("hidden"), false);
  assert.equal(el.textContent, "second");
});

test("hideBanner hides the banner and clears its text", () => {
  showBanner("Study loaded", "success", 0);
  hideBanner();
  const el = document.getElementById("app-banner")!;
  assert.equal(el.classList.contains("hidden"), true);
  assert.equal(el.textContent, "");
});

test("showToast appends a dismissible toast and wires the close button", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("careful", "warning", 0);
  const container = document.getElementById("toast-container")!;
  const toast = container.querySelector(".toast--warning") as HTMLElement;
  assert.ok(toast);
  assert.equal(toast.querySelector(".toast__msg")!.textContent, "careful");

  const closeBtn = toast.querySelector(".toast__close") as HTMLElement;
  closeBtn.click();
  assert.equal(toast.classList.contains("toast--out"), true);

  toast.dispatchEvent(new Event("animationend"));
  assert.equal(container.contains(toast), false);
});

test("showToast auto-dismisses after ms and escapes its message", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("<b>hi</b>", "error", 3000);
  const container = document.getElementById("toast-container")!;
  const toast = container.querySelector(".toast--error") as HTMLElement;
  assert.equal(toast.querySelector(".toast__msg")!.innerHTML, "&lt;b&gt;hi&lt;/b&gt;");

  t.mock.timers.tick(3000);
  assert.equal(toast.classList.contains("toast--out"), true);
});

test("showToast defaults to warning kind and a 6s timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showToast("default kind");
  const container = document.getElementById("toast-container")!;
  const toast = container.querySelector(".toast--warning") as HTMLElement;
  assert.ok(toast);
  t.mock.timers.tick(6000);
  assert.equal(toast.classList.contains("toast--out"), true);
});

test("showToast is a no-op when the toast container is missing", () => {
  setBody(`<div id="app-banner" class="hidden"></div>`);
  assert.doesNotThrow(() => showToast("nowhere to go"));
});

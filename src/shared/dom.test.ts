import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  $,
  showLoading,
  showError,
  escapeHtml,
  escapeAttr,
  formatDate,
} from "./dom.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

test.beforeEach(() => {
  setBody(`
    <div id="loading-indicator" class="hidden"></div>
    <div id="error-message" class="hidden"></div>
  `);
});

test("$ returns the element by id", () => {
  assert.equal(
    $("loading-indicator"),
    document.getElementById("loading-indicator"),
  );
});

test("showLoading toggles the hidden class on the loading indicator", () => {
  showLoading(true);
  assert.equal($("loading-indicator").classList.contains("hidden"), false);
  showLoading(false);
  assert.equal($("loading-indicator").classList.contains("hidden"), true);
});

test("showError sets the message, reveals it, hides loading, and auto-hides", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  showLoading(true);

  showError("Something broke");

  assert.equal($("loading-indicator").classList.contains("hidden"), true);
  const el = $("error-message");
  assert.equal(el.textContent, "Something broke");
  assert.equal(el.classList.contains("hidden"), false);

  t.mock.timers.tick(5000);
  assert.equal(el.classList.contains("hidden"), true);
});

test("escapeHtml escapes markup-significant characters", () => {
  assert.equal(escapeHtml("<script>&\"'"), "&lt;script&gt;&amp;\"'");
});

test("escapeAttr also encodes double quotes", () => {
  assert.equal(escapeAttr('say "hi" <b>'), "say &quot;hi&quot; &lt;b&gt;");
});

test("formatDate turns YYYYMMDD into YYYY-MM-DD", () => {
  assert.equal(formatDate("20240131"), "2024-01-31");
});

test("formatDate returns an em dash for empty input and the raw value otherwise", () => {
  assert.equal(formatDate(""), "—");
  assert.equal(formatDate("2024"), "2024");
});

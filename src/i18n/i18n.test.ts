/**
 * Tests for i18n.ts — key lookup, interpolation, locale switching, and the
 * guard that keeps es/en from silently drifting apart.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 *
 * t()/setLocale()/currentLocale() only touch localStorage/navigator inside
 * try/catch-guarded functions, so no DOM stubbing is needed here.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { t, setLocale, currentLocale, onLocaleChange } from "./i18n.ts";
import { es } from "./locales/es.ts";
import { en } from "./locales/en.ts";

beforeEach(() => {
  setLocale("es");
});

test("es and en locale files have identical key sets", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test("t() returns the value for a known key in the active locale", () => {
  const [key, value] = Object.entries(es)[0];
  assert.equal(t(key), value);
});

test("t() interpolates {{param}} placeholders", () => {
  setLocale("en");
  const key = "upload.uploadingProgress";
  assert.match(en[key], /\{\{current\}\}/);
  const result = t(key, { current: 3, total: 10 });
  assert.doesNotMatch(result, /\{\{/);
  assert.match(result, /3/);
  assert.match(result, /10/);
});

test("t() leaves an unmatched placeholder untouched", () => {
  const result = t("upload.uploadingProgress", { current: 1 });
  assert.match(result, /\{\{total\}\}/);
});

test("t() falls back to the key itself for a missing key, never throws", () => {
  assert.equal(t("this.key.does.not.exist"), "this.key.does.not.exist");
});

test("setLocale()/currentLocale() round-trip", () => {
  assert.equal(currentLocale(), "es");
  setLocale("en");
  assert.equal(currentLocale(), "en");
  setLocale("es");
  assert.equal(currentLocale(), "es");
});

test("setLocale() to the same locale is a no-op that still doesn't throw", () => {
  setLocale("es");
  assert.doesNotThrow(() => setLocale("es"));
  assert.equal(currentLocale(), "es");
});

test("onLocaleChange() fires subscribers with the new locale", () => {
  const seen: string[] = [];
  const unsubscribe = onLocaleChange((locale) => seen.push(locale));

  setLocale("en");
  assert.deepEqual(seen, ["en"]);

  unsubscribe();
});

test("the unsubscribe function returned by onLocaleChange() stops future notifications", () => {
  const seen: string[] = [];
  const unsubscribe = onLocaleChange((locale) => seen.push(locale));
  unsubscribe();

  setLocale("en");
  assert.deepEqual(seen, []);
});

test("multiple subscribers are all notified", () => {
  const a: string[] = [];
  const b: string[] = [];
  onLocaleChange((locale) => a.push(locale));
  onLocaleChange((locale) => b.push(locale));

  setLocale("en");

  assert.deepEqual(a, ["en"]);
  assert.deepEqual(b, ["en"]);
});

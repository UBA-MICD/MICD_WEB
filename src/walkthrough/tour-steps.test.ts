/**
 * Tests for tour-steps.ts — the content catalog. Pure data checks (no DOM):
 * the common core is shown to every role incl. guests, ids are unique, and
 * every i18n key the catalog references exists in both locales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tourSteps } from "./tour-steps.ts";
import { applicableSteps, isCommonStep } from "./walkthrough.ts";
import { en } from "../i18n/locales/en.ts";
import { es } from "../i18n/locales/es.ts";

test("the catalog is non-empty and every step is common core", () => {
  assert.ok(tourSteps.length > 0);
  for (const s of tourSteps) assert.equal(isCommonStep(s), true, s.id);
  // A guest (null) therefore sees the whole current catalog.
  assert.equal(applicableSteps(tourSteps, null).length, tourSteps.length);
});

test("step ids are unique", () => {
  const ids = tourSteps.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every referenced i18n key exists in both locales", () => {
  for (const s of tourSteps) {
    for (const key of [s.titleKey, s.bodyKey]) {
      assert.ok(key in en, `${key} missing from en`);
      assert.ok(key in es, `${key} missing from es`);
    }
  }
});

test("targets are 'center' or a CSS selector; follow-along steps name an event", () => {
  for (const s of tourSteps) {
    if (s.target !== "center") {
      assert.match(s.target, /^[#.\[]/, `${s.id} target should be a selector`);
    }
    if (s.advance.on === "event") {
      assert.ok(s.advance.event, `${s.id} follow-along step needs an event`);
    }
  }
});

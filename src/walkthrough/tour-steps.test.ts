/**
 * Tests for tour-steps.ts — the content catalog. Pure data checks (no DOM):
 * the common core is shown to every role incl. guests, ids are unique, and
 * every i18n key the catalog references exists in both locales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Role } from "../auth/auth.ts";
import { tourSteps } from "./tour-steps.ts";
import { applicableSteps, isCommonStep } from "./walkthrough.ts";
import { en } from "../i18n/locales/en.ts";
import { es } from "../i18n/locales/es.ts";

const ROLES: Role[] = ["admin", "medico", "investigador"];

test("a guest sees exactly the common-core steps", () => {
  const guest = applicableSteps(tourSteps, null);
  assert.ok(guest.length > 0);
  for (const s of guest) assert.equal(isCommonStep(s), true, s.id);
  assert.equal(guest.length, tourSteps.filter(isCommonStep).length);
});

test("each role gets the common core plus its own branch", () => {
  const guestCount = applicableSteps(tourSteps, null).length;
  for (const role of ROLES) {
    assert.ok(
      applicableSteps(tourSteps, role).length >= guestCount,
      `${role} should see at least the common core`,
    );
  }
  // investigador has role-specific steps beyond the core.
  const invOnly = tourSteps.filter(
    (s) => s.roles.includes("investigador") && !isCommonStep(s),
  );
  assert.ok(invOnly.length > 0, "investigador branch is present");
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

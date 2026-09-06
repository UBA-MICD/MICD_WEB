/**
 * Unit tests for the pure helper functions in validations-panel.ts.
 * These run under Node's bare test runner (no jsdom needed) because the tested
 * functions are DOM-free.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  filterToQueryParam,
  buildBadgeHtml,
  formatDate,
} from "./validations-panel.ts";

// ── filterToQueryParam ────────────────────────────────────────────────────────

test('filterToQueryParam returns empty string for "all"', () => {
  assert.equal(filterToQueryParam("all"), "");
});

test('filterToQueryParam returns correct segment for "none"', () => {
  assert.equal(filterToQueryParam("none"), "&validation_status=none");
});

test('filterToQueryParam returns correct segment for "approved"', () => {
  assert.equal(filterToQueryParam("approved"), "&validation_status=approved");
});

test('filterToQueryParam returns correct segment for "rejected"', () => {
  assert.equal(filterToQueryParam("rejected"), "&validation_status=rejected");
});

test('filterToQueryParam returns correct segment for "review"', () => {
  assert.equal(filterToQueryParam("review"), "&validation_status=review");
});

// ── buildBadgeHtml ────────────────────────────────────────────────────────────

// cspell:ignore Aprobado Rechazado
const LABELS = {
  none: "Sin validación",
  approved: "Aprobado",
  rejected: "Rechazado",
  review: "Para revisión",
} as const;

test("buildBadgeHtml returns --none badge for null status", () => {
  const html = buildBadgeHtml(
    null,
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--none"),
    "should include --none class",
  );
  assert.ok(html.includes(LABELS.none), "should include the none label");
  assert.ok(
    !html.includes("validation-badge--approved"),
    "should not include --approved class",
  );
});

test("buildBadgeHtml returns --approved badge for approved status", () => {
  const html = buildBadgeHtml(
    "approved",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--approved"),
    "should include --approved class",
  );
  assert.ok(
    html.includes(LABELS.approved),
    "should include the approved label",
  );
});

test("buildBadgeHtml returns --rejected badge for rejected status", () => {
  const html = buildBadgeHtml(
    "rejected",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--rejected"),
    "should include --rejected class",
  );
  assert.ok(
    html.includes(LABELS.rejected),
    "should include the rejected label",
  );
});

test("buildBadgeHtml returns --review badge for review status", () => {
  const html = buildBadgeHtml(
    "review",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--review"),
    "should include --review class",
  );
  assert.ok(html.includes(LABELS.review), "should include the review label");
});

test("buildBadgeHtml escapes HTML in labels", () => {
  const xssLabel = "<script>alert(1)</script>";
  const html = buildBadgeHtml(
    null,
    xssLabel,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    !html.includes("<script>"),
    "raw <script> tag must not appear in output",
  );
  assert.ok(html.includes("&lt;script&gt;"), "angle brackets must be escaped");
});

// ── formatDate ────────────────────────────────────────────────────────────────

test("formatDate returns — for null", () => {
  assert.equal(formatDate(null), "—");
});

test("formatDate returns — for empty string", () => {
  assert.equal(formatDate(""), "—");
});

test("formatDate returns a non-empty string for a valid ISO date", () => {
  const result = formatDate("2026-09-06T10:00:00Z");
  assert.ok(result.length > 0, "should return a formatted date string");
  assert.notEqual(result, "—");
});

test("formatDate returns the original string for an invalid date", () => {
  const bad = "not-a-date";
  const result = formatDate(bad);
  assert.equal(result, bad);
});

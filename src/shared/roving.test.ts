/**
 * Tests for nextRovingIndex — the index maths behind the single-tab-stop
 * toolbar and tablist. Kept DOM-free so it runs under the plain node:test
 * runner like the rest of the suite.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nextRovingIndex } from "./roving.ts";

test("horizontal: arrows step forward and back", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 5), 1);
  assert.equal(nextRovingIndex("ArrowLeft", 3, 5), 2);
});

test("horizontal: movement wraps at both ends", () => {
  assert.equal(nextRovingIndex("ArrowRight", 4, 5), 0);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 5), 4);
});

test("vertical: up/down drive the group, left/right are ignored", () => {
  assert.equal(nextRovingIndex("ArrowDown", 0, 3, "vertical"), 1);
  assert.equal(nextRovingIndex("ArrowUp", 0, 3, "vertical"), 2);
  assert.equal(nextRovingIndex("ArrowRight", 0, 3, "vertical"), null);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 3, "vertical"), null);
});

test("horizontal ignores the vertical arrows", () => {
  assert.equal(nextRovingIndex("ArrowDown", 0, 3), null);
  assert.equal(nextRovingIndex("ArrowUp", 0, 3), null);
});

test("Home and End jump to the ends in both orientations", () => {
  assert.equal(nextRovingIndex("Home", 3, 5), 0);
  assert.equal(nextRovingIndex("End", 1, 5), 4);
  assert.equal(nextRovingIndex("Home", 3, 5, "vertical"), 0);
  assert.equal(nextRovingIndex("End", 1, 5, "vertical"), 4);
});

test("keys the group does not handle return null so the caller can pass them on", () => {
  for (const key of ["Tab", "Enter", " ", "Escape", "a", "PageDown"]) {
    assert.equal(nextRovingIndex(key, 1, 5), null, `expected null for ${key}`);
  }
});

test("an empty group never moves focus", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 0), null);
  assert.equal(nextRovingIndex("Home", 0, 0), null);
});

test("a single item wraps onto itself", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 1), 0);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 1), 0);
});

test("an out-of-range current index is clamped, not wrapped negatively", () => {
  // A stale index must never produce a negative result: `(-3 - 1 + 5) % 5`
  // would be 1, silently focusing the wrong control.
  assert.equal(nextRovingIndex("ArrowLeft", -3, 5), 4);
  assert.equal(nextRovingIndex("ArrowRight", 99, 5), 0);
});

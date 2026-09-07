/**
 * Tests for overlay.ts positioning — the pure geometry only (no DOM needed).
 * The DOM plumbing that consumes it is exercised through walkthrough.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeScrimRects, computePopoverPosition } from "./overlay.ts";

test("computeScrimRects frames the hole with four rectangles", () => {
  const vp = { width: 1000, height: 800 };
  const hole = { top: 100, left: 200, width: 300, height: 150 };
  const r = computeScrimRects(hole, vp);
  assert.deepEqual(r.top, { top: 0, left: 0, width: 1000, height: 100 });
  assert.deepEqual(r.bottom, { top: 250, left: 0, width: 1000, height: 550 });
  assert.deepEqual(r.left, { top: 100, left: 0, width: 200, height: 150 });
  assert.deepEqual(r.right, { top: 100, left: 500, width: 500, height: 150 });
});

test("computeScrimRects never emits negative sizes for an off-screen hole", () => {
  const vp = { width: 1000, height: 800 };
  const hole = { top: -50, left: -40, width: 30, height: 20 };
  const r = computeScrimRects(hole, vp);
  assert.equal(r.top.height, 0);
  assert.equal(r.left.width, 0);
  assert.ok(r.right.width >= 0);
  assert.ok(r.bottom.height >= 0);
});

test("computePopoverPosition centers when there is no target", () => {
  const pos = computePopoverPosition(
    null,
    { width: 360, height: 160 },
    "center",
    { width: 1000, height: 800 },
  );
  assert.deepEqual(pos, { left: 320, top: 320 });
});

test("computePopoverPosition places below and centered for 'bottom'", () => {
  const hole = { top: 100, left: 200, width: 300, height: 150 };
  const pos = computePopoverPosition(
    hole,
    { width: 360, height: 160 },
    "bottom",
    { width: 1000, height: 800 },
    12,
  );
  assert.equal(pos.top, 262); // 100 + 150 + gap(12)
  assert.equal(pos.left, 170); // 200 + 150 - 180
});

test("computePopoverPosition clamps within the viewport", () => {
  const hole = { top: 0, left: 0, width: 20, height: 20 };
  const pos = computePopoverPosition(
    hole,
    { width: 360, height: 160 },
    "left",
    { width: 1000, height: 800 },
    12,
    8,
  );
  assert.equal(pos.left, 8); // would be negative → clamped to margin
  assert.ok(pos.top >= 8);
});

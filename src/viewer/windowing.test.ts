/**
 * Tests for windowing.ts — modality defaults and preset values.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getModalityDefaultWindow } from "../dicom/dicom-parser-util.ts";
import { WINDOWING_PRESETS } from "./windowing-presets.ts";

// ── getModalityDefaultWindow ──────────────────────────────────────────────────

test("CT returns soft-tissue defaults", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("CT");
  assert.equal(windowCenter, 40);
  assert.equal(windowWidth, 400);
});

test("CT is case-insensitive", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("ct");
  assert.equal(windowCenter, 40);
  assert.equal(windowWidth, 400);
});

test("MR returns a non-zero window", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("MR");
  assert.ok(windowWidth > 0, "MR windowWidth should be positive");
  assert.ok(windowCenter !== 0 || windowWidth !== 0);
});

test("US returns 8-bit range defaults", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("US");
  assert.equal(windowCenter, 128);
  assert.equal(windowWidth, 256);
});

test("CR returns a wide window", () => {
  const { windowWidth } = getModalityDefaultWindow("CR");
  assert.ok(windowWidth > 1000, "CR needs a wide window for X-ray");
});

test("DX returns same defaults as CR", () => {
  const cr = getModalityDefaultWindow("CR");
  const dx = getModalityDefaultWindow("DX");
  assert.deepEqual(cr, dx);
});

test("PT returns high-range defaults", () => {
  const { windowWidth } = getModalityDefaultWindow("PT");
  assert.ok(windowWidth >= 1000);
});

test("NM returns non-zero defaults", () => {
  const { windowWidth } = getModalityDefaultWindow("NM");
  assert.ok(windowWidth > 0);
});

test("unknown modality returns zeros (signals auto-calculation)", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("XY");
  assert.equal(windowCenter, 0);
  assert.equal(windowWidth, 0);
});

test("empty modality returns zeros", () => {
  const { windowCenter, windowWidth } = getModalityDefaultWindow("");
  assert.equal(windowCenter, 0);
  assert.equal(windowWidth, 0);
});

// ── Preset values ─────────────────────────────────────────────────────────────

test("Pulmón preset has correct WL/WW", () => {
  const preset = WINDOWING_PRESETS.find((p) => p.label === "Pulmón");
  assert.ok(preset, "Pulmón preset must exist");
  assert.equal(preset.wl, -600);
  assert.equal(preset.ww, 1500);
});

test("Hueso preset has correct WL/WW", () => {
  const preset = WINDOWING_PRESETS.find((p) => p.label === "Hueso");
  assert.ok(preset, "Hueso preset must exist");
  assert.equal(preset.wl, 400);
  assert.equal(preset.ww, 1800);
});

test("Tejido blando preset has correct WL/WW", () => {
  const preset = WINDOWING_PRESETS.find((p) => p.label === "Tejido blando");
  assert.ok(preset, "Tejido blando preset must exist");
  assert.equal(preset.wl, 40);
  assert.equal(preset.ww, 400);
});

test("Cerebro preset has correct WL/WW", () => {
  const preset = WINDOWING_PRESETS.find((p) => p.label === "Cerebro");
  assert.ok(preset, "Cerebro preset must exist");
  assert.equal(preset.wl, 40);
  assert.equal(preset.ww, 80);
});

test("all presets have windowWidth > 0", () => {
  for (const p of WINDOWING_PRESETS) {
    assert.ok(p.ww > 0, `preset "${p.label}" must have positive ww`);
  }
});

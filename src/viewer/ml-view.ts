// ── ML Comparative View (US-ML) ───────────────────────────────────────────────
//
// Manages the 1x2 comparative layout when an ML prediction is available.
// Left viewport: original DICOM. Right viewport: same DICOM + AI label in HUD.

import { getViewportManager } from "./viewport-registry.js";
import type { MLPredictionRecord } from "./prediction-api.js";

// True only while the ML 1x2 layout is active — prevents clearMLView from
// resetting a user-chosen 2x2 layout when loading a study without a prediction.
let mlLayoutActive = false;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Apply a prediction to the viewport layout.
 * - If prediction is null: collapse to 1x1 and clear any AI label.
 * - If prediction exists: switch to 1x2, copy vp0 data into vp1, set AI label
 *   on vp1's HUD, and render both viewports.
 */
/**
 * @param applyLayout - only true when opened from the validations panel;
 *   prevents 1x2 from activating during normal study browsing.
 */
export function notifyPredictionLoaded(
  prediction: MLPredictionRecord | null,
  applyLayout = false,
): void {
  const manager = getViewportManager();
  if (!manager) return;

  if (!prediction || !applyLayout) {
    clearMLView();
    return;
  }

  manager.setLayout("1x2");
  mlLayoutActive = true;

  const viewports = manager.getAllViewports();
  const vp0 = viewports[0];
  const vp1 = viewports[1];
  if (!vp0 || !vp1) return;

  // Mirror vp0's DICOM data into vp1 so both panels show the same image.
  vp1.data.source = vp0.data.source;
  vp1.data.files = vp0.data.files;
  vp1.data.serverStudyId = vp0.data.serverStudyId;
  vp1.data.serverInstances = vp0.data.serverInstances;
  vp1.data.currentIndex = vp0.data.currentIndex;
  vp1.data.parsed = vp0.data.parsed;
  vp1.data.viewport = { ...vp0.data.viewport };

  const pct = Math.round(prediction.confidence * 100);
  vp1.data.mlLabel = `IA: ${capitalize(prediction.label)} ${pct}%`;

  // Sync pan/zoom/slice between both viewports for pixel-by-pixel comparison.
  manager.setSync(true);

  vp0.render();
  vp1.render();
}

/**
 * Collapse back to 1x1 and clear any AI label from all viewports.
 * Called when a new study loads without a prediction.
 */
export function clearMLView(): void {
  const manager = getViewportManager();
  if (!manager) return;

  manager.setSync(false);

  for (const vp of manager.getAllViewports()) {
    vp.data.mlLabel = null;
  }

  // Only collapse to 1x1 if this module activated the 1x2 ML layout.
  // Preserves any layout the user chose independently (e.g. 2x2).
  if (mlLayoutActive) {
    mlLayoutActive = false;
    if (manager.getLayout() !== "1x1") {
      manager.setLayout("1x1");
    }
  }
}

/** No-op init hook — reserved for future interaction wiring. */
export function initMLView(): void {
  // intentionally empty
}

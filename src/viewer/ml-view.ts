// ── ML Comparative View (US-ML) ───────────────────────────────────────────────
//
// Manages the 1x2 comparative layout when an ML prediction is available.
// Left viewport: original DICOM. Right viewport: same DICOM + AI label in HUD.

import { getViewportManager } from "./viewport-registry.js";
import { state } from "./state.js";
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

  // Seed BOTH panels from the authoritative global state that loadCurrent()
  // just populated. We must not copy vp0 into vp1 and assume vp0 is loaded:
  // displayParsed() only ever writes the *active* viewport, which may be vp1
  // (e.g. opening a second validation study over a leftover 1x2). When vp0 was
  // left empty the left panel rendered dark and Reset no-op'd (parsed was null).
  for (const vp of [vp0, vp1]) {
    vp.data.source = state.source;
    vp.data.files = state.files;
    vp.data.serverStudyId = state.serverStudyId;
    vp.data.serverInstances = state.serverInstances;
    vp.data.currentIndex = state.currentIndex;
    vp.data.parsed = state.parsed;
    vp.data.viewport = { ...state.viewport };
  }

  vp0.data.mlLabel = null;
  const pct = Math.round(prediction.confidence * 100);
  vp1.data.mlLabel = `IA: ${capitalize(prediction.label)} ${pct}%`;

  // Sync starts OFF: the user turns on paired scrolling with the sync button
  // when they want it, and every new study resets it back off (see loading.ts).
  manager.setSync(false);

  vp0.fitImage();
  vp1.fitImage();
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

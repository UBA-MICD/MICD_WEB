/**
 * annotation-state.ts — State management and dispatchers for measurements/annotations (TK-26).
 *
 * Annotations are grouped by SOPInstanceUID (or slice fallback key) ensuring
 * that measurements persist across slice navigation and only render on the slice
 * to which they belong.
 */

import { state, type AppState } from "../state.js";
import type { Annotation } from "./types.js";

/**
 * Returns the effective SOPInstanceUID for the current slice,
 * falling back to slice index if the DICOM lacks tag (0008,0018).
 */
export function getActiveSopInstanceUid(appState: AppState = state): string {
  if (appState.parsed?.metadata?.sopInstanceUid) {
    return appState.parsed.metadata.sopInstanceUid;
  }
  return `slice_${appState.currentIndex}`;
}

/**
 * Adds a new annotation to state, grouped under its SOPInstanceUID.
 */
export function addAnnotation(
  annotation: Annotation,
  appState: AppState = state,
): void {
  const key = annotation.sopInstanceUid || getActiveSopInstanceUid(appState);
  if (!appState.annotations) {
    appState.annotations = {};
  }
  if (!appState.annotations[key]) {
    appState.annotations[key] = [];
  }
  appState.annotations[key].push({
    ...annotation,
    sopInstanceUid: key,
  });
}

/**
 * Updates an existing annotation by ID.
 * Returns true if the annotation was found and updated, false otherwise.
 */
export function updateAnnotation(
  annotation: Annotation,
  appState: AppState = state,
): boolean {
  if (!appState.annotations) return false;

  const key = annotation.sopInstanceUid || getActiveSopInstanceUid(appState);
  const list = appState.annotations[key];
  if (!list) return false;

  const idx = list.findIndex((a) => a.id === annotation.id);
  if (idx !== -1) {
    list[idx] = { ...annotation, sopInstanceUid: key };
    return true;
  }
  return false;
}

/**
 * Deletes an annotation by ID. If sopInstanceUid is provided, searches directly
 * in that group; otherwise searches across all groups.
 * Returns true if deleted, false if not found.
 */
export function deleteAnnotation(
  id: string,
  sopInstanceUid?: string,
  appState: AppState = state,
): boolean {
  if (!appState.annotations) return false;

  if (sopInstanceUid) {
    const list = appState.annotations[sopInstanceUid];
    if (!list) return false;
    const initialLen = list.length;
    appState.annotations[sopInstanceUid] = list.filter((a) => a.id !== id);
    return appState.annotations[sopInstanceUid].length < initialLen;
  }

  // If no UID given, search all groups
  let deleted = false;
  for (const groupKey of Object.keys(appState.annotations)) {
    const list = appState.annotations[groupKey];
    const initialLen = list.length;
    appState.annotations[groupKey] = list.filter((a) => a.id !== id);
    if (appState.annotations[groupKey].length < initialLen) {
      deleted = true;
      break;
    }
  }
  return deleted;
}

/**
 * Retrieves all annotations associated with a specific slice / SOPInstanceUID.
 */
export function getAnnotationsForSlice(
  sopInstanceUid?: string,
  appState: AppState = state,
): Annotation[] {
  if (!appState.annotations) return [];
  const key = sopInstanceUid || getActiveSopInstanceUid(appState);
  return appState.annotations[key] ? [...appState.annotations[key]] : [];
}

/**
 * Clears annotations for a specific slice, or clears all annotations if no UID is specified.
 */
export function clearAnnotations(
  sopInstanceUid?: string,
  appState: AppState = state,
): void {
  if (!appState.annotations) {
    appState.annotations = {};
    return;
  }
  if (sopInstanceUid) {
    delete appState.annotations[sopInstanceUid];
  } else {
    appState.annotations = {};
  }
}

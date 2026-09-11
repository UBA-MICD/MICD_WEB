import type { ParsedDicom } from "../dicom/dicom-parser-util.js";
import type { ViewportState } from "../dicom/dicom-renderer.js";
export {
  WINDOW_PRESETS,
  type WindowPreset,
} from "../dicom/dicom-parser-util.js";

// ── State ────────────────────────────────────────────────────────────────────

export interface AppState {
  /** Where the current series comes from: local disk files or a server study. */
  source: "local" | "server";
  files: File[];
  /** Orthanc study id when source === 'server'. */
  serverStudyId: string | null;
  /** Ordered Orthanc instance ids when source === 'server'. */
  serverInstances: string[];
  currentIndex: number;
  parsed: ParsedDicom | null;
  viewport: ViewportState;
  activeTool: "wl" | "zoom" | "pan" | "crosshair" | "length" | "ellipse";
  /** Measurement annotations indexed by SOPInstanceUID (TK-26). */
  annotations: Record<string, import("./measurements/types.js").Annotation[]>;
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
  isMetadataOpen: boolean;
  isWlPanelOpen: boolean;
  isZoomPanelOpen: boolean;
  isMeasurementPanelOpen: boolean;
  /** Unit for calibrated physical measurements (TK-26). */
  measurementUnit: "mm" | "cm";
  /** Stroke width in pixels for measurement overlays (1 to 5) (TK-26). */
  measurementLineWidth: number;
  is3DMode: boolean;
  isMprMode?: boolean;
  /** Configured base URL for the PACS / Orthanc server (TK-29). */
  serverUrl: string;
  /** Validation record for the currently loaded server study, or null if none. */
  serverValidation: {
    validationId: number;
    status: string;
    validatedBy: string;
    validatedAt: string;
  } | null;
}

export const DEFAULT_SERVER_URL = "http://localhost:3000";
export const SERVER_URL_STORAGE_KEY = "micd_server_url";

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // blocked or security error
  }
  return null;
}

/** Reads the persisted server URL from localStorage or environment fallback. */
export function getStoredServerUrl(): string {
  const storage = getStorage();
  if (storage) {
    const stored =
      storage.getItem(SERVER_URL_STORAGE_KEY) ||
      storage.getItem("micd_api_origin");
    if (stored && typeof stored === "string" && stored.trim().length > 0) {
      return stored.trim().replace(/\/+$/, "");
    }
  }
  const globalOrigin = (globalThis as { MICD_API_ORIGIN?: string })
    .MICD_API_ORIGIN;
  if (typeof globalOrigin === "string" && globalOrigin.trim().length > 0) {
    return globalOrigin.trim().replace(/\/+$/, "");
  }
  return DEFAULT_SERVER_URL;
}

/** Persists the server URL to state and localStorage. */
export function persistServerUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, "");
  state.serverUrl = clean;
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(SERVER_URL_STORAGE_KEY, clean);
      storage.setItem("micd_api_origin", clean);
    } catch {
      // Ignore storage quota or access errors
    }
  }
  (globalThis as { MICD_API_ORIGIN?: string }).MICD_API_ORIGIN = clean;
}

export const state: AppState = {
  source: "local",
  files: [],
  serverStudyId: null,
  serverInstances: [],
  currentIndex: 0,
  parsed: null,
  viewport: { windowCenter: 0, windowWidth: 0, zoom: 1, panX: 0, panY: 0 },
  activeTool: "wl",
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  isMetadataOpen: false,
  isWlPanelOpen: false,
  isZoomPanelOpen: false,
  isMeasurementPanelOpen: false,
  measurementUnit: "mm",
  measurementLineWidth: 2,
  is3DMode: false,
  isMprMode: false,
  annotations: {},
  serverUrl: getStoredServerUrl(),
  serverValidation: null,
};

export function setMeasurementUnit(unit: "mm" | "cm"): void {
  state.measurementUnit = unit;
}

export function setMeasurementLineWidth(width: number): void {
  const numeric = Number(width);
  if (!isNaN(numeric)) {
    state.measurementLineWidth = Math.max(1, Math.min(5, Math.round(numeric)));
  }
}

export function setMeasurementPanelOpen(open: boolean): void {
  state.isMeasurementPanelOpen = open;
}

export {
  getActiveSopInstanceUid,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  getAnnotationsForSlice,
  clearAnnotations,
} from "./measurements/annotation-state.js";

/** Number of images in the current series, regardless of source. */
export function itemCount(): number {
  return state.source === "server"
    ? state.serverInstances.length
    : state.files.length;
}

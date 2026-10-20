import type { ParsedDicom } from "../dicom/dicom-parser-util.js";
import type { ViewportState } from "../dicom/dicom-renderer.js";
import { updateApiOrigin } from "../auth/auth.js";
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
  activeTool:
    "wl" | "zoom" | "pan" | "crosshair" | "length" | "ellipse" | "polygon";
  /** Measurement annotations indexed by SOPInstanceUID (TK-26). */
  annotations: Record<string, import("./measurements/types.js").Annotation[]>;
  /** Visibility toggle for all measurement overlays on slices (US-48). */
  areAnnotationsVisible: boolean;
  /** Visibility toggle for the value badges/labels (area, perimeter, "IA"…). */
  areLabelsVisible: boolean;
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
  /** Guard flag indicating a layout / WebGL transition is currently running. */
  isLayoutTransitioning?: boolean;
  /** Validation record for the currently loaded server study, or null if none. */
  serverValidation: {
    validationId: number;
    status: string;
    validatedBy: string;
    validatedAt: string;
  } | null;
  windowWidth?: number;
  windowCenter?: number;
}

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

/**
 * Sets the active server origin: updates the live resolved origin (auth.ts),
 * persists it to localStorage, and mirrors it to MICD_API_ORIGIN so a reload
 * re-resolves the same value. The one place the origin is written.
 */
export function persistServerUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, "");
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
  updateApiOrigin(clean);
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
  isLayoutTransitioning: false,
  annotations: {},
  areAnnotationsVisible: true,
  areLabelsVisible: true,
  serverValidation: null,
  get windowWidth(): number {
    return this.viewport.windowWidth;
  },
  set windowWidth(val: number) {
    this.viewport.windowWidth = val;
  },
  get windowCenter(): number {
    return this.viewport.windowCenter;
  },
  set windowCenter(val: number) {
    this.viewport.windowCenter = val;
  },
};

export function setAnnotationsVisible(visible: boolean): void {
  state.areAnnotationsVisible = visible;
}

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

/** Number of images in the current series, regardless of source. */
export function itemCount(): number {
  return state.source === "server"
    ? state.serverInstances.length
    : state.files.length;
}

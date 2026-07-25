import type { ParsedDicom } from "../dicom/dicom-parser-util.js";
import type { ViewportState } from "../dicom/dicom-renderer.js";

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
  activeTool: "wl" | "zoom" | "pan" | "crosshair";
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
  isMetadataOpen: boolean;
  is3DMode: boolean;
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
  is3DMode: false,
};

/** Number of images in the current series, regardless of source. */
export function itemCount(): number {
  return state.source === "server"
    ? state.serverInstances.length
    : state.files.length;
}

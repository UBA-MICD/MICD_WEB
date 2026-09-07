import {
  parseDicomFile,
  calculateAutoWindowLevel,
  ParsedDicom,
} from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { authFetch, API_BASE } from "../auth/auth.js";
import { collectDicomFiles } from "../shared/folder-files.js";
import { expandFiles } from "../upload/zip-expand.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { state } from "./state.js";
import { dicomCache } from "./cache.js";
import {
  render,
  updateMetadataPanel,
  updateSeriesNav,
  updateInfoOverlay,
} from "./rendering.js";
import { updateToolbarUI } from "./interaction.js";
import { t } from "../i18n/i18n.js";
import { notifyStudyLoaded, isValidationBarActive } from "./validation-ui.js";
import { fetchValidation } from "./validation-api.js";
import { fetchPrediction } from "./prediction-api.js";
import { notifyPredictionLoaded, clearMLView } from "./ml-view.js";
import { getViewportManager } from "./viewport-registry.js";

/**
 * Sorts DICOM files in ascending order by Instance Number (0020,0013).
 * Falls back to alphanumeric filename sorting when instance numbers are absent or identical.
 */
export async function sortFilesByInstanceNumber(
  files: File[],
): Promise<File[]> {
  if (files.length <= 1) return files;

  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseDicomFile(buffer);
        const instNum = parseInt(parsed.metadata.instanceNumber, 10);
        return { file, instanceNumber: isNaN(instNum) ? null : instNum };
      } catch {
        return { file, instanceNumber: null };
      }
    }),
  );

  entries.sort((a, b) => {
    if (a.instanceNumber !== null && b.instanceNumber !== null) {
      if (a.instanceNumber !== b.instanceNumber) {
        return a.instanceNumber - b.instanceNumber;
      }
    } else if (a.instanceNumber !== null) {
      return -1;
    } else if (b.instanceNumber !== null) {
      return 1;
    }
    return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
  });

  return entries.map((e) => e.file);
}

/** Load the image at state.currentIndex from whichever source is active. */
export async function loadCurrent(): Promise<void> {
  const index = state.currentIndex;
  const cached = dicomCache.get(index);

  if (cached) {
    state.parsed = cached;
    displayParsed(cached, getTitleForIndex(index));
    dicomCache.prefetchNext(index, 5);
    return;
  }

  showLoading(true);
  try {
    const parsed = await dicomCache.getOrFetch(index);
    if (!parsed) {
      showError(t("viewer.loadImageError", { index: index + 1 }));
      return;
    }
    state.parsed = parsed;
    displayParsed(parsed, getTitleForIndex(index));
    dicomCache.prefetchNext(index, 5);
  } catch (err: any) {
    showError(
      t("viewer.loadImageGenericError", { message: err.message || err }),
    );
  } finally {
    showLoading(false);
  }
}

function getTitleForIndex(index: number): string {
  if (state.source === "server") {
    return t("viewer.titleServerSlice", {
      study: state.serverStudyId || t("viewer.defaultStudyLabel"),
      index: index + 1,
    });
  }
  if (state.files.length > 0 && index < state.files.length) {
    return state.files[index].name;
  }
  return t("viewer.defaultTitle");
}

export function resetViewerToDropZone(): void {
  dicomCache.clear();
  state.source = "local";
  state.files = [];
  state.serverStudyId = null;
  state.serverInstances = [];
  state.currentIndex = 0;
  state.parsed = null;
  $("series-nav").classList.add("hidden");
  $("topbar-title").textContent = t("viewer.defaultTitle");
  $("topbar-title").title = "";
  // Otherwise the canvas keeps describing the study that is no longer shown.
  $("dicom-canvas").setAttribute("aria-label", t("viewer.canvasEmptyLabel"));
  updateToolbarUI();
  showDropZone();
  notifyStudyLoaded(null);
  clearMLView();
}

// ── Browser File Inputs ──────────────────────────────────────────────────────

export function initFileInputs(): void {
  // Single/multi file picker
  const filesInput = $("open-files-input") as HTMLInputElement;
  filesInput.addEventListener("change", async () => {
    if (!filesInput.files || filesInput.files.length === 0) return;
    const selected = Array.from(filesInput.files);
    filesInput.value = "";
    const { files: expanded } = await expandFiles(selected, null);
    const dcmFiles = collectDicomFiles(expanded);
    if (dcmFiles.length === 0) {
      showError(t("viewer.folderNoDicom"));
      return;
    }
    dicomCache.clear();

    const sortedFiles = await sortFilesByInstanceNumber(dcmFiles);

    const vp = getViewportManager()?.activeViewport ?? null;
    if (vp) {
      vp.data.source = "local";
      vp.data.files = sortedFiles;
      vp.data.currentIndex = 0;
      vp.data.viewport = {
        windowCenter: 0,
        windowWidth: 0,
        zoom: 0,
        panX: 0,
        panY: 0,
      };
    }

    // Keep global state in sync for loadCurrent() / series nav.
    state.source = "local";
    state.files = sortedFiles;
    state.currentIndex = 0;
    state.viewport = {
      windowCenter: 0,
      windowWidth: 0,
      zoom: 0,
      panX: 0,
      panY: 0,
    };
    await loadCurrent();
  });

  // Folder picker — loads every DICOM image in the folder so you can walk through them
  const folderInput = $("open-folder-input") as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.addEventListener("change", async () => {
    if (!folderInput.files || folderInput.files.length === 0) return;
    const dcmFiles = collectDicomFiles(Array.from(folderInput.files));
    if (dcmFiles.length === 0) {
      showError(t("viewer.folderNoDicom"));
      return;
    }
    dicomCache.clear();

    const sortedFiles = await sortFilesByInstanceNumber(dcmFiles);

    const vp = getViewportManager()?.activeViewport ?? null;
    if (vp) {
      vp.data.source = "local";
      vp.data.files = sortedFiles;
      vp.data.currentIndex = 0;
      vp.data.viewport = {
        windowCenter: 0,
        windowWidth: 0,
        zoom: 0,
        panX: 0,
        panY: 0,
      };
    }

    // Keep global state in sync for loadCurrent() / series nav.
    state.source = "local";
    state.files = sortedFiles;
    state.currentIndex = 0;
    state.viewport = {
      windowCenter: 0,
      windowWidth: 0,
      zoom: 0,
      panX: 0,
      panY: 0,
    };
    await loadCurrent();
    folderInput.value = "";
  });

  // "Open folder" button → opens the folder picker (webkitdirectory)
  $("btn-open-folder")?.addEventListener("click", openFolder);
}

// ── File Loading ─────────────────────────────────────────────────────────────

export function openFiles(): void {
  ($("open-files-input") as HTMLInputElement).click();
}

export function openFolder(): void {
  ($("open-folder-input") as HTMLInputElement).click();
}

export async function loadCurrentFile(): Promise<void> {
  await loadCurrent();
}

export async function loadCurrentServerInstance(): Promise<void> {
  await loadCurrent();
}

export async function loadStudyFromServer(studyId: string): Promise<void> {
  showLoading(true);
  dicomCache.clear();
  state.source = "server";
  state.serverStudyId = studyId;
  state.serverInstances = [];
  state.files = [];
  state.currentIndex = 0;
  state.viewport = {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 0,
    panX: 0,
    panY: 0,
  };

  try {
    const res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      instances: Array<{ instanceId: string }>;
    };
    state.serverInstances = (data.instances ?? []).map((i) => i.instanceId);
    if (state.serverInstances.length === 0) {
      showError(t("viewer.serverStudyNoImages"));
      return;
    }
    await loadCurrent();
    const [validationResult, predictionResult] = await Promise.all([
      fetchValidation(studyId),
      fetchPrediction(studyId),
    ]);
    notifyStudyLoaded(
      studyId,
      validationResult.ok ? validationResult.data : null,
    );
    // Only apply 1x2 ML layout when opened from the validations panel.
    notifyPredictionLoaded(
      predictionResult.ok ? predictionResult.data : null,
      isValidationBarActive(),
    );
  } catch (err: any) {
    showError(
      t("viewer.serverStudyLoadError", { message: err.message || err }),
    );
  } finally {
    showLoading(false);
  }
}

export function displayParsed(parsed: ParsedDicom, name: string): void {
  // Always keep global state in sync — loadCurrent() and other legacy paths
  // still read from it for series navigation, metadata panel, etc.
  state.parsed = parsed;

  if (!parsed.pixelData) {
    showError(t("viewer.noPixelsFound"));
    return;
  }

  const vp = getViewportManager()?.activeViewport ?? null;

  if (vp) {
    // ── Multi-viewport path ───────────────────────────────────────────────
    vp.data.parsed = parsed;
    // Keep server-study fields in sync so ml-view can mirror them to vp1.
    vp.data.source = state.source;
    vp.data.serverStudyId = state.serverStudyId;
    vp.data.serverInstances = state.serverInstances;
    vp.data.files = state.files;
    vp.data.currentIndex = state.currentIndex;

    // Preserve the user's W/L adjustments across slice navigations; only
    // initialize from metadata (or auto) when the viewport is fresh (zoom=0).
    if (vp.data.viewport.windowWidth <= 0) {
      if (parsed.metadata.windowWidth > 0) {
        vp.data.viewport = createDefaultViewport(parsed.metadata);
      } else {
        const auto = calculateAutoWindowLevel(
          parsed.pixelData,
          parsed.metadata.rescaleSlope,
          parsed.metadata.rescaleIntercept,
          parsed.metadata.modality,
        );
        vp.data.viewport = {
          windowCenter: auto.windowCenter,
          windowWidth: auto.windowWidth,
          zoom: 1,
          panX: 0,
          panY: 0,
        };
      }
    }

    // Also keep global viewport state consistent for W/L sliders, etc.
    state.viewport = { ...vp.data.viewport };

    vp.fitImage();
    vp.render();
  } else {
    // ── Legacy single-viewport path ───────────────────────────────────────
    if (state.viewport.windowWidth <= 0) {
      if (parsed.metadata.windowWidth > 0) {
        state.viewport = createDefaultViewport(parsed.metadata);
      } else {
        const auto = calculateAutoWindowLevel(
          parsed.pixelData,
          parsed.metadata.rescaleSlope,
          parsed.metadata.rescaleIntercept,
          parsed.metadata.modality,
        );
        state.viewport = {
          windowCenter: auto.windowCenter,
          windowWidth: auto.windowWidth,
          zoom: 1,
          panX: 0,
          panY: 0,
        };
      }
    }

    const container = $("viewport-container");
    if (state.viewport.zoom <= 0) {
      state.viewport.zoom = fitToContainer(
        container.clientWidth,
        container.clientHeight,
        parsed.metadata.columns,
        parsed.metadata.rows,
      );
    }

    render();
  }

  hideDropZone();
  updateMetadataPanel();
  updateSeriesNav();
  updateInfoOverlay();
  updateToolbarUI();

  $("topbar-title").textContent = name;
  $("topbar-title").title = name;
}

// ── Drop Zone ────────────────────────────────────────────────────────────────

export function initDropZone(): void {
  const dropZone = $("drop-zone");
  const container = $("viewport-container");

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    document.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  container.addEventListener("dragenter", () => {
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !dropZone.contains(related)) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("drop", async (e: DragEvent) => {
    dropZone.classList.remove("drag-over");
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const dcmFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.toLowerCase().endsWith(".dcm")) {
        dcmFiles.push(file);
      }
    }

    if (dcmFiles.length > 0) {
      dicomCache.clear();
      const sortedFiles = await sortFilesByInstanceNumber(dcmFiles);

      const vp = getViewportManager()?.activeViewport ?? null;
      if (vp) {
        vp.data.source = "local";
        vp.data.files = sortedFiles;
        vp.data.currentIndex = 0;
        vp.data.viewport = {
          windowCenter: 0,
          windowWidth: 0,
          zoom: 0,
          panX: 0,
          panY: 0,
        };
      }

      // Keep global state in sync for loadCurrent() / series nav.
      state.source = "local";
      state.files = sortedFiles;
      state.currentIndex = 0;
      state.viewport = {
        windowCenter: 0,
        windowWidth: 0,
        zoom: 0,
        panX: 0,
        panY: 0,
      };
      await loadCurrent();
    }
  });

  $("drop-zone-open").addEventListener("click", openFiles);
}

function hideDropZone(): void {
  $("drop-zone").classList.add("hidden");
}

function showDropZone(): void {
  $("drop-zone").classList.remove("hidden");
}

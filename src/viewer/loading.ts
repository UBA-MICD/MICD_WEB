import {
  parseDicomFile,
  calculateAutoWindowLevel,
  ParsedDicom,
} from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
  type ViewportState,
} from "../dicom/dicom-renderer.js";
import { StudyBuilder } from "../dicom/study-builder.js";
import { getCanonicalFlip } from "../dicom/spatial-math.js";
import { authFetch, API_BASE } from "../auth/auth.js";
import { fetchStudyInstances } from "../services/api.js";
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
import { updateToolbarUI, setViewportSync } from "./interaction.js";
import { t } from "../i18n/i18n.js";
import { notifyStudyLoaded, isValidationBarActive } from "./validation-ui.js";
import { fetchValidation } from "./validation-api.js";
import { fetchPrediction } from "./prediction-api.js";
import { notifyPredictionLoaded, clearMLView } from "./ml-view.js";
import { getViewportManager } from "./viewport-registry.js";
import { view3DViewer, buildVolumeFromCache } from "./view-3d.js";
import { mprEngine } from "./mpr-engine.js";
import { itemCount } from "./state.js";
import { loadFromLocalStorage } from "./measurements/annotation-state.js";

/** Serie cuyo W/L tiene cargado el visor legacy (sin ViewportManager). */
let legacyWlSeriesKey: string | null = null;

/** Builds and injects the 3D volume into ViewportManager, MPREngine, and View3DViewer. */
export async function loadVolumeIntoEngines(): Promise<boolean> {
  const count = itemCount();
  if (count <= 1) return false;
  try {
    const vol = await buildVolumeFromCache();
    if (vol) {
      const manager = getViewportManager();
      if (manager) {
        manager.setVolume(vol);
      } else {
        view3DViewer.setVolume(vol);
        mprEngine.loadVolume(vol);
      }
      return true;
    }
  } catch (err) {
    console.warn("Failed to load volume into engines:", err);
  }
  return false;
}

/**
 * Sorts DICOM files in ascending order by Instance Number (0020,0013).
 * Falls back to alphanumeric filename sorting when instance numbers are absent or identical.
 */
export async function sortFilesByInstanceNumber(
  files: File[],
): Promise<File[]> {
  if (files.length <= 1) return files;

  try {
    const study = await StudyBuilder.build(files);
    if (study.primarySeries && study.primarySeries.slices.length > 0) {
      return study.primarySeries.slices.map(
        (s) => s.file ?? new File([s.buffer], s.name),
      );
    }
  } catch (err) {
    console.warn("StudyBuilder sorting failed, falling back:", err);
  }

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
  state.is3DMode = false;
  state.isMprMode = false;
  view3DViewer.isActive = false;
  view3DViewer.volume = null;
  view3DViewer.stopRenderLoop();
  mprEngine.volume = null;
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

/**
 * Shared local-load path for the file picker, folder picker, and drop zone:
 * expand any .zip archives, keep only DICOM images (incl. extension-less PACS
 * exports), reset the viewport so the new study recomputes its window/level,
 * and display the first slice.
 */
async function loadLocalFiles(selected: File[]): Promise<void> {
  const { files: expanded } = await expandFiles(selected, null);
  const dcmFiles = collectDicomFiles(expanded);
  if (dcmFiles.length === 0) {
    showError(t("viewer.folderNoDicom"));
    return;
  }
  dicomCache.clear();

  const study = await StudyBuilder.build(dcmFiles);
  const primarySeries = study.primarySeries;
  const sortedFiles: File[] =
    primarySeries && primarySeries.slices.length > 0
      ? primarySeries.slices.map((s) => s.file ?? new File([s.buffer], s.name))
      : await sortFilesByInstanceNumber(dcmFiles);

  if (primarySeries) {
    primarySeries.slices.forEach((slice, idx) => {
      dicomCache.set(idx, slice.parsed);
    });
  }

  const freshViewport = {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 0,
    panX: 0,
    panY: 0,
  };

  const vp = getViewportManager()?.activeViewport ?? null;
  if (vp) {
    vp.data.source = "local";
    vp.data.files = sortedFiles;
    vp.data.currentIndex = 0;
    vp.data.viewport = { ...freshViewport };
  }

  // A new file set is a fresh comparison: viewport sync resets to off.
  setViewportSync(false);

  // Keep global state in sync for loadCurrent() / series nav.
  state.source = "local";
  state.files = sortedFiles;
  state.currentIndex = 0;
  state.viewport = { ...freshViewport };
  await loadCurrent();
  if (sortedFiles.length > 1) {
    void loadVolumeIntoEngines();
  }
}

export function initFileInputs(): void {
  // Single/multi file picker
  const filesInput = $("open-files-input") as HTMLInputElement;
  filesInput.addEventListener("change", async () => {
    if (!filesInput.files || filesInput.files.length === 0) return;
    const selected = Array.from(filesInput.files);
    filesInput.value = "";
    await loadLocalFiles(selected);
  });

  // Folder picker — loads every DICOM image in the folder so you can walk through them
  const folderInput = $("open-folder-input") as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.addEventListener("change", async () => {
    if (!folderInput.files || folderInput.files.length === 0) return;
    const selected = Array.from(folderInput.files);
    await loadLocalFiles(selected);
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

  // Reset the active viewport too. Otherwise displayParsed() preserves the
  // previous study's window/level/zoom (it only recomputes when windowWidth<=0),
  // so a freshly opened server study — including the comparative validation
  // view — would inherit the last study's settings. Mirrors the local paths.
  const activeVp = getViewportManager()?.activeViewport ?? null;
  if (activeVp) {
    activeVp.data.viewport = {
      windowCenter: 0,
      windowWidth: 0,
      zoom: 0,
      panX: 0,
      panY: 0,
    };
  }

  // Opening a different study resets viewport sync to off.
  setViewportSync(false);

  try {
    const res = await fetchStudyInstances(studyId);
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
    if (state.serverInstances.length > 1) {
      void loadVolumeIntoEngines();
    }
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

/**
 * Identifica la serie a la que pertenece el window/level de un viewport.
 *
 * Se usa para decidir cuándo reiniciar el brillo/contraste: conservarlo al
 * cambiar de corte dentro de la misma serie es deliberado (si no, cada scroll
 * pisaría el ajuste del usuario), pero conservarlo al abrir OTRO estudio deja
 * la ventana del anterior — y una ventana de HU ajena hace que la imagen nueva
 * se vea negra o quemada.
 */
export function seriesKeyFor(parsed: ParsedDicom): string {
  const m = parsed.metadata;
  return (
    m.seriesInstanceUid ||
    `${m.studyInstanceUid}|${m.seriesNumber}|${m.modality}|${m.rows}x${m.columns}`
  );
}

/** Ventana inicial de una imagen: la del DICOM, o uno automático si no trae. */
export function initialViewportFor(parsed: ParsedDicom): ViewportState {
  if (parsed.metadata.windowWidth > 0) {
    return createDefaultViewport(parsed.metadata);
  }
  const auto = calculateAutoWindowLevel(
    parsed.pixelData!,
    parsed.metadata.rescaleSlope,
    parsed.metadata.rescaleIntercept,
    parsed.metadata.modality,
  );
  const { flipX, flipY } = getCanonicalFlip(
    parsed.metadata.imageOrientationPatient,
  );
  const vp: ViewportState = {
    windowCenter: auto.windowCenter,
    windowWidth: auto.windowWidth,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  if (flipX) vp.flipX = true;
  if (flipY) vp.flipY = true;
  return vp;
}

export function displayParsed(parsed: ParsedDicom, name: string): void {
  // Always keep global state in sync — loadCurrent() and other legacy paths
  // still read from it for series navigation, metadata panel, etc.
  state.parsed = parsed;

  if (!parsed.pixelData) {
    showError(t("viewer.noPixelsFound"));
    return;
  }

  const sopInstanceUid =
    parsed.metadata.sopInstanceUid || `slice_${state.currentIndex}`;
  loadFromLocalStorage(sopInstanceUid);

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

    // Preserve the user's W/L adjustments across slice navigations, but reset
    // it whenever a different series is opened: inheriting the previous
    // study's window is what rendered a freshly-opened image black.
    const seriesKey = seriesKeyFor(parsed);
    if (
      vp.data.viewport.windowWidth <= 0 ||
      vp.data.wlSeriesKey !== seriesKey
    ) {
      vp.data.viewport = initialViewportFor(parsed);
    } else {
      const { flipX, flipY } = getCanonicalFlip(
        parsed.metadata.imageOrientationPatient,
      );
      vp.data.viewport.flipX = flipX;
      vp.data.viewport.flipY = flipY;
    }
    vp.data.wlSeriesKey = seriesKey;

    // Also keep global viewport state consistent for W/L sliders, etc.
    state.viewport = { ...vp.data.viewport };

    vp.fitImage();
    vp.render();
  } else {
    // ── Legacy single-viewport path ───────────────────────────────────────
    const legacyKey = seriesKeyFor(parsed);
    if (state.viewport.windowWidth <= 0 || legacyWlSeriesKey !== legacyKey) {
      state.viewport = initialViewportFor(parsed);
    } else {
      const { flipX, flipY } = getCanonicalFlip(
        parsed.metadata.imageOrientationPatient,
      );
      state.viewport.flipX = flipX;
      state.viewport.flipY = flipY;
    }
    legacyWlSeriesKey = legacyKey;

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

  // US-45: the AI segmentation lives only on the derived (right) viewport of the
  // comparison, seeded by segmentation-ui. We deliberately do NOT reload it onto
  // the original (left) image here — keying it to the real SOP UID made it show
  // on both panels (and, since the mock reshapes each run, as two different
  // blobs that looked mirrored). Persisting across slices belongs to the
  // single-viewport unification (see reloadSegmentationForInstance, kept unused).
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
    // Same path as the file/folder pickers: expand .zip archives and keep
    // extension-less PACS exports, not just literal *.dcm files.
    await loadLocalFiles(Array.from(files));
  });

  $("drop-zone-open").addEventListener("click", openFiles);
}

function hideDropZone(): void {
  $("drop-zone").classList.add("hidden");
}

function showDropZone(): void {
  $("drop-zone").classList.remove("hidden");
}

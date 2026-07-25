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
import { $, showLoading, showError } from "../shared/dom.js";
import { state } from "./state.js";
import { dicomCache } from "./cache.js";
import {
  render,
  updateMetadataPanel,
  updateSeriesNav,
  updateInfoOverlay,
} from "./rendering.js";

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
      showError(`No se pudo cargar la imagen en el índice ${index + 1}`);
      return;
    }
    state.parsed = parsed;
    displayParsed(parsed, getTitleForIndex(index));
    dicomCache.prefetchNext(index, 5);
  } catch (err: any) {
    showError(`Error al cargar la imagen: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
}

function getTitleForIndex(index: number): string {
  if (state.source === "server") {
    return `${state.serverStudyId || "Estudio"} — Corte ${index + 1}`;
  }
  if (state.files.length > 0 && index < state.files.length) {
    return state.files[index].name;
  }
  return "DICOM Viewer";
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
  $("topbar-title").textContent = "DICOM Viewer";
  $("topbar-title").title = "";
  showDropZone();
}

// ── Browser File Inputs ──────────────────────────────────────────────────────

export function initFileInputs(): void {
  // Single/multi file picker
  const filesInput = $("open-files-input") as HTMLInputElement;
  filesInput.addEventListener("change", async () => {
    if (!filesInput.files || filesInput.files.length === 0) return;
    dicomCache.clear();
    state.files = collectDicomFiles(Array.from(filesInput.files));
    state.currentIndex = 0;
    await loadCurrent();
    filesInput.value = "";
  });

  // Folder picker — loads every DICOM image in the folder so you can walk through them
  const folderInput = $("open-folder-input") as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.addEventListener("change", async () => {
    if (!folderInput.files || folderInput.files.length === 0) return;
    const dcmFiles = collectDicomFiles(Array.from(folderInput.files));
    if (dcmFiles.length === 0) {
      showError("No se encontraron archivos DICOM en la carpeta seleccionada.");
      return;
    }
    dicomCache.clear();
    state.files = dcmFiles;
    state.currentIndex = 0;
    await loadCurrent();
    folderInput.value = "";
  });

  // "Abrir carpeta" button → opens the folder picker (webkitdirectory)
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
      showError("El estudio no tiene imágenes.");
      return;
    }
    await loadCurrent();
  } catch (err: any) {
    showError(`Error al cargar el estudio del servidor: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
}

export function displayParsed(parsed: ParsedDicom, name: string): void {
  state.parsed = parsed;

  if (!parsed.pixelData) {
    showError(
      "No pixel data found. The file may use compressed transfer syntax.",
    );
    return;
  }

  // Preserve existing window width / center if user adjusted them, otherwise use metadata/auto
  if (state.viewport.windowWidth <= 0) {
    if (parsed.metadata.windowWidth > 0) {
      state.viewport = createDefaultViewport(parsed.metadata);
    } else {
      const auto = calculateAutoWindowLevel(
        parsed.pixelData,
        parsed.metadata.rescaleSlope,
        parsed.metadata.rescaleIntercept,
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
  if (state.viewport.zoom <= 0 || state.currentIndex === 0) {
    state.viewport.zoom = fitToContainer(
      container.clientWidth,
      container.clientHeight,
      parsed.metadata.columns,
      parsed.metadata.rows,
    );
  }

  hideDropZone();
  render();
  updateMetadataPanel();
  updateSeriesNav();
  updateInfoOverlay();

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
      state.files = dcmFiles.sort((a, b) => a.name.localeCompare(b.name));
      state.currentIndex = 0;
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

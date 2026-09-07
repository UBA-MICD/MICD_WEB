import {
  calculateAutoWindowLevel,
  parseDicomFile,
  WINDOW_PRESETS,
} from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { anyDialogOpen, openDialog, closeDialog } from "../shared/dialog.js";
import { currentScreen } from "../shared/screen.js";
import { state, itemCount } from "./state.js";
import {
  render,
  updateSeriesNav,
  updateWlControlsUI,
  hide3DControls,
  update3DControls,
} from "./rendering.js";
import {
  loadCurrent,
  openFiles,
  openFolder,
  sortFilesByInstanceNumber,
  loadVolumeIntoEngines,
} from "./loading.js";
import { view3DViewer } from "./view-3d.js";
import { mprEngine } from "./mpr-engine.js";
import { t } from "../i18n/i18n.js";
import {
  exportCurrentViewToPNG,
  exportCurrentStudyAsZip,
} from "../services/export-service.js";
import { openServerScreen } from "../server-screen/server-screen.js";
import { getViewportManager } from "./viewport-registry.js";
import type { GridLayout } from "./viewport-manager.js";

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function initToolbar(): void {
  const tools = ["wl", "zoom", "pan", "crosshair"] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    if (btn) {
      btn.addEventListener("click", () => {
        if (tool === "pan" && state.is3DMode) return;
        if (tool === "crosshair" && !state.is3DMode && !mprEngine.volume)
          return;
        if (tool === "wl") {
          if (state.activeTool === "wl") {
            state.isWlPanelOpen = !state.isWlPanelOpen;
          } else {
            state.activeTool = "wl";
            state.isWlPanelOpen = true;
          }
          state.isZoomPanelOpen = false;
        } else if (tool === "zoom") {
          if (state.activeTool === "zoom") {
            state.isZoomPanelOpen = !state.isZoomPanelOpen;
          } else {
            state.activeTool = "zoom";
            state.isZoomPanelOpen = true;
          }
          state.isWlPanelOpen = false;
        } else {
          state.activeTool = tool;
          state.isWlPanelOpen = false;
          state.isZoomPanelOpen = false;
        }
        updateToolbarUI();
      });
    }
  });

  $("tool-reset").addEventListener("click", () => {
    if (!state.parsed) return;
    const container = $("viewport-container");
    if (state.parsed.metadata.windowWidth > 0) {
      state.viewport = createDefaultViewport(state.parsed.metadata);
    } else if (state.parsed.pixelData) {
      const auto = calculateAutoWindowLevel(
        state.parsed.pixelData,
        state.parsed.metadata.rescaleSlope,
        state.parsed.metadata.rescaleIntercept,
        state.parsed.metadata.modality,
      );
      state.viewport = {
        windowCenter: auto.windowCenter,
        windowWidth: auto.windowWidth,
        zoom: 1,
        panX: 0,
        panY: 0,
      };
    }
    state.viewport.zoom = fitToContainer(
      container.clientWidth,
      container.clientHeight,
      state.parsed.metadata.columns,
      state.parsed.metadata.rows,
    );

    if (state.is3DMode) {
      view3DViewer.resetCamera();
    }

    updateZoomControlsUI();
    render();
  });

  $("tool-metadata").addEventListener("click", () => {
    state.isMetadataOpen = !state.isMetadataOpen;
    $("metadata-panel").classList.toggle("open", state.isMetadataOpen);
    $("tool-metadata").classList.toggle("active", state.isMetadataOpen);
    $("tool-metadata").setAttribute(
      "aria-expanded",
      String(state.isMetadataOpen),
    );
  });

  $("tool-layers")?.addEventListener("click", () => {
    const popover = $("popover-layers");
    if (popover) {
      const isHidden = popover.classList.toggle("hidden");
      $("tool-layers")?.classList.toggle("active", !isHidden);
      $("tool-layers")?.setAttribute("aria-expanded", String(!isHidden));
    }
  });

  $("tool-view-3d")?.addEventListener("click", () => void toggle3DMode());
  $("tool-mpr")?.addEventListener("click", () => void toggleMprMode());

  $("btn-open").addEventListener("click", openFiles);

  $("btn-export-menu")?.addEventListener("click", () => {
    openDialog($("export-dialog"));
  });

  $("btn-export-dialog-png")?.addEventListener("click", () => {
    closeDialog($("export-dialog"));
    void exportCurrentViewToPNG();
  });

  $("btn-export-dialog-zip")?.addEventListener("click", () => {
    closeDialog($("export-dialog"));
    void exportCurrentStudyAsZip();
  });

  $("export-dialog-cancel")?.addEventListener("click", () => {
    closeDialog($("export-dialog"));
  });

  initWlControlsInteraction();
  initZoomControlsInteraction();
  init3DControlsInteraction();
  initLayerControlsInteraction();
  updateToolbarUI();
}

function initLayerControlsInteraction(): void {
  const btnLoadLayer = $("btn-load-layer");
  const inputLayerFile = $("input-layer-file") as HTMLInputElement | null;
  const sliderLayerWW = $("slider-layer-ww") as HTMLInputElement | null;
  const sliderLayerWL = $("slider-layer-wl") as HTMLInputElement | null;

  btnLoadLayer?.addEventListener("click", () => {
    inputLayerFile?.click();
  });

  inputLayerFile?.addEventListener("change", async () => {
    const rawFiles = Array.from(inputLayerFile.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith(".dcm"),
    );
    if (rawFiles.length === 0) return;

    try {
      const sortedFiles = await sortFilesByInstanceNumber(rawFiles);
      const buffer = await sortedFiles[0].arrayBuffer();
      const parsed = parseDicomFile(buffer);

      const manager = getViewportManager();
      const activeVp = manager?.activeViewport;
      if (!activeVp) return;

      const overlayViewport = {
        windowCenter: parsed.metadata.windowCenter,
        windowWidth: parsed.metadata.windowWidth || 400,
        zoom: 1,
        panX: 0,
        panY: 0,
      };

      activeVp.data.overlay = {
        files: sortedFiles,
        parsed,
        viewport: overlayViewport,
      };

      if (sliderLayerWW) {
        sliderLayerWW.value = String(overlayViewport.windowWidth);
      }
      if (sliderLayerWL) {
        sliderLayerWL.value = String(overlayViewport.windowCenter);
      }

      activeVp.render();
      render();
    } catch (err) {
      console.error("Error loading overlay layer:", err);
    }
  });

  sliderLayerWW?.addEventListener("input", () => {
    const val = parseFloat(sliderLayerWW.value);
    if (isNaN(val)) return;
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport;
    if (activeVp?.data.overlay) {
      activeVp.data.overlay.viewport.windowWidth = Math.max(1, val);
      activeVp.render();
      render();
    }
  });

  sliderLayerWL?.addEventListener("input", () => {
    const val = parseFloat(sliderLayerWL.value);
    if (isNaN(val)) return;
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport;
    if (activeVp?.data.overlay) {
      activeVp.data.overlay.viewport.windowCenter = val;
      activeVp.render();
      render();
    }
  });
}

function initWlControlsInteraction(): void {
  const sliderWW = $("slider-ww") as HTMLInputElement | null;
  const sliderWL = $("slider-wl") as HTMLInputElement | null;
  const sliderOpacity = $("slider-opacity") as HTMLInputElement | null;

  if (sliderOpacity) {
    sliderOpacity.addEventListener("input", () => {
      const val = parseFloat(sliderOpacity.value);
      if (isNaN(val)) return;
      const manager = getViewportManager();
      const vp = manager?.activeViewport;
      if (vp && manager) {
        vp.data.viewport.layerOpacity = val;
        state.viewport.layerOpacity = val;
        vp.render();
        if (manager.isSynchronized) {
          for (const otherVp of manager.getAllViewports()) {
            if (otherVp.id !== vp.id) {
              otherVp.data.viewport.layerOpacity = val;
              otherVp.render();
            }
          }
        }
      } else {
        state.viewport.layerOpacity = val;
        render();
      }
    });
  }

  if (sliderWW) {
    sliderWW.addEventListener("input", () => {
      const val = parseFloat(sliderWW.value);
      if (isNaN(val)) return;
      const manager = getViewportManager();
      const vp = manager?.activeViewport;
      if (vp && manager) {
        vp.data.viewport.windowWidth = Math.max(1, val);
        state.viewport.windowWidth = vp.data.viewport.windowWidth;
        vp.render();
        if (manager.isSynchronized) {
          for (const otherVp of manager.getAllViewports()) {
            if (otherVp.id !== vp.id) {
              otherVp.data.viewport.windowWidth = Math.max(1, val);
              otherVp.render();
            }
          }
        }
      } else {
        state.viewport.windowWidth = Math.max(1, val);
        render();
      }
    });
  }

  if (sliderWL) {
    sliderWL.addEventListener("input", () => {
      const val = parseFloat(sliderWL.value);
      if (isNaN(val)) return;
      const manager = getViewportManager();
      const vp = manager?.activeViewport;
      if (vp && manager) {
        vp.data.viewport.windowCenter = val;
        state.viewport.windowCenter = val;
        vp.render();
        if (manager.isSynchronized) {
          for (const otherVp of manager.getAllViewports()) {
            if (otherVp.id !== vp.id) {
              otherVp.data.viewport.windowCenter = val;
              otherVp.render();
            }
          }
        }
      } else {
        state.viewport.windowCenter = val;
        render();
      }
    });
  }

  const presets = ["lung", "bone", "soft", "brain"] as const;
  const presetMap: Record<string, keyof typeof WINDOW_PRESETS> = {
    lung: "lung",
    bone: "bone",
    soft: "softTissue",
    brain: "brain",
  };

  presets.forEach((key) => {
    const btn = $(`btn-preset-${key}`);
    if (btn) {
      btn.addEventListener("click", () => {
        const presetKey = presetMap[key];
        const preset = WINDOW_PRESETS[presetKey];
        if (preset) {
          state.viewport.windowCenter = preset.windowCenter;
          state.viewport.windowWidth = preset.windowWidth;
          render();
        }
      });
    }
  });
}

function initZoomControlsInteraction(): void {
  const sliderZoom = $("slider-zoom") as HTMLInputElement | null;
  if (sliderZoom) {
    sliderZoom.addEventListener("input", () => {
      const val = parseFloat(sliderZoom.value);
      if (!isNaN(val)) {
        if (state.is3DMode) {
          view3DViewer.camera.zoom = Math.max(0.1, Math.min(5.0, val));
        } else {
          state.viewport.zoom = Math.max(0.1, Math.min(5.0, val));
        }
        const valZoom = $("val-zoom");
        if (valZoom) {
          valZoom.textContent = `${val.toFixed(1)}x`;
        }
        render();
      }
    });
  }

  $("btn-zoom-fit")?.addEventListener("click", () => {
    if (state.parsed) {
      const container = $("viewport-container");
      const fitZoom = fitToContainer(
        container.clientWidth,
        container.clientHeight,
        state.parsed.metadata.columns,
        state.parsed.metadata.rows,
      );
      if (state.is3DMode) {
        view3DViewer.camera.zoom = 1;
        render();
      } else {
        const manager = getViewportManager();
        const vp = manager?.activeViewport;
        if (vp && manager) {
          vp.data.viewport.zoom = fitZoom;
          vp.data.viewport.panX = 0;
          vp.data.viewport.panY = 0;
          state.viewport.zoom = fitZoom;
          state.viewport.panX = 0;
          state.viewport.panY = 0;
          vp.render();
          if (manager.isSynchronized) {
            for (const otherVp of manager.getAllViewports()) {
              if (otherVp.id !== vp.id) {
                otherVp.data.viewport.zoom = fitZoom;
                otherVp.data.viewport.panX = 0;
                otherVp.data.viewport.panY = 0;
                otherVp.render();
              }
            }
          }
        } else {
          state.viewport.zoom = fitZoom;
          state.viewport.panX = 0;
          state.viewport.panY = 0;
          render();
        }
      }
    } else {
      if (state.is3DMode) {
        view3DViewer.camera.zoom = 1;
        render();
      } else {
        const manager = getViewportManager();
        const vp = manager?.activeViewport;
        if (vp && manager) {
          vp.data.viewport.zoom = 1;
          state.viewport.zoom = 1;
          vp.render();
          if (manager.isSynchronized) {
            for (const otherVp of manager.getAllViewports()) {
              if (otherVp.id !== vp.id) {
                otherVp.data.viewport.zoom = 1;
                otherVp.render();
              }
            }
          }
        } else {
          state.viewport.zoom = 1;
          render();
        }
      }
    }
    updateZoomControlsUI();
  });

  $("btn-zoom-100")?.addEventListener("click", () => {
    if (state.is3DMode) {
      view3DViewer.camera.zoom = 1;
      render();
    } else {
      const manager = getViewportManager();
      const vp = manager?.activeViewport;
      if (vp && manager) {
        vp.data.viewport.zoom = 1;
        state.viewport.zoom = 1;
        vp.render();
        if (manager.isSynchronized) {
          for (const otherVp of manager.getAllViewports()) {
            if (otherVp.id !== vp.id) {
              otherVp.data.viewport.zoom = 1;
              otherVp.render();
            }
          }
        }
      } else {
        state.viewport.zoom = 1;
        render();
      }
    }
    updateZoomControlsUI();
  });

  $("btn-zoom-200")?.addEventListener("click", () => {
    if (state.is3DMode) {
      view3DViewer.camera.zoom = 2;
      render();
    } else {
      const manager = getViewportManager();
      const vp = manager?.activeViewport;
      if (vp && manager) {
        vp.data.viewport.zoom = 2;
        state.viewport.zoom = 2;
        vp.render();
        if (manager.isSynchronized) {
          for (const otherVp of manager.getAllViewports()) {
            if (otherVp.id !== vp.id) {
              otherVp.data.viewport.zoom = 2;
              otherVp.render();
            }
          }
        }
      } else {
        state.viewport.zoom = 2;
        render();
      }
    }
    updateZoomControlsUI();
  });
}

function updateZoomControlsUI(): void {
  const currentZoom = state.is3DMode
    ? view3DViewer.camera.zoom
    : state.viewport.zoom;
  const sliderZoom = $("slider-zoom") as HTMLInputElement | null;
  if (sliderZoom && document.activeElement !== sliderZoom) {
    sliderZoom.value = String(Math.max(0.1, Math.min(5.0, currentZoom)));
  }
  const valZoom = $("val-zoom");
  if (valZoom) {
    valZoom.textContent = `${currentZoom.toFixed(1)}x`;
  }
}

export async function toggle3DMode(): Promise<boolean> {
  const btn = ($("tool-view-3d") || $("tool-mpr")) as HTMLButtonElement | null;
  if (btn?.disabled) return false;

  const count = itemCount();
  if (count <= 1 && !view3DViewer.volume) {
    showError(
      t("viewer.view3d.needTwoSlices") ||
        t("viewer.mpr.needTwoSlices") ||
        "Se requieren al menos 2 cortes",
    );
    return false;
  }

  if (state.is3DMode) {
    state.is3DMode = false;
    view3DViewer.isActive = false;
    view3DViewer.stopRenderLoop();
    $("view-3d-container")?.classList.add("hidden");
    $("viewport-container")?.classList.remove("mode-3d");
    hide3DControls();
    updateToolbarUI();
    render();
    return false;
  }

  if (state.isMprMode) {
    state.isMprMode = false;
  }

  showLoading(true);
  try {
    if (!view3DViewer.volume) {
      await loadVolumeIntoEngines();
    }
    if (!view3DViewer.volume) {
      const ok = await view3DViewer.toggle3DMode();
      if (!ok) return false;
    } else {
      view3DViewer.isActive = true;
      state.is3DMode = true;
    }

    $("viewport-container")?.classList.add("mode-3d");
    $("view-3d-container")?.classList.remove("hidden");
    update3DControls();
    update3DSlidersUI();
    updateToolbarUI();

    const canvas =
      (document.getElementById("view-3d-canvas") as HTMLCanvasElement) ||
      (document.getElementById("dicom-canvas") as HTMLCanvasElement);
    if (canvas) {
      view3DViewer.resize(canvas);
      view3DViewer.render(canvas);
      view3DViewer.startRenderLoop(canvas);
    }
    return true;
  } catch (err: any) {
    showError(err.message || String(err));
    return false;
  } finally {
    showLoading(false);
  }
}

export async function toggleMprMode(): Promise<boolean> {
  const btn = $("tool-mpr") as HTMLButtonElement | null;
  if (btn?.disabled) return false;

  const count = itemCount();
  if (count <= 1 && !mprEngine.volume) {
    showError(
      t("viewer.mpr.needTwoSlices") ||
        "Se requieren al menos 2 cortes para MPR",
    );
    return false;
  }

  // Deactivate 3D mode if active
  if (state.is3DMode) {
    state.is3DMode = false;
    view3DViewer.isActive = false;
    view3DViewer.stopRenderLoop();
    $("view-3d-container")?.classList.add("hidden");
    $("viewport-container")?.classList.remove("mode-3d");
    hide3DControls();
  }

  const manager = getViewportManager();
  if (state.isMprMode) {
    state.isMprMode = false;
    manager?.setLayout("1x1");
    updateToolbarUI();
    render();
    return false;
  }

  showLoading(true);
  try {
    if (!mprEngine.volume) {
      await loadVolumeIntoEngines();
    }
    if (!mprEngine.volume) {
      throw new Error("No se pudo reconstruir el volumen 3D para MPR.");
    }

    state.isMprMode = true;
    state.activeTool = "crosshair";

    // Set 2x2 triplanar layout
    manager?.setLayout("2x2");
    manager?.getAllViewports().forEach((vp) => vp.render());

    updateToolbarUI();
    return true;
  } catch (err: any) {
    showError(err.message || String(err));
    return false;
  } finally {
    showLoading(false);
  }
}

export function updateToolbarUI(): void {
  if (state.is3DMode && state.activeTool === "pan") {
    state.activeTool = "wl";
  } else if (
    !state.is3DMode &&
    !mprEngine.volume &&
    state.activeTool === "crosshair"
  ) {
    state.activeTool = "wl";
  }

  const panBtn = $("tool-pan") as HTMLButtonElement | null;
  if (panBtn) {
    panBtn.disabled = state.is3DMode;
  }

  const crosshairBtn = $("tool-crosshair") as HTMLButtonElement | null;
  if (crosshairBtn) {
    crosshairBtn.disabled = !state.is3DMode && !mprEngine.volume;
  }

  const view3dBtn = $("tool-view-3d") as HTMLButtonElement | null;
  if (view3dBtn) {
    view3dBtn.classList.toggle("active", Boolean(state.is3DMode));
    view3dBtn.setAttribute("aria-pressed", String(Boolean(state.is3DMode)));
  }

  const mprBtn = $("tool-mpr") as HTMLButtonElement | null;
  if (mprBtn) {
    mprBtn.classList.toggle("active", Boolean(state.isMprMode));
    mprBtn.setAttribute("aria-pressed", String(Boolean(state.isMprMode)));
  }

  // Only mode tools are mutually exclusive. Clearing every .toolbar__tool
  // would also strip the metadata toggle's state, leaving its class and
  // aria-expanded disagreeing with the open panel.
  (["wl", "zoom", "pan", "crosshair"] as const).forEach((tool) => {
    const btn = $(`tool-${tool}`) as HTMLButtonElement | null;
    if (!btn) return;
    const isActive = tool === state.activeTool;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const wlBtn = $("tool-wl");
  if (wlBtn) {
    wlBtn.setAttribute("aria-expanded", String(state.isWlPanelOpen));
  }

  const wlPanel = $("wl-panel");
  if (wlPanel) {
    wlPanel.classList.toggle("open", state.isWlPanelOpen);
  }

  const zoomBtn = $("tool-zoom");
  if (zoomBtn) {
    zoomBtn.setAttribute("aria-expanded", String(state.isZoomPanelOpen));
  }

  const zoomPanel = $("zoom-panel");
  if (zoomPanel) {
    zoomPanel.classList.toggle("open", state.isZoomPanelOpen);
  }

  const exportBtn = $("btn-export-menu") as HTMLButtonElement | null;
  if (exportBtn) {
    const hasLoadedStudy = itemCount() > 0 || state.parsed !== null;
    exportBtn.disabled = !hasLoadedStudy;
  }

  const viewport = $("viewport-container");
  if (viewport) {
    if (viewport.classList?.remove) {
      viewport.classList.remove(
        "cursor-wl",
        "cursor-zoom",
        "cursor-pan",
        "cursor-crosshair",
      );
    }
    viewport.classList?.add?.(`cursor-${state.activeTool}`);
    viewport.classList?.toggle?.("mode-3d", state.is3DMode);
  }

  updateZoomControlsUI();
}

// ── Viewport Mouse Interaction ───────────────────────────────────────────────

export function initViewportInteraction(): void {
  const container = $("viewport-container");

  if (typeof window !== "undefined") {
    window.addEventListener("viewport-changed", () => {
      const manager = getViewportManager();
      const activeVp = manager?.activeViewport;
      if (activeVp) {
        state.viewport = { ...activeVp.data.viewport };
        updateZoomControlsUI();
        updateWlControlsUI();
      }
    });
  }

  let dragOriginViewportId: string | null = null;

  const handlePointerAction = (e: MouseEvent) => {
    if (!state.parsed) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (mprEngine.volume && state.activeTool === "crosshair") {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      if (manager && manager.isCombined3DViewport(originId)) {
        return;
      }
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;
      const plane = activeVp?.plane || "axial";
      const w =
        activeVp?.canvasElement.clientWidth || container.clientWidth || 300;
      const h =
        activeVp?.canvasElement.clientHeight || container.clientHeight || 300;

      mprEngine.setCrosshairFromScreen(plane, clickX, clickY, w, h);
      if (manager) {
        for (const vp of manager.getAllViewports()) {
          vp.render();
        }
      } else {
        render();
      }
      return;
    }

    if (state.is3DMode && state.activeTool === "crosshair") {
      view3DViewer.updateCrosshairFromPointer(
        clickX,
        clickY,
        container.clientWidth,
        container.clientHeight,
      );
      render();
    }
  };

  container.addEventListener("mousedown", (e: MouseEvent) => {
    if (!state.parsed) return;
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

    const cell = (e.target as HTMLElement | null)?.closest?.(".viewport-cell");
    dragOriginViewportId = cell
      ? cell.id
      : (getViewportManager()?.activeViewport?.id ?? null);

    handlePointerAction(e);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!state.isDragging || !state.parsed) return;

    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

    if (state.is3DMode && state.isDragging) {
      if (state.activeTool === "pan") {
        view3DViewer.camera.panX += dx;
        view3DViewer.camera.panY += dy;
      } else if (state.activeTool === "zoom") {
        view3DViewer.camera.zoom = Math.max(
          0.1,
          Math.min(10, view3DViewer.camera.zoom * (1 - dy * 0.005)),
        );
      } else if (state.activeTool === "wl") {
        state.viewport.windowWidth = Math.max(
          1,
          state.viewport.windowWidth + dx * 2,
        );
        state.viewport.windowCenter += dy * 2;
      } else {
        // Priority 3D Orbit Controls (Rotate Camera)
        const sensitivity = 0.01;
        const movementX = e.movementX ?? dx;
        const movementY = e.movementY ?? dy;

        view3DViewer.camera.phi += movementX * sensitivity;
        view3DViewer.camera.theta = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(
            Math.PI / 2 - 0.1,
            view3DViewer.camera.theta + movementY * sensitivity,
          ),
        );
        if (state.activeTool === "crosshair") {
          handlePointerAction(e);
        }
      }
      const canvas = (document.getElementById("view-3d-canvas") ||
        document.getElementById("dicom-canvas")) as HTMLCanvasElement;
      if (state.is3DMode && canvas) {
        view3DViewer.render(canvas);
      } else {
        render();
      }
      return;
    }

    // ── 2D / MPR tools: route through ViewportManager so sync propagates ──
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport ?? null;

    if (activeVp && manager) {
      switch (state.activeTool) {
        case "wl":
          manager.dispatchWindowLevel(activeVp.id, dx * 2, dy * 2);
          // Mirror into global state so W/L sliders stay in sync.
          state.viewport.windowWidth = activeVp.data.viewport.windowWidth;
          state.viewport.windowCenter = activeVp.data.viewport.windowCenter;
          break;
        case "zoom":
          manager.dispatchZoom(activeVp.id, 1 - dy * 0.005);
          state.viewport.zoom = activeVp.data.viewport.zoom;
          break;
        case "pan":
          if (mprEngine.volume) {
            manager.dispatchMprPan(
              activeVp.id,
              dx,
              dy,
              activeVp.canvasElement.clientWidth ||
                container.clientWidth ||
                300,
              activeVp.canvasElement.clientHeight ||
                container.clientHeight ||
                300,
            );
          } else {
            manager.dispatchPan(activeVp.id, dx, dy);
            state.viewport.panX = activeVp.data.viewport.panX;
            state.viewport.panY = activeVp.data.viewport.panY;
          }
          break;
        case "crosshair":
          if (mprEngine.volume) {
            const originId = dragOriginViewportId || activeVp.id;
            if (manager.isCombined3DViewport(originId)) {
              break;
            }
            manager.dispatchMprCrosshair(
              originId,
              dx,
              dy,
              activeVp.canvasElement.clientWidth ||
                container.clientWidth ||
                300,
              activeVp.canvasElement.clientHeight ||
                container.clientHeight ||
                300,
            );
          }
          break;
      }
    } else {
      // Fallback: no manager yet (e.g. unit tests that don't call startApp).
      switch (state.activeTool) {
        case "wl":
          state.viewport.windowWidth = Math.max(
            1,
            state.viewport.windowWidth + dx * 2,
          );
          state.viewport.windowCenter += dy * 2;
          break;
        case "zoom":
          state.viewport.zoom = Math.max(
            0.1,
            Math.min(10, state.viewport.zoom * (1 - dy * 0.005)),
          );
          break;
        case "pan":
          if (mprEngine.volume) {
            mprEngine.applyPanDelta2D(
              "axial",
              dx,
              dy,
              container.clientWidth || 300,
              container.clientHeight || 300,
            );
          } else {
            state.viewport.panX += dx;
            state.viewport.panY += dy;
          }
          break;
        case "crosshair":
          if (mprEngine.volume) {
            mprEngine.applyCrosshairDelta2D(
              "axial",
              dx,
              dy,
              container.clientWidth || 300,
              container.clientHeight || 300,
            );
          }
          break;
      }
      render();
    }
  });

  document.addEventListener("mouseup", () => {
    if (state.isDragging && state.is3DMode) {
      console.groupCollapsed("⚙️ [3D View Debug] Post-Interaction State");
      console.log("Camera (Theta, Phi, Zoom):", view3DViewer.camera);
      console.log("Crosshair (X, Y, Z):", view3DViewer.crosshair);
      console.log(
        "Window (W/L):",
        state.viewport.windowWidth,
        state.viewport.windowCenter,
      );
      console.log("Active View:", view3DViewer.activeView);
      console.groupEnd();
    }
    state.isDragging = false;
    dragOriginViewportId = null;
  });

  // Mouse wheel interaction
  container.addEventListener(
    "wheel",
    async (e: WheelEvent) => {
      if (!state.parsed) return;
      e.preventDefault();

      if (state.is3DMode) {
        // 3D mode: depth slice navigation (3D view manages its own stack)
        const depthInfo = view3DViewer.getDepthInfo();
        const delta = e.deltaY > 0 ? 1 : -1;
        const target = depthInfo.current + delta;
        if (target >= 0 && target < depthInfo.total) {
          view3DViewer.setDepthIndex(target);
          const canvas = (document.getElementById("view-3d-canvas") ||
            document.getElementById("dicom-canvas")) as HTMLCanvasElement;
          if (canvas) view3DViewer.render(canvas);
        }
        return;
      }

      // ── 2D mode: route through ViewportManager so sync propagates ────────
      const manager = getViewportManager();
      const activeVp = manager?.activeViewport ?? null;
      const total = itemCount();

      if (total > 1 && !e.ctrlKey && !e.metaKey) {
        // Slice scroll
        const delta = e.deltaY > 0 ? 1 : -1;

        if (activeVp && manager) {
          await manager.dispatchSliceDelta(activeVp.id, delta, async (vp) => {
            // Keep global state in sync for series nav and loadCurrent().
            state.currentIndex = vp.data.currentIndex;
            await loadCurrent();
          });
        } else {
          // Fallback: no manager (e.g. unit tests)
          const targetIndex = state.currentIndex + delta;
          if (targetIndex >= 0 && targetIndex < total) {
            state.currentIndex = targetIndex;
            await loadCurrent();
          }
        }
      } else {
        // Ctrl+Wheel zoom
        const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;

        if (activeVp && manager) {
          manager.dispatchZoom(activeVp.id, zoomFactor);
          state.viewport.zoom = activeVp.data.viewport.zoom;
        } else {
          // Fallback: no manager
          state.viewport.zoom = Math.max(
            0.1,
            Math.min(10, state.viewport.zoom * zoomFactor),
          );
          render();
        }
      }
    },
    { passive: false },
  );
}

// ── 3D Controls & Orientation Interactions ───────────────────────────────────

// ── 3D Controls & Orientation Interactions ───────────────────────────────────

function init3DControlsInteraction(): void {
  // Depth slider
  const depthSliders = [
    $("view-3d-depth-slider"),
    $("mpr-depth-slider"),
  ].filter(Boolean) as HTMLInputElement[];

  depthSliders.forEach((depthSlider) => {
    depthSlider.addEventListener("input", () => {
      const idx = parseInt(depthSlider.value, 10);
      view3DViewer.setDepthIndex(idx);
      update3DSlidersUI();
      render();
    });
  });

  const render3D = () => {
    const canvas = (document.getElementById("view-3d-canvas") ||
      document.getElementById("dicom-canvas")) as HTMLCanvasElement;
    if (canvas && state.is3DMode) {
      view3DViewer.render(canvas);
    }
  };

  const onAxialInput = (slider: HTMLInputElement) => {
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      view3DViewer.setAxialIndex(idx);
      render3D();
    }
  };

  const onCoronalInput = (slider: HTMLInputElement) => {
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      view3DViewer.setCoronalIndex(idx);
      render3D();
    }
  };

  const onSagittalInput = (slider: HTMLInputElement) => {
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      view3DViewer.setSagittalIndex(idx);
      render3D();
    }
  };

  ["view-3d-scroll-axial", "mpr-scroll-axial"].forEach((id) => {
    const el = $(id) as HTMLInputElement | null;
    el?.addEventListener("input", () => onAxialInput(el));
  });

  ["view-3d-scroll-coronal", "mpr-scroll-coronal"].forEach((id) => {
    const el = $(id) as HTMLInputElement | null;
    el?.addEventListener("input", () => onCoronalInput(el));
  });

  ["view-3d-scroll-sagittal", "mpr-scroll-sagittal"].forEach((id) => {
    const el = $(id) as HTMLInputElement | null;
    el?.addEventListener("input", () => onSagittalInput(el));
  });

  // Quick view orientation buttons
  const setView = (view: "axial" | "coronal" | "sagittal" | "3d") => {
    view3DViewer.setOrientation(view);
    updateOrientationButtonsUI(view);
    render();
  };

  $("btn-view-3d-axial")?.addEventListener("click", () => setView("axial"));
  $("btn-view-axial")?.addEventListener("click", () => setView("axial"));
  $("btn-mpr-axial")?.addEventListener("click", () => setView("axial"));

  $("btn-view-3d-coronal")?.addEventListener("click", () => setView("coronal"));
  $("btn-view-coronal")?.addEventListener("click", () => setView("coronal"));
  $("btn-mpr-coronal")?.addEventListener("click", () => setView("coronal"));

  $("btn-view-3d-sagittal")?.addEventListener("click", () =>
    setView("sagittal"),
  );
  $("btn-view-sagittal")?.addEventListener("click", () => setView("sagittal"));
  $("btn-mpr-sagittal")?.addEventListener("click", () => setView("sagittal"));

  $("btn-view-3d-3d")?.addEventListener("click", () => setView("3d"));
  $("btn-view-3d")?.addEventListener("click", () => setView("3d"));
  $("btn-mpr-3d")?.addEventListener("click", () => setView("3d"));
}

function updateOrientationButtonsUI(
  activeView: "axial" | "coronal" | "sagittal" | "3d",
): void {
  ["axial", "coronal", "sagittal", "3d"].forEach((view) => {
    const btnView3D = $(`btn-view-3d-${view}`);
    if (btnView3D) {
      btnView3D.classList.toggle("active", view === activeView);
    }
    const btnView = $(`btn-view-${view}`);
    if (btnView) {
      btnView.classList.toggle("active", view === activeView);
    }
    const btnMpr = $(`btn-mpr-${view}`);
    if (btnMpr) {
      btnMpr.classList.toggle("active", view === activeView);
    }
  });
}

export function update3DSlidersUI(): void {
  const dims = view3DViewer.getVolumeDimensions();
  const indices = view3DViewer.getCurrentIndices();

  const axialSliders = [
    $("view-3d-scroll-axial") as HTMLInputElement | null,
    $("mpr-scroll-axial") as HTMLInputElement | null,
  ];
  const coronalSliders = [
    $("view-3d-scroll-coronal") as HTMLInputElement | null,
    $("mpr-scroll-coronal") as HTMLInputElement | null,
  ];
  const sagittalSliders = [
    $("view-3d-scroll-sagittal") as HTMLInputElement | null,
    $("mpr-scroll-sagittal") as HTMLInputElement | null,
  ];

  if (dims) {
    axialSliders.forEach((scrollAxial) => {
      if (scrollAxial) {
        scrollAxial.min = "0";
        scrollAxial.max = String(Math.max(0, dims.depth - 1));
        if (document.activeElement !== scrollAxial) {
          scrollAxial.value = String(indices.z);
        }
      }
    });

    coronalSliders.forEach((scrollCoronal) => {
      if (scrollCoronal) {
        scrollCoronal.min = "0";
        scrollCoronal.max = String(Math.max(0, dims.rows - 1));
        if (document.activeElement !== scrollCoronal) {
          scrollCoronal.value = String(indices.y);
        }
      }
    });

    sagittalSliders.forEach((scrollSagittal) => {
      if (scrollSagittal) {
        scrollSagittal.min = "0";
        scrollSagittal.max = String(Math.max(0, dims.cols - 1));
        if (document.activeElement !== scrollSagittal) {
          scrollSagittal.value = String(indices.x);
        }
      }
    });
  }
}

// Backwards-compatible alias for existing tests and callers
export const updateMPRSlidersUI = update3DSlidersUI;

// ── Series Navigation ────────────────────────────────────────────────────────

export function initSeriesNav(): void {
  $("nav-prev").addEventListener("click", async () => {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      await loadCurrent();
    }
  });

  $("nav-next").addEventListener("click", async () => {
    if (state.currentIndex < itemCount() - 1) {
      state.currentIndex++;
      await loadCurrent();
    }
  });

  const slider = $("nav-slider") as HTMLInputElement | null;
  if (slider) {
    slider.addEventListener("input", async () => {
      const val = parseInt(slider.value, 10);
      if (val >= 0 && val < itemCount() && val !== state.currentIndex) {
        state.currentIndex = val;
        await loadCurrent();
      }
    });
  }
}

// ── Menu Events (Electron only) ──────────────────────────────────────────────

export function initMenuListeners(): void {
  if (!window.api) return;
  window.api.on("menu:open-files", () => void openFiles());
  window.api.on("menu:open-folder", () => void openFolder());
  // Desktop-only "File > API Server…": the setting lives on the server
  // screen's auth card (shared/desktop.ts unhides it there), so this just
  // navigates — nothing new to render.
  window.api.on("menu:api-server", () => openServerScreen("buscar"));
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

/**
 * How far one arrow press moves each tool. Shift multiplies by COARSE so the
 * same keys cover both a nudge and a sweep.
 */
const STEP = { window: 20, zoom: 1.1, pan: 10 };
const COARSE = 5;

/**
 * Adjusts the active tool from the keyboard. Window/level, zoom and pan were
 * mouse-drag only, which made the app's core interaction unusable without a
 * pointer — a WCAG 2.1.1 failure. Returns true if the key was handled.
 */
function adjustActiveTool(e: KeyboardEvent): boolean {
  if (!state.parsed) return false;

  const fast = e.shiftKey ? COARSE : 1;
  const horizontal =
    e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  const vertical = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (horizontal === 0 && vertical === 0) return false;

  switch (state.activeTool) {
    case "wl":
      state.viewport.windowWidth = Math.max(
        1,
        state.viewport.windowWidth + horizontal * STEP.window * fast,
      );
      state.viewport.windowCenter += vertical * STEP.window * fast;
      break;
    case "zoom": {
      // Right/Up zoom in, Left/Down zoom out — the same sense as the
      // mouse-drag mapping.
      const direction = horizontal !== 0 ? horizontal : -vertical;
      const factor = STEP.zoom ** (direction * fast);
      state.viewport.zoom = Math.max(
        0.1,
        Math.min(10, state.viewport.zoom * factor),
      );
      break;
    }
    case "pan":
      state.viewport.panX += horizontal * STEP.pan * fast;
      state.viewport.panY += vertical * STEP.pan * fast;
      break;
  }

  render();
  return true;
}

export function initKeyboardShortcuts(): void {
  document.addEventListener("keydown", async (e: KeyboardEvent) => {
    // A modal owns the keyboard while it is up. The page behind it is inert,
    // but this listener is on `document` and still sees every key — without
    // this guard, "m" inside the duplicate-upload dialog would toggle the
    // metadata panel hidden behind it.
    if (anyDialogOpen()) return;
    // Same reasoning for the server screen: the viewer is inert, but this
    // listener still fires.
    if (currentScreen() !== "viewer") return;
    // A composite widget (the tool rail, a listbox) that already consumed the
    // key has called preventDefault; don't act on it a second time.
    if (e.defaultPrevented) return;

    // Ignore keystrokes while typing (search box, date filters, login card).
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return;
    }

    // In 3D mode, arrows navigate depth slices instead of adjusting the tool.
    if (state.is3DMode) {
      const depthInfo = view3DViewer.getDepthInfo();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (depthInfo.current > 0) {
          view3DViewer.setDepthIndex(depthInfo.current - 1);
          render();
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (depthInfo.current < depthInfo.total - 1) {
          view3DViewer.setDepthIndex(depthInfo.current + 1);
          render();
        }
      }
    } else {
      // Arrows drive the active tool; series navigation uses PageUp/PageDown
      // so both are reachable without a pointer.
      if (adjustActiveTool(e)) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === "PageUp") {
      e.preventDefault();
      if (state.currentIndex > 0) {
        state.currentIndex--;
        await loadCurrent();
      }
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      if (state.currentIndex < itemCount() - 1) {
        state.currentIndex++;
        await loadCurrent();
      }
      return;
    }

    if (e.key === "w" || e.key === "W") {
      $("tool-wl")?.click();
    } else if (e.key === "z" || e.key === "Z") {
      $("tool-zoom")?.click();
    } else if (e.key === "p" || e.key === "P") {
      if (!state.is3DMode) {
        $("tool-pan")?.click();
      }
    } else if (e.key === "c" || e.key === "C") {
      if (state.is3DMode) {
        $("tool-crosshair")?.click();
      }
    } else if (e.key === "r" || e.key === "R") {
      $("tool-reset")?.click();
    } else if (e.key === "m" || e.key === "M") {
      $("tool-metadata")?.click();
    }
  });
}

// ── Resize Observer ──────────────────────────────────────────────────────────

export function initResizeObserver(): void {
  const container = $("viewport-container");
  const observer = new ResizeObserver(() => {
    if (state.parsed) render();
  });
  observer.observe(container);
}

// ── Grid Layout & Sync Controls ──────────────────────────────────────────────

export function initGridLayoutControls(): void {
  const LAYOUTS: GridLayout[] = ["1x1", "1x2", "2x2"];

  LAYOUTS.forEach((layout) => {
    const btn = document.getElementById(`btn-layout-${layout}`);
    if (!btn) return;

    btn.addEventListener("click", () => {
      getViewportManager()?.setLayout(layout);
      updateGridLayoutUI(layout);
    });
  });

  const syncBtn = document.getElementById("btn-sync-viewports");
  syncBtn?.addEventListener("click", () => {
    const isNowActive = syncBtn.classList.toggle("active");
    syncBtn.setAttribute("aria-pressed", String(isNowActive));
    getViewportManager()?.setSync(isNowActive);
  });
}

function updateGridLayoutUI(activeLayout: GridLayout): void {
  const LAYOUTS: GridLayout[] = ["1x1", "1x2", "2x2"];
  LAYOUTS.forEach((layout) => {
    const btn = document.getElementById(`btn-layout-${layout}`);
    if (!btn) return;
    const isActive = layout === activeLayout;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

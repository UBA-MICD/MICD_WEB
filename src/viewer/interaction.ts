import {
  calculateAutoWindowLevel,
  parseDicomFile,
  WINDOW_PRESETS,
  type DicomMetadata,
} from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { showToast } from "../shared/banner.js";
import { getPathologies } from "./segmentation/segmentation-api.js";
import { anyDialogOpen, openDialog, closeDialog } from "../shared/dialog.js";
import { currentScreen } from "../shared/screen.js";
import {
  state,
  itemCount,
  setMeasurementUnit,
  setMeasurementLineWidth,
} from "./state.js";
import {
  render,
  ensure3DRendered,
  updateSeriesNav,
  updateWlControlsUI,
  hide3DControls,
  update3DControls,
  update3DSlidersUI,
  updateMPRSlidersUI,
  setActiveInteractingSlider,
  getActiveInteractingSlider,
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
import { mprCoordinator } from "./mpr-coordinator.js";
import {
  createMprTrackball,
  type MprTrackballHandle,
} from "./mpr-trackball.js";
import { dicomCache } from "./cache.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import {
  exportCurrentViewToPNG,
  exportCurrentStudyAsZip,
} from "../services/export-service.js";
import { openServerScreen } from "../server-screen/server-screen.js";
import { getViewportManager } from "./viewport-registry.js";
import type { GridLayout, Viewport } from "./viewport-manager.js";
import {
  screenToWorld,
  calculateDistance,
  calculateEllipseArea,
  calculateEllipseHUStats,
  extractCalibration,
  formatLength,
  formatArea,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  worldToScreen,
} from "./measurements/measurement-math.js";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  clearAnnotations,
  getActiveSopInstanceUid,
  getAnnotationsForSlice,
  saveToLocalStorage,
} from "./measurements/annotation-state.js";
import {
  getActiveDrawing,
  setActiveDrawing,
  getSelectedAnnotationId,
  setSelectedAnnotationId,
  hitTestAnnotation,
  hitTestPolygonVertex,
  type ActiveDrawing,
} from "./measurements/measurement-overlay.js";
import type {
  LengthAnnotation,
  EllipseAnnotation,
  PolygonAnnotation,
  Point2D,
} from "./measurements/types.js";
import { exportSegmentation } from "./measurements/export-annotation.js";

// ── Slice navigation ──────────────────────────────────────────────────────────

/**
 * Advance the active viewport by `delta` slices, routing through the
 * ViewportManager so synchronized viewports scroll in step. The active viewport
 * takes the full path (global state, series nav, prefetch); synced viewports —
 * which share the current stack — get their slice loaded straight into them and
 * repainted (loadCurrent()/displayParsed() only ever target the active one).
 */
async function navigateSliceDelta(delta: number): Promise<void> {
  const manager = getViewportManager();
  const activeVp = manager?.activeViewport ?? null;

  if (activeVp && manager) {
    await manager.dispatchSliceDelta(activeVp.id, delta, async (vp) => {
      if (vp.id === activeVp.id) {
        state.currentIndex = vp.data.currentIndex;
        await loadCurrent();
      } else {
        const parsed = await dicomCache.getOrFetch(vp.data.currentIndex);
        if (parsed) {
          vp.data.parsed = parsed;
          vp.render();
        }
      }
    });
    return;
  }

  // Fallback: no manager (e.g. unit tests).
  const total = itemCount();
  const target = state.currentIndex + delta;
  if (target >= 0 && target < total) {
    state.currentIndex = target;
    await loadCurrent();
  }
}

// ── MPR Trackball Mounting (spec 007, TK-30) ─────────────────────────────────

let mprTrackballInstance: MprTrackballHandle | null = null;

export function getMprTrackball(): MprTrackballHandle | null {
  return mprTrackballInstance;
}

export function ensureMprTrackballMounted(): MprTrackballHandle | null {
  const toolbar =
    $("viewer-toolbar") ||
    $("tool-crosshair")?.parentElement ||
    $("tool-mpr")?.parentElement;
  if (!toolbar) return null;

  if (
    !mprTrackballInstance ||
    !mprTrackballInstance.el.isConnected ||
    !document.contains(mprTrackballInstance.el)
  ) {
    if (mprTrackballInstance) {
      try {
        mprTrackballInstance.destroy();
      } catch {
        // Safe cleanup
      }
      mprTrackballInstance = null;
    }
    mprTrackballInstance = createMprTrackball();
    const anchorBtn =
      $("tool-crosshair") || $("tool-pan") || $("tool-zoom") || $("tool-mpr");
    if (anchorBtn && anchorBtn.parentElement) {
      anchorBtn.parentElement.insertBefore(
        mprTrackballInstance.el,
        anchorBtn.nextSibling,
      );
    } else {
      toolbar.appendChild(mprTrackballInstance.el);
    }
  }

  return mprTrackballInstance;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

/**
 * Event delegation for view mode toggles (#tool-view-3d and #tool-mpr).
 * Bound to document.body so buttons survive dynamic DOM re-renders.
 */
function initViewModeDelegation(): void {
  if (typeof document === "undefined" || !document.body) return;
  const body = document.body as HTMLElement & {
    __viewModeDelegationInitialized?: boolean;
  };
  if (body.__viewModeDelegationInitialized) return;
  body.__viewModeDelegationInitialized = true;

  document.body.addEventListener("click", (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;

    // Delegación para Vista 3D
    const btn3D = target.closest("#tool-view-3d") as HTMLButtonElement | null;
    if (btn3D) {
      if (btn3D.disabled || state.isLayoutTransitioning) return;
      void toggle3DMode();
      return;
    }

    // Delegación para botón MPR
    const btnMpr = target.closest("#tool-mpr") as HTMLButtonElement | null;
    if (btnMpr) {
      if (btnMpr.disabled || state.isLayoutTransitioning) return;
      void toggleMprMode();
      return;
    }
  });
}

export function initToolbar(): void {
  ensureMprTrackballMounted();
  const tools = [
    "wl",
    "zoom",
    "pan",
    "crosshair",
    "length",
    "ellipse",
    "polygon",
  ] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    if (btn) {
      btn.addEventListener("click", () => {
        if (
          state.is3DMode &&
          (tool === "length" || tool === "ellipse" || tool === "polygon")
        ) {
          return;
        }
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
          state.isMeasurementPanelOpen = false;
        } else if (tool === "zoom") {
          if (state.activeTool === "zoom") {
            state.isZoomPanelOpen = !state.isZoomPanelOpen;
          } else {
            state.activeTool = "zoom";
            state.isZoomPanelOpen = true;
          }
          state.isWlPanelOpen = false;
          state.isMeasurementPanelOpen = false;
        } else if (
          tool === "length" ||
          tool === "ellipse" ||
          tool === "polygon"
        ) {
          if (state.activeTool === tool) {
            state.isMeasurementPanelOpen = !state.isMeasurementPanelOpen;
          } else {
            state.activeTool = tool;
            state.isMeasurementPanelOpen = true;
          }
          state.isWlPanelOpen = false;
          state.isZoomPanelOpen = false;
        } else {
          state.activeTool = tool;
          state.isWlPanelOpen = false;
          state.isZoomPanelOpen = false;
          state.isMeasurementPanelOpen = false;
        }
        updateToolbarUI();
      });
    }
  });

  $("tool-reset").addEventListener("click", () => {
    // Multi-viewport path: reset the active viewport (and synced ones), the same
    // way every other tool routes through the manager. Without this the reset
    // button only touched the legacy global state and left the on-screen
    // viewport — e.g. the left panel of the comparison view — untouched.
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport ?? null;
    if (manager && activeVp?.data.parsed) {
      activeVp.resetCamera();
      if (manager.isSynchronized) {
        for (const vp of manager.getAllViewports()) {
          if (vp.id !== activeVp.id && vp.data.parsed) vp.resetCamera();
        }
      }
      if (state.is3DMode) view3DViewer.resetCamera();
      mprCoordinator.resetRotation();
      view3DViewer.setPresetMode(0);
      // Keep global state + the zoom slider aligned with the active viewport.
      state.viewport = { ...activeVp.data.viewport };
      updateZoomControlsUI();
      return;
    }

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

  initViewModeDelegation();

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
  initMeasurementControlsInteraction();
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
      const targetW = Math.max(1, val);
      state.viewport.windowWidth = targetW;
      mprEngine.setWindowLevel(state.viewport.windowCenter, targetW);
      view3DViewer.setWindowLevel(state.viewport.windowCenter, targetW);

      const manager = getViewportManager();
      if (manager) {
        if (state.isMprMode) {
          for (const gridVp of manager.getAllViewports()) {
            gridVp.data.viewport.windowWidth = targetW;
            gridVp.render();
          }
        } else {
          const vp = manager.activeViewport;
          if (vp) {
            vp.data.viewport.windowWidth = targetW;
            vp.render();
          }
          if (manager.isSynchronized) {
            for (const otherVp of manager.getAllViewports()) {
              if (!vp || otherVp.id !== vp.id) {
                otherVp.data.viewport.windowWidth = targetW;
                otherVp.render();
              }
            }
          }
        }
      } else {
        render();
      }
      updateWlControlsUI();
    });
  }

  if (sliderWL) {
    sliderWL.addEventListener("input", () => {
      const val = parseFloat(sliderWL.value);
      if (isNaN(val)) return;
      const targetC = val;
      state.viewport.windowCenter = targetC;
      mprEngine.setWindowLevel(targetC, state.viewport.windowWidth);
      view3DViewer.setWindowLevel(targetC, state.viewport.windowWidth);

      const manager = getViewportManager();
      if (manager) {
        if (state.isMprMode) {
          for (const gridVp of manager.getAllViewports()) {
            gridVp.data.viewport.windowCenter = targetC;
            gridVp.render();
          }
        } else {
          const vp = manager.activeViewport;
          if (vp) {
            vp.data.viewport.windowCenter = targetC;
            vp.render();
          }
          if (manager.isSynchronized) {
            for (const otherVp of manager.getAllViewports()) {
              if (!vp || otherVp.id !== vp.id) {
                otherVp.data.viewport.windowCenter = targetC;
                otherVp.render();
              }
            }
          }
        }
      } else {
        render();
      }
      updateWlControlsUI();
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

          mprEngine.setWindowLevel(preset.windowCenter, preset.windowWidth);
          view3DViewer.setWindowLevel(preset.windowCenter, preset.windowWidth);

          if (key === "bone") {
            view3DViewer.setPresetMode(1);
          } else if (key === "soft") {
            view3DViewer.setPresetMode(2);
          } else {
            view3DViewer.setPresetMode(0);
          }

          const manager = getViewportManager();
          if (manager) {
            if (state.isMprMode) {
              for (const vp of manager.getAllViewports()) {
                vp.data.viewport.windowCenter = preset.windowCenter;
                vp.data.viewport.windowWidth = preset.windowWidth;
                vp.render();
              }
            } else {
              const activeVp = manager.activeViewport;
              if (activeVp) {
                activeVp.data.viewport.windowCenter = preset.windowCenter;
                activeVp.data.viewport.windowWidth = preset.windowWidth;
                activeVp.render();
              }
              if (manager.isSynchronized) {
                for (const otherVp of manager.getAllViewports()) {
                  if (!activeVp || otherVp.id !== activeVp.id) {
                    otherVp.data.viewport.windowCenter = preset.windowCenter;
                    otherVp.data.viewport.windowWidth = preset.windowWidth;
                    otherVp.render();
                  }
                }
              }
            }
          } else {
            render();
          }

          updateWlControlsUI();
        }
      });
    }
  });

  const btnMip = $("btn-preset-mip") || $("btn-view-3d-mip");
  if (btnMip) {
    btnMip.addEventListener("click", () => {
      view3DViewer.setPresetMode(3);
      const manager = getViewportManager();
      if (manager) {
        for (const vp of manager.getAllViewports()) {
          vp.render();
        }
      } else {
        render();
      }
      updateWlControlsUI();
    });
  }
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

function renderActiveMeasurementOverlays(): void {
  const manager = getViewportManager();
  if (manager && manager.getAllViewports().length > 0) {
    for (const vp of manager.getAllViewports()) {
      vp.renderOverlay();
    }
  } else {
    render();
  }
}

export function updateMeasurementControlsUI(): void {
  const btnMm = $("btn-unit-mm");
  const btnCm = $("btn-unit-cm");
  const selectUnit = $("select-measure-unit") as HTMLSelectElement | null;
  const sliderWidth = $("slider-measure-width") as HTMLInputElement | null;
  const valWidth = $("val-measure-width");

  const isMm = state.measurementUnit === "mm";
  if (btnMm) {
    btnMm.classList.toggle("active", isMm);
    btnMm.setAttribute("aria-pressed", String(isMm));
  }
  if (btnCm) {
    btnCm.classList.toggle("active", !isMm);
    btnCm.setAttribute("aria-pressed", String(!isMm));
  }
  if (selectUnit && selectUnit.value !== state.measurementUnit) {
    selectUnit.value = state.measurementUnit;
  }
  if (sliderWidth && document.activeElement !== sliderWidth) {
    sliderWidth.value = String(state.measurementLineWidth);
  }
  if (valWidth) {
    valWidth.textContent = `${state.measurementLineWidth}px`;
  }
}

export function initMeasurementControlsInteraction(): void {
  const btnMm = $("btn-unit-mm");
  const btnCm = $("btn-unit-cm");
  const selectUnit = $("select-measure-unit") as HTMLSelectElement | null;
  const sliderWidth = $("slider-measure-width") as HTMLInputElement | null;
  const btnClear = $("btn-clear-measurements");

  const handleUnitChange = (unit: "mm" | "cm"): void => {
    setMeasurementUnit(unit);
    updateMeasurementControlsUI();
    renderActiveMeasurementOverlays();
  };

  btnMm?.addEventListener("click", () => handleUnitChange("mm"));
  btnCm?.addEventListener("click", () => handleUnitChange("cm"));

  selectUnit?.addEventListener("change", () => {
    const val = selectUnit.value === "cm" ? "cm" : "mm";
    handleUnitChange(val);
  });

  sliderWidth?.addEventListener("input", () => {
    const val = parseInt(sliderWidth.value, 10);
    if (!isNaN(val)) {
      setMeasurementLineWidth(val);
      const valWidth = $("val-measure-width");
      if (valWidth) {
        valWidth.textContent = `${state.measurementLineWidth}px`;
      }
      renderActiveMeasurementOverlays();
    }
  });

  const btnToggle = $("btn-toggle-annotations");
  btnToggle?.addEventListener("click", () => {
    state.areAnnotationsVisible = !state.areAnnotationsVisible;
    btnToggle.setAttribute("aria-pressed", String(state.areAnnotationsVisible));
    btnToggle.textContent = state.areAnnotationsVisible
      ? t("viewer.measure.hideAnnotations") || "Ocultar anotaciones"
      : t("viewer.measure.showAnnotations") || "Mostrar anotaciones";
    renderActiveMeasurementOverlays();
  });

  // Top-bar "info" toggle (US-45): hides the on-image info — measurement
  // badges (area/perimeter/HU), the "IA" tag and the AI label ("IA: …") —
  // WITHOUT hiding the contours, which stay visible and editable. The state is
  // global (state.areLabelsVisible), so it holds across slice and layout changes.
  const btnInfo = $("btn-toggle-info");
  btnInfo?.addEventListener("click", () => {
    state.areLabelsVisible = !state.areLabelsVisible;
    btnInfo.setAttribute("aria-pressed", String(state.areLabelsVisible));
    const label = state.areLabelsVisible
      ? t("viewer.info.hide") || "Ocultar info"
      : t("viewer.info.show") || "Mostrar info";
    btnInfo.setAttribute("aria-label", label);
    btnInfo.setAttribute("title", label);
    // Re-render every viewport so the AI label overlay updates too, not just the
    // measurement badges.
    for (const vp of getViewportManager()?.getAllViewports() ?? []) vp.render();
    renderActiveMeasurementOverlays();
  });

  const btnSave = $("btn-save-annotations");
  btnSave?.addEventListener("click", () => {
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport;
    const uid =
      activeVp?.data.parsed?.metadata?.sopInstanceUid ||
      getActiveSopInstanceUid();
    saveToLocalStorage(uid);

    const originalText =
      btnSave.textContent || t("viewer.measure.saveAnnotations") || "Guardar";
    btnSave.textContent = t("viewer.measure.savedSuccess") || "¡Guardado!";
    btnSave.classList.add("saved");

    setTimeout(() => {
      btnSave.textContent = originalText;
      btnSave.classList.remove("saved");
    }, 2000);
  });

  const btnExport = $("btn-export-segmentation");
  btnExport?.addEventListener("click", async () => {
    await exportSegmentation();
  });

  btnClear?.addEventListener("click", () => {
    const manager = getViewportManager();
    const activeVp = manager?.activeViewport;
    const uid =
      activeVp?.data.parsed?.metadata?.sopInstanceUid ||
      getActiveSopInstanceUid();
    if (uid) {
      clearAnnotations(uid);
      setSelectedAnnotationId(null);
      renderActiveMeasurementOverlays();
    }
  });

  // Pathology selector (US-45): tag the selected polygon with a pathology type,
  // from the same catalog as upload. Populated lazily (needs a session), synced
  // to whatever polygon is selected, and re-labelled on a locale change.
  measurePathologySelect()?.addEventListener("change", () =>
    onMeasurePathologyChange(),
  );
  onLocaleChange(relabelMeasurePathologyOptions);
  void ensureMeasurePathologyOptions();
  if (typeof window !== "undefined") {
    window.addEventListener("annotation-selection-changed", () => {
      void ensureMeasurePathologyOptions();
      syncMeasurePathologySelect();
    });
  }
}

// ── Pathology of the selected polygon (measurement panel) ────────────────────

let measurePathologyLoaded = false;

function measurePathologySelect(): HTMLSelectElement | null {
  return $("measure-pathology") as HTMLSelectElement | null;
}

/** The currently selected annotation, if it is a polygon on the active slice. */
function findSelectedPolygon(): PolygonAnnotation | null {
  const id = getSelectedAnnotationId();
  if (!id) return null;
  const manager = getViewportManager();
  const uid =
    manager?.activeViewport?.data.parsed?.metadata?.sopInstanceUid ||
    getActiveSopInstanceUid();
  const ann = getAnnotationsForSlice(uid).find((a) => a.id === id);
  return ann && ann.type === "polygon" ? (ann as PolygonAnnotation) : null;
}

/** Fetch the catalog once and build the options. No-op for a guest/on error —
 *  the blank "Sin clasificar" default stays and retries on the next selection. */
async function ensureMeasurePathologyOptions(): Promise<void> {
  if (measurePathologyLoaded) return;
  const sel = measurePathologySelect();
  if (!sel) return;
  const cats = await getPathologies();
  if (cats.length === 0) return;
  sel.querySelectorAll("option[data-id]").forEach((o) => o.remove());
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.dataset.id = String(c.id);
    opt.dataset.key = c.key;
    opt.textContent = t(`classification.${c.key}`);
    sel.appendChild(opt);
  }
  measurePathologyLoaded = true;
  syncMeasurePathologySelect();
}

/** Re-translate the options on a locale change (no refetch). */
function relabelMeasurePathologyOptions(): void {
  measurePathologySelect()
    ?.querySelectorAll<HTMLOptionElement>("option[data-key]")
    .forEach((o) => {
      if (o.dataset.key) o.textContent = t(`classification.${o.dataset.key}`);
    });
}

/** Reflect the selected polygon's pathology in the select (blank if none). */
function syncMeasurePathologySelect(): void {
  const sel = measurePathologySelect();
  if (!sel) return;
  const poly = findSelectedPolygon();
  sel.value = poly?.pathologyId != null ? String(poly.pathologyId) : "";
}

/** Assign the chosen pathology to the selected polygon (or warn if none). */
function onMeasurePathologyChange(): void {
  const sel = measurePathologySelect();
  if (!sel) return;
  const poly = findSelectedPolygon();
  if (!poly) {
    showToast(t("viewer.measure.pathologyNeedPolygon"), "warning");
    sel.value = "";
    return;
  }
  const opt = sel.selectedOptions[0];
  if (sel.value === "") {
    delete poly.pathologyId;
    delete poly.pathologyKey;
  } else {
    poly.pathologyId = Number(sel.value);
    poly.pathologyKey = opt?.dataset.key;
  }
  updateAnnotation(poly);
  saveToLocalStorage(poly.sopInstanceUid);
  renderActiveMeasurementOverlays();
}

function schedulePostReflow(action: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        action();
      });
    });
  } else {
    setTimeout(action, 50);
  }
}

export async function toggle3DMode(): Promise<boolean> {
  if (state.isLayoutTransitioning) return false;

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

  // Force close/hide trackball popover during transition to avoid stale camera reads
  const trackball = getMprTrackball();
  trackball?.closePopover();

  state.isLayoutTransitioning = true;
  try {
    if (state.is3DMode) {
      state.is3DMode = false;
      view3DViewer.isActive = false;
      view3DViewer.stopRenderLoop();
      $("view-3d-container")?.classList.add("hidden");
      $("viewport-container")?.classList.remove("mode-3d");
      hide3DControls();
      render();
      return false;
    }

    // Stop any running render loop before switching layout
    view3DViewer.stopRenderLoop();

    if (state.isMprMode) {
      state.isMprMode = false;
      $("viewport-container")?.classList.remove("mode-mpr");
      const manager = getViewportManager();
      manager?.setLayout("1x1");
    }

    showLoading(true);
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

    const canvas =
      (document.getElementById("view-3d-canvas") as HTMLCanvasElement) ||
      (document.getElementById("dicom-canvas") as HTMLCanvasElement);
    ensure3DRendered(canvas ?? undefined);
    return true;
  } catch (err: any) {
    showError(err.message || String(err));
    return false;
  } finally {
    state.isLayoutTransitioning = false;
    updateToolbarUI();
    showLoading(false);
  }
}

export async function toggleMprMode(): Promise<boolean> {
  if (state.isLayoutTransitioning) return false;

  const btn = $("tool-mpr") as HTMLButtonElement | null;
  if (btn?.disabled) return false;

  const count = itemCount();
  if (count <= 1 && !mprEngine.volume) {
    showError(
      t("viewer.mpr.needTwoSlices") ||
        "Se requieren al menos 2 cortes para MPR",
    );

  // Force close/hide trackball popover during transition to avoid stale camera reads
    return false;
  }
  const trackball = getMprTrackball();
  trackball?.closePopover();
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
    $("viewport-container")?.classList.remove("mode-mpr");
    manager?.setLayout("1x1");
    hide3DControls();
    updateToolbarUI();
    render();
    return false;
  }

  state.isLayoutTransitioning = true;
  try {
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
      $("viewport-container")?.classList.remove("mode-mpr");
      manager?.setLayout("1x1");
      hide3DControls();
      render();
      return false;
    }

    showLoading(true);
    if (!mprEngine.volume) {
      await loadVolumeIntoEngines();
    }
    if (!mprEngine.volume) {
      throw new Error("No se pudo reconstruir el volumen 3D para MPR.");
    }

    state.isMprMode = true;
    state.activeTool = "crosshair";
    $("viewport-container")?.classList.add("mode-mpr");

    // Set 2x2 triplanar layout
    manager?.setLayout("2x2");
    schedulePostReflow(() => {
      if (!state.isMprMode) return;
      manager?.getAllViewports().forEach((vp) => vp.render());
    });

    $("view-3d-sliders-panel")?.classList.remove("hidden");
    $("mpr-sliders-panel")?.classList.remove("hidden");
    update3DSlidersUI();
    return true;
  } catch (err: any) {
    showError(err.message || String(err));
    return false;
  } finally {
    state.isLayoutTransitioning = false;
    updateToolbarUI();
    showLoading(false);
  }
}

export function updateToolbarUI(): void {
  if (
    state.is3DMode &&
    (state.activeTool === "length" ||
      state.activeTool === "ellipse" ||
      state.activeTool === "polygon")
  ) {
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
    panBtn.disabled = false;
  }

  const lengthBtn = $("tool-length") as HTMLButtonElement | null;
  if (lengthBtn) {
    lengthBtn.disabled = state.is3DMode;
    lengthBtn.setAttribute(
      "aria-expanded",
      String(state.isMeasurementPanelOpen),
    );
  }

  const ellipseBtn = $("tool-ellipse") as HTMLButtonElement | null;
  if (ellipseBtn) {
    ellipseBtn.disabled = state.is3DMode;
    ellipseBtn.setAttribute(
      "aria-expanded",
      String(state.isMeasurementPanelOpen),
    );
  }

  const polygonBtn = $("tool-polygon") as HTMLButtonElement | null;
  if (polygonBtn) {
    polygonBtn.disabled = state.is3DMode;
    polygonBtn.setAttribute(
      "aria-expanded",
      String(state.isMeasurementPanelOpen),
    );
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

  try {
    const trackball = ensureMprTrackballMounted();
    if (trackball) {
      const shouldShow = Boolean(state.isMprMode || state.is3DMode);
      trackball.el.hidden = !shouldShow;
      trackball.el.classList.toggle("hidden", !shouldShow);
      if (
        shouldShow &&
        !state.isLayoutTransitioning &&
        typeof trackball.update === "function"
      ) {
        trackball.update();
      } else if (!shouldShow && typeof trackball.closePopover === "function") {
        trackball.closePopover();
      }
    }
  } catch (err) {
    console.warn("Failed to update trackball visibility in toolbar:", err);
  }

  // Only mode tools are mutually exclusive. Clearing every .toolbar__tool
  // would also strip the metadata toggle's state, leaving its class and
  // aria-expanded disagreeing with the open panel.
  (
    ["wl", "zoom", "pan", "crosshair", "length", "ellipse", "polygon"] as const
  ).forEach((tool) => {
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

  const measurePanel = $("measure-panel");
  if (measurePanel) {
    measurePanel.classList.toggle("open", state.isMeasurementPanelOpen);
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
        "cursor-length",
        "cursor-ellipse",
        "cursor-polygon",
      );
    }
    viewport.classList?.add?.(`cursor-${state.activeTool}`);
    viewport.classList?.toggle?.("mode-3d", state.is3DMode);
  }

  updateZoomControlsUI();
  updateMeasurementControlsUI();
}

// ── Viewport Mouse Interaction ───────────────────────────────────────────────

let draggingNode: { annotationId: string; vertexIndex: number } | null = null;
let draggingShape: {
  annotationId: string;
  startWorld: Point2D;
  initialPoints: Point2D[];
} | null = null;

export function finishPolygonDrawing(
  drawing: ActiveDrawing,
  metadata: DicomMetadata,
  sopInstanceUid: string,
  sliceIndex: number,
  activeVp?: Viewport | null,
): void {
  if (!drawing.points || drawing.points.length < 3) {
    setActiveDrawing(null);
    if (activeVp) activeVp.renderOverlay();
    else render();
    return;
  }

  const cal = extractCalibration(metadata);
  const area = calculatePolygonArea(drawing.points, cal.pixelSpacing);
  const perimeter = calculatePolygonPerimeter(drawing.points, cal.pixelSpacing);

  const newAnn: PolygonAnnotation = {
    id: `ann_poly_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: "polygon",
    sopInstanceUid,
    sliceIndex,
    points: drawing.points.map((p) => ({ x: p.x, y: p.y })),
    isClosed: true,
    area,
    perimeter,
    isCalibrated: cal.isCalibrated,
    unit: cal.isCalibrated ? "mm" : "px",
    createdAt: Date.now(),
  };

  addAnnotation(newAnn);
  setSelectedAnnotationId(newAnn.id);
  setActiveDrawing(null);

  const announceEl = $("measure-announce");
  if (announceEl) {
    const areaStr = formatArea(area, cal.isCalibrated, state.measurementUnit);
    const perimeterStr = formatLength(
      perimeter,
      cal.isCalibrated,
      state.measurementUnit,
    );
    announceEl.textContent = `${t("annotations.polygon") || "Polígono"}: ${t("annotations.area") || "Área"} ${areaStr}, ${t("annotations.perimeter") || "Perímetro"} ${perimeterStr}`;
  }

  if (activeVp) activeVp.renderOverlay();
  else render();
}

export function completeActivePolygon(): void {
  const drawing = getActiveDrawing();
  if (
    !drawing ||
    drawing.type !== "polygon" ||
    !drawing.points ||
    drawing.points.length < 3
  ) {
    return;
  }
  const manager = getViewportManager();
  const activeVp = manager?.activeViewport;
  const metadata = activeVp
    ? activeVp.data.parsed?.metadata
    : state.parsed?.metadata;
  if (!metadata) return;
  const sopInstanceUid =
    (activeVp
      ? activeVp.data.parsed?.metadata.sopInstanceUid
      : getActiveSopInstanceUid()) ||
    `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;
  const sliceIndex = activeVp ? activeVp.data.currentIndex : state.currentIndex;

  finishPolygonDrawing(drawing, metadata, sopInstanceUid, sliceIndex, activeVp);
}

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
        updateToolbarUI();
      }
    });
  }

  let dragOriginViewportId: string | null = null;
  let activeMouseButton = 0;

  if (container) {
    container.addEventListener("contextmenu", (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, select, textarea, button, .view-3d-sliders-panel, .mpr-sliders-panel, #view-3d-sliders-panel",
        )
      ) {
        return;
      }
      e.preventDefault();
    });
  }

  function getTargetMetrics(
    e: MouseEvent,
    containerEl: HTMLElement,
    activeVp?: Viewport | null,
  ): { clickX: number; clickY: number; viewW: number; viewH: number } {
    const targetEl: HTMLElement =
      activeVp?.overlayCanvas ||
      (document.getElementById(
        "annotation-overlay",
      ) as HTMLCanvasElement | null) ||
      activeVp?.cellElement ||
      containerEl;
    const rect = targetEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const viewW =
      targetEl.clientWidth ||
      (targetEl as HTMLCanvasElement).width ||
      containerEl.clientWidth ||
      300;
    const viewH =
      targetEl.clientHeight ||
      (targetEl as HTMLCanvasElement).height ||
      containerEl.clientHeight ||
      300;
    return { clickX, clickY, viewW, viewH };
  }

  const handlePointerAction = (e: MouseEvent) => {
    if (!state.parsed) return;
    const manager = getViewportManager();
    const originId = dragOriginViewportId || manager?.activeViewport?.id || "";
    const activeVp =
      (manager && originId
        ? manager.getAllViewports().find((v) => v.id === originId)
        : null) || manager?.activeViewport;

    const { clickX, clickY, viewW, viewH } = getTargetMetrics(
      e,
      container,
      activeVp,
    );

    if (
      mprEngine.volume &&
      state.isMprMode &&
      state.activeTool === "crosshair"
    ) {
      if (manager && manager.isCombined3DViewport(originId)) {
        return;
      }
      const plane = activeVp?.plane || "axial";
      const [cx, cy] = mprEngine.getCrosshairScreenCoords(plane, viewW, viewH);
      const distToCenter = Math.hypot(clickX - cx, clickY - cy);

      // Check if clicking on crosshair arm/handle to rotate oblique slice
      if (distToCenter > 30) {
        const { line1, line2 } = mprEngine.getCrosshairLineDirections(plane);
        const distToLine1 = Math.abs(
          (clickX - cx) * line1.dirY - (clickY - cy) * line1.dirX,
        );
        const distToLine2 = Math.abs(
          (clickX - cx) * line2.dirY - (clickY - cy) * line2.dirX,
        );
        if (distToLine1 <= 18 || distToLine2 <= 18) {
          isRotatingMprCrosshair = true;
          mprRotationPlane = plane;
          mprCrosshairScreenCenter = [cx, cy];
          return;
        }
      }

      isRotatingMprCrosshair = false;
      mprEngine.setCrosshairFromScreen(plane, clickX, clickY, viewW, viewH);
      const [nx, ny, nz] = mprEngine.crosshairNormalized;
      mprCoordinator.setCrosshairFromNormalized(nx, ny, nz);
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
      view3DViewer.updateCrosshairFromPointer(clickX, clickY, viewW, viewH);
      mprCoordinator.setCrosshair(
        view3DViewer.crosshair.x,
        view3DViewer.crosshair.y,
        view3DViewer.crosshair.z,
      );
      render();
    }
  };

  container.addEventListener("mousedown", (e: MouseEvent) => {
    if (!state.parsed) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;

    // Do NOT intercept clicks or block native events on interactive UI controls
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "input, select, textarea, button, label, .view-3d-sliders-panel, .mpr-sliders-panel, #view-3d-sliders-panel, .view-3d-orientation-widget, .mpr-orientation-widget, #view-3d-reference-cube, #mpr-reference-cube",
      )
    ) {
      return;
    }

    activeMouseButton = e.button;
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

    const cell = (e.target as HTMLElement | null)?.closest?.(".viewport-cell");
    dragOriginViewportId = cell
      ? cell.id
      : (getViewportManager()?.activeViewport?.id ?? null);

    const manager = getViewportManager();
    if (
      manager &&
      dragOriginViewportId &&
      dragOriginViewportId !== manager.activeViewport?.id
    ) {
      manager.setActiveViewport(dragOriginViewportId);
      updateToolbarUI();
    }
    const activeVp =
      (manager && dragOriginViewportId
        ? manager.getAllViewports().find((v) => v.id === dragOriginViewportId)
        : null) || manager?.activeViewport;

    // Right and Middle clicks are dedicated to W/L and Pan navigation
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      return;
    }

    if (
      state.activeTool !== "length" &&
      state.activeTool !== "ellipse" &&
      state.activeTool !== "polygon"
    ) {
      if (getActiveDrawing()) {
        setActiveDrawing(null);
      }
      handlePointerAction(e);
      e.preventDefault();
      return;
    }

    const { clickX, clickY, viewW, viewH } = getTargetMetrics(
      e,
      container,
      activeVp,
    );
    const metadata = activeVp
      ? activeVp.data.parsed?.metadata
      : state.parsed?.metadata;
    const vpState = activeVp ? activeVp.data.viewport : state.viewport;
    const sopInstanceUid =
      (activeVp
        ? activeVp.data.parsed?.metadata.sopInstanceUid
        : getActiveSopInstanceUid()) ||
      `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;
    const sliceIndex = activeVp
      ? activeVp.data.currentIndex
      : state.currentIndex;

    if (metadata && viewW > 0 && viewH > 0) {
      const existing = getAnnotationsForSlice(sopInstanceUid);
      const activeD = getActiveDrawing();

      // If already tracing a polygon with activeDrawing, handle adding points or closing
      if (
        state.activeTool === "polygon" &&
        activeD &&
        activeD.type === "polygon" &&
        activeD.points &&
        activeD.points.length > 0
      ) {
        const p0Screen = worldToScreen(
          activeD.points[0].x,
          activeD.points[0].y,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );
        const distToStart = Math.hypot(
          clickX - p0Screen.x,
          clickY - p0Screen.y,
        );

        if (distToStart <= 10 && activeD.points.length >= 3) {
          finishPolygonDrawing(
            activeD,
            metadata,
            sopInstanceUid,
            sliceIndex,
            activeVp,
          );
          e.preventDefault();
          return;
        }

        const worldPt = screenToWorld(
          clickX,
          clickY,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );
        activeD.points.push(worldPt);
        activeD.end = worldPt;
        if (activeVp) activeVp.renderOverlay();
        else render();
        e.preventDefault();
        return;
      }

      // Layer 1: Vertex hit-testing (editing node)
      const selectedId = getSelectedAnnotationId();
      const vertexHit = hitTestPolygonVertex(
        clickX,
        clickY,
        existing,
        selectedId,
        vpState,
        metadata.columns,
        metadata.rows,
        viewW,
        viewH,
        8,
      );

      if (vertexHit && !e.shiftKey) {
        setSelectedAnnotationId(vertexHit.annotationId);
        draggingNode = {
          annotationId: vertexHit.annotationId,
          vertexIndex: vertexHit.vertexIndex,
        };
        container.style.cursor = "crosshair";
        if (activeVp) activeVp.renderOverlay();
        else render();
        e.preventDefault();
        return;
      }

      // Layer 2: Shape hit-testing (edge or interior)
      const hit = hitTestAnnotation(
        clickX,
        clickY,
        existing,
        vpState,
        metadata.columns,
        metadata.rows,
        viewW,
        viewH,
      );

      if (hit && !e.shiftKey) {
        setSelectedAnnotationId(hit.id);
        if (hit.type === "polygon") {
          const worldPt = screenToWorld(
            clickX,
            clickY,
            viewW,
            viewH,
            metadata.columns,
            metadata.rows,
            vpState,
          );
          draggingShape = {
            annotationId: hit.id,
            startWorld: worldPt,
            initialPoints: hit.points.map((p) => ({ ...p })),
          };
          container.style.cursor = "move";
        }
        if (activeVp) activeVp.renderOverlay();
        else render();
        e.preventDefault();
        return;
      }

      // Layer 3: Drawing new annotation
      setSelectedAnnotationId(null);
      const worldPt = screenToWorld(
        clickX,
        clickY,
        viewW,
        viewH,
        metadata.columns,
        metadata.rows,
        vpState,
      );

      if (state.activeTool === "length") {
        setActiveDrawing({
          type: "length",
          start: worldPt,
          end: worldPt,
          cellId: activeVp ? activeVp.id : null,
        });
      } else if (state.activeTool === "ellipse") {
        setActiveDrawing({
          type: "ellipse",
          center: worldPt,
          radiusX: 0,
          radiusY: 0,
          cellId: activeVp ? activeVp.id : null,
        });
      } else if (state.activeTool === "polygon") {
        setActiveDrawing({
          type: "polygon",
          points: [worldPt],
          end: worldPt,
          cellId: activeVp ? activeVp.id : null,
        });
      }

      if (activeVp) activeVp.renderOverlay();
      else render();
      e.preventDefault();
      return;
    }

    handlePointerAction(e);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!state.parsed) return;

    // 1. Polygon elastic guide line when cursor moves between clicks
    const drawing = getActiveDrawing();
    if (!state.isDragging && drawing && drawing.type === "polygon") {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;

      const { clickX, clickY, viewW, viewH } = getTargetMetrics(
        e,
        container,
        activeVp,
      );
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const vpState = activeVp ? activeVp.data.viewport : state.viewport;

      if (metadata && viewW > 0 && viewH > 0) {
        const currentWorld = screenToWorld(
          clickX,
          clickY,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );
        drawing.end = currentWorld;
        if (activeVp) activeVp.renderOverlay();
        else render();
      }
      return;
    }

    if (!state.isDragging) return;

    // 2. Dragging polygon node (Layer 1)
    if (draggingNode) {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;

      const { clickX, clickY, viewW, viewH } = getTargetMetrics(
        e,
        container,
        activeVp,
      );
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const vpState = activeVp ? activeVp.data.viewport : state.viewport;
      const sopInstanceUid =
        (activeVp
          ? activeVp.data.parsed?.metadata.sopInstanceUid
          : getActiveSopInstanceUid()) ||
        `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;

      if (metadata && viewW > 0 && viewH > 0) {
        const currentWorld = screenToWorld(
          clickX,
          clickY,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );
        const ann = getAnnotationsForSlice(sopInstanceUid).find(
          (a) => a.id === draggingNode!.annotationId,
        );
        if (
          ann &&
          ann.type === "polygon" &&
          ann.points[draggingNode.vertexIndex]
        ) {
          ann.points[draggingNode.vertexIndex] = { ...currentWorld };
          const cal = extractCalibration(metadata);
          ann.area = calculatePolygonArea(ann.points, cal.pixelSpacing);
          ann.perimeter = calculatePolygonPerimeter(
            ann.points,
            cal.pixelSpacing,
          );
          updateAnnotation(ann);
          if (activeVp) activeVp.renderOverlay();
          else render();
        }
      }
      return;
    }

    // 3. Dragging polygon shape (Layer 2)
    if (draggingShape) {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;

      const { clickX, clickY, viewW, viewH } = getTargetMetrics(
        e,
        container,
        activeVp,
      );
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const vpState = activeVp ? activeVp.data.viewport : state.viewport;
      const sopInstanceUid =
        (activeVp
          ? activeVp.data.parsed?.metadata.sopInstanceUid
          : getActiveSopInstanceUid()) ||
        `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;

      if (metadata && viewW > 0 && viewH > 0) {
        const currentWorld = screenToWorld(
          clickX,
          clickY,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );
        const ann = getAnnotationsForSlice(sopInstanceUid).find(
          (a) => a.id === draggingShape!.annotationId,
        );
        if (ann && ann.type === "polygon") {
          const deltaX = currentWorld.x - draggingShape.startWorld.x;
          const deltaY = currentWorld.y - draggingShape.startWorld.y;
          ann.points = draggingShape.initialPoints.map((p) => ({
            x: p.x + deltaX,
            y: p.y + deltaY,
          }));
          updateAnnotation(ann);
          if (activeVp) activeVp.renderOverlay();
          else render();
        }
      }
      return;
    }

    const isMeasurementTool =
      state.activeTool === "length" || state.activeTool === "ellipse";

    if (isMeasurementTool && drawing) {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;

      const { clickX, clickY, viewW, viewH } = getTargetMetrics(
        e,
        container,
        activeVp,
      );
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const vpState = activeVp ? activeVp.data.viewport : state.viewport;

      if (metadata && viewW > 0 && viewH > 0) {
        const currentWorld = screenToWorld(
          clickX,
          clickY,
          viewW,
          viewH,
          metadata.columns,
          metadata.rows,
          vpState,
        );

        if (drawing.type === "length") {
          drawing.end = currentWorld;
        } else if (drawing.type === "ellipse" && drawing.center) {
          drawing.radiusX = Math.abs(currentWorld.x - drawing.center.x);
          drawing.radiusY = Math.abs(currentWorld.y - drawing.center.y);
        }

        if (activeVp) activeVp.renderOverlay();
        else render();
      }
      return;
    }

    if (drawing && drawing.type !== "polygon") {
      setActiveDrawing(null);
    }

    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

    const manager = getViewportManager();
    const originId = dragOriginViewportId || manager?.activeViewport?.id || "";
    const activeVp =
      (manager && originId
        ? manager.getAllViewports().find((v) => v.id === originId)
        : null) || manager?.activeViewport;
    const is3DTarget =
      state.is3DMode || (manager && manager.isCombined3DViewport(originId));

    // ── Radiological Standard: Middle Click Drag = Pan ──────────────────────
    if (activeMouseButton === 1) {
      if (is3DTarget) {
        view3DViewer.camera.panX += dx;
        view3DViewer.camera.panY += dy;
        const canvas = (document.getElementById("view-3d-canvas") ||
          document.getElementById("dicom-canvas")) as HTMLCanvasElement;
        if (state.is3DMode && canvas) {
          view3DViewer.render(canvas);
        } else if (manager) {
          for (const vp of manager.getAllViewports()) vp.render();
        } else {
          render();
        }
      } else if (activeVp && manager) {
        if (mprEngine.volume && state.isMprMode) {
          manager.dispatchMprPan(
            activeVp.id,
            dx,
            dy,
            activeVp.canvasElement.clientWidth || container.clientWidth || 300,
            activeVp.canvasElement.clientHeight ||
              container.clientHeight ||
              300,
          );
        } else {
          manager.dispatchPan(activeVp.id, dx, dy);
          state.viewport.panX = activeVp.data.viewport.panX;
          state.viewport.panY = activeVp.data.viewport.panY;
        }
      } else {
        if (mprEngine.volume && state.isMprMode) {
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
        render();
      }
      return;
    }

    // ── Radiological Standard: Right Click Drag = Window / Level ─────────────
    if (activeMouseButton === 2) {
      if (state.isMprMode && manager) {
        manager.dispatchWindowLevel(activeVp?.id || "vp-0", dx * 2, dy * 2);
        updateWlControlsUI();
        return;
      }

      if (is3DTarget) {
        state.viewport.windowWidth = Math.max(
          1,
          state.viewport.windowWidth + dx * 2,
        );
        state.viewport.windowCenter += dy * 2;
        mprEngine.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        view3DViewer.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        const canvas = (document.getElementById("view-3d-canvas") ||
          document.getElementById("dicom-canvas")) as HTMLCanvasElement;
        if (state.is3DMode && canvas) {
          view3DViewer.render(canvas);
        } else if (manager) {
          for (const vp of manager.getAllViewports()) vp.render();
        } else {
          render();
        }
        updateWlControlsUI();
      } else if (activeVp && manager) {
        manager.dispatchWindowLevel(activeVp.id, dx * 2, dy * 2);
        state.viewport.windowWidth = activeVp.data.viewport.windowWidth;
        state.viewport.windowCenter = activeVp.data.viewport.windowCenter;
        mprEngine.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        view3DViewer.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        updateWlControlsUI();
      } else {
        state.viewport.windowWidth = Math.max(
          1,
          state.viewport.windowWidth + dx * 2,
        );
        state.viewport.windowCenter += dy * 2;
        mprEngine.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        view3DViewer.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        render();
        updateWlControlsUI();
      }
      return;
    }

    // ── Left Button Drag (or Active Tool interaction) ───────────────────────
    if (is3DTarget && state.isDragging) {
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
        mprEngine.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        view3DViewer.setWindowLevel(
          state.viewport.windowCenter,
          state.viewport.windowWidth,
        );
        if (state.isMprMode && manager) {
          for (const vp of manager.getAllViewports()) {
            vp.data.viewport.windowWidth = state.viewport.windowWidth;
            vp.data.viewport.windowCenter = state.viewport.windowCenter;
          }
        }
        updateWlControlsUI();
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
      } else if (manager) {
        for (const vp of manager.getAllViewports()) vp.render();
      } else {
        render();
      }
      return;
    }

    // ── 2D / MPR tools: route through ViewportManager so sync propagates ──
    if (activeVp && manager) {
      switch (state.activeTool) {
        case "wl":
          manager.dispatchWindowLevel(activeVp.id, dx * 2, dy * 2);
          // Mirror into global state so W/L sliders stay in sync.
          state.viewport.windowWidth = activeVp.data.viewport.windowWidth;
          state.viewport.windowCenter = activeVp.data.viewport.windowCenter;
          mprEngine.setWindowLevel(
            state.viewport.windowCenter,
            state.viewport.windowWidth,
          );
          view3DViewer.setWindowLevel(
            state.viewport.windowCenter,
            state.viewport.windowWidth,
          );
          updateWlControlsUI();
          break;
        case "zoom":
          manager.dispatchZoom(activeVp.id, 1 - dy * 0.005);
          state.viewport.zoom = activeVp.data.viewport.zoom;
          break;
        case "pan":
          if (mprEngine.volume && state.isMprMode) {
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
        default:
          if (mprEngine.volume && state.isMprMode) {
            const crosshairOriginId = dragOriginViewportId || activeVp.id;
            if (manager.isCombined3DViewport(crosshairOriginId)) {
              break;
            }

            manager.dispatchMprCrosshair(
              crosshairOriginId,
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
          mprEngine.setWindowLevel(
            state.viewport.windowCenter,
            state.viewport.windowWidth,
          );
          view3DViewer.setWindowLevel(
            state.viewport.windowCenter,
            state.viewport.windowWidth,
          );
          updateWlControlsUI();
          break;
        case "zoom":
          state.viewport.zoom = Math.max(
            0.1,
            Math.min(10, state.viewport.zoom * (1 - dy * 0.005)),
          );
          break;
        case "pan":
          if (mprEngine.volume && state.isMprMode) {
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
        default:
          if (mprEngine.volume && state.isMprMode) {
            mprEngine.applyCrosshairDelta2D(
              "axial",
              dx,
              dy,
              container.clientWidth || 300,
              container.clientHeight || 300,
            );
            const [nx, ny, nz] = mprEngine.crosshairNormalized;
            mprCoordinator.setCrosshairFromNormalized(nx, ny, nz);
          }
          break;
      }
      render();
    }
  });

  document.addEventListener("mouseup", () => {
    if (draggingNode) {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const sopInstanceUid =
        (activeVp
          ? activeVp.data.parsed?.metadata.sopInstanceUid
          : getActiveSopInstanceUid()) ||
        `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;

      if (metadata) {
        const ann = getAnnotationsForSlice(sopInstanceUid).find(
          (a) => a.id === draggingNode!.annotationId,
        );
        if (ann && ann.type === "polygon") {
          const cal = extractCalibration(metadata);
          const announceEl = $("measure-announce");
          if (announceEl) {
            const areaStr = formatArea(
              ann.area,
              cal.isCalibrated,
              state.measurementUnit,
            );
            const perimeterStr = formatLength(
              ann.perimeter,
              cal.isCalibrated,
              state.measurementUnit,
            );
            announceEl.textContent = `${t("annotations.polygon") || "Polígono"}: ${t("annotations.area") || "Área"} ${areaStr}, ${t("annotations.perimeter") || "Perímetro"} ${perimeterStr}`;
          }
        }
      }
      draggingNode = null;
      container.style.cursor = "";
    }

    if (draggingShape) {
      draggingShape = null;
      container.style.cursor = "";
    }

    const isMeasurementTool =
      state.activeTool === "length" || state.activeTool === "ellipse";
    const drawing = getActiveDrawing();

    if (isMeasurementTool && drawing) {
      const manager = getViewportManager();
      const originId =
        dragOriginViewportId || manager?.activeViewport?.id || "";
      const activeVp =
        (manager && originId
          ? manager.getAllViewports().find((v) => v.id === originId)
          : null) || manager?.activeViewport;
      const metadata = activeVp
        ? activeVp.data.parsed?.metadata
        : state.parsed?.metadata;
      const pixelData = activeVp
        ? activeVp.data.parsed?.pixelData
        : state.parsed?.pixelData;
      const sopInstanceUid =
        (activeVp
          ? activeVp.data.parsed?.metadata.sopInstanceUid
          : getActiveSopInstanceUid()) ||
        `slice_${activeVp ? activeVp.data.currentIndex : state.currentIndex}`;
      const sliceIndex = activeVp
        ? activeVp.data.currentIndex
        : state.currentIndex;

      if (metadata) {
        const cal = extractCalibration(metadata);
        if (drawing.type === "length" && drawing.start && drawing.end) {
          const dx = drawing.end.x - drawing.start.x;
          const dy = drawing.end.y - drawing.start.y;
          if (Math.hypot(dx, dy) >= 3) {
            const dist = calculateDistance(
              drawing.start,
              drawing.end,
              cal.pixelSpacing,
            );
            const newAnn: LengthAnnotation = {
              id: `ann_len_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              type: "length",
              sopInstanceUid,
              sliceIndex,
              start: { ...drawing.start },
              end: { ...drawing.end },
              distance: dist,
              isCalibrated: cal.isCalibrated,
              unit: cal.isCalibrated ? "mm" : "px",
              createdAt: Date.now(),
            };
            addAnnotation(newAnn);
            setSelectedAnnotationId(newAnn.id);

            const announceEl = $("measure-announce");
            if (announceEl) {
              const val = formatLength(
                dist,
                cal.isCalibrated,
                state.measurementUnit,
              );
              announceEl.textContent = `${t("annotations.length") || "Longitud"}: ${val}`;
            }
          }
        } else if (
          drawing.type === "ellipse" &&
          drawing.center &&
          typeof drawing.radiusX === "number" &&
          typeof drawing.radiusY === "number"
        ) {
          if (drawing.radiusX >= 3 && drawing.radiusY >= 3) {
            const area = calculateEllipseArea(
              drawing.radiusX,
              drawing.radiusY,
              cal.pixelSpacing,
            );
            let meanHu: number | undefined;
            let stdDevHu: number | undefined;
            if (pixelData) {
              const hu = calculateEllipseHUStats(
                drawing.center,
                drawing.radiusX,
                drawing.radiusY,
                pixelData,
                metadata.columns,
                metadata.rows,
                cal.rescaleSlope,
                cal.rescaleIntercept,
              );
              if (hu) {
                meanHu = hu.mean;
                stdDevHu = hu.stdDev;
              }
            }
            const newAnn: EllipseAnnotation = {
              id: `ann_ell_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              type: "ellipse",
              sopInstanceUid,
              sliceIndex,
              center: { ...drawing.center },
              radiusX: drawing.radiusX,
              radiusY: drawing.radiusY,
              area,
              isCalibrated: cal.isCalibrated,
              unit: cal.isCalibrated ? "mm²" : "px²",
              meanHu,
              stdDevHu,
              createdAt: Date.now(),
            };
            addAnnotation(newAnn);
            setSelectedAnnotationId(newAnn.id);

            const announceEl = $("measure-announce");
            if (announceEl) {
              const val = formatArea(
                area,
                cal.isCalibrated,
                state.measurementUnit,
              );
              const huStr =
                typeof meanHu === "number"
                  ? `, Media: ${meanHu.toFixed(1)} HU`
                  : "";
              announceEl.textContent = `${t("annotations.area") || "Área"}: ${val}${huStr}`;
            }
          }
        }
      }

      setActiveDrawing(null);
      if (activeVp) activeVp.renderOverlay();
      else render();
    } else if (drawing && drawing.type !== "polygon") {
      setActiveDrawing(null);
      const manager = getViewportManager();
      const activeVp = manager?.activeViewport;
      if (activeVp) activeVp.renderOverlay();
      else render();
    }

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
    activeMouseButton = 0;
    dragOriginViewportId = null;
    isRotatingMprCrosshair = false;
  });

  container.addEventListener("dblclick", (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "input, select, textarea, button, .view-3d-sliders-panel, .mpr-sliders-panel, #view-3d-sliders-panel",
      )
    ) {
      return;
    }
    if (state.activeTool === "polygon") {
      completeActivePolygon();
      e.preventDefault();
    }
  });

  // Mouse wheel interaction
  container.addEventListener(
    "wheel",
    async (e: WheelEvent) => {
      if (!state.parsed) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".view-3d-sliders-panel, .mpr-sliders-panel, #view-3d-sliders-panel, .view-3d-orientation-widget, .mpr-orientation-widget",
        )
      ) {
        return;
      }
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
        // Slice scroll — routes through the manager so synced viewports follow.
        await navigateSliceDelta(e.deltaY > 0 ? 1 : -1);
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
  const render3D = () => {
    const canvas = (document.getElementById("view-3d-canvas") ||
      document.getElementById("dicom-canvas")) as HTMLCanvasElement;
    if (canvas && state.is3DMode) {
      view3DViewer.render(canvas);
    }
  };

  const syncAndRenderAfterSlider = () => {
    render3D();
    const manager = getViewportManager();
    if (manager) {
      for (const vp of manager.getAllViewports()) {
        vp.render();
      }
    } else {
      render();
    }
  };

  // Depth slider (legacy fallback if present in test DOM)
  const depthSliders = [
    $("view-3d-depth-slider"),
    $("mpr-depth-slider"),
  ].filter(Boolean) as HTMLInputElement[];

  depthSliders.forEach((depthSlider) => {
    depthSlider.addEventListener("input", () => {
      const idx = parseInt(depthSlider.value, 10);
      view3DViewer.setDepthIndex(idx);
      mprCoordinator.updateCrosshairAxis("axial", idx);
      syncAndRenderAfterSlider();
    });
  });

  // Stop propagation on floating slider panels to isolate from viewport navigation
  const sliderPanels = [
    $("view-3d-sliders-panel"),
    $("mpr-sliders-panel"),
  ].filter(Boolean) as HTMLElement[];

  sliderPanels.forEach((panel) => {
    panel.addEventListener("mousedown", (e) => e.stopPropagation());
    panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  const onAxialInput = (slider: HTMLInputElement) => {
    setActiveInteractingSlider(slider);
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      console.warn("[DEBUG] Slider movido a:", idx, { axis: "axial" });
      mprCoordinator.updateCrosshairAxis("axial", idx);
      syncAndRenderAfterSlider();
    }
  };

  const onCoronalInput = (slider: HTMLInputElement) => {
    setActiveInteractingSlider(slider);
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      console.warn("[DEBUG] Slider movido a:", idx, {
        axis: "coronal",
      });
      mprCoordinator.updateCrosshairAxis("coronal", idx);
      syncAndRenderAfterSlider();
    }
  };

  const onSagittalInput = (slider: HTMLInputElement) => {
    setActiveInteractingSlider(slider);
    const idx = parseInt(slider.value, 10);
    if (!isNaN(idx)) {
      console.warn("[DEBUG] Slider movido a:", idx, {
        axis: "sagittal",
      });
      mprCoordinator.updateCrosshairAxis("sagittal", idx);
      syncAndRenderAfterSlider();
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

  // Track active interacting slider to break reactivity loops
  const all3DSliders = [
    "view-3d-scroll-axial",
    "mpr-scroll-axial",
    "view-3d-scroll-coronal",
    "mpr-scroll-coronal",
    "view-3d-scroll-sagittal",
    "mpr-scroll-sagittal",
  ]
    .map((id) => $(id) as HTMLInputElement | null)
    .filter(Boolean) as HTMLInputElement[];

  all3DSliders.forEach((slider) => {
    slider.addEventListener("pointerdown", () =>
      setActiveInteractingSlider(slider),
    );
    slider.addEventListener("mousedown", () =>
      setActiveInteractingSlider(slider),
    );
    slider.addEventListener("focus", () => setActiveInteractingSlider(slider));
    slider.addEventListener("blur", () => {
      if (getActiveInteractingSlider() === slider) {
        setActiveInteractingSlider(null);
      }
    });
    slider.addEventListener("change", () => setActiveInteractingSlider(null));
  });

  if (typeof window !== "undefined") {
    window.addEventListener("pointerup", () =>
      setActiveInteractingSlider(null),
    );
    window.addEventListener("mouseup", () => setActiveInteractingSlider(null));
  }

  // Reverse reactivity: update 3-axis sliders & counters on any crosshair change
  mprCoordinator.onCrosshairChange(() => {
    update3DSlidersUI();
  });

  // Quick view orientation buttons
  const setView = (view: "axial" | "coronal" | "sagittal" | "3d") => {
    const canvas =
      (document.getElementById("view-3d-canvas") as HTMLCanvasElement | null) ||
      (document.getElementById("dicom-canvas") as HTMLCanvasElement | null);
    const btnName =
      view === "axial"
        ? "Axial"
        : view === "coronal"
          ? "Coronal"
          : view === "sagittal"
            ? "Sagital"
            : "Volumetric View";
    console.warn(`[DEBUG-CONTROLS] Click en botón ${btnName}`, {
      camera: { ...view3DViewer.camera },
      canvasDimensions: {
        clientWidth: canvas?.clientWidth ?? 0,
        clientHeight: canvas?.clientHeight ?? 0,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        isConnected: canvas?.isConnected ?? false,
      },
      windowWidth: view3DViewer.windowWidth,
      windowCenter: view3DViewer.windowCenter,
    });
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
  $("btn-view-3d-3d")?.addEventListener("click", () => setView("3d"));
  $("btn-view-3d")?.addEventListener("click", () => setView("3d"));
  $("btn-mpr-3d")?.addEventListener("click", () => setView("3d"));

  // Interactive Reference Cube (Gizmo) Hit-Testing & Smooth Alignment
  const gizmoCanvases = [
    $("view-3d-reference-cube"),
    $("mpr-reference-cube"),
  ].filter(Boolean) as HTMLCanvasElement[];

  gizmoCanvases.forEach((gizmo) => {
    gizmo.addEventListener("pointerdown", (e: PointerEvent) => {
      e.stopPropagation();
      const rect = gizmo.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const hitFace = view3DViewer.hitTestGizmoFace(clickX, clickY, gizmo);
      if (hitFace) {
        const targetAngles = view3DViewer.getTargetAnglesForFace(hitFace);
        if (targetAngles) {
          const main3DCanvas = (document.getElementById("view-3d-canvas") ||
            document.getElementById(
              "dicom-canvas",
            )) as HTMLCanvasElement | null;
          view3DViewer.animateCameraTo(
            targetAngles.theta,
            targetAngles.phi,
            280,
            main3DCanvas || undefined,
          );
        }
      }
    });
  });
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

export {
  update3DSlidersUI,
  updateMPRSlidersUI,
  setActiveInteractingSlider,
  getActiveInteractingSlider,
};

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
      await navigateSliceDelta(-1);
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      await navigateSliceDelta(1);
      return;
    }

    if (e.key === "w" || e.key === "W") {
      $("tool-wl")?.click();
    } else if (e.key === "z" || e.key === "Z") {
      $("tool-zoom")?.click();
    } else if (e.key === "p" || e.key === "P") {
      $("tool-pan")?.click();
    } else if (e.key === "c" || e.key === "C") {
      if (state.is3DMode) {
        $("tool-crosshair")?.click();
      }
    } else if (e.key === "l" || e.key === "L") {
      if (!state.is3DMode) {
        $("tool-length")?.click();
      }
    } else if (e.key === "e" || e.key === "E") {
      if (!state.is3DMode) {
        $("tool-ellipse")?.click();
      }
    } else if (e.key === "Enter") {
      if (
        state.activeTool === "polygon" &&
        getActiveDrawing()?.type === "polygon"
      ) {
        completeActivePolygon();
        e.preventDefault();
        return;
      }
    } else if (e.key === "Escape") {
      if (getActiveDrawing()) {
        setActiveDrawing(null);
        render();
        const manager = getViewportManager();
        if (manager) {
          for (const vp of manager.getAllViewports()) vp.render();
        }
      } else if (getSelectedAnnotationId()) {
        setSelectedAnnotationId(null);
        render();
        const manager = getViewportManager();
        if (manager) {
          for (const vp of manager.getAllViewports()) vp.render();
        }
      } else if (state.isMeasurementPanelOpen) {
        state.isMeasurementPanelOpen = false;
        updateToolbarUI();
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const selectedId = getSelectedAnnotationId();
      if (selectedId) {
        deleteAnnotation(selectedId);
        setSelectedAnnotationId(null);
        render();
        const manager = getViewportManager();
        if (manager) {
          for (const vp of manager.getAllViewports()) vp.render();
        }
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
    if (state.is3DMode) {
      ensure3DRendered();
    } else if (state.parsed) {
      render();
    }
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
      getMprTrackball()?.closePopover();
      getViewportManager()?.setLayout(layout);
      updateGridLayoutUI(layout);
      updateToolbarUI();
      if (state.is3DMode) {
        ensure3DRendered();
      }
    });
  });

  const syncBtn = document.getElementById("btn-sync-viewports");
  syncBtn?.addEventListener("click", () => {
    setViewportSync(!syncBtn.classList.contains("active"));
  });
}

/**
 * Single place that flips viewport sync — updates the manager and the toolbar
 * button together so they never drift. Called on the button click and whenever a
 * new study/file loads (sync resets to off on every study change).
 */
export function setViewportSync(enabled: boolean): void {
  getViewportManager()?.setSync(enabled);
  const btn = document.getElementById("btn-sync-viewports");
  if (btn) {
    btn.classList.toggle("active", enabled);
    btn.setAttribute("aria-pressed", String(enabled));
  }
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

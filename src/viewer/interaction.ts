import {
  calculateAutoWindowLevel,
  WINDOW_PRESETS,
} from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $ } from "../shared/dom.js";
import { anyDialogOpen, openDialog, closeDialog } from "../shared/dialog.js";
import { currentScreen } from "../shared/screen.js";
import { state, itemCount } from "./state.js";
import { render, updateSeriesNav } from "./rendering.js";
import { loadCurrent, openFiles, openFolder } from "./loading.js";
import { mpr3DViewer } from "./mpr.js";
import {
  exportCurrentViewToPNG,
  exportCurrentStudyAsZip,
} from "../services/export-service.js";
import { openServerScreen } from "../server-screen/server-screen.js";

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function initToolbar(): void {
  const tools = ["wl", "zoom", "pan", "crosshair"] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    if (btn) {
      btn.addEventListener("click", () => {
        if (tool === "pan" && state.is3DMode) return;
        if (tool === "crosshair" && !state.is3DMode) return;
        if (tool === "wl") {
          if (state.activeTool === "wl") {
            state.isWlPanelOpen = !state.isWlPanelOpen;
          } else {
            state.activeTool = "wl";
            state.isWlPanelOpen = true;
          }
        } else {
          state.activeTool = tool;
          state.isWlPanelOpen = false;
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
      mpr3DViewer.camera.zoom = 1;
      mpr3DViewer.camera.panX = 0;
      mpr3DViewer.camera.panY = 0;
    }

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

  $("tool-mpr")?.addEventListener("click", async () => {
    const btn = $("tool-mpr") as HTMLButtonElement | null;
    if (btn && !btn.disabled) {
      await mpr3DViewer.toggle3DMode();
      updateSeriesNav();
      updateToolbarUI();
      render();
    }
  });

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
  init3DControlsInteraction();
  updateToolbarUI();
}

function initWlControlsInteraction(): void {
  const sliderWW = $("slider-ww") as HTMLInputElement | null;
  const sliderWL = $("slider-wl") as HTMLInputElement | null;

  if (sliderWW) {
    sliderWW.addEventListener("input", () => {
      const val = parseFloat(sliderWW.value);
      state.viewport.windowWidth = Math.max(1, val);
      render();
    });
  }

  if (sliderWL) {
    sliderWL.addEventListener("input", () => {
      const val = parseFloat(sliderWL.value);
      state.viewport.windowCenter = val;
      render();
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

export function updateToolbarUI(): void {
  if (state.is3DMode && state.activeTool === "pan") {
    state.activeTool = "wl";
  } else if (!state.is3DMode && state.activeTool === "crosshair") {
    state.activeTool = "wl";
  }

  const panBtn = $("tool-pan") as HTMLButtonElement | null;
  if (panBtn) {
    panBtn.disabled = state.is3DMode;
  }

  const crosshairBtn = $("tool-crosshair") as HTMLButtonElement | null;
  if (crosshairBtn) {
    crosshairBtn.disabled = !state.is3DMode;
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

  const exportBtn = $("btn-export-menu") as HTMLButtonElement | null;
  if (exportBtn) {
    const hasLoadedStudy = itemCount() > 0 || state.parsed !== null;
    exportBtn.disabled = !hasLoadedStudy;
  }

  const viewport = $("viewport-container");
  if (viewport) {
    viewport.className = "viewport-container";
    viewport.classList.add(`cursor-${state.activeTool}`);
  }
}

// ── Viewport Mouse Interaction ───────────────────────────────────────────────

export function initViewportInteraction(): void {
  const container = $("viewport-container");

  const handlePointerAction = (e: MouseEvent) => {
    if (!state.parsed) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (state.is3DMode && state.activeTool === "crosshair") {
      mpr3DViewer.updateCrosshairFromPointer(
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
        mpr3DViewer.camera.panX += dx;
        mpr3DViewer.camera.panY += dy;
      } else if (state.activeTool === "zoom") {
        mpr3DViewer.camera.zoom = Math.max(
          0.1,
          Math.min(10, mpr3DViewer.camera.zoom * (1 - dy * 0.005)),
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

        mpr3DViewer.camera.phi += movementX * sensitivity;
        mpr3DViewer.camera.theta = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(
            Math.PI / 2 - 0.1,
            mpr3DViewer.camera.theta + movementY * sensitivity,
          ),
        );
        if (state.activeTool === "crosshair") {
          handlePointerAction(e);
        }
      }
      const canvas = document.getElementById(
        "dicom-canvas",
      ) as HTMLCanvasElement;
      if (state.is3DMode && canvas) {
        mpr3DViewer.render(canvas);
      } else {
        render();
      }
      return;
    }

    switch (state.activeTool) {
      case "wl":
        state.viewport.windowWidth = Math.max(
          1,
          state.viewport.windowWidth + dx * 2,
        );
        state.viewport.windowCenter += dy * 2;
        break;
      case "zoom":
        if (state.is3DMode) {
          mpr3DViewer.camera.zoom = Math.max(
            0.1,
            Math.min(10, mpr3DViewer.camera.zoom * (1 - dy * 0.005)),
          );
        } else {
          state.viewport.zoom = Math.max(
            0.1,
            Math.min(10, state.viewport.zoom * (1 - dy * 0.005)),
          );
        }
        break;
      case "pan":
        if (state.is3DMode) {
          mpr3DViewer.camera.panX += dx;
          mpr3DViewer.camera.panY += dy;
        } else {
          state.viewport.panX += dx;
          state.viewport.panY += dy;
        }
        break;
    }

    render();
  });

  document.addEventListener("mouseup", () => {
    if (state.isDragging && state.is3DMode) {
      console.groupCollapsed("⚙️ [MPR 3D Debug] Post-Interaction State");
      console.log("Camera (Theta, Phi, Zoom):", mpr3DViewer.camera);
      console.log("Crosshair (X, Y, Z):", mpr3DViewer.crosshair);
      console.log(
        "Window (W/L):",
        state.viewport.windowWidth,
        state.viewport.windowCenter,
      );
      console.log("Active View:", mpr3DViewer.activeView);
      console.groupEnd();
    }
    state.isDragging = false;
  });

  // Mouse wheel interaction
  container.addEventListener(
    "wheel",
    async (e: WheelEvent) => {
      if (!state.parsed) return;
      e.preventDefault();

      if (state.is3DMode) {
        // Depth slice navigation in 3D mode
        const depthInfo = mpr3DViewer.getDepthInfo();
        const delta = e.deltaY > 0 ? 1 : -1;
        const target = depthInfo.current + delta;
        if (target >= 0 && target < depthInfo.total) {
          mpr3DViewer.setDepthIndex(target);
          const canvas = document.getElementById(
            "dicom-canvas",
          ) as HTMLCanvasElement;
          if (state.is3DMode && canvas) {
            mpr3DViewer.render(canvas);
          } else {
            render();
          }
        }
      } else {
        // 2D mode stack scrolling
        const total = itemCount();
        if (total > 1 && !e.ctrlKey && !e.metaKey) {
          const delta = e.deltaY > 0 ? 1 : -1;
          const targetIndex = state.currentIndex + delta;
          if (targetIndex >= 0 && targetIndex < total) {
            state.currentIndex = targetIndex;
            await loadCurrent();
          }
        } else {
          const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
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

function init3DControlsInteraction(): void {
  // Depth slider
  const depthSlider = $("mpr-depth-slider") as HTMLInputElement | null;
  if (depthSlider) {
    depthSlider.addEventListener("input", () => {
      const idx = parseInt(depthSlider.value, 10);
      mpr3DViewer.setDepthIndex(idx);
      render();
    });
  }

  // Quick view orientation buttons
  $("btn-view-axial")?.addEventListener("click", () => {
    mpr3DViewer.setOrientation("axial");
    updateOrientationButtonsUI("axial");
    render();
  });

  $("btn-view-coronal")?.addEventListener("click", () => {
    mpr3DViewer.setOrientation("coronal");
    updateOrientationButtonsUI("coronal");
    render();
  });

  $("btn-view-sagittal")?.addEventListener("click", () => {
    mpr3DViewer.setOrientation("sagittal");
    updateOrientationButtonsUI("sagittal");
    render();
  });

  $("btn-view-3d")?.addEventListener("click", () => {
    mpr3DViewer.setOrientation("3d");
    updateOrientationButtonsUI("3d");
    render();
  });
}

function updateOrientationButtonsUI(
  activeView: "axial" | "coronal" | "sagittal" | "3d",
): void {
  ["axial", "coronal", "sagittal", "3d"].forEach((view) => {
    const btn = $(`btn-view-${view}`);
    if (btn) {
      btn.classList.toggle("active", view === activeView);
    }
  });
}

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
      const depthInfo = mpr3DViewer.getDepthInfo();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (depthInfo.current > 0) {
          mpr3DViewer.setDepthIndex(depthInfo.current - 1);
          render();
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (depthInfo.current < depthInfo.total - 1) {
          mpr3DViewer.setDepthIndex(depthInfo.current + 1);
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

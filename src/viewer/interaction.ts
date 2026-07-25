import { calculateAutoWindowLevel } from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $ } from "../shared/dom.js";
import { state, itemCount } from "./state.js";
import { render, updateSeriesNav } from "./rendering.js";
import { loadCurrent, openFiles, openFolder } from "./loading.js";
import { mpr3DViewer } from "./mpr.js";

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function initToolbar(): void {
  const tools = ["wl", "zoom", "pan", "crosshair"] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    if (btn) {
      btn.addEventListener("click", () => {
        state.activeTool = tool;
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
  });

  $("tool-mpr")?.addEventListener("click", async () => {
    const btn = $("tool-mpr") as HTMLButtonElement | null;
    if (btn && !btn.disabled) {
      await mpr3DViewer.toggle3DMode();
      updateSeriesNav();
      render();
    }
  });

  $("btn-open").addEventListener("click", openFiles);

  init3DControlsInteraction();
  updateToolbarUI();
}

function updateToolbarUI(): void {
  document
    .querySelectorAll(".toolbar__tool")
    .forEach((el) => el.classList.remove("active"));

  const activeBtn = $(`tool-${state.activeTool}`);
  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  const viewport = $("viewport-container");
  viewport.className = "viewport-container";
  viewport.classList.add(`cursor-${state.activeTool}`);
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

    if (state.activeTool === "crosshair") {
      handlePointerAction(e);
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
          render();
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
}

function updateOrientationButtonsUI(
  activeView: "axial" | "coronal" | "sagittal",
): void {
  ["axial", "coronal", "sagittal"].forEach((view) => {
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
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

export function initKeyboardShortcuts(): void {
  document.addEventListener("keydown", async (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return;
    }

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
      const total = itemCount();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (state.currentIndex > 0) {
          state.currentIndex--;
          await loadCurrent();
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (state.currentIndex < total - 1) {
          state.currentIndex++;
          await loadCurrent();
        }
      }
    }

    if (e.key === "w" || e.key === "W") {
      state.activeTool = "wl";
      updateToolbarUI();
    } else if (e.key === "z" || e.key === "Z") {
      state.activeTool = "zoom";
      updateToolbarUI();
    } else if (e.key === "p" || e.key === "P") {
      state.activeTool = "pan";
      updateToolbarUI();
    } else if (e.key === "c" || e.key === "C") {
      state.activeTool = "crosshair";
      updateToolbarUI();
    } else if (e.key === "r" || e.key === "R") {
      $("tool-reset").click();
    } else if (e.key === "m" || e.key === "M") {
      $("tool-metadata").click();
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

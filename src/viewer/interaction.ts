import { calculateAutoWindowLevel } from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $ } from "../shared/dom.js";
import { state, itemCount } from "./state.js";
import { render } from "./rendering.js";
import { loadCurrent, openFiles, openFolder } from "./loading.js";

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function initToolbar(): void {
  const tools = ["wl", "zoom", "pan"] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    btn.addEventListener("click", () => {
      state.activeTool = tool;
      updateToolbarUI();
    });
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

  $("btn-open").addEventListener("click", openFiles);

  updateToolbarUI();
}

function updateToolbarUI(): void {
  // Only the three mode tools are mutually exclusive. Clearing every
  // .toolbar__tool would also strip the metadata toggle's state, leaving its
  // class and aria-expanded disagreeing with the open panel.
  (["wl", "zoom", "pan"] as const).forEach((tool) => {
    const btn = $(`tool-${tool}`);
    const isActive = tool === state.activeTool;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const viewport = $("viewport-container");
  viewport.className = "viewport-container";
  viewport.classList.add(`cursor-${state.activeTool}`);
}

// ── Viewport Mouse Interaction ───────────────────────────────────────────────

export function initViewportInteraction(): void {
  const container = $("viewport-container");

  container.addEventListener("mousedown", (e: MouseEvent) => {
    if (!state.parsed) return;
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!state.isDragging || !state.parsed) return;

    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

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
        state.viewport.panX += dx;
        state.viewport.panY += dy;
        break;
    }

    render();
  });

  document.addEventListener("mouseup", () => {
    state.isDragging = false;
  });

  container.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (!state.parsed) return;
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
      state.viewport.zoom = Math.max(
        0.1,
        Math.min(10, state.viewport.zoom * zoomFactor),
      );
      render();
    },
    { passive: false },
  );
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
    // Ignore keystrokes while typing (login dialog, search box, date filters).
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      if (state.currentIndex > 0) {
        state.currentIndex--;
        await loadCurrent();
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      if (state.currentIndex < itemCount() - 1) {
        state.currentIndex++;
        await loadCurrent();
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

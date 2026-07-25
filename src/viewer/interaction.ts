import { calculateAutoWindowLevel } from "../dicom/dicom-parser-util.js";
import {
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { $ } from "../shared/dom.js";
import { anyDialogOpen } from "../shared/dialog.js";
import { currentScreen } from "../shared/screen.js";
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

    // Arrows drive the active tool; series navigation moves to PageUp/PageDown
    // so both are reachable without a pointer.
    if (adjustActiveTool(e)) {
      e.preventDefault();
      return;
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

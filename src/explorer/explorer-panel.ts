// ── Explorer panel toggle + drag-resize ──────────────────────────────────────
// Manages the "Estudios en servidor" panel's open/closed state and its
// draggable left edge, mirroring the DevTools resize UX.

const STORAGE_KEY = "micd_explorer_width";
const MIN_WIDTH = 220;
const MAX_RATIO = 0.55; // 55vw

function getPanel(): HTMLElement {
  return document.getElementById("explorer-panel") as HTMLElement;
}

function isCollapsed(): boolean {
  return getPanel().classList.contains("explorer-panel--collapsed");
}

function setCollapsed(collapsed: boolean): void {
  const panel = getPanel();
  const btn = document.getElementById("btn-toggle-explorer");
  panel.classList.toggle("explorer-panel--collapsed", collapsed);
  btn?.setAttribute("aria-expanded", String(!collapsed));
  btn?.classList.toggle("active", !collapsed);
}

function initToggle(): void {
  document.getElementById("btn-toggle-explorer")?.addEventListener("click", () => {
    setCollapsed(!isCollapsed());
  });
}

function initResizeHandle(): void {
  const panel = getPanel();
  const handle = document.getElementById("explorer-resize-handle");
  if (!handle) return;

  // Restore saved width
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= MIN_WIDTH) panel.style.width = `${w}px`;
  }

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    if (isCollapsed()) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add("explorer-panel__resize-handle--dragging");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent): void => {
      // Panel is on the right of the shell; dragging left (smaller clientX) = smaller panel.
      // Panel right edge is fixed; left edge moves with drag.
      const delta = ev.clientX - startX;
      const newWidth = Math.min(
        Math.max(startWidth - delta, MIN_WIDTH),
        Math.round(window.innerWidth * MAX_RATIO),
      );
      panel.style.width = `${newWidth}px`;
    };

    const onUp = (): void => {
      handle.classList.remove("explorer-panel__resize-handle--dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, String(panel.offsetWidth));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

export function initExplorerPanel(): void {
  // Panel starts open — mark the toolbar button as active to match.
  document.getElementById("btn-toggle-explorer")?.classList.add("active");
  initToggle();
  initResizeHandle();
}

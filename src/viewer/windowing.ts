import { $ } from "../shared/dom.js";
import { state } from "./state.js";
import { render } from "./rendering.js";
export { WINDOWING_PRESETS } from "./windowing-presets.js";

// ── Init ──────────────────────────────────────────────────────────────────────

export function initWindowing(): void {
  const wlSlider = $("wl-slider") as HTMLInputElement;
  const wlNumber = $("wl-number") as HTMLInputElement;
  const wwSlider = $("ww-slider") as HTMLInputElement;
  const wwNumber = $("ww-number") as HTMLInputElement;

  wlSlider.addEventListener("input", () => {
    const v = Number(wlSlider.value);
    wlNumber.value = String(v);
    if (state.parsed) {
      state.viewport.windowCenter = v;
      render();
    }
  });

  wlNumber.addEventListener("change", () => {
    const v = Number(wlNumber.value);
    wlSlider.value = String(clampWl(v));
    if (state.parsed) {
      state.viewport.windowCenter = v;
      render();
    }
  });

  wwSlider.addEventListener("input", () => {
    const v = Number(wwSlider.value);
    wwNumber.value = String(v);
    if (state.parsed) {
      state.viewport.windowWidth = v;
      render();
    }
  });

  wwNumber.addEventListener("change", () => {
    const v = Math.max(1, Number(wwNumber.value));
    wwSlider.value = String(clampWw(v));
    if (state.parsed) {
      state.viewport.windowWidth = v;
      render();
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-preset-wl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.parsed) return;
      state.viewport.windowCenter = Number(btn.dataset.presetWl);
      state.viewport.windowWidth = Number(btn.dataset.presetWw);
      updateWindowingPanel();
      render();
    });
  });

  $("tool-windowing").addEventListener("click", () => {
    const panel = $("windowing-panel");
    const isOpen = panel.classList.toggle("open");
    $("tool-windowing").setAttribute("aria-expanded", String(isOpen));
    $("tool-windowing").classList.toggle("active", isOpen);
  });
}

// ── Sync UI from state ────────────────────────────────────────────────────────

export function updateWindowingPanel(): void {
  const wl = Math.round(state.viewport.windowCenter);
  const ww = Math.max(1, Math.round(state.viewport.windowWidth));

  ($("wl-slider") as HTMLInputElement).value = String(clampWl(wl));
  ($("wl-number") as HTMLInputElement).value = String(wl);
  ($("ww-slider") as HTMLInputElement).value = String(clampWw(ww));
  ($("ww-number") as HTMLInputElement).value = String(ww);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampWl(v: number): number {
  return Math.max(-2048, Math.min(4096, v));
}

function clampWw(v: number): number {
  return Math.max(1, Math.min(8192, v));
}

// ── Status banner ────────────────────────────────────────────────────────────
//
// The strip that appears above the topbar to confirm an action finished —
// "Estudio cargado · volviendo al visualizador". It is a live region, so the
// confirmation reaches screen-reader users too rather than being a purely
// visual reward.

import { $, escapeHtml } from "./dom.js";

export type BannerKind = "success" | "error" | "warning";

let dismissTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shows the banner for `ms` (0 keeps it up until the next call).
 *
 * Errors stay put by default: a message the user needs to act on should not
 * time out while they are reading it.
 */
export function showBanner(
  text: string,
  kind: BannerKind = "success",
  ms = kind === "error" ? 0 : kind === "warning" ? 6000 : 4000,
): void {
  const el = $("app-banner");
  clearTimeout(dismissTimer);

  el.textContent = text;
  el.className = `app-banner app-banner--${kind}`;
  el.classList.remove("hidden");

  if (ms > 0) dismissTimer = setTimeout(hideBanner, ms);
}

// ── Toast (bottom, dismissible) ───────────────────────────────────────────────

export type ToastKind = "success" | "error" | "warning";

export function showToast(
  text: string,
  kind: ToastKind = "warning",
  ms = kind === "error" ? 0 : 6000,
): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.innerHTML = `
    <span class="toast__msg">${escapeHtml(text)}</span>
    <button class="toast__close" aria-label="Cerrar">✕</button>`;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    toast.classList.add("toast--out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    clearTimeout(timer);
  };

  toast.querySelector(".toast__close")!.addEventListener("click", dismiss);
  container.appendChild(toast);

  if (ms > 0) timer = setTimeout(dismiss, ms);
}

export function hideBanner(): void {
  clearTimeout(dismissTimer);
  const el = $("app-banner");
  el.classList.add("hidden");
  // Clear the text too, so the live region doesn't re-announce stale content
  // the next time it is revealed.
  el.textContent = "";
}

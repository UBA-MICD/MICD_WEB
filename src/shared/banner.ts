// ── Status banner ────────────────────────────────────────────────────────────
//
// The strip that appears above the topbar to confirm an action finished —
// "Estudio cargado · volviendo al visualizador". It is a live region, so the
// confirmation reaches screen-reader users too rather than being a purely
// visual reward.

import { $ } from "./dom.js";

export type BannerKind = "success" | "error";

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
  ms = kind === "error" ? 0 : 4000,
): void {
  const el = $("app-banner");
  clearTimeout(dismissTimer);

  el.textContent = text;
  el.className = `app-banner app-banner--${kind}`;
  el.classList.remove("hidden");

  if (ms > 0) dismissTimer = setTimeout(hideBanner, ms);
}

export function hideBanner(): void {
  clearTimeout(dismissTimer);
  const el = $("app-banner");
  el.classList.add("hidden");
  // Clear the text too, so the live region doesn't re-announce stale content
  // the next time it is revealed.
  el.textContent = "";
}

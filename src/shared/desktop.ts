import { showToast } from "./banner.js";
import { t } from "../i18n/i18n.js";

/** True when running inside the Electron shell (the preload bridge is present). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.api;
}

/**
 * Un-hides every `[data-desktop-only]` element. These start hidden in the
 * shared markup (`class="hidden"`) so the browser build never shows them.
 */
export function initDesktopOnlyUI(): void {
  if (!isDesktop()) return;
  document
    .querySelectorAll<HTMLElement>("[data-desktop-only]")
    .forEach((el) => el.classList.remove("hidden"));
}

/**
 * Wires the server screen's API-origin settings card for all platforms (TK-29).
 *
 * - Desktop (Electron): reads/writes via the preload bridge (`window.api`).
 * - Browser: reads/writes localStorage key `micd_api_origin`; the stored
 *   value is injected into `window.MICD_API_ORIGIN` by an inline script in
 *   index.html before auth.ts loads, so the new origin takes effect on reload.
 *
 * Both paths validate the URL the same way and call `window.location.reload()`
 * after saving so the new origin is picked up by `resolveApiOrigin()`.
 */
export async function initApiOriginSetting(): Promise<void> {
  const input = document.getElementById(
    "desktop-api-origin-input",
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById("desktop-api-origin-save");
  const card = document.querySelector<HTMLElement>(".auth-card--settings");
  if (!input || !saveBtn || !card) return;

  card.classList.remove("hidden");

  // Pre-fill with the current value.
  if (isDesktop() && window.api) {
    input.value = await window.api.getApiOrigin();
  } else {
    const ls = (
      globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem"> }
    ).localStorage;
    input.value = ls?.getItem("micd_api_origin") ?? "";
  }

  saveBtn.addEventListener("click", () => {
    void (async () => {
      const raw = input.value.trim();
      if (!raw) return;

      // A bare "host:port" (no scheme) is a relative URL to fetch(), not an
      // absolute one — default to http:// so "localhost:3001" works as expected.
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      let origin: string;
      try {
        origin = new URL(withScheme).origin;
      } catch {
        showToast(t("server.apiOriginInvalid"), "error");
        return;
      }

      input.value = origin;

      if (isDesktop() && window.api) {
        await window.api.setApiOrigin(origin);
      } else {
        const ls = (
          globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem"> }
        ).localStorage;
        ls?.setItem("micd_api_origin", origin);
      }

      window.location.reload();
    })();
  });
}

/** @deprecated Use initApiOriginSetting() — kept for callers that have not migrated. */
export async function initDesktopApiOriginSetting(): Promise<void> {
  return initApiOriginSetting();
}

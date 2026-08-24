import { showToast } from "./banner.js";
import { t } from "../i18n/i18n.js";

/** True when running inside the Electron shell (the preload bridge is present). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.api;
}

/**
 * Un-hides every `[data-desktop-only]` element. These start hidden in the
 * shared markup (`class="hidden"`) so the browser build never shows them —
 * e.g. the API-origin field on the server screen's auth card, meaningless
 * when nginx already proxies same-origin.
 */
export function initDesktopOnlyUI(): void {
  if (!isDesktop()) return;
  document
    .querySelectorAll<HTMLElement>("[data-desktop-only]")
    .forEach((el) => el.classList.remove("hidden"));
}

/**
 * Wires the server screen's API-origin field: pre-fills it with the current
 * value, and on save persists it via the preload bridge and reloads so the
 * new origin takes effect (it's read synchronously by preload before page
 * scripts run — see global.d.ts).
 */
export async function initDesktopApiOriginSetting(): Promise<void> {
  if (!isDesktop() || !window.api) return;
  const input = document.getElementById(
    "desktop-api-origin-input",
  ) as HTMLInputElement | null;
  const saveBtn = document.getElementById("desktop-api-origin-save");
  if (!input || !saveBtn) return;

  input.value = await window.api.getApiOrigin();
  saveBtn.addEventListener("click", () => {
    void (async () => {
      if (!window.api) return;
      const raw = input.value.trim();
      if (!raw) return;

      // A bare "host:port" (no scheme) is a relative URL to fetch(), not an
      // absolute one — it silently resolves against the app's file:// origin
      // instead of ever reaching the backend. Default to http:// so typing
      // "localhost:3001" does what it looks like it should.
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      let origin: string;
      try {
        origin = new URL(withScheme).origin;
      } catch {
        showToast(t("server.apiOriginInvalid"), "error");
        return;
      }

      input.value = origin;
      await window.api.setApiOrigin(origin);
      window.location.reload();
    })();
  });
}

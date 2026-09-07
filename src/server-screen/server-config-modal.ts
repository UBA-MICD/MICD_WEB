/**
 * server-config-modal.ts — Server configuration modal dialog (TK-29).
 * Allows users to view, validate, and persist a custom PACS/Orthanc server URL.
 */
import { $ } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { showToast } from "../shared/banner.js";
import { t } from "../i18n/i18n.js";
import {
  validateServerUrl,
  getServerUrl,
  setServerUrl,
} from "../services/api.js";
import { openServerScreen } from "./server-screen.js";
import { loadStudyExplorer } from "../explorer/explorer.js";

let initialized = false;

export function initServerConfigModal(): void {
  if (initialized) return;

  const overlay = $("server-config-dialog");
  const form = $("server-config-form") as HTMLFormElement | null;
  const input = $("server-config-url-input") as HTMLInputElement | null;
  const errorEl = $("server-config-error");
  const cancelBtn = $("btn-server-config-cancel");

  if (!overlay || !form || !input) return;

  // Clear validation error when typing
  input.addEventListener("input", () => {
    input.classList.remove("server-config-input--error");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }
  });

  // Cancel button dismisses modal
  cancelBtn?.addEventListener("click", () => {
    closeDialog(overlay);
  });

  // Form submission: validate and persist
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const rawValue = input.value.trim();
    const validation = validateServerUrl(rawValue);

    if (!validation.valid || !validation.formattedUrl) {
      input.classList.add("server-config-input--error");
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "server-config-error");
      if (errorEl) {
        errorEl.textContent = validation.error || t("serverConfig.invalidUrl");
        errorEl.classList.remove("hidden");
      }
      input.focus();
      return;
    }

    // Valid URL: clear errors
    input.classList.remove("server-config-input--error");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }

    // Persist and update active API origin
    setServerUrl(validation.formattedUrl);
    input.value = validation.formattedUrl;

    // Sync desktop setting input if present
    const desktopInput = document.getElementById(
      "desktop-api-origin-input",
    ) as HTMLInputElement | null;
    if (desktopInput) {
      desktopInput.value = validation.formattedUrl;
    }

    showToast(t("serverConfig.saveSuccess"), "success");
    closeDialog(overlay);

    // Open server screen and reload studies from newly configured server
    openServerScreen("buscar");
    void loadStudyExplorer();
  });

  initialized = true;
}

export function openServerConfigModal(opener?: HTMLElement): void {
  const overlay = $("server-config-dialog");
  const input = $("server-config-url-input") as HTMLInputElement | null;
  const errorEl = $("server-config-error");

  if (!overlay) return;

  // Pre-fill with active server URL
  if (input) {
    input.value = getServerUrl();
    input.classList.remove("server-config-input--error");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  openDialog(overlay, opener);
}

export function closeServerConfigModal(): void {
  const overlay = $("server-config-dialog");
  if (overlay) {
    closeDialog(overlay);
  }
}

/** Reset initialization state for unit tests */
export function _resetServerConfigModalForTest(): void {
  initialized = false;
}

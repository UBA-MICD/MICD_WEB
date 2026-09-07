// ── Login form ───────────────────────────────────────────────────────────────
//
// The submit/error/disable behaviour of the login form, mounted onto whichever
// markup is showing it. Two surfaces need it — the escalation dialog and the
// server screen's logged-out landing — and both must go through the same
// `login()` call, so the rate-limit and bad-credentials handling only exists
// once.
//
// Fields are found by data attribute within the given form, not by global id,
// so more than one instance can live in the document.

import { login } from "./auth.js";
import { t } from "../i18n/i18n.js";

const EYE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export interface LoginFormOptions {
  /** Runs after a successful login, before the caller's own navigation. */
  onSuccess: () => void;
  /**
   * Toggled while a request is in flight. The dialog uses it to block Escape,
   * so a login whose result is still coming can't be dismissed underneath.
   */
  onBusyChange?: (busy: boolean) => void;
}

export interface LoginFormHandle {
  /** Clears the fields and any error — call before showing the form again. */
  reset(): void;
  /** Puts focus on the email field. */
  focusFirstField(): void;
}

function field<T extends HTMLElement>(form: HTMLFormElement, name: string): T {
  const el = form.querySelector<T>(`[data-login-${name}]`);
  if (!el) throw new Error(`login form is missing [data-login-${name}]`);
  return el;
}

export function mountLoginForm(
  form: HTMLFormElement,
  { onSuccess, onBusyChange }: LoginFormOptions,
): LoginFormHandle {
  const emailEl = field<HTMLInputElement>(form, "email");
  const passwordEl = field<HTMLInputElement>(form, "password");
  const errorEl = field<HTMLElement>(form, "error");
  const submitEl = field<HTMLButtonElement>(form, "submit");
  // Optional: the server screen's landing card has nothing to cancel to.
  const cancelEl = form.querySelector<HTMLButtonElement>("[data-login-cancel]");
  const toggleEl = form.querySelector<HTMLButtonElement>("[data-login-toggle]");

  if (toggleEl) {
    toggleEl.addEventListener("click", () => {
      const isPassword = passwordEl.type === "password";
      passwordEl.type = isPassword ? "text" : "password";
      toggleEl.setAttribute(
        "aria-label",
        isPassword ? t("auth.hidePassword") : t("auth.showPassword"),
      );
      toggleEl.innerHTML = isPassword ? EYE_OFF_SVG : EYE_SVG;
    });
  }

  let inFlight = false;

  const setBusy = (busy: boolean): void => {
    inFlight = busy;
    submitEl.disabled = busy;
    if (cancelEl) cancelEl.disabled = busy; // don't let cancel race the request
    onBusyChange?.(busy);
  };

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  };

  const clearError = (): void => {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (inFlight) return;

    clearError();
    setBusy(true);
    const result = await login(emailEl.value, passwordEl.value);
    setBusy(false);

    if (!result.ok) {
      showError(result.error);
      emailEl.focus();
      return;
    }

    form.reset();
    onSuccess();
  });

  return {
    reset(): void {
      form.reset();
      clearError();
    },
    focusFirstField(): void {
      emailEl.focus();
    },
  };
}

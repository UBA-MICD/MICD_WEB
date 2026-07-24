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

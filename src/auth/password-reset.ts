// ── Password recovery: reset screen + "forgot password" dialog ───────────────
//
// Mirrors the accept-invite flow. Two public, session-less surfaces:
//   • the reset *screen*, reached from an emailed ?reset=<code> link (the code
//     is stripped from the URL on entry so it can't leak via history or the
//     Referer header), and
//   • the "Forgot your password?" *dialog* on the login card: step 1 asks for
//     the email and requests a code, step 2 takes the code + a new password
//     (the path the desktop app needs, since Electron loads from file:// and no
//     email link can open it).
//
// The backend answers the request step identically for unknown accounts, so
// the UI never claims a code was sent — only that it was, *if* the account
// exists.

import { API_ORIGIN, adoptSession, type AuthUser } from "./auth.js";
import { validateInvitePassword } from "./accept-invite.js";
import { t, currentLocale, onLocaleChange } from "../i18n/i18n.js";
import { registerScreen, showScreen } from "../shared/screen.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { $ } from "../shared/dom.js";

/** The reset code from a URL query string, or null when absent/blank. */
export function parseResetCode(search: string): string | null {
  const code = new URLSearchParams(search).get("reset");
  return code && code.trim() ? code.trim() : null;
}

interface ResetDeps {
  /** Called after a successful reset — the app is now authenticated. */
  onReset: () => void;
}

/** Ask the server to email a reset code. Resolves ok for any known-or-not
 *  email (the server never says which); fails only on network/rate limit. */
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale: currentLocale() }),
    });
  } catch {
    return { ok: false, error: t("invite.error.network") };
  }
  if (res.status === 429) return { ok: false, error: t("reset.error.tooMany") };
  if (!res.ok) return { ok: false, error: t("invite.error.generic") };
  return { ok: true };
}

/** Look up the email a reset code belongs to. `invalid` distinguishes a
 *  bad/expired code (404) from a network failure. */
export async function fetchResetEmail(
  code: string,
): Promise<
  { ok: true; email: string } | { ok: false; invalid: boolean; error: string }
> {
  let res: Response;
  try {
    res = await fetch(
      `${API_ORIGIN}/auth/reset-password/${encodeURIComponent(code)}`,
    );
  } catch {
    return { ok: false, invalid: false, error: t("invite.error.network") };
  }
  if (!res.ok) {
    return { ok: false, invalid: true, error: t("reset.invalid") };
  }
  const { email } = await res.json();
  return { ok: true, email };
}

/** Redeem a code + new password and adopt the returned session, so the app
 *  is signed in on success. */
export async function submitPasswordReset(
  code: string,
  password: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password }),
    });
  } catch {
    return { ok: false, error: t("invite.error.network") };
  }
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: t("reset.error.tooMany") };
    if (res.status === 400) return { ok: false, error: t("reset.invalid") };
    return { ok: false, error: t("invite.error.generic") };
  }
  const data = await res.json();
  await adoptSession(data.accessToken, data.refreshToken, data.user);
  return { ok: true, user: data.user };
}

// ── Reset screen (from the ?reset= link) ─────────────────────────────────────

let screenDeps: ResetDeps | null = null;
let currentCode: string | null = null;

/** Mount + register the reset screen. Call once during app bootstrap. */
export function initResetScreen(d: ResetDeps): void {
  screenDeps = d;
  registerScreen("reset", $("reset-screen"));

  const form =
    $("reset-screen").querySelector<HTMLFormElement>("[data-reset-form]")!;
  const passwordEl = form.querySelector<HTMLInputElement>(
    "[data-reset-password]",
  )!;
  const errorEl = form.querySelector<HTMLElement>("[data-reset-error]")!;
  const submitEl = form.querySelector<HTMLButtonElement>(
    "[data-reset-submit]",
  )!;

  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentCode) return;
    errorEl.classList.add("hidden");

    const check = validateInvitePassword(passwordEl.value);
    if (!check.ok) {
      showError(check.error);
      return;
    }

    submitEl.disabled = true;
    const result = await submitPasswordReset(currentCode, passwordEl.value);
    submitEl.disabled = false;

    if (!result.ok) {
      showError(result.error);
      return;
    }
    currentCode = null;
    form.reset();
    screenDeps?.onReset();
  });
}

/**
 * If the page was opened from a reset link, strip the code from the URL, show
 * the reset screen and load the account's email. Returns true if it took over
 * (so the caller skips the normal signed-out landing).
 */
export async function enterResetFlowIfPresent(): Promise<boolean> {
  const code = parseResetCode(window.location.search);
  if (!code) return false;

  // Strip the code from the URL before anything else — it must not linger in
  // history or leak via the Referer header on the next request.
  history.replaceState(null, "", window.location.pathname);
  currentCode = code;

  showScreen("reset");
  await loadResetEmail(code);
  return true;
}

async function loadResetEmail(code: string): Promise<void> {
  const root = $("reset-screen");
  const emailEl = root.querySelector<HTMLElement>("[data-reset-email]")!;
  const formEl = root.querySelector<HTMLElement>("[data-reset-form]")!;
  const invalidEl = root.querySelector<HTMLElement>("[data-reset-invalid]")!;

  const info = await fetchResetEmail(code);
  if (!info.ok) {
    currentCode = null;
    formEl.classList.add("hidden");
    invalidEl.textContent = info.error;
    invalidEl.classList.remove("hidden");
    return;
  }
  emailEl.textContent = t("reset.forEmail", { email: info.email });
  formEl.classList.remove("hidden");
  invalidEl.classList.add("hidden");
}

// ── "Forgot your password?" dialog (from the login card) ─────────────────────

/** Wire the "Forgot your password?" trigger and its two-step modal. */
export function initForgotPasswordDialog(d: ResetDeps): void {
  const overlay = $("forgot-dialog");
  const requestForm = overlay.querySelector<HTMLFormElement>(
    "[data-forgot-request-form]",
  )!;
  const resetForm = overlay.querySelector<HTMLFormElement>(
    "[data-forgot-reset-form]",
  )!;
  const emailEl = requestForm.querySelector<HTMLInputElement>(
    "[data-forgot-email]",
  )!;
  const requestErrorEl = requestForm.querySelector<HTMLElement>(
    "[data-forgot-request-error]",
  )!;
  const requestSubmitEl = requestForm.querySelector<HTMLButtonElement>(
    "[data-forgot-request-submit]",
  )!;
  const sentEl = resetForm.querySelector<HTMLElement>("[data-forgot-sent]")!;
  const codeEl = resetForm.querySelector<HTMLInputElement>(
    "[data-forgot-code]",
  )!;
  const passwordEl = resetForm.querySelector<HTMLInputElement>(
    "[data-forgot-password]",
  )!;
  const resetErrorEl = resetForm.querySelector<HTMLElement>(
    "[data-forgot-reset-error]",
  )!;
  const resetSubmitEl = resetForm.querySelector<HTMLButtonElement>(
    "[data-forgot-reset-submit]",
  )!;

  // The email the last code was requested for, so the "sent" note can be
  // re-rendered on a locale switch.
  let sentTo: string | null = null;

  const renderSent = (): void => {
    sentEl.textContent = sentTo
      ? t("reset.dialog.sent", { email: sentTo })
      : t("reset.dialog.haveCodeMsg");
  };

  const showStep = (step: "request" | "reset"): void => {
    requestForm.classList.toggle("hidden", step !== "request");
    resetForm.classList.toggle("hidden", step !== "reset");
    requestErrorEl.classList.add("hidden");
    resetErrorEl.classList.add("hidden");
    if (step === "reset") {
      renderSent();
      codeEl.focus();
    } else {
      emailEl.focus();
    }
  };

  const showError = (el: HTMLElement, msg: string): void => {
    el.textContent = msg;
    el.classList.remove("hidden");
  };

  /** Run a request with the dialog's busy guard (no Escape mid-request). */
  const busy = async (
    button: HTMLButtonElement,
    fn: () => Promise<void>,
  ): Promise<void> => {
    overlay.dataset.dialogBusy = "true";
    button.disabled = true;
    try {
      await fn();
    } finally {
      button.disabled = false;
      delete overlay.dataset.dialogBusy;
    }
  };

  document
    .querySelectorAll<HTMLButtonElement>("[data-forgot-open]")
    .forEach((opener) =>
      opener.addEventListener("click", (e) => {
        requestForm.reset();
        resetForm.reset();
        sentTo = null;
        // Carry over whatever the user already typed into the login email.
        const loginEmail = document.querySelector<HTMLInputElement>(
          "#server-login-email",
        );
        if (loginEmail?.value) emailEl.value = loginEmail.value.trim();
        openDialog(overlay, e.currentTarget as HTMLElement);
        showStep("request");
      }),
    );

  overlay
    .querySelectorAll<HTMLButtonElement>("[data-forgot-cancel]")
    .forEach((b) => b.addEventListener("click", () => closeDialog(overlay)));
  overlay
    .querySelector<HTMLButtonElement>("[data-forgot-have-code]")!
    .addEventListener("click", () => {
      sentTo = null;
      showStep("reset");
    });
  overlay
    .querySelector<HTMLButtonElement>("[data-forgot-back]")!
    .addEventListener("click", () => showStep("request"));

  requestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    requestErrorEl.classList.add("hidden");
    const email = emailEl.value.trim();
    if (!email) {
      showError(requestErrorEl, t("reset.dialog.missingEmail"));
      return;
    }
    await busy(requestSubmitEl, async () => {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        showError(requestErrorEl, result.error);
        return;
      }
      sentTo = email;
      showStep("reset");
    });
  });

  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetErrorEl.classList.add("hidden");
    const code = codeEl.value.trim();
    if (!code) {
      showError(resetErrorEl, t("reset.dialog.missingCode"));
      return;
    }
    const pw = validateInvitePassword(passwordEl.value);
    if (!pw.ok) {
      showError(resetErrorEl, pw.error);
      return;
    }
    await busy(resetSubmitEl, async () => {
      const result = await submitPasswordReset(code, passwordEl.value);
      if (!result.ok) {
        showError(resetErrorEl, result.error);
        return;
      }
      requestForm.reset();
      resetForm.reset();
      closeDialog(overlay);
      d.onReset();
    });
  });

  // The "sent to <email>" line is written by t() at runtime, outside the
  // static data-i18n pass, so it must follow a locale switch itself.
  onLocaleChange(renderSent);
}


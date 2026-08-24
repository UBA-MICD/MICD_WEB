// ── Accept-invite: URL screen + activation dialog ────────────────────────────
//
// Two public, session-less surfaces to redeem an invite:
//   • the accept-invite *screen*, reached from an emailed ?invite=<code> link
//     (the code is stripped from the URL on entry so it can't leak via history
//     or the Referer header), and
//   • the "Were you invited?" *dialog* on the login card, where the user pastes
//     the email + code they received (the path the desktop app needs, since
//     Electron loads from file:// and no email link can open it).
//
// Both share the same pure checks and the same fetch helpers below.

import { API_ORIGIN, adoptSession, type AuthUser } from "./auth.js";
import { t } from "../i18n/i18n.js";
import { registerScreen, showScreen } from "../shared/screen.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { $ } from "../shared/dom.js";

const MIN_PASSWORD_LENGTH = 8;

/** The invite code from a URL query string, or null when absent/blank. */
export function parseInviteCode(search: string): string | null {
  const code = new URLSearchParams(search).get("invite");
  return code && code.trim() ? code.trim() : null;
}

/** Client-side password check mirroring the backend's single rule (min 8). */
export function validateInvitePassword(
  password: string,
): { ok: true } | { ok: false; error: string } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: t("invite.error.tooShort") };
  }
  return { ok: true };
}

interface InviteScreenDeps {
  /** Called after a successful redeem — the app is now authenticated. */
  onAccepted: () => void;
}

/** Look up the email a code belongs to. `invalid` distinguishes a bad/expired
 *  code (404) from a network failure, so callers can word the error right. */
export async function fetchInviteEmail(
  code: string,
): Promise<
  | { ok: true; email: string }
  | { ok: false; invalid: boolean; error: string }
> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/invite/${encodeURIComponent(code)}`);
  } catch {
    return { ok: false, invalid: false, error: t("invite.error.network") };
  }
  if (!res.ok) {
    return { ok: false, invalid: true, error: t("invite.invalid") };
  }
  const { email } = await res.json();
  return { ok: true, email };
}

/** Redeem a code + password: sets the password, activates the account, and
 *  adopts the returned session so the app is signed in on success. */
export async function redeemInvite(
  code: string,
  password: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/accept-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password }),
    });
  } catch {
    return { ok: false, error: t("invite.error.network") };
  }
  if (!res.ok) {
    let error = t("invite.error.generic");
    try {
      const body = await res.json();
      if (typeof body.error === "string") error = body.error;
    } catch {
      // keep the generic message
    }
    return { ok: false, error };
  }
  const data = await res.json();
  await adoptSession(data.accessToken, data.refreshToken, data.user);
  return { ok: true, user: data.user };
}

// ── Accept-invite screen (from the ?invite= link) ────────────────────────────

let screenDeps: InviteScreenDeps | null = null;
let currentCode: string | null = null;

/** Mount + register the invite screen. Call once during app bootstrap. */
export function initInviteScreen(d: InviteScreenDeps): void {
  screenDeps = d;
  registerScreen("invite", $("invite-screen"));

  const form = $("invite-screen").querySelector<HTMLFormElement>("[data-invite-form]")!;
  const passwordEl = form.querySelector<HTMLInputElement>("[data-invite-password]")!;
  const errorEl = form.querySelector<HTMLElement>("[data-invite-error]")!;
  const submitEl = form.querySelector<HTMLButtonElement>("[data-invite-submit]")!;

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
    const result = await redeemInvite(currentCode, passwordEl.value);
    submitEl.disabled = false;

    if (!result.ok) {
      showError(result.error);
      return;
    }
    form.reset();
    screenDeps?.onAccepted();
  });
}

/**
 * If the page was opened from an invite link, strip the code from the URL, show
 * the invite screen and load the invitee's email. Returns true if it took over
 * (so the caller skips the normal signed-out landing).
 */
export async function enterInviteFlowIfPresent(): Promise<boolean> {
  const code = parseInviteCode(window.location.search);
  if (!code) return false;

  // Strip the code from the URL before anything else — it must not linger in
  // history or leak via the Referer header on the next request.
  history.replaceState(null, "", window.location.pathname);
  currentCode = code;

  showScreen("invite");
  await loadInviteEmail(code);
  return true;
}

async function loadInviteEmail(code: string): Promise<void> {
  const emailEl = $("invite-screen").querySelector<HTMLElement>("[data-invite-email]")!;
  const formEl = $("invite-screen").querySelector<HTMLElement>("[data-invite-form]")!;
  const invalidEl = $("invite-screen").querySelector<HTMLElement>("[data-invite-invalid]")!;

  const info = await fetchInviteEmail(code);
  if (!info.ok) {
    currentCode = null;
    formEl.classList.add("hidden");
    invalidEl.textContent = info.error;
    invalidEl.classList.remove("hidden");
    return;
  }
  emailEl.textContent = t("invite.forEmail", { email: info.email });
  formEl.classList.remove("hidden");
  invalidEl.classList.add("hidden");
}

// ── Activation dialog (from the login card's "Were you invited?" link) ───────

/** Wire the "Were you invited?" trigger and its modal. Call once at bootstrap. */
export function initInviteDialog(d: InviteScreenDeps): void {
  const overlay = $("invite-dialog");
  const form = overlay.querySelector<HTMLFormElement>("[data-invite-dialog-form]")!;
  const emailEl = form.querySelector<HTMLInputElement>("[data-invite-dialog-email]")!;
  const codeEl = form.querySelector<HTMLInputElement>("[data-invite-dialog-code]")!;
  const passwordEl = form.querySelector<HTMLInputElement>("[data-invite-dialog-password]")!;
  const errorEl = form.querySelector<HTMLElement>("[data-invite-dialog-error]")!;
  const submitEl = form.querySelector<HTMLButtonElement>("[data-invite-dialog-submit]")!;
  const cancelEl = form.querySelector<HTMLButtonElement>("[data-invite-dialog-cancel]")!;

  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  };

  document
    .querySelectorAll<HTMLButtonElement>("[data-invite-open]")
    .forEach((opener) =>
      opener.addEventListener("click", (e) => {
        form.reset();
        errorEl.classList.add("hidden");
        openDialog(overlay, e.currentTarget as HTMLElement);
      }),
    );

  cancelEl.addEventListener("click", () => closeDialog(overlay));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");

    const email = emailEl.value.trim();
    const code = codeEl.value.trim();
    if (!email || !code) {
      showError(t("invite.dialog.missing"));
      return;
    }
    const pw = validateInvitePassword(passwordEl.value);
    if (!pw.ok) {
      showError(pw.error);
      return;
    }

    overlay.dataset.dialogBusy = "true"; // block Escape while a request is out
    submitEl.disabled = true;
    try {
      const info = await fetchInviteEmail(code);
      if (!info.ok) {
        showError(info.error);
        return;
      }
      // The code identifies the account; the typed email is a guard against a
      // mistyped or wrong code, and gives a clearer error than a blind redeem.
      if (info.email.trim().toLowerCase() !== email.toLowerCase()) {
        showError(t("invite.dialog.emailMismatch"));
        return;
      }
      const result = await redeemInvite(code, passwordEl.value);
      if (!result.ok) {
        showError(result.error);
        return;
      }
      form.reset();
      closeDialog(overlay);
      d.onAccepted();
    } finally {
      submitEl.disabled = false;
      delete overlay.dataset.dialogBusy;
    }
  });
}

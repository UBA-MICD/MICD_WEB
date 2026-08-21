// ── Accept-invite screen ─────────────────────────────────────────────────────
//
// A public, session-less surface reached from an emailed ?invite=<code> link. It
// validates the code (naming the account), takes a password, redeems the invite,
// and drops the user straight into the authenticated app. The code is stripped
// from the URL on entry so it doesn't leak via history or the Referer header.
//
// Parsing and password validation are pure (unit-tested); the fetch/DOM wiring
// is the rest.

import { API_ORIGIN, adoptSession, type AuthUser } from "./auth.js";
import { t } from "../i18n/i18n.js";
import { registerScreen, showScreen } from "../shared/screen.js";
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

let deps: InviteScreenDeps | null = null;
let currentCode: string | null = null;

/** Mount + register the invite screen. Call once during app bootstrap. */
export function initInviteScreen(d: InviteScreenDeps): void {
  deps = d;
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
    const result = await acceptInvite(currentCode, passwordEl.value);
    submitEl.disabled = false;

    if (!result.ok) {
      showError(result.error);
      return;
    }
    form.reset();
    deps?.onAccepted();
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

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/invite/${encodeURIComponent(code)}`);
  } catch {
    showInvalid(t("invite.error.network"), formEl, invalidEl);
    return;
  }
  if (!res.ok) {
    showInvalid(t("invite.invalid"), formEl, invalidEl);
    return;
  }
  const { email } = await res.json();
  emailEl.textContent = t("invite.forEmail", { email });
  formEl.classList.remove("hidden");
  invalidEl.classList.add("hidden");
}

function showInvalid(msg: string, formEl: HTMLElement, invalidEl: HTMLElement): void {
  currentCode = null;
  formEl.classList.add("hidden");
  invalidEl.textContent = msg;
  invalidEl.classList.remove("hidden");
}

async function acceptInvite(
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

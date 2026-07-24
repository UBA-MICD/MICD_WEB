import { isAuthenticated, getCurrentUser } from "./auth.js";
import { mountLoginForm } from "./login-form.js";
import { openDialog, closeDialog, isDialogOpen } from "../shared/dialog.js";
import { $ } from "../shared/dom.js";

// ── Login dialog (promise-based popup, injected into auth.ts) ────────────────
//
// This is the escalation path only: it appears when a session dies in the
// middle of a server operation. Focus handling, Escape and the Tab trap belong
// to shared/dialog.ts; the form's submit behaviour belongs to login-form.ts.

let loginResolve: ((ok: boolean) => void) | null = null;
let form: ReturnType<typeof mountLoginForm> | null = null;

/** Shows the login dialog; resolves true on login, false on cancel/Escape. */
export function promptLogin(): Promise<boolean> {
  const overlay = $("login-screen");
  form?.reset();
  openDialog(overlay);
  form?.focusFirstField();
  return new Promise<boolean>((resolve) => {
    loginResolve = resolve;
  });
}

function settle(ok: boolean): void {
  const resolve = loginResolve;
  loginResolve = null;
  resolve?.(ok);
}

export function initLoginDialog(): void {
  const overlay = $("login-screen");

  form = mountLoginForm($("login-form") as HTMLFormElement, {
    onSuccess: () => {
      settle(true);
      closeDialog(overlay);
    },
    // While a login is in flight the dialog must not be dismissable, or the
    // caller would get `false` and then a session would appear anyway.
    onBusyChange: (busy) => {
      overlay.dataset.dialogBusy = String(busy);
    },
  });

  ($("login-cancel") as HTMLButtonElement).addEventListener("click", () =>
    closeDialog(overlay),
  );

  // Every close path — cancel, Escape, or a programmatic close — funnels
  // through the dialog's close event, so a pending promise is never orphaned.
  overlay.addEventListener("dialog:close", () => settle(false));
}

/** True while the escalation dialog is on screen. */
export function isLoginDialogOpen(): boolean {
  return isDialogOpen($("login-screen"));
}

// ── Session UI (sidebar + panel footer) ──────────────────────────────────────

/** Two-letter monogram for the avatar, from the email's local part. */
function initials(email: string): string {
  const local = email.split("@")[0]?.replace(/[^a-zA-Z]/g, "") ?? "";
  return (local.slice(0, 2) || "··").toUpperCase();
}

/**
 * The single place that repaints everything session-dependent. Subscribed to
 * `onAuthChange` in main.ts, so login, logout and a silent refresh all land
 * here rather than each caller poking at the DOM.
 */
export function updateAuthUI(): void {
  const authed = isAuthenticated();
  const email = getCurrentUser()?.email ?? "";

  $("btn-login").classList.toggle("hidden", authed);
  $("btn-logout").classList.toggle("hidden", !authed);
  $("session-block").classList.toggle("hidden", !authed);

  if (authed) {
    $("session-email").textContent = email || "Sesión activa";
    $("session-email").title = email;
    $("session-avatar").textContent = email ? initials(email) : "··";
  }

  // The panel footer states the session rule in words, so a guest can see why
  // the list is empty without having to click anything.
  $("explorer-session-line").textContent = authed
    ? `Sesión activa${email ? ` · ${email}` : ""}`
    : "Sin sesión · solo lectura local";
}

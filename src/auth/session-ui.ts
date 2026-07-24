import { isAuthenticated, getCurrentUser } from "./auth.js";
import { $ } from "../shared/dom.js";

// ── Session UI (sidebar + panel footer) ──────────────────────────────────────
//
// There is no login dialog any more: the server screen's auth card is the
// app's single login surface, including for a session that dies mid-operation.
// What is left here is the state repaint.

/** Two-letter monogram for the avatar, from the email's local part. */
function initials(email: string): string {
  const local = email.split("@")[0]?.replace(/[^a-zA-Z]/g, "") ?? "";
  return (local.slice(0, 2) || "\u00b7\u00b7").toUpperCase();
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
    $("session-email").textContent = email || "Sesi\u00f3n activa";
    $("session-email").title = email;
    $("session-avatar").textContent = email ? initials(email) : "\u00b7\u00b7";
  }

  // The panel footer states the session rule in words, so a guest can see why
  // the list is empty without having to click anything.
  $("explorer-session-line").textContent = authed
    ? `Sesi\u00f3n activa${email ? ` \u00b7 ${email}` : ""}`
    : "Sin sesi\u00f3n \u00b7 solo lectura local";
}

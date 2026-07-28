import {
  isAuthenticated,
  getCurrentUser,
  getSessionExpiresAt,
  authFetch,
  API_BASE,
} from "./auth.js";
import { $, escapeHtml } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";

// ── Session UI (sidebar + panel footer) ──────────────────────────────────────
//
// There is no login dialog any more: the server screen's auth card is the
// app's single login surface, including for a session that dies mid-operation.
// What is left here is the session state — who you are, how long you have, and
// what you have done.

let tickTimer: ReturnType<typeof setInterval> | undefined;
/** So the "about to expire" warning is announced once, not every second. */
let warnedAboutExpiry = false;

/** Two-letter monogram for the avatar, from the email's local part. */
function initials(email: string): string {
  const local = email.split("@")[0]?.replace(/[^a-zA-Z]/g, "") ?? "";
  return (local.slice(0, 2) || "··").toUpperCase();
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Repaints the countdown once a second, so it must stay cheap and must NOT sit
 * in a polite live region — a per-second live region is unusable with a screen
 * reader. The one-minute warning is announced once instead, from a separate
 * live element.
 */
function tick(): void {
  const expiresAt = getSessionExpiresAt();
  if (!isAuthenticated() || expiresAt === null) {
    $("session-expiry").textContent = "Sesión activa";
    return;
  }

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    $("session-expiry").textContent = "Sesión expirada";
    $("explorer-session-line").textContent =
      "Sesión expirada · la próxima acción pedirá iniciar sesión";
    announceOnce("Tu sesión expiró. La próxima acción pedirá iniciar sesión.");
    return;
  }

  const left = formatRemaining(remaining);
  $("session-expiry").textContent = `Expira en ${left}`;
  $("explorer-session-line").textContent = `Sesión activa · expira en ${left}`;

  if (remaining <= 60_000) {
    announceOnce("Tu sesión expira en menos de un minuto.");
  }
}

function announceOnce(message: string): void {
  if (warnedAboutExpiry) return;
  warnedAboutExpiry = true;
  $("session-announce").textContent = message;
}

function startTicking(): void {
  stopTicking();
  warnedAboutExpiry = false;
  tick();
  tickTimer = setInterval(tick, 1000);
}

function stopTicking(): void {
  clearInterval(tickTimer);
  tickTimer = undefined;
  $("session-announce").textContent = "";
}

/**
 * The single place that repaints everything session-dependent. Subscribed to
 * `onAuthChange` in main.ts, so login, logout and a silent refresh all land
 * here rather than each caller poking at the DOM. A refresh mints a new token
 * with a new expiry, which is why the countdown restarts from here.
 */
export function updateAuthUI(): void {
  const authed = isAuthenticated();
  const email = getCurrentUser()?.email ?? "";

  $("btn-login").classList.toggle("hidden", authed);
  $("session-block").classList.toggle("hidden", !authed);
  $("btn-activity").classList.toggle("hidden", !authed);

  if (!authed) {
    stopTicking();
    // The panel footer states the rule in words, so a guest can see why the
    // list is empty without having to click anything.
    $("explorer-session-line").textContent = "Sin sesión · solo lectura local";
    return;
  }

  $("session-email").textContent = email || "Sesión activa";
  $("session-email").title = email;
  $("session-avatar").textContent = email ? initials(email) : "··";
  startTicking();
}

// ── Activity history ─────────────────────────────────────────────────────────

interface ActivityEntry {
  action: string;
  resourceId?: string;
  timestamp: string;
}

export function initActivityHistory(): void {
  const dialog = $("activity-dialog");
  $("btn-activity").addEventListener("click", (e) => {
    openDialog(dialog, e.currentTarget as HTMLElement);
    void loadActivity();
  });
  $("activity-close").addEventListener("click", () => closeDialog(dialog));
}

function message(text: string): string {
  return `<p class="activity-empty">${escapeHtml(text)}</p>`;
}

async function loadActivity(): Promise<void> {
  const body = $("activity-body");
  body.innerHTML = message("Cargando…");

  let res: Response;
  try {
    res = await authFetch(`${API_BASE}/v1/activity?limit=50`);
  } catch {
    body.innerHTML = message("No se pudo conectar con el servidor.");
    return;
  }

  // This endpoint does not exist in the backend yet: it writes an audit_log
  // but exposes no reader, and currently records only Zenodo actions. Saying
  // so is better than an empty list, which would read as "you did nothing".
  if (res.status === 404) {
    body.innerHTML = message(
      "Historial no disponible todavía en este servidor.",
    );
    return;
  }
  if (!res.ok) {
    body.innerHTML = message("No se pudo cargar el historial.");
    return;
  }

  try {
    const data = (await res.json()) as { entries?: ActivityEntry[] };
    const entries = data.entries ?? [];
    if (entries.length === 0) {
      body.innerHTML = message("Sin actividad registrada.");
      return;
    }
    body.innerHTML = `<ul class="activity-list">${entries
      .map(
        (entry) => `
        <li class="activity-item">
          <span class="activity-item__action">${escapeHtml(entry.action)}</span>
          <span class="activity-item__meta">${escapeHtml(
            new Date(entry.timestamp).toLocaleString(),
          )}${entry.resourceId ? ` · ${escapeHtml(entry.resourceId)}` : ""}</span>
        </li>`,
      )
      .join("")}</ul>`;
  } catch {
    body.innerHTML = message("Respuesta inesperada del servidor.");
  }
}

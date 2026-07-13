// Origin the backend API + auth endpoints live on. Default: the backend's own
// port, for local dev (page opened directly / served without nginx). In the
// Docker/nginx deployment the page is served same-origin and nginx proxies
// /api and /auth to the backend — set `window.MICD_API_ORIGIN = ""` before this
// module loads to use that same-origin path (any absolute origin also works).
function resolveApiOrigin(): string {
  const override = (globalThis as { MICD_API_ORIGIN?: string }).MICD_API_ORIGIN;
  const raw = typeof override === "string" ? override : "http://localhost:3000";
  return raw.replace(/\/+$/, ""); // strip trailing slash — callers add their own
}

export const API_ORIGIN = resolveApiOrigin();

const API_BASE = `${API_ORIGIN}/api`;
const REFRESH_KEY = "micd_refresh_token";

export interface AuthUser {
  id: number;
  email: string;
}

let accessToken: string | null = null;
let currentUser: AuthUser | null = null;

// ── Session state & change notifications ─────────────────────────────────────

type AuthListener = (user: AuthUser | null) => void;
const authListeners: AuthListener[] = [];

/** Registers a listener fired on every login/logout/refresh-restore. */
export function onAuthChange(listener: AuthListener): void {
  authListeners.push(listener);
}

function notifyAuthChange(): void {
  for (const listener of authListeners) listener(currentUser);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return accessToken !== null;
}

/**
 * Recovers the user from the access token's JWT claims (sub/email).
 * Needed after /auth/refresh, whose response carries no user object.
 */
function decodeUserFromToken(token: string): AuthUser | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64));
    if (typeof claims.sub !== "number" || typeof claims.email !== "string")
      return null;
    return { id: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

function setSession(token: string, refreshToken: string, user: AuthUser): void {
  accessToken = token;
  currentUser = user;
  localStorage.setItem(REFRESH_KEY, refreshToken);
  notifyAuthChange();
}

function clearSession(): void {
  accessToken = null;
  currentUser = null;
  localStorage.removeItem(REFRESH_KEY);
  notifyAuthChange();
}

// ── Login / logout ────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }

  if (res.status === 429) {
    return {
      ok: false,
      error: "Demasiados intentos. Esperá unos minutos e intentá de nuevo.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: "Email o contraseña incorrectos." };
  }

  const data = await res.json();
  setSession(data.accessToken, data.refreshToken, data.user);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    try {
      await fetch(`${API_ORIGIN}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort — clear the local session regardless
    }
  }
  clearSession();
}

// ── Token refresh (single-flight) ─────────────────────────────────────────────

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Attempts to mint a new access token from the stored refresh token.
 * Single-flight: the backend rotates refresh tokens, so concurrent refreshes
 * with the same token would race — the first wins and the rest would clear
 * the session. All concurrent callers share one request instead.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return false;
  }

  if (!res.ok) {
    clearSession();
    return false;
  }

  const data = await res.json();
  accessToken = data.accessToken;
  currentUser = decodeUserFromToken(data.accessToken) ?? currentUser;
  localStorage.setItem(REFRESH_KEY, data.refreshToken);
  notifyAuthChange();
  return true;
}

// ── Interactive login gate ────────────────────────────────────────────────────

type LoginPrompt = () => Promise<boolean>;
let loginPrompt: LoginPrompt | null = null;
let loginPromptInFlight: Promise<boolean> | null = null;

/** Registers the UI callback that shows the login dialog (the renderer owns the DOM). */
export function setLoginPrompt(prompt: LoginPrompt): void {
  loginPrompt = prompt;
}

/** Shows the login dialog, deduped: concurrent callers share one dialog. */
function promptLoginOnce(): Promise<boolean> {
  if (!loginPrompt) return Promise.resolve(false);
  loginPromptInFlight ??= loginPrompt().finally(() => {
    loginPromptInFlight = null;
  });
  return loginPromptInFlight;
}

/**
 * The gate every server-bound operation goes through: resolves true once a
 * session exists (in-memory token, silent refresh, or interactive login) and
 * false only if the user cancels the login dialog.
 */
export async function ensureAuthenticated(): Promise<boolean> {
  if (accessToken) return true;
  if (await refreshAccessToken()) return true;
  return promptLoginOnce();
}

// ── Authenticated fetch ───────────────────────────────────────────────────────

/**
 * fetch() wrapper for protected /api endpoints: attaches the bearer token, and
 * on a 401 escalates — silent refresh first, interactive login as a last
 * resort — then retries once. If the user cancels the login, the caller gets
 * the original 401 and its normal error path.
 */
export async function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const withAuth = (token: string | null): RequestInit => ({
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const res = await fetch(input, withAuth(accessToken));
  if (res.status !== 401) return res;

  if (!(await refreshAccessToken()) && !(await promptLoginOnce())) return res;
  return fetch(input, withAuth(accessToken));
}

export { API_BASE };

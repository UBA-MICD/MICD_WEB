import { t } from "../i18n/i18n.js";
import { getRefreshToken, setRefreshToken, clearRefreshToken } from "../shared/token-store.js";

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

export interface AuthUser {
  id: number;
  email: string;
}

let accessToken: string | null = null;
let currentUser: AuthUser | null = null;
/** Epoch ms the access token expires, from its `exp` claim. */
let accessTokenExpiresAt: number | null = null;

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
 * When the current access token expires, in epoch ms, or null without a
 * session. Read from the token's own `exp` claim rather than timed locally,
 * so it stays right across a suspended laptop or a clock the app never saw.
 */
export function getSessionExpiresAt(): number | null {
  return accessTokenExpiresAt;
}

/**
 * Reads the access token's JWT claims: the user (sub/email), needed after
 * /auth/refresh whose response carries no user object, and `exp`, which drives
 * the session countdown.
 *
 * These are display-only claims off a token the server will verify anyway —
 * nothing here is a security decision.
 */
function decodeToken(token: string): {
  user: AuthUser | null;
  expiresAt: number | null;
} {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64));
    const user =
      typeof claims.sub === "number" && typeof claims.email === "string"
        ? { id: claims.sub, email: claims.email }
        : null;
    // `exp` is in seconds since the epoch, per RFC 7519.
    const expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : null;
    return { user, expiresAt };
  } catch {
    return { user: null, expiresAt: null };
  }
}

async function setSession(token: string, refreshToken: string, user: AuthUser): Promise<void> {
  accessToken = token;
  currentUser = user;
  accessTokenExpiresAt = decodeToken(token).expiresAt;
  await setRefreshToken(refreshToken);
  notifyAuthChange();
}

async function clearSession(): Promise<void> {
  accessToken = null;
  currentUser = null;
  accessTokenExpiresAt = null;
  await clearRefreshToken();
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
    return { ok: false, error: t("auth.error.networkError") };
  }

  if (res.status === 429) {
    return {
      ok: false,
      error: t("auth.error.tooManyAttempts"),
    };
  }
  if (!res.ok) {
    return { ok: false, error: t("auth.error.badCredentials") };
  }

  const data = await res.json();
  await setSession(data.accessToken, data.refreshToken, data.user);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
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
  await clearSession();
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
  const refreshToken = await getRefreshToken();
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
    await clearSession();
    return false;
  }

  const data = await res.json();
  const claims = decodeToken(data.accessToken);
  accessToken = data.accessToken;
  currentUser = claims.user ?? currentUser;
  accessTokenExpiresAt = claims.expiresAt;
  await setRefreshToken(data.refreshToken);
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

const API_BASE = '/api';
const REFRESH_KEY = 'micd_refresh_token';

interface AuthUser {
  id: number;
  email: string;
  role: 'admin' | 'user';
}

let accessToken: string | null = null;
let currentUser: AuthUser | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return accessToken !== null;
}

function setSession(token: string, refreshToken: string, user: AuthUser): void {
  accessToken = token;
  currentUser = user;
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

function clearSession(): void {
  accessToken = null;
  currentUser = null;
  localStorage.removeItem(REFRESH_KEY);
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }

  if (res.status === 429) {
    return { ok: false, error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' };
  }
  if (!res.ok) {
    return { ok: false, error: 'Email o contraseña incorrectos.' };
  }

  const data = await res.json();
  setSession(data.accessToken, data.refreshToken, data.user);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort — clear the local session regardless
    }
  }
  clearSession();
}

/** Attempts to mint a new access token from the stored refresh token. */
export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  let res: Response;
  try {
    res = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  localStorage.setItem(REFRESH_KEY, data.refreshToken);
  return true;
}

/**
 * fetch() wrapper for protected /api endpoints: attaches the bearer token,
 * and on a 401 (expired access token) tries one silent refresh + retry
 * before giving up.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const withAuth = (token: string | null): RequestInit => ({
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  let res = await fetch(input, withAuth(accessToken));
  if (res.status !== 401) return res;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;

  return fetch(input, withAuth(accessToken));
}

export { API_BASE };

// Where the refresh token lives: Electron's `safeStorage`-backed secure store
// when the app runs inside the desktop shell (`window.api.secureStore`), else
// `localStorage`. A 7-day refresh token in a plaintext `electron-store` JSON
// file would be worse than `localStorage`, so this distinction matters.
//
// Both branches expose the same async contract so callers never need to know
// which one is active. Guarded like i18n.ts: this file is imported by
// auth.ts, which is unit-tested under Node's bare test runner with no
// `window` global at all.

const REFRESH_KEY = "micd_refresh_token";

function secureStore() {
  return typeof window !== "undefined" ? window.api?.secureStore : undefined;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = secureStore();
  if (store) return (await store.get(REFRESH_KEY)) ?? null;
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(REFRESH_KEY)
      : null;
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  const store = secureStore();
  if (store) {
    await store.set(REFRESH_KEY, token);
    return;
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(REFRESH_KEY, token);
  } catch {
    // best-effort persistence only — a session that resets on reload is fine
  }
}

export async function clearRefreshToken(): Promise<void> {
  const store = secureStore();
  if (store) {
    await store.delete(REFRESH_KEY);
    return;
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(REFRESH_KEY);
  } catch {
    // best-effort only
  }
}

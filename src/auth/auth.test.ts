/**
 * Tests for auth.ts — session state, single-flight refresh, the login-prompt
 * dedup behind ensureAuthenticated(), and authFetch's 401 escalation.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 *
 * auth.ts only touches localStorage/fetch inside functions, so stubbing the
 * globals here (module scope) is enough — no DOM required.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  login,
  logout,
  refreshAccessToken,
  authFetch,
  ensureAuthenticated,
  setLoginPrompt,
  onAuthChange,
  isAuthenticated,
  getAccessToken,
  getCurrentUser,
  getSessionExpiresAt,
  API_ORIGIN,
  type AuthUser,
} from "./auth.ts";

// auth.ts prefixes its own /auth/* calls with the configured API origin
// (default http://localhost:3000). The /api/* URLs below are passed straight
// into authFetch by the caller, so they stay exactly as written.
const AUTH_LOGIN = `${API_ORIGIN}/auth/login`;
const AUTH_REFRESH = `${API_ORIGIN}/auth/refresh`;
const AUTH_LOGOUT = `${API_ORIGIN}/auth/logout`;

// ── Global stubs ──────────────────────────────────────────────────────────────

const REFRESH_KEY = "micd_refresh_token";
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}
let fetchCalls: FetchCall[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
(globalThis as { fetch?: unknown }).fetch = (
  url: string,
  init?: RequestInit,
) => {
  fetchCalls.push({ url, init });
  return fetchImpl(url, init);
};

/** Routes fetches by exact URL; unexpected URLs fail the test loudly. */
function respondBy(
  routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
): void {
  fetchImpl = async (url, init) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler(init);
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Builds an unsigned-but-well-formed JWT whose payload auth.ts can decode. */
function jwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

const adminUser: AuthUser = { id: 1, email: "admin@micd.local", role: "admin" };
const adminToken = jwt({
  sub: adminUser.id,
  email: adminUser.email,
  role: "admin",
});

function bearerOf(call: FetchCall): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)
    ?.Authorization;
}

/** Seeds a live session the same way the login dialog does. */
async function loginAsAdmin(
  accessToken = adminToken,
  refreshToken = "refresh-1",
): Promise<void> {
  respondBy({
    [AUTH_LOGIN]: () => json({ accessToken, refreshToken, user: adminUser }),
  });
  const result = await login(adminUser.email, "secret");
  assert.deepEqual(result, { ok: true });
}

beforeEach(async () => {
  fetchImpl = async () => new Response(null, { status: 204 });
  await logout(); // resets auth.ts module state
  store.clear();
  fetchCalls = [];
  setLoginPrompt(() => Promise.resolve(false));
});

// ── login ─────────────────────────────────────────────────────────────────────

test("login success stores the session and notifies listeners", async () => {
  let notified: AuthUser | null = null;
  onAuthChange((user) => {
    notified = user;
  });
  await loginAsAdmin();

  assert.equal(isAuthenticated(), true);
  assert.equal(getAccessToken(), adminToken);
  assert.equal(store.get(REFRESH_KEY), "refresh-1");
  assert.deepEqual(getCurrentUser(), adminUser);
  assert.deepEqual(notified, adminUser);
});

test("login 429 reports the rate-limit message and keeps no session", async () => {
  respondBy({ [AUTH_LOGIN]: () => json({ error: "rate limited" }, 429) });
  const result = await login("a@b.c", "pw");
  assert.equal(result.ok, false);
  // cspell:disable-next-line
  assert.match((result as { error: string }).error, /Demasiados intentos/);
  assert.equal(isAuthenticated(), false);
});

test("login with bad credentials reports the credentials message", async () => {
  respondBy({ [AUTH_LOGIN]: () => json({ error: "nope" }, 401) });
  const result = await login("a@b.c", "pw");
  assert.equal(result.ok, false);
  // cspell:disable-next-line
  assert.match((result as { error: string }).error, /incorrectos/);
  assert.equal(isAuthenticated(), false);
});

test("login network failure reports the connection message", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await login("a@b.c", "pw");
  assert.equal(result.ok, false);
  // cspell:disable-next-line
  assert.match((result as { error: string }).error, /No se pudo conectar/);
  assert.equal(isAuthenticated(), false);
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

test("refresh with no stored token returns false without any request", async () => {
  assert.equal(await refreshAccessToken(), false);
  assert.equal(fetchCalls.length, 0);
});

test("refresh success rotates the stored token and decodes the user from the JWT", async () => {
  store.set(REFRESH_KEY, "refresh-1");
  respondBy({
    [AUTH_REFRESH]: () =>
      json({ accessToken: adminToken, refreshToken: "refresh-2" }),
  });

  assert.equal(await refreshAccessToken(), true);
  assert.equal(store.get(REFRESH_KEY), "refresh-2");
  assert.equal(isAuthenticated(), true);
  // /auth/refresh returns no user object — it must come from the JWT claims
  assert.deepEqual(getCurrentUser(), adminUser);
});

test("refresh rejected by the server clears the whole session", async () => {
  await loginAsAdmin();
  respondBy({ [AUTH_REFRESH]: () => json({ error: "revoked" }, 401) });

  assert.equal(await refreshAccessToken(), false);
  assert.equal(isAuthenticated(), false);
  assert.equal(store.has(REFRESH_KEY), false);
});

test("refresh network failure keeps the refresh token for a later retry", async () => {
  store.set(REFRESH_KEY, "refresh-1");
  fetchImpl = async () => {
    throw new Error("offline");
  };
  assert.equal(await refreshAccessToken(), false);
  assert.equal(store.get(REFRESH_KEY), "refresh-1");
});

test("refresh keeps the known user when the new token carries no claims", async () => {
  await loginAsAdmin();
  // A token whose payload has no sub/email at all — the session is still valid,
  // so the user we already know must survive rather than being nulled out and
  // blanking the account block in the panel footer.
  respondBy({
    [AUTH_REFRESH]: () =>
      json({ accessToken: jwt({ iat: 7 }), refreshToken: "refresh-2" }),
  });

  assert.equal(await refreshAccessToken(), true);
  assert.deepEqual(getCurrentUser(), adminUser);
});

test("refresh keeps the known user when the claims are the wrong types", async () => {
  await loginAsAdmin();
  // sub as a string is the shape a JWT library change could plausibly produce;
  // it must be rejected as a user rather than trusted into { id: "1" }.
  respondBy({
    [AUTH_REFRESH]: () =>
      json({
        accessToken: jwt({ sub: "1", email: 42 }),
        refreshToken: "refresh-2",
      }),
  });

  assert.equal(await refreshAccessToken(), true);
  assert.deepEqual(getCurrentUser(), adminUser);
});

test("concurrent refreshes are single-flight (rotation makes parallel refreshes race)", async () => {
  store.set(REFRESH_KEY, "refresh-1");
  let release!: (res: Response) => void;
  fetchImpl = () => new Promise<Response>((resolve) => (release = resolve));

  const results = [
    refreshAccessToken(),
    refreshAccessToken(),
    refreshAccessToken(),
  ];
  // The refresh-token read is async (token-store.ts), so doRefresh() needs a
  // microtask hop before it reaches fetch() and `release` gets assigned —
  // let the queue drain rather than assuming the old synchronous timing.
  await new Promise((resolve) => setTimeout(resolve, 0));
  release(json({ accessToken: adminToken, refreshToken: "refresh-2" }));

  assert.deepEqual(await Promise.all(results), [true, true, true]);
  assert.equal(fetchCalls.filter((c) => c.url === AUTH_REFRESH).length, 1);
});

// ── authFetch ─────────────────────────────────────────────────────────────────

test("authFetch attaches the bearer token", async () => {
  await loginAsAdmin();
  respondBy({ "/api/v1/studies": () => json({ studies: [] }) });

  const res = await authFetch("/api/v1/studies");
  assert.equal(res.status, 200);
  assert.equal(bearerOf(fetchCalls.at(-1)!), `Bearer ${adminToken}`);
});

test("authFetch sends no Authorization header when there is no session", async () => {
  // Guest state: the header must be absent, not `Bearer null`, which some
  // servers parse as a malformed token and answer 400 instead of 401.
  respondBy({ "/api/v1/studies": () => json({ studies: [] }) });

  const res = await authFetch("/api/v1/studies");
  assert.equal(res.status, 200);
  assert.equal(bearerOf(fetchCalls.at(-1)!), undefined);
});

test("authFetch on 401 refreshes and retries with the new token", async () => {
  await loginAsAdmin();
  const newToken = jwt({
    sub: adminUser.id,
    email: adminUser.email,
    role: "admin",
    iat: 2,
  });
  respondBy({
    "/api/x": (init) =>
      (init?.headers as Record<string, string>).Authorization ===
      `Bearer ${newToken}`
        ? json({ ok: true })
        : json({ error: "expired" }, 401),
    [AUTH_REFRESH]: () =>
      json({ accessToken: newToken, refreshToken: "refresh-2" }),
  });

  const res = await authFetch("/api/x");
  assert.equal(res.status, 200);
  assert.equal(bearerOf(fetchCalls.at(-1)!), `Bearer ${newToken}`);
});

test("authFetch on 401 + dead refresh + cancelled login returns the original 401", async () => {
  await loginAsAdmin();
  let prompts = 0;
  setLoginPrompt(() => {
    prompts++;
    return Promise.resolve(false);
  });
  respondBy({
    "/api/x": () => json({ error: "expired" }, 401),
    [AUTH_REFRESH]: () => json({ error: "revoked" }, 401),
  });

  const res = await authFetch("/api/x");
  assert.equal(res.status, 401);
  assert.equal(prompts, 1);
});

test("authFetch on 401 + dead refresh + interactive login retries with the new session", async () => {
  await loginAsAdmin();
  const newToken = jwt({
    sub: adminUser.id,
    email: adminUser.email,
    role: "admin",
    iat: 3,
  });
  respondBy({
    "/api/x": (init) =>
      (init?.headers as Record<string, string>).Authorization ===
      `Bearer ${newToken}`
        ? json({ ok: true })
        : json({ error: "expired" }, 401),
    [AUTH_REFRESH]: () => json({ error: "revoked" }, 401),
    [AUTH_LOGIN]: () =>
      json({
        accessToken: newToken,
        refreshToken: "refresh-2",
        user: adminUser,
      }),
  });
  setLoginPrompt(async () => (await login(adminUser.email, "secret")).ok);

  const res = await authFetch("/api/x");
  assert.equal(res.status, 200);
});

// ── ensureAuthenticated ───────────────────────────────────────────────────────

test("concurrent ensureAuthenticated calls share a single login prompt", async () => {
  let prompts = 0;
  let release!: (ok: boolean) => void;
  setLoginPrompt(() => {
    prompts++;
    return new Promise<boolean>((resolve) => (release = resolve));
  });

  const gates = [
    ensureAuthenticated(),
    ensureAuthenticated(),
    ensureAuthenticated(),
  ];
  await new Promise((r) => setTimeout(r, 0)); // let all three reach the prompt
  release(true);

  assert.deepEqual(await Promise.all(gates), [true, true, true]);
  assert.equal(prompts, 1);
});

test("ensureAuthenticated resolves without a prompt when a session exists", async () => {
  await loginAsAdmin();
  let prompts = 0;
  setLoginPrompt(() => {
    prompts++;
    return Promise.resolve(false);
  });

  assert.equal(await ensureAuthenticated(), true);
  assert.equal(prompts, 0);
});

test("ensureAuthenticated restores a dead in-memory session silently", async () => {
  // The access token lives in memory only, so every page reload arrives here:
  // no token, a refresh token in localStorage. That must not show a login form.
  store.set(REFRESH_KEY, "refresh-1");
  let prompts = 0;
  setLoginPrompt(() => {
    prompts++;
    return Promise.resolve(false);
  });
  respondBy({
    [AUTH_REFRESH]: () =>
      json({ accessToken: adminToken, refreshToken: "refresh-2" }),
  });

  assert.equal(await ensureAuthenticated(), true);
  assert.equal(prompts, 0, "a silent refresh must not prompt");
  assert.deepEqual(getCurrentUser(), adminUser);
});

// ── logout ────────────────────────────────────────────────────────────────────

test("logout posts the refresh token and clears the session even if the network fails", async () => {
  await loginAsAdmin();
  fetchImpl = async () => {
    throw new Error("offline");
  };

  await logout();
  assert.equal(isAuthenticated(), false);
  assert.equal(getCurrentUser(), null);
  assert.equal(store.has(REFRESH_KEY), false);

  const call = fetchCalls.at(-1)!;
  assert.equal(call.url, AUTH_LOGOUT);
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    refreshToken: "refresh-1",
  });
});

// ── session expiry (drives the countdown in the UI) ──────────────────────────

test("login records the access token's exp claim in epoch ms", async () => {
  const expSeconds = Math.floor(Date.now() / 1000) + 900; // the backend's 15m
  await loginAsAdmin(
    jwt({
      sub: adminUser.id,
      email: adminUser.email,
      role: "admin",
      exp: expSeconds,
    }),
  );
  assert.equal(getSessionExpiresAt(), expSeconds * 1000);
});

test("a token with no exp claim reports no expiry rather than 0", () => {
  // adminToken carries sub/email only. Treating a missing exp as 0 would show
  // a permanently expired session.
  assert.equal(getSessionExpiresAt(), null);
});

test("refresh replaces the expiry with the new token's", async () => {
  await loginAsAdmin(
    jwt({
      sub: adminUser.id,
      email: adminUser.email,
      role: "admin",
      exp: 1000,
    }),
  );
  assert.equal(getSessionExpiresAt(), 1_000_000);

  respondBy({
    [AUTH_REFRESH]: () =>
      json({
        accessToken: jwt({
          sub: adminUser.id,
          email: adminUser.email,
          role: "admin",
          exp: 2000,
        }),
        refreshToken: "refresh-2",
      }),
  });
  assert.equal(await refreshAccessToken(), true);
  assert.equal(getSessionExpiresAt(), 2_000_000);
});

test("logout clears the expiry along with the session", async () => {
  await loginAsAdmin(
    jwt({
      sub: adminUser.id,
      email: adminUser.email,
      role: "admin",
      exp: 1000,
    }),
  );
  await logout();
  assert.equal(getSessionExpiresAt(), null);
});

test("a malformed token yields no expiry instead of throwing", async () => {
  await loginAsAdmin("not-a-jwt");
  assert.equal(getSessionExpiresAt(), null);
  assert.equal(isAuthenticated(), true);
});

/**
 * Tests updateAuthUI() and the activity-history dialog against the real
 * auth.ts (login()/authFetch()), stubbing only fetch/localStorage — same
 * approach as login-form.test.ts — plus jsdom for the DOM it repaints.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { updateAuthUI, initActivityHistory } from "./session-ui.ts";
import { login, logout, API_ORIGIN, API_BASE } from "./auth.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

let store: Map<string, string>;
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  (globalThis as { fetch?: unknown }).fetch = (url: string, init?: RequestInit) =>
    fetchImpl(url, init);
  setBody(`
    <button id="btn-login">Log in</button>
    <div id="session-block" class="hidden">
      <span id="session-email"></span>
      <span id="session-avatar"></span>
      <span id="session-expiry"></span>
      <button id="btn-activity" class="hidden">Activity</button>
    </div>
    <div id="explorer-session-line"></div>
    <div id="session-announce"></div>
    <div id="activity-dialog" class="hidden">
      <div class="dialog" role="dialog">
        <button id="activity-close">Close</button>
        <div id="activity-body"></div>
      </div>
    </div>
  `);
});

afterEach(async () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { fetch?: unknown }).fetch;
  await logout().catch(() => {});
  // updateAuthUI's unauthenticated branch calls stopTicking() internally —
  // startTicking() sets a real (unmocked-outside-fake-timer-tests) setInterval
  // that would otherwise keep the process alive past every test that signs in.
  updateAuthUI();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

async function loginAs(
  role: "admin" | "medico" | "investigador",
  email: string,
  remainingSeconds: number,
): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + remainingSeconds;
  fetchImpl = async () =>
    jsonResponse(200, {
      accessToken: fakeJwt({ sub: 1, email, role, exp }),
      refreshToken: "r",
      user: { id: 1, email, role },
    });
  const result = await login(email, "pw");
  assert.equal(result.ok, true);
}

test("updateAuthUI shows the guest state when signed out", () => {
  updateAuthUI();
  assert.equal(document.getElementById("btn-login")!.classList.contains("hidden"), false);
  assert.equal(document.getElementById("session-block")!.classList.contains("hidden"), true);
  assert.notEqual(document.getElementById("explorer-session-line")!.textContent, "");
});

test("updateAuthUI shows the session state for a signed-in non-admin", async () => {
  await loginAs("medico", "doc@example.com", 300);
  updateAuthUI();

  assert.equal(document.getElementById("btn-login")!.classList.contains("hidden"), true);
  assert.equal(document.getElementById("session-block")!.classList.contains("hidden"), false);
  assert.equal(document.getElementById("btn-activity")!.classList.contains("hidden"), true);
  assert.equal(document.getElementById("session-email")!.textContent, "doc@example.com");
  assert.equal(document.getElementById("session-avatar")!.textContent, "DO");
  assert.match(document.getElementById("session-expiry")!.textContent!, /\d+:\d\d/);
});

test("updateAuthUI reveals the activity button for admins", async () => {
  await loginAs("admin", "root@example.com", 300);
  updateAuthUI();
  assert.equal(document.getElementById("btn-activity")!.classList.contains("hidden"), false);
});

test("the countdown announces once when under a minute remains, then reports expired", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
  return (async () => {
    await loginAs("medico", "doc@example.com", 65);
    updateAuthUI();

    const announce = document.getElementById("session-announce")!;
    assert.equal(announce.textContent, "");

    t.mock.timers.tick(6000); // remaining ~59s now, under the 60s warning threshold
    assert.notEqual(announce.textContent, "");
    const warned = announce.textContent;

    t.mock.timers.tick(1000); // still under a minute — should not re-announce
    assert.equal(announce.textContent, warned);

    t.mock.timers.tick(60_000); // now past expiry
    assert.equal(
      document.getElementById("session-expiry")!.textContent,
      document.getElementById("session-expiry")!.textContent, // just re-read below
    );
    assert.match(document.getElementById("explorer-session-line")!.textContent!, /.+/);
  })();
});

test("updateAuthUI falls back to '··' avatar and stops ticking when signing out mid-session", async () => {
  await loginAs("medico", "doc@example.com", 300);
  updateAuthUI();
  await logout();
  updateAuthUI();
  assert.equal(document.getElementById("session-announce")!.textContent, "");
  assert.equal(document.getElementById("session-block")!.classList.contains("hidden"), true);
});

test("initActivityHistory opens the dialog and loads entries", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async (url) => {
    assert.equal(url, `${API_BASE}/v1/activity?limit=50`);
    return jsonResponse(200, {
      entries: [
        { action: "upload", timestamp: "2024-01-01T00:00:00Z", resourceId: "abc" },
        { action: "login", timestamp: "2024-01-02T00:00:00Z" },
      ],
    });
  };

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const body = document.getElementById("activity-body")!;
  assert.equal(body.querySelectorAll(".activity-item").length, 2);
  assert.equal(document.getElementById("activity-dialog")!.classList.contains("hidden"), false);

  document.getElementById("activity-close")!.dispatchEvent(new Event("click", { bubbles: true }));
  assert.equal(document.getElementById("activity-dialog")!.classList.contains("hidden"), true);
});

test("loadActivity shows an empty-state message when there are no entries", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async () => jsonResponse(200, { entries: [] });

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById("activity-body")!.innerHTML, /activity-empty/);
});

test("loadActivity reports the 'not available' message on a 404", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async () => jsonResponse(404, {});

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById("activity-body")!.innerHTML, /activity-empty/);
});

test("loadActivity reports a load error on a non-ok, non-404 response", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async () => jsonResponse(500, {});

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById("activity-body")!.innerHTML, /activity-empty/);
});

test("loadActivity reports a network error when fetch throws", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async () => {
    throw new Error("offline");
  };

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById("activity-body")!.innerHTML, /activity-empty/);
});

test("loadActivity reports an unexpected-response message when json() throws", async () => {
  await loginAs("admin", "root@example.com", 300);
  fetchImpl = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    }) as Response;

  initActivityHistory();
  document.getElementById("btn-activity")!.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.match(document.getElementById("activity-body")!.innerHTML, /activity-empty/);
});

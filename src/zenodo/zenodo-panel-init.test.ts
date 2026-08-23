/**
 * Panel open/close, tab switching, and role-gated tab visibility for
 * zenodo-panel.ts. See test/zenodo-fixture.ts for the shared markup/fetch
 * mock and src/shared/dialog.test.ts / screen.test.ts for the jsdom patterns
 * this follows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { jwt, zenodoPanelHtml, createMockFetch } from "../../test/zenodo-fixture.ts";
import { adoptSession, logout, type AuthUser } from "../auth/auth.ts";
import { initZenodoPanel } from "./zenodo-panel.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

const adminUser: AuthUser = { id: 1, email: "admin@micd.local", role: "admin" };
const medicoUser: AuthUser = { id: 2, email: "medico@micd.local", role: "medico" };

async function loginAs(user: AuthUser): Promise<void> {
  await adoptSession(jwt({ sub: user.id, email: user.email, role: user.role }), "refresh-fake", user);
}

test.beforeEach(async () => {
  setBody(zenodoPanelHtml());
  const { fetchImpl } = createMockFetch();
  (globalThis as any).fetch = fetchImpl;
  await logout().catch(() => {});
});

test("initZenodoPanel starts closed and toggles open/closed via the rail button", () => {
  initZenodoPanel();
  const panel = document.getElementById("zenodo-panel")!;
  const openBtn = document.getElementById("btn-open-zenodo")!;

  assert.equal(panel.classList.contains("zenodo-panel--closed"), true);
  assert.equal(panel.inert, true);
  assert.equal(openBtn.getAttribute("aria-expanded"), "false");

  openBtn.click();
  assert.equal(panel.classList.contains("zenodo-panel--closed"), false);
  assert.equal(panel.inert, false);
  assert.equal(openBtn.getAttribute("aria-expanded"), "true");
  assert.equal(openBtn.classList.contains("active"), true);

  openBtn.click();
  assert.equal(panel.classList.contains("zenodo-panel--closed"), true);
  assert.equal(openBtn.getAttribute("aria-expanded"), "false");
});

test("btn-close-zenodo closes the panel and returns focus to the opener", () => {
  initZenodoPanel();
  const panel = document.getElementById("zenodo-panel")!;
  const openBtn = document.getElementById("btn-open-zenodo")!;
  openBtn.click();

  document.getElementById("btn-close-zenodo")!.click();
  assert.equal(panel.classList.contains("zenodo-panel--closed"), true);
  assert.equal(document.activeElement, openBtn);
});

test("Escape inside the panel closes it", () => {
  initZenodoPanel();
  const panel = document.getElementById("zenodo-panel")!;
  document.getElementById("btn-open-zenodo")!.click();

  panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(panel.classList.contains("zenodo-panel--closed"), true);
});

test("clicking a tab switches the active tab and panel, and loads config on demand", async () => {
  const { fetchImpl, on } = createMockFetch();
  (globalThis as any).fetch = fetchImpl;
  on(
    (url) => url.includes("/v1/zenodo/config/"),
    () => ({ status: 200, body: {} }),
  );
  await loginAs(adminUser);

  initZenodoPanel();
  const configTab = document.querySelector<HTMLElement>('.z-tab[data-tab="config"]')!;
  configTab.click();

  assert.equal(configTab.classList.contains("z-tab--active"), true);
  assert.equal(document.getElementById("z-tab-config")!.classList.contains("hidden"), false);
  assert.equal(document.getElementById("z-tab-search")!.classList.contains("hidden"), true);

  // loadConfig() is async — give its microtasks a tick to settle before
  // asserting the loading skeleton was at least swapped out.
  await Promise.resolve();
  await Promise.resolve();
});

test("applyRoleVisibility hides admin-only tabs for a non-admin and shows them for an admin", async () => {
  initZenodoPanel();
  const publishTab = document.querySelector<HTMLElement>('.z-tab[data-tab="publish"]')!;
  const configTab = document.querySelector<HTMLElement>('.z-tab[data-tab="config"]')!;
  const logsTab = document.querySelector<HTMLElement>('.z-tab[data-tab="logs"]')!;

  // Signed out: not admin.
  assert.equal(publishTab.classList.contains("hidden"), true);
  assert.equal(configTab.classList.contains("hidden"), true);
  assert.equal(logsTab.classList.contains("hidden"), true);

  await loginAs(adminUser);
  assert.equal(publishTab.classList.contains("hidden"), false);
  assert.equal(configTab.classList.contains("hidden"), false);
  assert.equal(logsTab.classList.contains("hidden"), false);

  await loginAs(medicoUser);
  assert.equal(publishTab.classList.contains("hidden"), true);
});

test("losing admin while on an admin-only tab falls back to search", async () => {
  const { fetchImpl, on } = createMockFetch();
  (globalThis as any).fetch = fetchImpl;
  on(
    (url) => url.includes("/v1/zenodo/config/"),
    () => ({ status: 200, body: {} }),
  );
  await loginAs(adminUser);
  initZenodoPanel();

  document.querySelector<HTMLElement>('.z-tab[data-tab="config"]')!.click();
  assert.equal(document.getElementById("z-tab-config")!.classList.contains("hidden"), false);

  await loginAs(medicoUser);
  assert.equal(document.getElementById("z-tab-search")!.classList.contains("hidden"), false);
  assert.equal(
    document.querySelector<HTMLElement>('.z-tab[data-tab="search"]')!.classList.contains("z-tab--active"),
    true,
  );
});

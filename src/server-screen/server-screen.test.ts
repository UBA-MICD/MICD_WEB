/**
 * Tests for server-screen.ts role gating, including informatico's server-only
 * mode. Loads the real markup (assembled from src/html like build-html.mjs) so
 * every element the screen wires up exists exactly as in production.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { adoptSession, logout, type AuthUser, type Role } from "../auth/auth.ts";
import {
  initServerScreen,
  openServerScreen,
  closeServerScreen,
} from "./server-screen.ts";
import { currentScreen } from "../shared/screen.ts";

const SRC = join(import.meta.dirname, "..");
const INCLUDE = /^\s*<!--\s*@include\s+(\S+)\s*-->\s*$/;

function expand(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => {
      const m = line.match(INCLUDE);
      return m ? expand(join(SRC, m[1])) : line;
    })
    .join("\n");
}

function pageBody(): string {
  const html = expand(join(SRC, "html", "index.template.html"));
  return html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
}

test.before(() => {
  installDom();
  // Every server call answers an empty, successful list: these tests are
  // about which controls a role sees, not about data.
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ studies: [], total: 0, page: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  document.body.innerHTML = pageBody();
  initServerScreen();
});
test.after(() => uninstallDom());

beforeEach(async () => {
  await logout();
  closeServerScreen();
});

async function signInAs(role: Role): Promise<void> {
  const user: AuthUser = { id: 7, email: `${role}@micd.local`, role };
  await adoptSession("fake-access-token", "fake-refresh-token", user);
}

const hidden = (id: string): boolean =>
  document.getElementById(id)!.classList.contains("hidden");

test("informatico sees only Buscar and Cargar, with download as the primary action", async () => {
  await signInAs("informatico");
  openServerScreen();

  assert.equal(hidden("tab-buscar"), false);
  assert.equal(hidden("tab-cargar"), false);
  assert.equal(hidden("tab-validaciones"), true);
  assert.equal(hidden("tab-usuarios"), true);
  assert.equal(hidden("tab-sistema"), true);
  assert.equal(hidden("btn-server-settings"), true);
  assert.equal(
    document.getElementById("btn-open-selected")!.dataset.i18n,
    "explorer.downloadSelected",
  );
});

test("informatico gets the server-only chrome: no way back, session in the header", async () => {
  await signInAs("informatico");
  openServerScreen();

  assert.equal(hidden("btn-server-back"), true);
  assert.equal(hidden("btn-buscar-cancel"), true);
  assert.equal(hidden("btn-upload-finish"), true);
  assert.equal(hidden("server-session"), false);
  assert.equal(
    document.getElementById("server-session-email")!.textContent,
    "informatico@micd.local",
  );
});

test("informatico cannot leave the server screen", async () => {
  await signInAs("informatico");
  openServerScreen();
  closeServerScreen();
  assert.equal(currentScreen(), "server");
});

test("an informatico session is moved to the server screen from the viewer", async () => {
  assert.equal(currentScreen(), "viewer");
  await signInAs("informatico");
  assert.equal(currentScreen(), "server");
});

test("logging out of informatico shows the login card and the normal chrome again", async () => {
  await signInAs("informatico");
  openServerScreen();
  await logout();

  assert.equal(hidden("server-auth"), false);
  assert.equal(hidden("server-session"), true);
  assert.equal(hidden("btn-server-back"), false);
});

test("medico keeps the viewer round trip and the open action", async () => {
  await signInAs("medico");
  openServerScreen();

  assert.equal(hidden("tab-cargar"), false);
  assert.equal(hidden("tab-validaciones"), false);
  assert.equal(hidden("tab-usuarios"), true);
  assert.equal(hidden("btn-server-back"), false);
  assert.equal(hidden("server-session"), true);
  assert.equal(
    document.getElementById("btn-open-selected")!.dataset.i18n,
    "explorer.openSelected",
  );

  closeServerScreen();
  assert.equal(currentScreen(), "viewer");
});

test("investigador has no Cargar tab", async () => {
  await signInAs("investigador");
  openServerScreen();
  assert.equal(hidden("tab-cargar"), true);
  assert.equal(hidden("tab-validaciones"), true);
});

test("admin sees every tab and the settings gear", async () => {
  await signInAs("admin");
  openServerScreen();
  for (const id of [
    "tab-buscar",
    "tab-cargar",
    "tab-validaciones",
    "tab-usuarios",
    "tab-sistema",
    "btn-server-settings",
  ]) {
    assert.equal(hidden(id), false, id);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

// screen.ts keeps module-level state (which screen is active). Each test
// gets a fresh module instance via a cache-busting query string so tests
// don't leak state into each other.
let counter = 0;
async function freshScreenModule() {
  return import(`./screen.ts?fresh=${counter++}`);
}

function fixture(): { viewer: HTMLElement; server: HTMLElement } {
  setBody(`
    <div id="viewer"><h1 data-screen-heading tabindex="-1">Viewer</h1></div>
    <div id="server"><h1 data-screen-heading tabindex="-1">Server</h1></div>
  `);
  return {
    viewer: document.getElementById("viewer") as HTMLElement,
    server: document.getElementById("server") as HTMLElement,
  };
}

test("currentScreen defaults to viewer", async () => {
  const { currentScreen } = await freshScreenModule();
  assert.equal(currentScreen(), "viewer");
});

test("showScreen with an unregistered name is a no-op", async () => {
  const { showScreen, currentScreen } = await freshScreenModule();
  showScreen("server");
  assert.equal(currentScreen(), "viewer");
});

test("showScreen hides all but the target and moves focus to its heading", async () => {
  const { registerScreen, showScreen, currentScreen } = await freshScreenModule();
  const { viewer, server } = fixture();
  registerScreen("viewer", viewer);
  registerScreen("server", server);

  showScreen("server");

  assert.equal(currentScreen(), "server");
  assert.equal(server.classList.contains("hidden"), false);
  assert.equal(server.inert, false);
  assert.equal(viewer.classList.contains("hidden"), true);
  assert.equal(viewer.inert, true);
  assert.equal(document.activeElement, server.querySelector("[data-screen-heading]"));
});

test("showScreen falls back to the screen root when there is no heading", async () => {
  const { registerScreen, showScreen } = await freshScreenModule();
  setBody(`<div id="viewer"></div><div id="server"></div>`);
  const viewer = document.getElementById("viewer") as HTMLElement;
  const server = document.getElementById("server") as HTMLElement;
  viewer.tabIndex = -1;
  server.tabIndex = -1;
  registerScreen("viewer", viewer);
  registerScreen("server", server);

  showScreen("server");
  assert.equal(document.activeElement, server);
});

test("showScreen(name, from) remembers the opener, and returning to viewer restores its focus", async () => {
  const { registerScreen, showScreen, currentScreen } = await freshScreenModule();
  const { viewer, server } = fixture();
  registerScreen("viewer", viewer);
  registerScreen("server", server);

  const trigger = document.createElement("button");
  document.body.appendChild(trigger);

  showScreen("server", trigger);
  assert.equal(currentScreen(), "server");

  showScreen("viewer");
  assert.equal(currentScreen(), "viewer");
  assert.equal(document.activeElement, trigger);
});

test("showScreen(viewer) with a disconnected opener falls back to focusing the heading", async () => {
  const { registerScreen, showScreen } = await freshScreenModule();
  const { viewer, server } = fixture();
  registerScreen("viewer", viewer);
  registerScreen("server", server);

  const trigger = document.createElement("button");
  // never attached to the document, so isConnected is false
  showScreen("server", trigger);
  showScreen("viewer");

  assert.equal(document.activeElement, viewer.querySelector("[data-screen-heading]"));
});

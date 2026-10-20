import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  initServerConfigModal,
  openServerConfigModal,
  closeServerConfigModal,
  _resetServerConfigModalForTest,
} from "./server-config-modal.ts";
import { persistServerUrl } from "../viewer/state.ts";
import { isDialogOpen } from "../shared/dialog.ts";
import { getServerUrl } from "../services/api.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

let store: Map<string, string>;

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

  persistServerUrl("http://localhost:3000");
  _resetServerConfigModalForTest();

  setBody(`
    <div id="server-config-dialog" class="dialog-overlay hidden">
      <form
        class="dialog server-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-config-dialog-title"
        id="server-config-form"
      >
        <h3 id="server-config-dialog-title">Configuración del Servidor</h3>
        <input
          type="url"
          id="server-config-url-input"
          class="server-config-input"
          data-dialog-autofocus
        />
        <p id="server-config-error" class="login-error hidden" role="alert"></p>
        <button type="button" id="btn-server-config-cancel">Cancelar</button>
        <button type="submit" id="btn-server-config-save">Guardar / Conectar</button>
      </form>
    </div>
    <div id="toast-container"></div>
    <section id="server-screen" class="hidden"></section>
    <section id="viewer-screen"></section>
  `);

  initServerConfigModal();
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("openServerConfigModal pre-fills active serverUrl and opens dialog", () => {
  const overlay = document.getElementById(
    "server-config-dialog",
  ) as HTMLElement;
  const input = document.getElementById(
    "server-config-url-input",
  ) as HTMLInputElement;

  persistServerUrl("http://hospital.pacs:8042");
  openServerConfigModal();

  assert.equal(isDialogOpen(overlay), true);
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(input.value, "http://hospital.pacs:8042");

  closeServerConfigModal();
  assert.equal(isDialogOpen(overlay), false);
});

test("submitting invalid URL displays error style and message", () => {
  openServerConfigModal();

  const form = document.getElementById("server-config-form") as HTMLFormElement;
  const input = document.getElementById(
    "server-config-url-input",
  ) as HTMLInputElement;
  const errorEl = document.getElementById("server-config-error") as HTMLElement;
  const overlay = document.getElementById(
    "server-config-dialog",
  ) as HTMLElement;

  input.value = "ftp://invalid-server.com";
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

  assert.equal(input.classList.contains("server-config-input--error"), true);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(errorEl.classList.contains("hidden"), false);
  assert.match(errorEl.textContent || "", /protocolo/i);
  // Modal remains open on error
  assert.equal(isDialogOpen(overlay), true);

  closeServerConfigModal();
});

test("typing in input clears the error state", () => {
  openServerConfigModal();

  const form = document.getElementById("server-config-form") as HTMLFormElement;
  const input = document.getElementById(
    "server-config-url-input",
  ) as HTMLInputElement;
  const errorEl = document.getElementById("server-config-error") as HTMLElement;

  input.value = "   ";
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

  assert.equal(input.classList.contains("server-config-input--error"), true);
  assert.equal(errorEl.classList.contains("hidden"), false);

  // User begins typing
  input.value = "http://valid-host:8042";
  input.dispatchEvent(new Event("input", { bubbles: true }));

  assert.equal(input.classList.contains("server-config-input--error"), false);
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(errorEl.classList.contains("hidden"), true);
  assert.equal(errorEl.textContent, "");

  closeServerConfigModal();
});

test("cancel button dismisses the modal without modifying server URL", () => {
  persistServerUrl("http://localhost:3000");
  openServerConfigModal();

  const cancelBtn = document.getElementById(
    "btn-server-config-cancel",
  ) as HTMLButtonElement;
  const overlay = document.getElementById(
    "server-config-dialog",
  ) as HTMLElement;

  cancelBtn.click();

  assert.equal(isDialogOpen(overlay), false);
  assert.equal(overlay.classList.contains("hidden"), true);
  assert.equal(getServerUrl(), "http://localhost:3000");
});

test("submitting valid URL updates serverUrl and closes dialog", () => {
  openServerConfigModal();

  const form = document.getElementById("server-config-form") as HTMLFormElement;
  const input = document.getElementById(
    "server-config-url-input",
  ) as HTMLInputElement;
  const overlay = document.getElementById(
    "server-config-dialog",
  ) as HTMLElement;

  input.value = "https://pacs.radiology.org:8443/dicom-web";
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

  assert.equal(getServerUrl(), "https://pacs.radiology.org:8443");
  assert.equal(store.get("micd_server_url"), "https://pacs.radiology.org:8443");
  assert.equal(isDialogOpen(overlay), false);
  assert.equal(overlay.classList.contains("hidden"), true);
});

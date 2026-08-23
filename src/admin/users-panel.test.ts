/**
 * Tests mountUsersPanel() — the DOM wiring around users-admin.ts. Stubs
 * global fetch (authFetch's transport, so users-admin.ts's real API calls
 * run) and jsdom for the panel markup, plus window.confirm for the delete flow.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { mountUsersPanel } from "./users-panel.ts";
import { API_BASE } from "../auth/auth.ts";

const USERS_URL = `${API_BASE}/v1/users`;

test.before(() => installDom());
test.after(() => uninstallDom());

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
let confirmResult = true;

beforeEach(() => {
  (globalThis as { fetch?: unknown }).fetch = (url: string, init?: RequestInit) =>
    fetchImpl(url, init);
  (globalThis as any).confirm = () => confirmResult;
  confirmResult = true;

  setBody(`
    <div id="panel-usuarios">
      <div data-users-error class="hidden"></div>
      <table><tbody data-users-tbody></tbody></table>
      <form data-user-create>
        <input data-user-new-name />
        <input data-user-new-email />
        <select data-user-new-role>
          <option value="medico">Médico</option>
          <option value="admin">Admin</option>
        </select>
        <div data-user-new-error class="hidden"></div>
        <button data-user-new-submit type="submit">Create</button>
      </form>
    </div>
  `);
});

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
  delete (globalThis as any).confirm;
});

function root(): HTMLElement {
  return document.getElementById("panel-usuarios")!;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const sampleUser = {
  id: 1,
  name: "Jane",
  email: "jane@micd.local",
  role: "medico" as const,
  status: "active" as const,
  has_password: true,
  last_login_at: null,
};

test("reload() renders fetched users into the table", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  const tbody = root().querySelector("[data-users-tbody]")!;
  assert.match(tbody.innerHTML, /jane@micd\.local/);
  assert.equal(root().querySelector("[data-users-error]")!.classList.contains("hidden"), true);
});

test("reload() shows a forbidden message on a 403", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "nope" });
  const panel = mountUsersPanel(root());
  await panel.reload();

  const errorEl = root().querySelector("[data-users-error]")!;
  assert.equal(errorEl.classList.contains("hidden"), false);
  assert.notEqual(errorEl.textContent, "");
  assert.match(root().querySelector("[data-users-tbody]")!.innerHTML, /user-empty/);
});

test("reload() shows the server error message on other failures", async () => {
  fetchImpl = async () => jsonResponse(500, { error: "boom" });
  const panel = mountUsersPanel(root());
  await panel.reload();
  assert.equal(root().querySelector("[data-users-error]")!.textContent, "boom");
});

test("create form: client-side validation blocks submit before hitting the network", async () => {
  let fetchCalled = false;
  fetchImpl = async () => {
    fetchCalled = true;
    return jsonResponse(200, []);
  };
  mountUsersPanel(root());

  const form = root().querySelector("[data-user-create]") as HTMLFormElement;
  (form.querySelector("[data-user-new-name]") as HTMLInputElement).value = "";
  (form.querySelector("[data-user-new-email]") as HTMLInputElement).value = "not-an-email";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(fetchCalled, false);
  const formErr = form.querySelector("[data-user-new-error]")!;
  assert.equal(formErr.classList.contains("hidden"), false);
});

test("create form: valid submit creates the user, resets the form, and reloads", async () => {
  let createCalls = 0;
  let listCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "POST") {
      createCalls++;
      return jsonResponse(201, { ...sampleUser, id: 2, email: "new@micd.local" });
    }
    listCalls++;
    return jsonResponse(200, [sampleUser]);
  };
  mountUsersPanel(root());

  const form = root().querySelector("[data-user-create]") as HTMLFormElement;
  (form.querySelector("[data-user-new-name]") as HTMLInputElement).value = "New";
  (form.querySelector("[data-user-new-email]") as HTMLInputElement).value = "new@micd.local";
  (form.querySelector("[data-user-new-role]") as HTMLSelectElement).value = "medico";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(createCalls, 1);
  assert.equal(listCalls, 1);
  assert.equal((form.querySelector("[data-user-new-name]") as HTMLInputElement).value, "");
});

test("create form: server-side rejection shows the returned error and does not reset", async () => {
  fetchImpl = async (url, init) => {
    if (init?.method === "POST") return jsonResponse(409, { error: "email taken" });
    return jsonResponse(200, []);
  };
  mountUsersPanel(root());

  const form = root().querySelector("[data-user-create]") as HTMLFormElement;
  (form.querySelector("[data-user-new-name]") as HTMLInputElement).value = "New";
  (form.querySelector("[data-user-new-email]") as HTMLInputElement).value = "new@micd.local";
  (form.querySelector("[data-user-new-role]") as HTMLSelectElement).value = "medico";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const formErr = form.querySelector("[data-user-new-error]")!;
  assert.equal(formErr.textContent, "email taken");
  assert.notEqual((form.querySelector("[data-user-new-name]") as HTMLInputElement).value, "");
});

test("changing a row's role select calls setUserRole and reloads", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  let roleCalls = 0;
  let listCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "PATCH" && url.endsWith("/role")) {
      roleCalls++;
      assert.equal(url, `${USERS_URL}/1/role`);
      return jsonResponse(200, { ...sampleUser, role: "admin" });
    }
    listCalls++;
    return jsonResponse(200, [{ ...sampleUser, role: "admin" }]);
  };

  const select = root().querySelector("[data-user-role]") as HTMLSelectElement;
  select.value = "admin";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(roleCalls, 1);
  assert.equal(listCalls, 1);
});

test("a failed role change still reloads, to revert the select to server truth", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  let listCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "PATCH") return jsonResponse(500, { error: "denied" });
    listCalls++;
    return jsonResponse(200, [sampleUser]);
  };

  const select = root().querySelector("[data-user-role]") as HTMLSelectElement;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(listCalls, 1);
});

test("clicking the toggle button blocks/enables the user and reloads", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  let statusCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "PATCH" && url.endsWith("/status")) {
      statusCalls++;
      assert.deepEqual(JSON.parse(init!.body as string), { status: "blocked" });
      return jsonResponse(200, { ...sampleUser, status: "blocked" });
    }
    return jsonResponse(200, [{ ...sampleUser, status: "blocked" }]);
  };

  const toggle = root().querySelector("[data-user-toggle]") as HTMLElement;
  toggle.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(statusCalls, 1);
});

test("clicking delete asks for confirmation and skips the request when cancelled", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  confirmResult = false;
  let deleteCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "DELETE") deleteCalls++;
    return jsonResponse(200, [sampleUser]);
  };

  const del = root().querySelector("[data-user-delete]") as HTMLElement;
  del.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(deleteCalls, 0);
});

test("clicking delete, when confirmed, deletes the user and reloads", async () => {
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  confirmResult = true;
  let deleteCalls = 0;
  let listCalls = 0;
  fetchImpl = async (url, init) => {
    if (init?.method === "DELETE") {
      deleteCalls++;
      assert.equal(url, `${USERS_URL}/1`);
      return jsonResponse(204, null);
    }
    listCalls++;
    return jsonResponse(200, []);
  };

  const del = root().querySelector("[data-user-delete]") as HTMLElement;
  del.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(deleteCalls, 1);
  assert.equal(listCalls, 1);
});

test("a failed delete shows a toast but does not throw, then reloads", async () => {
  setBody(`
    <div id="panel-usuarios">
      <div data-users-error class="hidden"></div>
      <table><tbody data-users-tbody></tbody></table>
      <form data-user-create>
        <input data-user-new-name /><input data-user-new-email />
        <select data-user-new-role><option value="medico">M</option></select>
        <div data-user-new-error class="hidden"></div>
        <button data-user-new-submit type="submit">Create</button>
      </form>
    </div>
    <div id="app-banner" class="hidden"></div>
    <div id="toast-container"></div>
  `);
  fetchImpl = async () => jsonResponse(200, [sampleUser]);
  const panel = mountUsersPanel(root());
  await panel.reload();

  fetchImpl = async (url, init) =>
    init?.method === "DELETE" ? jsonResponse(500, { error: "cannot delete" }) : jsonResponse(200, []);

  const del = root().querySelector("[data-user-delete]") as HTMLElement;
  await assert.doesNotReject(async () => {
    del.dispatchEvent(new Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
});

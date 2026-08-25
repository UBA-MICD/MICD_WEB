/**
 * Tests mountLoginForm() end-to-end against the real login() from auth.ts,
 * stubbing only the network (fetch) and localStorage — same approach as
 * auth.test.ts, plus jsdom for the form itself.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { mountLoginForm } from "./login-form.ts";
import { API_ORIGIN } from "./auth.ts";

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
  (globalThis as { fetch?: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => fetchImpl(url, init);
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { fetch?: unknown }).fetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fixture(): {
  form: HTMLFormElement;
  email: HTMLInputElement;
  password: HTMLInputElement;
  error: HTMLElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
} {
  setBody(`
    <form id="login-form">
      <input data-login-email value="" />
      <input data-login-password type="password" value="" />
      <div data-login-error class="hidden"></div>
      <button data-login-submit type="submit">Log in</button>
      <button data-login-cancel type="button">Cancel</button>
    </form>
  `);
  const form = document.getElementById("login-form") as HTMLFormElement;
  return {
    form,
    email: form.querySelector("[data-login-email]") as HTMLInputElement,
    password: form.querySelector("[data-login-password]") as HTMLInputElement,
    error: form.querySelector("[data-login-error]") as HTMLElement,
    submit: form.querySelector("[data-login-submit]") as HTMLButtonElement,
    cancel: form.querySelector("[data-login-cancel]") as HTMLButtonElement,
  };
}

function submitForm(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

test("mountLoginForm throws if required fields are missing", () => {
  setBody(`<form id="broken"><button data-login-submit>Go</button></form>`);
  const form = document.getElementById("broken") as HTMLFormElement;
  assert.throws(() => mountLoginForm(form, { onSuccess: () => {} }));
});

test("successful submit clears the form, calls onSuccess, and de-busies", async () => {
  const { form, email, password, submit, cancel } = fixture();
  email.value = "user@example.com";
  password.value = "hunter2";

  const busyStates: boolean[] = [];
  let successCalled = false;

  fetchImpl = async (url) => {
    assert.equal(url, `${API_ORIGIN}/auth/login`);
    assert.equal(submit.disabled, true);
    assert.equal(cancel.disabled, true);
    return jsonResponse(200, {
      accessToken: fakeJwt({
        sub: "u1",
        email: "user@example.com",
        role: "medico",
        exp: 9999999999,
      }),
      refreshToken: "refresh-abc",
      user: { id: "u1", email: "user@example.com" },
    });
  };

  mountLoginForm(form, {
    onSuccess: () => {
      successCalled = true;
    },
    onBusyChange: (busy) => busyStates.push(busy),
  });

  submitForm(form);
  // let the async submit handler run to completion
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(successCalled, true);
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(submit.disabled, false);
  assert.equal(cancel.disabled, false);
});

test("failed submit shows the error message and refocuses email, without calling onSuccess", async () => {
  const { form, email, password, error } = fixture();
  email.value = "user@example.com";
  password.value = "wrong";

  fetchImpl = async () => jsonResponse(401, { message: "nope" });

  let successCalled = false;
  mountLoginForm(form, { onSuccess: () => (successCalled = true) });

  submitForm(form);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(successCalled, false);
  assert.equal(error.classList.contains("hidden"), false);
  assert.notEqual(error.textContent, "");
  assert.equal(document.activeElement, email);
});

test("a submit while already in flight is ignored", async () => {
  const { form, email, password } = fixture();
  email.value = "user@example.com";
  password.value = "hunter2";

  let fetchCalls = 0;
  let resolveFetch: (() => void) | undefined;
  fetchImpl = () =>
    new Promise((resolve) => {
      fetchCalls++;
      resolveFetch = () => resolve(jsonResponse(401, {}));
    });

  mountLoginForm(form, { onSuccess: () => {} });

  submitForm(form); // starts the in-flight request
  submitForm(form); // should be ignored while inFlight
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(fetchCalls, 1);
  resolveFetch?.();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
});

test("reset() clears the form and any visible error", async () => {
  const { form, email, password, error } = fixture();
  email.value = "user@example.com";
  password.value = "wrong";
  fetchImpl = async () => jsonResponse(401, {});

  const handle = mountLoginForm(form, { onSuccess: () => {} });
  submitForm(form);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(error.classList.contains("hidden"), false);

  handle.reset();
  assert.equal(email.value, "");
  assert.equal(error.classList.contains("hidden"), true);
  assert.equal(error.textContent, "");
});

test("focusFirstField() focuses the email input", () => {
  const { form, email } = fixture();
  const handle = mountLoginForm(form, { onSuccess: () => {} });
  handle.focusFirstField();
  assert.equal(document.activeElement, email);
});

test("mountLoginForm works without an optional cancel button", async () => {
  setBody(`
    <form id="no-cancel">
      <input data-login-email />
      <input data-login-password type="password" />
      <div data-login-error class="hidden"></div>
      <button data-login-submit type="submit">Go</button>
    </form>
  `);
  const form = document.getElementById("no-cancel") as HTMLFormElement;
  const email = form.querySelector("[data-login-email]") as HTMLInputElement;
  const password = form.querySelector(
    "[data-login-password]",
  ) as HTMLInputElement;
  email.value = "a@b.com";
  password.value = "x";

  fetchImpl = async () => jsonResponse(429, {});
  assert.doesNotThrow(() => mountLoginForm(form, { onSuccess: () => {} }));
  submitForm(form);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
});

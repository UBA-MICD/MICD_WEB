/**
 * Tests for upload.ts's XHR-driven upload flow. Every request goes through a
 * FakeXHR (Node has no native XMLHttpRequest) that the test drives manually
 * via progress()/respond()/fail()/abort(). Auth state is the real auth.ts,
 * driven through its exported adoptSession()/logout() rather than mocked, so
 * ensureAuthenticated()/refreshAccessToken() behave exactly as in production.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { adoptSession, logout, type AuthUser } from "../auth/auth.ts";
import { t } from "../i18n/i18n.ts";
import {
  estimateRemaining,
  formatBytes,
  getLastUploadedStudyId,
  onUploadComplete,
  cancelUpload,
  isUploading,
  startExplorerUpload,
  initUploadPanel,
} from "./upload.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

// ── FakeXHR ──────────────────────────────────────────────────────────────────

class FakeXHR extends EventTarget {
  static instances: FakeXHR[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  sentBody: FormData | null = null;
  aborted = false;
  upload = new EventTarget();

  constructor() {
    super();
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: FormData): void {
    this.sentBody = body;
  }
  abort(): void {
    this.aborted = true;
    this.dispatchEvent(new Event("abort"));
  }
  progress(loaded: number, total: number): void {
    this.upload.dispatchEvent(
      new ProgressEvent("progress", { lengthComputable: true, loaded, total }),
    );
  }
  respond(status: number, responseText = ""): void {
    this.status = status;
    this.responseText = responseText;
    this.dispatchEvent(new Event("load"));
  }
  fail(): void {
    this.dispatchEvent(new Event("error"));
  }
  static latest(): FakeXHR {
    const xhr = FakeXHR.instances[FakeXHR.instances.length - 1];
    if (!xhr) throw new Error("no FakeXHR created yet");
    return xhr;
  }
}

/** Lets the async anonymize → upload chain run; fails loudly if it never settles. */
async function waitUntil(cond: () => boolean, maxTicks = 100): Promise<void> {
  for (let i = 0; i < maxTicks && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function installFakeXhr(): void {
  FakeXHR.instances = [];
  (globalThis as any).XMLHttpRequest = FakeXHR;
}

// A minimal fetch stub so auth.ts's real logout()/refreshAccessToken() never
// hit the network. Individual tests overwrite this when they need /auth/refresh
// to behave a specific way.
// Stand-in for the local anonymization service (upload/local-anonymizer.ts)
// on 127.0.0.1:8000: healthy, and /anonymize/ answers with `anonymizerReply`
// (default: the received bytes, unchanged). Every other URL gets an empty 200.
// Each file it receives is recorded in `anonymizerCalls`.
const ANONYMIZER = "http://127.0.0.1:8000";
let anonymizerCalls: File[] = [];
let anonymizerReply: (file: File) => Promise<Response> = async (file) =>
  new Response(await file.arrayBuffer(), { status: 200 });

function stubFetchOk(): void {
  (globalThis as any).fetch = async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ANONYMIZER}/anonymize/`) {
      const file = (init?.body as FormData).get("file") as File;
      anonymizerCalls.push(file);
      return anonymizerReply(file);
    }
    return new Response(null, { status: 200 });
  };
}

const testUser: AuthUser = {
  id: 1,
  email: "radiologist@example.com",
  role: "medico",
};

beforeEach(async () => {
  installFakeXhr();
  anonymizerCalls = [];
  anonymizerReply = async (file) =>
    new Response(await file.arrayBuffer(), { status: 200 });
  stubFetchOk();
  await logout(); // reset auth.ts's module-level session between tests
});

async function signIn(): Promise<void> {
  await adoptSession("fake-access-token", "fake-refresh-token", testUser);
}

function dcmFile(name = "a.dcm", content = "dicom bytes"): File {
  return new File([content], name, { type: "application/octet-stream" });
}

// ── startExplorerUpload ──────────────────────────────────────────────────────

test("startExplorerUpload warns and does nothing when not authenticated", async () => {
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);
  setBody(`<div id="toast-container"></div>`);
  document.body.appendChild(statusEl);

  await startExplorerUpload([dcmFile()], statusEl);

  assert.equal(FakeXHR.instances.length, 0);
  assert.equal(isUploading(), false);
  const toast = document.querySelector(".toast--warning");
  assert.ok(toast, "expected a warning toast for needing login");
});

test("startExplorerUpload rejects a concurrent call while one is in flight", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const p1 = startExplorerUpload([dcmFile()], statusEl);
  assert.equal(isUploading(), true);
  const p2 = startExplorerUpload([dcmFile("b.dcm")], statusEl);

  const toast = document.querySelector(".toast--warning");
  assert.ok(toast, "expected an 'in progress' warning toast");

  // ensureAuthenticated() resolves via a microtask hop before uploadOneExplorer
  // creates the XHR, since it's already-authenticated but still an async fn.
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(
    201,
    JSON.stringify({ study: { orthanc_study_id: "study-1" } }),
  );
  await p1;
  await p2;
});

test("startExplorerUpload succeeds, remembers the study id, and refreshes the explorer", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  const xhr = FakeXHR.latest();
  assert.equal(xhr.method, "POST");
  assert.match(xhr.url, /\/v1\/studies\/upload$/);
  assert.equal(xhr.headers.Authorization, "Bearer fake-access-token");

  xhr.respond(201, JSON.stringify({ study: { orthanc_study_id: "study-42" } }));
  await done;

  assert.equal(getLastUploadedStudyId(), "study-42");
  assert.equal(isUploading(), false);
  const successToast = document.querySelector(".toast--success");
  assert.ok(successToast);
});

test("startExplorerUpload treats a 201 with an unparseable body as a success with no study id", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(201, "not json");
  await done;

  const successToast = document.querySelector(".toast--success");
  assert.ok(successToast);
});

test("startExplorerUpload surfaces a network error", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().fail();
  await done;

  assert.ok(document.querySelector(".toast--error"));
});

test("startExplorerUpload reports a 409 as a duplicate and a 413 as too large", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done1 = startExplorerUpload([dcmFile("dup.dcm")], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(409, JSON.stringify({ message: "already exists" }));
  await done1;
  assert.ok(document.querySelector(".toast--warning"));

  document.querySelectorAll(".toast").forEach((n) => n.remove());

  const done2 = startExplorerUpload([dcmFile("huge.dcm")], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(413, "");
  await done2;
  assert.ok(document.querySelector(".toast--error"));
});

test("startExplorerUpload reports a generic 500 with the server's message when present", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(500, JSON.stringify({ error: "disk full" }));
  await done;

  const toast = document.querySelector(".toast--error .toast__msg");
  assert.equal(toast?.textContent, "disk full");
});

test("startExplorerUpload retries once on 401 after a successful silent refresh", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  const first = FakeXHR.latest();

  (globalThis as any).fetch = async (input: string) => {
    if (String(input).includes("/auth/refresh")) {
      return new Response(
        JSON.stringify({
          accessToken: "new-token",
          refreshToken: "new-refresh",
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 200 });
  };

  first.respond(401, "");
  // refreshAccessToken() -> fetch -> retry uploadOneExplorer creates a 2nd xhr
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(FakeXHR.instances.length, 2);
  FakeXHR.instances[1]!.respond(
    201,
    JSON.stringify({ study: { orthanc_study_id: "s2" } }),
  );

  await done;
  assert.ok(document.querySelector(".toast--success"));
});

test("startExplorerUpload gives up on 401 when the refresh and the login prompt both fail", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  const xhr = FakeXHR.latest();

  (globalThis as any).fetch = async () => new Response(null, { status: 401 });
  xhr.respond(401, "");

  await done;
  assert.equal(FakeXHR.instances.length, 1);
  assert.ok(document.querySelector(".toast--error"));
});

test("cancelUpload aborts the in-flight explorer upload", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const done = startExplorerUpload([dcmFile(), dcmFile("b.dcm")], statusEl);
  assert.equal(isUploading(), true);
  await new Promise((r) => setTimeout(r, 0));
  cancelUpload();
  assert.equal(FakeXHR.latest().aborted, true);

  await done;
  assert.equal(isUploading(), false);
  // only the aborted file's xhr should have been created — the loop stops
  assert.equal(FakeXHR.instances.length, 1);
});

test("cancelUpload is a no-op when nothing is uploading", () => {
  assert.doesNotThrow(() => cancelUpload());
});

test("startExplorerUpload sends the raw file only to the local anonymizer, and uploads its output", async () => {
  anonymizerReply = async () =>
    new Response(new Uint8Array([0x20, 0x20, 0x42]), { status: 200 });

  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const file = new File([new Uint8Array([0xff, 0xff, 0x42])], "phi.dcm");
  const done = startExplorerUpload([file], statusEl);
  await waitUntil(() => FakeXHR.instances.length > 0);

  assert.equal(anonymizerCalls.length, 1);
  assert.deepEqual(
    Array.from(new Uint8Array(await anonymizerCalls[0]!.arrayBuffer())),
    [0xff, 0xff, 0x42],
    "the anonymizer gets the original file",
  );
  const sentFile = FakeXHR.latest().sentBody?.get("file") as File;
  const sentBytes = new Uint8Array(await sentFile.arrayBuffer());
  assert.deepEqual(
    Array.from(sentBytes),
    [0x20, 0x20, 0x42],
    "the backend gets the anonymizer's output",
  );
  assert.equal(sentFile.name, "phi.dcm");

  FakeXHR.latest().respond(201, "{}");
  await done;
});

test("startExplorerUpload uses window.api.anonymizeDicom (desktop) when present", async () => {
  // Desktop seam: stubbed to return sentinel bytes; assert THOSE are what gets
  // sent and the local service was bypassed.
  (window as any).api = {
    anonymizeDicom: async () => new Uint8Array([0xde, 0xad]).buffer,
  };

  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  const file = new File([new Uint8Array([0x11, 0x22, 0x33])], "phi.dcm");
  const done = startExplorerUpload([file], statusEl);
  await waitUntil(() => FakeXHR.instances.length > 0);

  const sentFile = FakeXHR.latest().sentBody?.get("file") as File;
  const sentBytes = new Uint8Array(await sentFile.arrayBuffer());
  assert.deepEqual(Array.from(sentBytes), [0xde, 0xad], "desktop seam output");
  assert.equal(anonymizerCalls.length, 0);

  delete (window as any).api;
  FakeXHR.latest().respond(201, "{}");
  await done;
});

test("startExplorerUpload fails closed: a file the anonymizer rejects is never sent", async () => {
  anonymizerReply = async () =>
    new Response(
      JSON.stringify({ detail: "El archivo no es un DICOM válido." }),
      {
        status: 400,
      },
    );
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  await startExplorerUpload([dcmFile("raw.dcm")], statusEl);

  assert.equal(
    FakeXHR.instances.length,
    0,
    "no request may carry the raw file",
  );
  const toasts = document.getElementById("toast-container")!.textContent ?? "";
  assert.match(toasts, /raw\.dcm/);
});

test("startExplorerUpload refuses the whole batch when the local anonymizer is down", async () => {
  (globalThis as any).fetch = async (input: string) => {
    if (String(input).startsWith(ANONYMIZER))
      throw new TypeError("Failed to fetch");
    return new Response(null, { status: 200 });
  };
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  await startExplorerUpload([dcmFile("a.dcm"), dcmFile("b.dcm")], statusEl);

  assert.equal(FakeXHR.instances.length, 0, "nothing may be sent");
  const toasts = document.getElementById("toast-container")!.textContent ?? "";
  assert.ok(toasts.includes(t("upload.anonymizerUnavailable")));
  assert.equal(isUploading(), false);
});

test("startExplorerUpload fails closed when the anonymizer goes away mid-batch", async () => {
  anonymizerReply = async () => {
    throw new TypeError("Failed to fetch");
  };
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  await startExplorerUpload([dcmFile("raw.dcm")], statusEl);

  assert.equal(FakeXHR.instances.length, 0);
  const toasts = document.getElementById("toast-container")!.textContent ?? "";
  assert.ok(toasts.includes(t("upload.anonymizerUnavailable")));
});

test("startExplorerUpload fails closed when the desktop anonymizer rejects", async () => {
  (window as any).api = {
    anonymizeDicom: async () => {
      throw new Error("python crashed");
    },
  };
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);

  try {
    await startExplorerUpload([dcmFile("raw.dcm")], statusEl);
    assert.equal(FakeXHR.instances.length, 0);
  } finally {
    delete (window as any).api;
  }
});

test("onUploadComplete is not fired by startExplorerUpload (row-based summaries only)", async () => {
  setBody(`<div id="toast-container"></div>`);
  await signIn();
  let fired = false;
  onUploadComplete(() => {
    fired = true;
  });
  const statusEl = document.createElement("div");
  document.body.appendChild(statusEl);
  const done = startExplorerUpload([dcmFile()], statusEl);
  await new Promise((r) => setTimeout(r, 0));
  FakeXHR.latest().respond(201, "{}");
  await done;
  assert.equal(fired, false);
});

// ── initUploadPanel (row-based flow) ─────────────────────────────────────────

function uploadPanelFixture(): void {
  setBody(`
    <button id="btn-upload-server">Subir</button>
    <input type="file" id="upload-input" />
    <button id="btn-upload-folder">Subir carpeta</button>
    <input type="file" id="upload-folder-input" />
    <div id="upload-drop"></div>
    <button id="btn-refresh-studies">Actualizar</button>
    <p id="upload-note"></p>
    <section id="upload-progress" class="hidden">
      <h3 id="upload-progress-title"></h3>
      <span id="upload-percent"></span>
      <div id="upload-track" role="progressbar" aria-valuenow="0">
        <span id="upload-bar"></span>
      </div>
      <span id="upload-phase"></span>
      <span id="upload-bytes"></span>
      <details id="upload-errors" class="hidden">
        <summary id="upload-errors-summary"></summary>
        <ul id="upload-error-list"></ul>
      </details>
    </section>
    <div id="upload-status"></div>
    <button id="btn-upload-finish">Finalizar</button>
    <div id="duplicate-dialog" class="hidden">
      <div class="dialog" role="dialog" aria-modal="true">
        <p id="duplicate-msg"></p>
        <button id="duplicate-yes">Reemplazar</button>
        <button id="duplicate-no">Cancelar</button>
      </div>
    </div>
    <div id="toast-container"></div>
    <div id="app-banner" class="hidden"></div>
  `);
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

test("initUploadPanel: btn-upload-server gates the file picker on auth", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  let clicked = false;
  input.addEventListener("click", () => {
    clicked = true;
  });
  document
    .getElementById("btn-upload-server")!
    .dispatchEvent(new MouseEvent("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(clicked, true);
});

test("initUploadPanel: one progress panel tracks the upload and reaches 100%", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));

  // expandFiles/collectDicomFiles are real async work before startUpload runs.
  await waitUntil(() => FakeXHR.instances.length > 0);
  const xhr = FakeXHR.latest();
  const panel = document.getElementById("upload-progress")!;
  assert.equal(panel.classList.contains("hidden"), false);
  assert.match(
    document.getElementById("upload-phase")!.textContent!,
    /Subiendo archivo 1 de 1/,
  );

  xhr.progress(50, 100);
  assert.equal(document.getElementById("upload-percent")!.textContent, "50%");
  assert.equal(
    document.getElementById("upload-track")!.getAttribute("aria-valuenow"),
    "50",
  );

  xhr.respond(
    201,
    JSON.stringify({ study: { orthanc_study_id: "row-study" } }),
  );
  await waitUntil(() => panel.classList.contains("upload-progress--done"));

  assert.equal(panel.classList.contains("upload-progress--done"), true);
  assert.equal(document.getElementById("upload-percent")!.textContent, "100%");
  assert.equal(document.querySelectorAll(".upload-row").length, 0);
  assert.equal(
    (document.getElementById("btn-upload-finish") as HTMLButtonElement)
      .disabled,
    false,
  );
});

test("initUploadPanel: file input change is blocked when the anonymizer is unavailable", async () => {
  // The Cargar-tab pre-flight: a down anonymizer must stop the whole batch and
  // surface the message in the status line, with nothing uploaded.
  (globalThis as any).fetch = async (input: string) => {
    if (String(input).startsWith(ANONYMIZER))
      throw new TypeError("Failed to fetch");
    return new Response(null, { status: 200 });
  };
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));

  const status = document.getElementById("upload-status")!;
  await waitUntil(() => status.textContent === t("upload.anonymizerUnavailable"));

  assert.equal(FakeXHR.instances.length, 0, "nothing may be uploaded");
  assert.equal(
    document.getElementById("upload-status")!.textContent,
    t("upload.anonymizerUnavailable"),
  );
});

test("initUploadPanel: a file that can't be anonymized is listed as failed and never sent", async () => {
  anonymizerReply = async () => new Response("bad", { status: 400 });
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile("raw.dcm")]);
  input.dispatchEvent(new Event("change"));

  const errors = document.getElementById("upload-errors")!;
  await waitUntil(() => !errors.classList.contains("hidden"));

  assert.equal(FakeXHR.instances.length, 0, "no request may carry the raw file");
  assert.match(
    document.getElementById("upload-errors-summary")!.textContent!,
    /\(1\)/,
  );
  const item = document.querySelector("#upload-error-list li")!.textContent!;
  assert.match(item, /raw\.dcm/);
  assert.match(item, /No anonimizado: no enviado/);
});

test("initUploadPanel: folder input change collects and uploads files", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById(
    "upload-folder-input",
  ) as HTMLInputElement;
  setInputFiles(input, [dcmFile("folder-a.dcm")]);
  input.dispatchEvent(new Event("change"));

  await waitUntil(() => FakeXHR.instances.length > 0);
  assert.equal(FakeXHR.instances.length, 1);
  FakeXHR.latest().respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

function addClassifyDialog(): void {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="classify-dialog" class="hidden">
      <div class="dialog" role="dialog" aria-modal="true">
        <p id="classify-msg"></p>
        <select id="upload-classification">
          <option value="">Sin clasificar</option>
          <option value="3">Tumor</option>
        </select>
        <button id="classify-confirm">Subir</button>
        <button id="classify-cancel">Cancelar</button>
      </div>
    </div>`,
  );
}

async function waitForDialog(): Promise<HTMLElement> {
  const dialog = document.getElementById("classify-dialog")!;
  for (let i = 0; i < 10 && dialog.classList.contains("hidden"); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  return dialog;
}

test("initUploadPanel: classify dialog holds the upload until confirmed", async () => {
  uploadPanelFixture();
  addClassifyDialog();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));

  const dialog = await waitForDialog();
  assert.equal(dialog.classList.contains("hidden"), false);
  assert.equal(FakeXHR.instances.length, 0);

  (
    document.getElementById("upload-classification") as HTMLSelectElement
  ).value = "3";
  document.getElementById("classify-confirm")!.click();
  await waitUntil(() => FakeXHR.instances.length > 0);
  assert.equal(dialog.classList.contains("hidden"), true);
  assert.equal(FakeXHR.latest().sentBody!.get("classification_id"), "3");
  FakeXHR.latest().respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

test("initUploadPanel: cancelling the classify dialog uploads nothing", async () => {
  uploadPanelFixture();
  addClassifyDialog();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));

  const dialog = await waitForDialog();
  document.getElementById("classify-cancel")!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dialog.classList.contains("hidden"), true);
  assert.equal(FakeXHR.instances.length, 0);
});

test("initUploadPanel: shows an error status when uploading twice concurrently", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);

  setInputFiles(input, [dcmFile("second.dcm")]);
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));

  const status = document.getElementById("upload-status")!;
  assert.equal(status.classList.contains("upload-status--error"), true);

  FakeXHR.latest().respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

test("initUploadPanel: duplicate dialog 'replace' re-uploads with force=true", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile("dup.dcm")]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);

  FakeXHR.latest().respond(409, JSON.stringify({ message: "ya existe" }));
  await new Promise((r) => setTimeout(r, 0));

  const dialog = document.getElementById("duplicate-dialog")!;
  assert.equal(dialog.classList.contains("hidden"), false);
  assert.equal(
    document.getElementById("duplicate-msg")!.textContent,
    "ya existe",
  );

  (document.getElementById("duplicate-yes") as HTMLButtonElement).click();
  await waitUntil(() => FakeXHR.instances.length === 2);

  assert.equal(dialog.classList.contains("hidden"), true);
  assert.equal(FakeXHR.instances.length, 2);
  assert.match(FakeXHR.instances[1]!.url, /force=true/);

  FakeXHR.instances[1]!.respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

test("initUploadPanel: duplicate dialog 'no' keeps the outcome as duplicate", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile("dup2.dcm")]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);

  FakeXHR.latest().respond(409, "");
  await new Promise((r) => setTimeout(r, 0));

  (document.getElementById("duplicate-no") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));

  await waitUntil(() =>
    /ya existían/.test(document.getElementById("upload-status")!.textContent!),
  );
  assert.match(
    document.getElementById("upload-status")!.textContent!,
    /1 ya existían/,
  );
  assert.equal(FakeXHR.instances.length, 1);
});

test("initUploadPanel: the duplicate answer is asked once and reused for the batch", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile("s1.dcm"), dcmFile("s2.dcm")]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);

  const dialog = document.getElementById("duplicate-dialog")!;
  FakeXHR.instances[0]!.respond(409, "");
  await waitUntil(() => !dialog.classList.contains("hidden"));
  assert.match(
    document.getElementById("duplicate-msg")!.textContent!,
    /todos los archivos repetidos/,
  );
  (document.getElementById("duplicate-no") as HTMLButtonElement).click();

  await waitUntil(() => FakeXHR.instances.length === 2);
  FakeXHR.instances[1]!.respond(409, "");
  await waitUntil(() =>
    /ya existían/.test(document.getElementById("upload-status")!.textContent!),
  );

  assert.equal(dialog.classList.contains("hidden"), true, "asked only once");
  assert.equal(FakeXHR.instances.length, 2, "skipped, never forced");
  assert.match(
    document.getElementById("upload-status")!.textContent!,
    /2 ya existían/,
  );
});

test("initUploadPanel: cancelling mid-upload marks the summary cancelled", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  let summary: any = null;
  onUploadComplete((s) => {
    summary = s;
  });

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile("a.dcm"), dcmFile("b.dcm")]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);

  cancelUpload();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const status = document.getElementById("upload-status")!;
  assert.equal(status.classList.contains("upload-status--error"), true);
  assert.equal(summary?.cancelled, true);
});

test("initUploadPanel: dropping a folder uploads the files inside it", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const fileEntry = (name: string, path: string) => ({
    isFile: true,
    fullPath: path,
    file: (ok: (f: File) => void) => ok(dcmFile(name)),
  });
  // readEntries returns children once, then an empty batch (end of folder).
  const dirEntry = (children: unknown[]) => ({
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let batches = [children, []];
      return {
        readEntries: (ok: (b: unknown[]) => void) => ok(batches.shift() ?? []),
      };
    },
  });
  const folder = dirEntry([
    fileEntry("a.dcm", "/study/a.dcm"),
    dirEntry([fileEntry("b.dcm", "/study/series/b.dcm")]),
  ]);

  const dropEvt = new Event("drop", { cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: {
      files: [],
      items: [
        { kind: "file", webkitGetAsEntry: () => folder },
        // A loose file beside the folder: read via getAsFile, not its entry.
        {
          kind: "file",
          webkitGetAsEntry: () => ({ isDirectory: false }),
          getAsFile: () => dcmFile("loose.dcm"),
        },
      ],
    },
  });
  document.getElementById("upload-drop")!.dispatchEvent(dropEvt);

  await waitUntil(() => FakeXHR.instances.length > 0);
  assert.equal(
    document.getElementById("upload-progress-title")!.textContent,
    "Subiendo estudio · 3 archivos",
  );
  for (let n = 1; n <= 3; n++) {
    await waitUntil(() => FakeXHR.instances.length === n);
    FakeXHR.latest().respond(201, "{}");
  }
});

test("initUploadPanel: drop zone toggles drag-over and uploads dropped files", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const zone = document.getElementById("upload-drop")!;
  const dragOver = new Event("dragover", { cancelable: true }) as DragEvent;
  zone.dispatchEvent(dragOver);
  assert.equal(zone.classList.contains("drag-over"), true);

  const dragLeave = new Event("dragleave") as DragEvent;
  Object.defineProperty(dragLeave, "relatedTarget", { value: null });
  zone.dispatchEvent(dragLeave);
  assert.equal(zone.classList.contains("drag-over"), false);

  const dropEvt = new Event("drop", { cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: { files: [dcmFile("dropped.dcm")] },
  });
  zone.dispatchEvent(dropEvt);

  await waitUntil(() => FakeXHR.instances.length > 0);
  assert.equal(zone.classList.contains("drag-over"), false);
  assert.equal(FakeXHR.instances.length, 1);
  FakeXHR.latest().respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

test("initUploadPanel: dropping only non-DICOM files shows 'no dicom found'", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const zone = document.getElementById("upload-drop")!;
  const dropEvt = new Event("drop", { cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: { files: [new File(["x"], "notes.txt")] },
  });
  zone.dispatchEvent(dropEvt);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const status = document.getElementById("upload-status")!;
  assert.equal(status.classList.contains("upload-status--error"), true);
  assert.equal(FakeXHR.instances.length, 0);
});

test("initUploadPanel: dropping a corrupt zip reports the error via toast", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const zone = document.getElementById("upload-drop")!;
  const dropEvt = new Event("drop", { cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: { files: [new File(["not actually a zip"], "bad.zip")] },
  });
  zone.dispatchEvent(dropEvt);

  for (let i = 0; i < 30 && !document.querySelector(".toast--error"); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(document.querySelector(".toast--error"));
  assert.equal(FakeXHR.instances.length, 0);
});

test("initUploadPanel: btn-refresh-studies triggers loadStudyExplorer without throwing", () => {
  uploadPanelFixture();
  initUploadPanel();
  assert.doesNotThrow(() =>
    document
      .getElementById("btn-refresh-studies")!
      .dispatchEvent(new MouseEvent("click")),
  );
});

test("initUploadPanel: renders the unencrypted-transport note over http", () => {
  uploadPanelFixture();
  initUploadPanel();
  const note = document.getElementById("upload-note")!.textContent ?? "";
  assert.notEqual(note, "");
});

test("formatBytes picks KB, MB or GB", () => {
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
});

test("estimateRemaining stays quiet early on, then projects from the average rate", () => {
  assert.equal(estimateRemaining(0.5, 1000), "", "too early");
  assert.equal(estimateRemaining(0.01, 60000), "", "too little progress");
  assert.equal(estimateRemaining(1, 60000), "", "done");
  assert.equal(estimateRemaining(0.5, 10000), "menos de 1 min restante");
  assert.equal(estimateRemaining(0.25, 120000), "≈ 6 min restantes");
});

// ── Progress panel: every failure lands in the collapsed list ───────────────

/** Starts a one-file Cargar-tab upload and returns its first XHR. */
async function startPanelUpload(name = "slice.dcm"): Promise<FakeXHR> {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();
  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile(name)]);
  input.dispatchEvent(new Event("change"));
  await waitUntil(() => FakeXHR.instances.length > 0);
  return FakeXHR.latest();
}

async function panelFinished(): Promise<HTMLElement> {
  const panel = document.getElementById("upload-progress")!;
  await waitUntil(
    () =>
      panel.classList.contains("upload-progress--done") ||
      panel.classList.contains("upload-progress--error"),
  );
  return panel;
}

const failureText = (): string =>
  document.querySelector("#upload-error-list li")?.textContent ?? "";

for (const [label, drive, reason] of [
  ["a network error", (x: FakeXHR) => x.fail(), t("upload.networkError")],
  ["a 413", (x: FakeXHR) => x.respond(413, ""), t("upload.fileTooLarge")],
  [
    "a 422 PHI rejection",
    (x: FakeXHR) =>
      x.respond(
        422,
        JSON.stringify({
          error: "not_anonymized",
          tags: [{ name: "PatientName" }],
        }),
      ),
    t("upload.stateNotAnonymized"),
  ],
  [
    "a 500 with a server message",
    (x: FakeXHR) => x.respond(500, JSON.stringify({ message: "disco lleno" })),
    "disco lleno",
  ],
] as const) {
  test(`progress panel: ${label} is listed as a failed file`, async () => {
    const xhr = await startPanelUpload("bad.dcm");
    drive(xhr);
    const panel = await panelFinished();

    assert.equal(panel.classList.contains("upload-progress--error"), true);
    assert.equal(
      document.getElementById("upload-progress-title")!.textContent,
      t("upload.progressDoneWithErrors"),
    );
    assert.match(failureText(), /bad\.dcm/);
    assert.ok(failureText().includes(reason), failureText());
  });
}

test("progress panel: a 422 failure keeps the offending tag names after the summary", async () => {
  const xhr = await startPanelUpload();
  xhr.respond(
    422,
    JSON.stringify({ error: "not_anonymized", tags: [{ name: "PatientName" }] }),
  );
  await panelFinished();
  assert.match(failureText(), /PatientName/);
});

/** Keeps the anonymizer stub, and answers /auth/refresh with `refresh`. */
function withRefresh(refresh: () => Response): void {
  const base = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: string, init?: RequestInit) =>
    String(input).includes("/auth/refresh") ? refresh() : base(input, init);
}

test("progress panel: a 401 refreshes the session and retries the file once", async () => {
  const xhr = await startPanelUpload();
  withRefresh(
    () =>
      new Response(
        JSON.stringify({ accessToken: "new-token", refreshToken: "new-refresh" }),
        { status: 200 },
      ),
  );
  xhr.respond(401, "");
  await waitUntil(() => FakeXHR.instances.length === 2);
  FakeXHR.latest().respond(201, "{}");

  const panel = await panelFinished();
  assert.equal(panel.classList.contains("upload-progress--done"), true);
});

test("progress panel: a second 401 after the retry is listed as a failure", async () => {
  const xhr = await startPanelUpload();
  withRefresh(
    () =>
      new Response(
        JSON.stringify({ accessToken: "new-token", refreshToken: "new-refresh" }),
        { status: 200 },
      ),
  );
  xhr.respond(401, "");
  await waitUntil(() => FakeXHR.instances.length === 2);
  FakeXHR.latest().respond(401, "");

  await panelFinished();
  assert.ok(failureText().includes(t("upload.unauthorizedRetry")), failureText());
});

test("progress panel: a 401 whose refresh fails is listed as session expired", async () => {
  const xhr = await startPanelUpload();
  withRefresh(() => new Response(null, { status: 401 }));
  xhr.respond(401, "");

  await panelFinished();
  assert.equal(FakeXHR.instances.length, 1, "no retry without a session");
  assert.ok(
    failureText().includes(t("upload.sessionExpiredRetry")),
    failureText(),
  );
});

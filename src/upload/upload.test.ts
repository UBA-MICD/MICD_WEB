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
import {
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

function installFakeXhr(): void {
  FakeXHR.instances = [];
  (globalThis as any).XMLHttpRequest = FakeXHR;
}

// A minimal fetch stub so auth.ts's real logout()/refreshAccessToken() never
// hit the network. Individual tests overwrite this when they need /auth/refresh
// to behave a specific way.
function stubFetchOk(): void {
  (globalThis as any).fetch = async () => new Response(null, { status: 200 });
}

const testUser: AuthUser = {
  id: 1,
  email: "radiologist@example.com",
  role: "medico",
};

beforeEach(async () => {
  installFakeXhr();
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
    <ul id="upload-rows"></ul>
    <div id="upload-status"></div>
    <span id="upload-percent"></span>
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

test("initUploadPanel: file input change uploads via rows and reaches 100%", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));

  // expandFiles/collectDicomFiles are real async work before startUpload runs.
  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  const xhr = FakeXHR.latest();
  xhr.progress(50, 100);

  const row = document.querySelector(".upload-row") as HTMLElement;
  assert.equal(row.querySelector(".upload-row__pct")!.textContent, "50%");

  xhr.respond(
    201,
    JSON.stringify({ study: { orthanc_study_id: "row-study" } }),
  );
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(row.classList.contains("upload-row--ok"), true);
  assert.equal(
    document.getElementById("upload-percent")!.textContent,
    " · 100%",
  );
  assert.equal(
    (document.getElementById("btn-upload-finish") as HTMLButtonElement)
      .disabled,
    false,
  );
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

  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(FakeXHR.instances.length, 1);
  FakeXHR.latest().respond(201, "{}");
  await new Promise((r) => setTimeout(r, 0));
});

test("initUploadPanel: shows an error status when uploading twice concurrently", async () => {
  uploadPanelFixture();
  await signIn();
  initUploadPanel();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  setInputFiles(input, [dcmFile()]);
  input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }

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
  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }

  FakeXHR.latest().respond(409, JSON.stringify({ message: "ya existe" }));
  await new Promise((r) => setTimeout(r, 0));

  const dialog = document.getElementById("duplicate-dialog")!;
  assert.equal(dialog.classList.contains("hidden"), false);
  assert.equal(
    document.getElementById("duplicate-msg")!.textContent,
    "ya existe",
  );

  (document.getElementById("duplicate-yes") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));

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
  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }

  FakeXHR.latest().respond(409, "");
  await new Promise((r) => setTimeout(r, 0));

  (document.getElementById("duplicate-no") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));

  const row = document.querySelector(".upload-row") as HTMLElement;
  assert.equal(row.classList.contains("upload-row--duplicate"), true);
  assert.equal(FakeXHR.instances.length, 1);
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
  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }

  cancelUpload();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const status = document.getElementById("upload-status")!;
  assert.equal(status.classList.contains("upload-status--error"), true);
  assert.equal(summary?.cancelled, true);
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

  for (let i = 0; i < 5 && FakeXHR.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
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

  for (let i = 0; i < 10 && !document.querySelector(".toast--error"); i++) {
    await new Promise((r) => setTimeout(r, 0));
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

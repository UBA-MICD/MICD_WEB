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
import { hideBanner } from "../shared/banner.ts";
import { initStudyExplorer } from "../explorer/explorer.ts";
import { initUploadPanel } from "../upload/upload.ts";

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

const STUDY = {
  orthanc_study_id: "study-1",
  modality: "CT",
  patient_name: "ANON",
  study_date: "20240101",
  study_description: "Torax",
  num_instances: 1,
};

/** Every URL the app fetched, so tests can assert what an action requested. */
let fetched: string[] = [];

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// Node has no XMLHttpRequest; uploads go through this stand-in. It is a Node
// EventTarget (declared before installDom), so it must dispatch Node's Event.
const NodeEvent = Event;
class FakeXHR extends EventTarget {
  static instances: FakeXHR[] = [];
  upload = new EventTarget();
  status = 0;
  responseText = "";
  constructor() {
    super();
    FakeXHR.instances.push(this);
  }
  open(): void {}
  setRequestHeader(): void {}
  send(): void {}
  abort(): void {}
  respond(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.dispatchEvent(new NodeEvent("load"));
  }
}

test.before(() => {
  installDom();
  (globalThis as any).XMLHttpRequest = FakeXHR;
  (globalThis as any).fetch = async (input: string, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/anonymize/")) {
      const file = (init?.body as FormData).get("file") as File;
      return new Response(await file.arrayBuffer(), { status: 200 });
    }
    if (url.includes("/instances")) return json({ instances: [] });
    if (url.includes("/v1/pathologies")) return json([]);
    if (url.includes("/v1/studies")) {
      return json({ studies: [STUDY], total: 1, page: 1, totalPages: 1 });
    }
    return json({});
  };
  document.body.innerHTML = pageBody();
  initStudyExplorer();
  initUploadPanel();
  initServerScreen();
});
test.after(() => {
  hideBanner(); // clears its auto-dismiss timer before the DOM goes away
  uninstallDom();
});

beforeEach(async () => {
  await logout();
  closeServerScreen();
  fetched = [];
  FakeXHR.instances = [];
  hideBanner();
});

async function waitUntil(cond: () => boolean, maxTicks = 200): Promise<void> {
  for (let i = 0; i < maxTicks && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

const requestedInstances = (): boolean =>
  fetched.some((u) => u.includes(`/v1/studies/${STUDY.orthanc_study_id}/instances`));

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

test("informatico: Descargar in Buscar downloads the selected study and stays put", async () => {
  await signInAs("informatico");
  openServerScreen("buscar");

  const item = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      `[data-explorer-view="server"] [data-id="${STUDY.orthanc_study_id}"]`,
    );
  await waitUntil(() => item() !== null);
  item()!.click();

  const button = document.getElementById("btn-open-selected") as HTMLButtonElement;
  assert.equal(button.disabled, false);
  button.click();
  await waitUntil(requestedInstances);

  assert.equal(requestedInstances(), true);
  assert.equal(currentScreen(), "server");
  await waitUntil(() => !button.disabled);
  assert.equal(button.disabled, false, "re-enabled after the download");
});

test("informatico: clicking a study in the sidebar list downloads it", async () => {
  await signInAs("informatico");
  openServerScreen("buscar");

  const item = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      `[data-explorer-view]:not([data-explorer-view="server"]) [data-id="${STUDY.orthanc_study_id}"]`,
    );
  await waitUntil(() => item() !== null);
  item()!.click();
  await waitUntil(requestedInstances);

  assert.equal(requestedInstances(), true);
  assert.equal(currentScreen(), "server");
});

test("informatico: a clean upload ends with a banner and stays on Cargar", async () => {
  await signInAs("informatico");
  openServerScreen("cargar");

  const input = document.getElementById("upload-input") as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["dicom"], "a.dcm")],
    configurable: true,
  });
  input.dispatchEvent(new Event("change"));

  const dialog = document.getElementById("classify-dialog")!;
  await waitUntil(() => !dialog.classList.contains("hidden"));
  document.getElementById("classify-confirm")!.click();

  await waitUntil(() => FakeXHR.instances.length > 0);
  FakeXHR.instances[0]!.respond(
    201,
    JSON.stringify({ study: { orthanc_study_id: "new-study" } }),
  );

  const banner = document.getElementById("app-banner")!;
  await waitUntil(() => banner.textContent !== "");
  assert.equal(banner.textContent, "1 archivo(s) subido(s) correctamente");
  assert.equal(currentScreen(), "server");
});

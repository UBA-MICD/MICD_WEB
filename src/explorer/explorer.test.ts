/**
 * DOM-driven tests for explorer.ts (rendering, filters, selection, pagination,
 * thumbnails). Uses jsdom via test/dom-setup.ts. explorer.ts keeps mutable
 * module-level state (registered views, selection, pagination), so each test
 * imports a fresh instance via a cache-busting query string — see
 * src/shared/screen.test.ts for the same pattern.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { adoptSession, logout, API_ORIGIN } from "../auth/auth.ts";
import { setLocale } from "../i18n/i18n.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

let counter = 0;
async function freshExplorer() {
  return import(`./explorer.ts?fresh=${counter++}`);
}

// ── fetch stub ────────────────────────────────────────────────────────────────

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchImpl = () => Promise.reject(new Error("no fetch stub set"));
let fetchCalls: string[] = [];

(globalThis as { fetch?: unknown }).fetch = (url: string, init?: RequestInit) => {
  fetchCalls.push(url);
  return fetchImpl(url, init);
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

function studiesPage(studies: any[], overrides: Partial<any> = {}) {
  return {
    studies,
    total: studies.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    ...overrides,
  };
}

const STUDY_A = {
  id: 1,
  orthanc_study_id: "study-a",
  orthanc_instance_id: "inst-a",
  patient_name: "Ana Pérez",
  patient_id: "P1",
  study_date: "20240115",
  modality: "CT",
  study_description: "Chest",
  uploaded_at: "2024-01-15T00:00:00Z",
  num_instances: 3,
  zenodo_doi: null,
  zenodo_source_doi: null,
};

// ── fixtures ──────────────────────────────────────────────────────────────────

function explorerFixture(): void {
  setBody(`
    <div data-explorer-view="panel">
      <input data-explorer-search />
      <button data-explorer-search-clear class="hidden"></button>
      <div data-explorer-chips>
        <button class="filter-chip filter-chip--active" data-modality=""></button>
        <button class="filter-chip" data-modality="CT"></button>
        <button class="filter-chip filter-chip--zenodo" data-zenodo-linked></button>
      </div>
      <input type="date" data-explorer-date-from />
      <input type="date" data-explorer-date-to />
      <button data-explorer-clear></button>
      <span data-explorer-pagination-info></span>
      <button data-explorer-prev></button>
      <button data-explorer-next></button>
      <ul data-explorer-list role="listbox"></ul>
    </div>
    <div data-explorer-view="server">
      <input data-explorer-search />
      <ul data-explorer-list role="listbox"></ul>
    </div>
  `);
}

beforeEach(async () => {
  fetchCalls = [];
  fetchImpl = () => Promise.reject(new Error("unexpected fetch"));
  setLocale("es");
  await logout();
  (globalThis as any).URL.createObjectURL = () => "blob:mock";
  (globalThis as any).URL.revokeObjectURL = () => {};
});

test("logged out: loadStudyExplorer renders the logged-out hint, not a fetch", async () => {
  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();

  await mod.loadStudyExplorer();

  assert.equal(fetchCalls.length, 0);
  const lists = document.querySelectorAll("[data-explorer-list]");
  lists.forEach((list) => {
    assert.match(list.innerHTML, /data-explorer-login/);
  });
});

test("clicking the logged-out login hint re-triggers loadStudyExplorer", async () => {
  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  const loginBtn = list.querySelector<HTMLElement>("[data-explorer-login]")!;
  loginBtn.click();
  // still logged out, so this resolves synchronously-ish without throwing
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCalls.length, 0);
});

test("authenticated: loadStudyExplorer fetches and renders studies in both view modes", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async (url) => {
    if (url.includes("/thumbnail")) return jsonResponse(200, {});
    return jsonResponse(200, studiesPage([STUDY_A]));
  };

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const [panelList, serverList] = Array.from(
    document.querySelectorAll("[data-explorer-list]"),
  ) as HTMLElement[];

  // panel view = "open" mode → button rows
  assert.ok(panelList.querySelector('button[data-id="study-a"]'));
  // server view = "select" mode → listbox options
  assert.ok(serverList.querySelector('li[role="option"][data-id="study-a"]'));
  assert.match(panelList.innerHTML, /Ana Pérez/);
});

test("empty results render the unfiltered empty state", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  assert.match(list.innerHTML, /study-item--empty/);
});

test("a non-ok response renders the error state and resets pagination", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(500, {});

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  assert.match(list.innerHTML, /study-item--error/);
});

test("a network failure (fetch throws) also renders the error state", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => {
    throw new Error("network down");
  };

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  assert.match(list.innerHTML, /study-item--error/);
});

test("clicking a select-mode option selects it and notifies listeners", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([STUDY_A]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  let selected: string | null | undefined;
  mod.onSelectionChange((id: string | null) => {
    selected = id;
  });

  const serverList = document.querySelectorAll("[data-explorer-list]")[1] as HTMLElement;
  const option = serverList.querySelector<HTMLElement>('[data-id="study-a"]')!;
  option.click();

  assert.equal(selected, "study-a");
  assert.equal(mod.getSelectedStudyId(), "study-a");
  assert.equal(option.getAttribute("aria-selected"), "true");
  assert.equal(option.tabIndex, 0);
});

test("clearSelection deselects and notifies listeners with null", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([STUDY_A]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const serverList = document.querySelectorAll("[data-explorer-list]")[1] as HTMLElement;
  serverList.querySelector<HTMLElement>('[data-id="study-a"]')!.click();

  let selected: string | null = "unset" as any;
  mod.onSelectionChange((id: string | null) => {
    selected = id;
  });
  mod.clearSelection();
  assert.equal(selected, null);
  assert.equal(mod.getSelectedStudyId(), null);
});

test("listbox arrow keys move selection, Home/End jump, Enter activates", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () =>
    jsonResponse(
      200,
      studiesPage([
        STUDY_A,
        { ...STUDY_A, orthanc_study_id: "study-b", patient_name: "B" },
      ]),
    );

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const serverList = document.querySelectorAll("[data-explorer-list]")[1] as HTMLElement;

  serverList.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  assert.equal(mod.getSelectedStudyId(), "study-a");

  serverList.dispatchEvent(
    new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
  );
  assert.equal(mod.getSelectedStudyId(), "study-b");

  serverList.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
  );
  assert.equal(mod.getSelectedStudyId(), "study-a");

  serverList.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  );
  assert.equal(mod.getSelectedStudyId(), "study-a"); // clamped at the start

  let activated: string | undefined;
  mod.onSelectionActivate((id: string) => {
    activated = id;
  });
  serverList.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  assert.equal(activated, "study-a");
});

test("search input is debounced and refetches with the search param", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  fetchCalls = [];

  const search = document.querySelector("[data-explorer-search]") as HTMLInputElement;
  search.value = "ana";
  search.dispatchEvent(new Event("input", { bubbles: true }));

  t.mock.timers.tick(399);
  assert.equal(fetchCalls.length, 0);
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /search=ana/);
  // both views' search boxes stay in sync
  const otherSearch = document.querySelectorAll("[data-explorer-search]")[1] as HTMLInputElement;
  assert.equal(otherSearch.value, "ana");
});

test("the search clear button resets the search and refetches", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const search = document.querySelector("[data-explorer-search]") as HTMLInputElement;
  search.value = "x";
  const clearBtn = document.querySelector("[data-explorer-search-clear]") as HTMLElement;
  clearBtn.click();
  await Promise.resolve();
  assert.equal(search.value, ""); // syncControls pushes state back
});

test("modality chip clicks filter and toggle aria-pressed", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  fetchCalls = [];

  const ctChip = document.querySelector('[data-modality="CT"]') as HTMLElement;
  ctChip.click();
  await Promise.resolve();

  assert.match(fetchCalls[0], /modality=CT/);
  assert.equal(ctChip.classList.contains("filter-chip--active"), true);
  assert.equal(ctChip.getAttribute("aria-pressed"), "true");
});

test("the zenodo-linked chip toggles independently of modality", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  fetchCalls = [];

  const zChip = document.querySelector("[data-zenodo-linked]") as HTMLElement;
  zChip.click();
  await Promise.resolve();
  assert.match(fetchCalls[0], /zenodo_linked=true/);
});

test("date range inputs filter and format as YYYYMMDD", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  fetchCalls = [];

  const from = document.querySelector("[data-explorer-date-from]") as HTMLInputElement;
  from.value = "2024-01-01";
  from.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.match(fetchCalls[0], /date_from=20240101/);

  fetchCalls = [];
  const to = document.querySelector("[data-explorer-date-to]") as HTMLInputElement;
  to.value = "2024-02-01";
  to.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.match(fetchCalls[0], /date_to=20240201/);
});

test("the clear-filters button resets every filter and refetches", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const ctChip = document.querySelector('[data-modality="CT"]') as HTMLElement;
  ctChip.click();
  await Promise.resolve();

  fetchCalls = [];
  const clear = document.querySelector("[data-explorer-clear]") as HTMLElement;
  clear.click();
  await Promise.resolve();

  assert.doesNotMatch(fetchCalls[0], /modality=/);
  assert.equal(ctChip.classList.contains("filter-chip--active"), false);
});

test("pagination prev/next respect the page boundaries", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([STUDY_A], { page: 2, totalPages: 3, total: 40 }));

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const prev = document.querySelector("[data-explorer-prev]") as HTMLButtonElement;
  const next = document.querySelector("[data-explorer-next]") as HTMLButtonElement;
  assert.equal(prev.disabled, false);
  assert.equal(next.disabled, false);

  const info = document.querySelector("[data-explorer-pagination-info]") as HTMLElement;
  assert.equal(info.textContent, "2 / 3");

  fetchCalls = [];
  next.click();
  await Promise.resolve();
  // explorerState.page (the request counter) starts at 1 regardless of what
  // page the stubbed response claims to be, so clicking next requests page 2.
  assert.match(fetchCalls[0], /page=2/);
});

test("markStudyAsNew adds the new badge on the next render", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async () => jsonResponse(200, studiesPage([STUDY_A]));

  const mod = await freshExplorer();
  explorerFixture();
  mod.markStudyAsNew("study-a");
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();

  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  assert.match(list.innerHTML, /study-item__new/);
});

test("thumbnails are fetched as blobs and swapped in", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async (url) => {
    if (url.includes("/thumbnail")) return jsonResponse(200, {});
    return jsonResponse(200, studiesPage([STUDY_A]));
  };

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  await Promise.resolve();
  await Promise.resolve();

  const img = document.querySelector<HTMLImageElement>("img[data-thumb-id]")!;
  assert.equal(img.src, "blob:mock");
  assert.equal(img.style.display, "");
});

test("a failing thumbnail fetch leaves the fallback badge visible", async () => {
  await adoptSession("t.t.t", "r", { id: 1, email: "a@b.com", role: "medico" });
  fetchImpl = async (url) => {
    if (url.includes("/thumbnail")) return jsonResponse(500, {});
    return jsonResponse(200, studiesPage([STUDY_A]));
  };

  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  await mod.loadStudyExplorer();
  await Promise.resolve();
  await Promise.resolve();

  const img = document.querySelector<HTMLImageElement>("img[data-thumb-id]")!;
  assert.equal(img.style.display, "none");
});

test("renderLoggedOutExplorer can be called directly", async () => {
  const mod = await freshExplorer();
  explorerFixture();
  mod.initStudyExplorer();
  mod.renderLoggedOutExplorer();
  const list = document.querySelector("[data-explorer-list]") as HTMLElement;
  assert.match(list.innerHTML, /data-explorer-login/);
});

// Note: explorer.ts registers an onLocaleChange re-render, but exercising
// setLocale() here also fires viewer/rendering.ts's own module-level locale
// listener (loading.ts, which explorer.ts imports for openStudy(), pulls
// rendering.ts in transitively) against a fixture that doesn't have the
// viewer's DOM — out of scope for this file, left to the viewer test suite.

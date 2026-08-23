/**
 * Search, DOI resolve/version-switch, pagination, filter chips, env toggle,
 * and the import flow (including the ZIP confirm strip) for zenodo-panel.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { jwt, zenodoPanelHtml, createMockFetch } from "../../test/zenodo-fixture.ts";
import { adoptSession, logout, type AuthUser } from "../auth/auth.ts";
import { initZenodoPanel } from "./zenodo-panel.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

const staffUser: AuthUser = { id: 1, email: "medico@micd.local", role: "medico" };
const researcherUser: AuthUser = { id: 2, email: "investigador@micd.local", role: "investigador" };

async function loginAs(user: AuthUser): Promise<void> {
  await adoptSession(jwt({ sub: user.id, email: user.email, role: user.role }), "refresh-fake", user);
}

let mock: ReturnType<typeof createMockFetch>;

/** Flushes pending microtask chains (async/await), unlike a fixed count of Promise.resolve() hops. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Microtask-only equivalent of flush(), for use once a test has enabled mock
 * timers (t.mock.timers.enable) — flush()'s setTimeout(0) would never fire
 * on its own past that point, since mock timers only advance via .tick().
 */
async function flushMicro(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

test.beforeEach(async () => {
  setBody(zenodoPanelHtml());
  // logout() (below) may itself fire a real /auth/logout request if a
  // previous test's login left a refresh token stored — use a throwaway
  // fetch for that so it doesn't pollute the fresh mock's call log that
  // this test's assertions inspect.
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await logout().catch(() => {});

  mock = createMockFetch();
  (globalThis as any).fetch = mock.fetchImpl;
  initZenodoPanel();
});

function search(term: string): void {
  const input = document.getElementById("z-search-input") as HTMLInputElement;
  input.value = term;
  document.getElementById("btn-z-search")!.click();
}

const sampleRecord = {
  id: 42,
  doi: "10.5281/zenodo.42",
  title: "CT lung dataset",
  authors: [{ name: "Ada Lovelace" }],
  publicationDate: "2024-05-01",
  license: "cc-by-4.0",
  totalSize: 2048,
  numFiles: 3,
  importable: true,
  files: [{ key: "a.dcm", size: 100 }],
};

test("runSearch with a blank query is a no-op", async () => {
  await loginAs(staffUser);
  search("   ");
  await Promise.resolve();
  assert.equal(document.getElementById("z-results")!.querySelector(".z-skeleton-card"), null);
});

test("loadSearch shows a login-required empty state and toast when the session can't be established", async () => {
  // Never logged in, and no login prompt registered -> ensureAuthenticated() resolves false.
  search("lung ct");
  await flush();
  const results = document.getElementById("z-results")!;
  assert.match(results.innerHTML, /z-empty-state--error/);
});

test("loadSearch renders record cards on a successful search with results", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 200, body: { records: [sampleRecord], total: 1, page: 1, size: 8 } }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();

  const results = document.getElementById("z-results")!;
  assert.match(results.innerHTML, /CT lung dataset/);
  assert.match(results.innerHTML, /Ada Lovelace/);
  assert.match(results.innerHTML, /10\.5281\/zenodo\.42/);
  // staff + importable + not-all-zip -> plain DICOM import button
  assert.match(results.innerHTML, /data-import-id="42"/);
  assert.match(results.innerHTML, /data-has-zip="false"/);
});

test("loadSearch hides the import button for a researcher (read-only role)", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 200, body: { records: [sampleRecord], total: 1, page: 1, size: 8 } }),
  );
  await loginAs(researcherUser);
  search("lung ct");
  await flush();
  assert.doesNotMatch(document.getElementById("z-results")!.innerHTML, /data-import-id/);
});

test("loadSearch renders a not-importable badge when the record isn't importable", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({
      status: 200,
      body: { records: [{ ...sampleRecord, importable: false }], total: 1, page: 1, size: 8 },
    }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
  assert.match(document.getElementById("z-results")!.innerHTML, /z-badge--muted/);
});

test("loadSearch renders a ZIP·DICOM badge when every file is a .zip", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({
      status: 200,
      body: {
        records: [{ ...sampleRecord, files: [{ key: "a.zip", size: 10 }, { key: "b.zip", size: 10 }] }],
        total: 1,
        page: 1,
        size: 8,
      },
    }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
  const html = document.getElementById("z-results")!.innerHTML;
  assert.match(html, /ZIP·DICOM/);
  assert.match(html, /data-has-zip="true"/);
});

test("loadSearch renders the no-results empty state when total is 0", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 200, body: { records: [], total: 0, page: 1, size: 8 } }),
  );
  await loginAs(staffUser);
  search("nothing here");
  await flush();
  const html = document.getElementById("z-results")!.innerHTML;
  assert.match(html, /z-empty-state/);
  assert.doesNotMatch(html, /z-empty-state--error/);
});

for (const [status, expectMarker] of [
  [401, /searchSessionRequired|error401/i],
  [429, /rateLimit/i],
  [503, /unavailable/i],
  [500, /searchError/i],
] as const) {
  test(`loadSearch maps a ${status} search error to an error empty-state`, async () => {
    mock.on(
      (url) => url.includes("/v1/zenodo/search"),
      () => ({ status, body: { error: "server said no" } }),
    );
    await loginAs(staffUser);
    search("lung ct");
    await flush();
    assert.match(document.getElementById("z-results")!.innerHTML, /z-empty-state--error/);
  });
}

test("a 429 search error shows the 'go to Config' link, and clicking it switches tabs", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 429, body: { error: "throttled" } }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();

  const link = document.getElementById("z-empty-config-link");
  assert.ok(link);
  link!.click();
  assert.equal(document.getElementById("z-tab-config")!.classList.contains("hidden"), false);
});

test("loadSearch renders a connection-error empty state when fetch throws", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => {
      throw new Error("network down");
    },
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
  assert.match(document.getElementById("z-results")!.innerHTML, /z-empty-state--error/);
});

test("pagination buttons page the search forward and back", async () => {
  let seenPage = 0;
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      seenPage = page;
      return { status: 200, body: { records: [sampleRecord], total: 20, page, size: 8 } };
    },
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
  assert.equal(seenPage, 1);
  assert.equal((document.getElementById("z-next") as HTMLButtonElement).disabled, false);

  document.getElementById("z-next")!.click();
  await flush();
  assert.equal(seenPage, 2);

  document.getElementById("z-prev")!.click();
  await flush();
  assert.equal(seenPage, 1);
  assert.equal((document.getElementById("z-prev") as HTMLButtonElement).disabled, true);
});

test("z-prev is a no-op on page 1 and z-next is a no-op on the last page", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 200, body: { records: [sampleRecord], total: 1, page: 1, size: 8 } }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
  const callsBefore = mock.calls.length;

  document.getElementById("z-prev")!.click();
  document.getElementById("z-next")!.click();
  await Promise.resolve();
  assert.equal(mock.calls.length, callsBefore);
});

test("filter chips set state.fileType, re-search when a query exists, and toggle active class", async () => {
  const seenFileTypes: string[] = [];
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    (url) => {
      seenFileTypes.push(new URL(url).searchParams.get("file_type") ?? "");
      return { status: 200, body: { records: [], total: 0, page: 1, size: 8 } };
    },
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();

  const dcmChip = document.querySelector<HTMLElement>('.filter-chip[data-type="dcm"]')!;
  dcmChip.click();
  await flush();

  assert.equal(dcmChip.classList.contains("filter-chip--active"), true);
  assert.equal(seenFileTypes.at(-1), "dcm");
});

test("filter chip click with no active query does not trigger a search", async () => {
  const before = mock.calls.length;
  document.querySelector<HTMLElement>('.filter-chip[data-type="zip"]')!.click();
  await Promise.resolve();
  assert.equal(mock.calls.length, before);
});

test("environment toggle sets state.environment and re-searches when a query exists", async () => {
  const seenEnvs: string[] = [];
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    (url) => {
      seenEnvs.push(new URL(url).searchParams.get("environment") ?? "");
      return { status: 200, body: { records: [], total: 0, page: 1, size: 8 } };
    },
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();

  const prodBtn = document.querySelector<HTMLElement>('[data-env="production"]')!;
  prodBtn.click();
  await flush();

  assert.equal(prodBtn.classList.contains("active"), true);
  assert.equal(seenEnvs.at(-1), "production");
});

// ── DOI resolve ──────────────────────────────────────────────────────────────

test("resolveDoi rejects input that doesn't look like a DOI/Zenodo URL", async () => {
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "not a doi";
  document.getElementById("btn-z-resolve-doi")!.click();
  await Promise.resolve();
  assert.equal(mock.calls.length, 0);
});

test("resolveDoi resolves a valid DOI, renders the record, and syncs the env toggle", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => ({
      status: 200,
      body: {
        record: sampleRecord,
        versions: [{ recordId: 42, doi: "10.5281/zenodo.42", version: "1.0", publicationDate: "2024-05-01", isLatest: true, isSelected: true }],
        environment: "production",
      },
    }),
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "10.5281/zenodo.42";
  document.getElementById("btn-z-resolve-doi")!.click();
  await flush();

  assert.match(document.getElementById("z-results")!.innerHTML, /CT lung dataset/);
  assert.equal(document.querySelector('[data-env="production"]')!.classList.contains("active"), true);
});

test("resolveDoi via Enter key on the doi input triggers the same flow", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => ({
      status: 200,
      body: { record: sampleRecord, versions: [], environment: "sandbox" },
    }),
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "https://zenodo.org/records/42";
  doiInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush();
  assert.match(document.getElementById("z-results")!.innerHTML, /CT lung dataset/);
});

test("resolveDoi shows a toast and resets the button on a non-ok response", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => ({ status: 404, body: { error: "not found" } }),
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "10.5281/zenodo.99";
  document.getElementById("btn-z-resolve-doi")!.click();
  await flush();
  const btn = document.getElementById("btn-z-resolve-doi") as HTMLButtonElement;
  assert.equal(btn.disabled, false);
});

test("resolveDoi shows a connection-error toast when fetch throws", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => {
      throw new Error("down");
    },
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "10.5281/zenodo.99";
  document.getElementById("btn-z-resolve-doi")!.click();
  await flush();
  const btn = document.getElementById("btn-z-resolve-doi") as HTMLButtonElement;
  assert.equal(btn.disabled, false);
});

test("selectDoiVersion switches to another version via the rendered <select>", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => ({
      status: 200,
      body: {
        record: sampleRecord,
        versions: [
          { recordId: 42, doi: "d1", version: "2.0", publicationDate: "2024-05-01", isLatest: true, isSelected: true },
          { recordId: 41, doi: "d0", version: "1.0", publicationDate: "2023-01-01", isLatest: false, isSelected: false },
        ],
        environment: "sandbox",
      },
    }),
  );
  mock.on(
    (url) => /\/v1\/zenodo\/records\/41\?/.test(url),
    () => ({ status: 200, body: { ...sampleRecord, id: 41, doi: "d0" } }),
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "10.5281/zenodo.42";
  document.getElementById("btn-z-resolve-doi")!.click();
  await flush();

  const select = document.getElementById("z-doi-version-select") as HTMLSelectElement;
  assert.ok(select);
  select.value = "41";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();

  assert.match(document.getElementById("z-results")!.innerHTML, /d0/);
});

test("selectDoiVersion shows a toast on a failed version fetch", async () => {
  mock.on(
    (url) => url.includes("/v1/zenodo/resolve"),
    () => ({
      status: 200,
      body: {
        record: sampleRecord,
        versions: [
          { recordId: 42, doi: "d1", version: "2.0", publicationDate: null, isLatest: true, isSelected: true },
          { recordId: 41, doi: "d0", version: "1.0", publicationDate: null, isLatest: false, isSelected: false },
        ],
        environment: "sandbox",
      },
    }),
  );
  mock.on(
    (url) => /\/v1\/zenodo\/records\/41\?/.test(url),
    () => ({ status: 500, body: { error: "boom" } }),
  );
  await loginAs(staffUser);
  const doiInput = document.getElementById("z-doi-input") as HTMLInputElement;
  doiInput.value = "10.5281/zenodo.42";
  document.getElementById("btn-z-resolve-doi")!.click();
  await flush();

  const select = document.getElementById("z-doi-version-select") as HTMLSelectElement;
  select.value = "41";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
  // still shows the previously-resolved record, not a crash
  assert.match(document.getElementById("z-results")!.innerHTML, /CT lung dataset|d1/);
});

// ── Import flow ──────────────────────────────────────────────────────────────

async function renderOneRecord(record: typeof sampleRecord = sampleRecord): Promise<void> {
  mock.on(
    (url) => url.includes("/v1/zenodo/search"),
    () => ({ status: 200, body: { records: [record], total: 1, page: 1, size: 8 } }),
  );
  await loginAs(staffUser);
  search("lung ct");
  await flush();
}

test("importRecord happy path: fetches detail, imports, shows success, then resets", async (t) => {
  await renderOneRecord();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 200, body: sampleRecord }),
  );
  mock.on(
    (url) => url.endsWith("/v1/zenodo/import"),
    () => ({ status: 200, body: { imported: 1, duplicates: 0 } }),
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  btn.click();
  await flushMicro();

  assert.equal(btn.classList.contains("btn--success"), true);
  t.mock.timers.tick(3000);
  assert.equal(btn.disabled, false);
});

test("importRecord with only duplicates shows the duplicate warning and resets without success styling", async () => {
  await renderOneRecord();
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 200, body: sampleRecord }),
  );
  mock.on(
    (url) => url.endsWith("/v1/zenodo/import"),
    () => ({ status: 200, body: { imported: 0, duplicates: 2 } }),
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  btn.click();
  await flush();

  assert.equal(btn.disabled, false);
  assert.equal(btn.classList.contains("btn--success"), false);
});

test("importRecord shows an error and resets when the import call fails", async () => {
  await renderOneRecord();
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 200, body: sampleRecord }),
  );
  mock.on(
    (url) => url.endsWith("/v1/zenodo/import"),
    () => ({ status: 500, body: { error: "import failed" } }),
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  btn.click();
  await flush();

  assert.equal(btn.disabled, false);
});

test("importRecord shows a warning and re-enables when the detail has no importable files", async () => {
  const { fetchImpl, on } = mock;
  await renderOneRecord({ ...sampleRecord, files: [{ key: "readme.txt", size: 1 }] });
  on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 200, body: { ...sampleRecord, files: [{ key: "readme.txt", size: 1 }] } }),
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  btn.click();
  await flush();
  assert.notEqual(btn.textContent, "…");
});

test("importRecord surfaces a 404 detail fetch as 'dataset not found' and re-enables the button", async () => {
  await renderOneRecord();
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 404, body: {} }),
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  const origLabel = btn.textContent;
  btn.click();
  await flush();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, origLabel);
});

test("importRecord shows a connection-error toast and resets when the request throws", async (t) => {
  await renderOneRecord();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => {
      throw new Error("down");
    },
  );

  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  const origLabel = btn.textContent;
  btn.click();
  await flushMicro();
  t.mock.timers.tick(2000);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, origLabel);
});

test("a ZIP-only record shows a confirm strip first; cancel removes it without importing", async () => {
  await renderOneRecord({ ...sampleRecord, files: [{ key: "a.zip", size: 600 * 1024 * 1024 }] });
  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  assert.equal(btn.dataset.hasZip, "true");

  btn.click();
  const strip = document.querySelector(".z-zip-confirm");
  assert.ok(strip);
  assert.match(strip!.innerHTML, /z-zip-confirm__msg/);

  document.querySelector<HTMLElement>(".z-zip-confirm__cancel")!.click();
  assert.equal(document.querySelector(".z-zip-confirm"), null);
  assert.equal(mock.calls.filter((c) => c.url.endsWith("/v1/zenodo/import")).length, 0);
});

test("clicking the ZIP import button twice does not stack a second confirm strip", async () => {
  await renderOneRecord({ ...sampleRecord, files: [{ key: "a.zip", size: 10 }] });
  const btn = document.querySelector<HTMLButtonElement>("[data-import-id]")!;
  btn.click();
  btn.click();
  assert.equal(document.querySelectorAll(".z-zip-confirm").length, 1);
});

test("confirming a ZIP import strip removes it and proceeds to importRecord", async () => {
  await renderOneRecord({ ...sampleRecord, files: [{ key: "a.zip", size: 10 }] });
  mock.on(
    (url) => /\/v1\/zenodo\/records\/42\?/.test(url),
    () => ({ status: 200, body: { ...sampleRecord, files: [{ key: "a.zip", size: 10 }] } }),
  );
  mock.on(
    (url) => url.endsWith("/v1/zenodo/import"),
    () => ({ status: 200, body: { imported: 1, duplicates: 0 } }),
  );

  document.querySelector<HTMLButtonElement>("[data-import-id]")!.click();
  document.querySelector<HTMLElement>(".z-zip-confirm__ok")!.click();
  await flush();

  assert.equal(document.querySelector(".z-zip-confirm"), null);
  assert.equal(mock.calls.some((c) => c.url.endsWith("/v1/zenodo/import")), true);
});

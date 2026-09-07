/**
 * Unit tests for the pure helper functions in validations-panel.ts.
 * These run under Node's bare test runner (no jsdom needed) because the tested
 * functions are DOM-free.
 *
 * Run: npm test
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  filterToQueryParam,
  buildBadgeHtml,
  formatDate,
  mountValidationsPanel,
} from "./validations-panel.ts";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { adoptSession, logout } from "../auth/auth.ts";

// ── filterToQueryParam ────────────────────────────────────────────────────────

test('filterToQueryParam returns empty string for "all"', () => {
  assert.equal(filterToQueryParam("all"), "");
});

test('filterToQueryParam returns correct segment for "none"', () => {
  assert.equal(filterToQueryParam("none"), "&validation_status=none");
});

test('filterToQueryParam returns correct segment for "approved"', () => {
  assert.equal(filterToQueryParam("approved"), "&validation_status=approved");
});

test('filterToQueryParam returns correct segment for "rejected"', () => {
  assert.equal(filterToQueryParam("rejected"), "&validation_status=rejected");
});

test('filterToQueryParam returns correct segment for "review"', () => {
  assert.equal(filterToQueryParam("review"), "&validation_status=review");
});

// ── buildBadgeHtml ────────────────────────────────────────────────────────────

// cspell:ignore Aprobado Rechazado
const LABELS = {
  none: "Sin validación",
  approved: "Aprobado",
  rejected: "Rechazado",
  review: "Para revisión",
} as const;

test("buildBadgeHtml returns --none badge for null status", () => {
  const html = buildBadgeHtml(
    null,
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--none"),
    "should include --none class",
  );
  assert.ok(html.includes(LABELS.none), "should include the none label");
  assert.ok(
    !html.includes("validation-badge--approved"),
    "should not include --approved class",
  );
});

test("buildBadgeHtml returns --approved badge for approved status", () => {
  const html = buildBadgeHtml(
    "approved",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--approved"),
    "should include --approved class",
  );
  assert.ok(
    html.includes(LABELS.approved),
    "should include the approved label",
  );
});

test("buildBadgeHtml returns --rejected badge for rejected status", () => {
  const html = buildBadgeHtml(
    "rejected",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--rejected"),
    "should include --rejected class",
  );
  assert.ok(
    html.includes(LABELS.rejected),
    "should include the rejected label",
  );
});

test("buildBadgeHtml returns --review badge for review status", () => {
  const html = buildBadgeHtml(
    "review",
    LABELS.none,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    html.includes("validation-badge--review"),
    "should include --review class",
  );
  assert.ok(html.includes(LABELS.review), "should include the review label");
});

test("buildBadgeHtml escapes HTML in labels", () => {
  const xssLabel = "<script>alert(1)</script>";
  const html = buildBadgeHtml(
    null,
    xssLabel,
    LABELS.approved,
    LABELS.rejected,
    LABELS.review,
  );
  assert.ok(
    !html.includes("<script>"),
    "raw <script> tag must not appear in output",
  );
  assert.ok(html.includes("&lt;script&gt;"), "angle brackets must be escaped");
});

// ── formatDate ────────────────────────────────────────────────────────────────

test("formatDate returns — for null", () => {
  assert.equal(formatDate(null), "—");
});

test("formatDate returns — for empty string", () => {
  assert.equal(formatDate(""), "—");
});

test("formatDate returns a non-empty string for a valid ISO date", () => {
  const result = formatDate("2026-09-06T10:00:00Z");
  assert.ok(result.length > 0, "should return a formatted date string");
  assert.notEqual(result, "—");
});

test("formatDate returns the original string for an invalid date", () => {
  const bad = "not-a-date";
  const result = formatDate(bad);
  assert.equal(result, bad);
});

// ── DOM tests: mountValidationsPanel ─────────────────────────────────────────

test.describe("mountValidationsPanel", () => {
  test.before(() => installDom());
  test.after(() => uninstallDom());

  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  beforeEach(async () => {
    (globalThis as { fetch?: unknown }).fetch = (
      url: string,
      init?: RequestInit,
    ) => fetchImpl(url, init);
    fetchImpl = async () => {
      throw new Error("unexpected fetch");
    };
    const enc = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const header = enc({ alg: "HS256", typ: "JWT" });
    const payload = enc({
      sub: 1,
      email: "medico@micd.local",
      role: "medico",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await adoptSession(`${header}.${payload}.sig`, "rt", {
      id: 1,
      email: "medico@micd.local",
      role: "medico",
    });
  });

  afterEach(async () => {
    delete (globalThis as { fetch?: unknown }).fetch;
    await logout();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  function makeRoot(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-validations-filters></div>
      <table>
        <thead data-validations-thead></thead>
        <tbody data-validations-tbody></tbody>
      </table>
      <div data-validations-empty class="hidden"></div>
      <div data-validations-error class="hidden"></div>
    `;
    document.body.innerHTML =
      '<div id="toast-container"></div>' + root.outerHTML;
    return document.body.querySelector("div:last-child") as HTMLElement;
  }

  const STUDY_ROW = {
    orthanc_study_id: "study-abc",
    patient_name: "García, María",
    modality: "CT",
    study_date: "2026-09-01T00:00:00Z",
    validation_status: null as null | "approved" | "rejected" | "review",
    validated_by: null,
    validated_at: null,
    has_ml_prediction: true,
  };

  test("renders filter chips on mount", async () => {
    fetchImpl = async () => jsonResponse(200, { studies: [] });
    const root = makeRoot();
    mountValidationsPanel(root, () => {});
    const chips = root.querySelectorAll("[data-filter]");
    assert.ok(chips.length >= 5, "should render at least 5 filter chips");
  });

  test("reload() fetches studies and renders table rows", async () => {
    fetchImpl = async () => jsonResponse(200, { studies: [STUDY_ROW] });
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();
    const rows = root.querySelectorAll("[data-validations-tbody] tr");
    assert.equal(rows.length, 1, "should render one table row");
    assert.ok(
      root
        .querySelector("[data-validations-tbody]")!
        .innerHTML.includes("García"),
    );
  });

  test("reload() shows empty state when API returns no studies", async () => {
    fetchImpl = async () => jsonResponse(200, { studies: [] });
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();
    const emptyEl = root.querySelector<HTMLElement>(
      "[data-validations-empty]",
    )!;
    assert.ok(!emptyEl.classList.contains("hidden"), "empty state should show");
  });

  test("reload() shows error state when API fails", async () => {
    fetchImpl = async () => jsonResponse(500, { error: "internal" });
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();
    const errorEl = root.querySelector<HTMLElement>(
      "[data-validations-error]",
    )!;
    assert.ok(!errorEl.classList.contains("hidden"), "error state should show");
  });

  test("reload() shows error state on network failure", async () => {
    fetchImpl = async () => {
      throw new Error("offline");
    };
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();
    const errorEl = root.querySelector<HTMLElement>(
      "[data-validations-error]",
    )!;
    assert.ok(
      !errorEl.classList.contains("hidden"),
      "error state should show on network error",
    );
  });

  test("clicking Open button calls onOpenStudy with the study id", async () => {
    fetchImpl = async () => jsonResponse(200, { studies: [STUDY_ROW] });
    const root = makeRoot();
    const opened: string[] = [];
    const handle = mountValidationsPanel(root, (id) => opened.push(id));
    await handle.reload();

    const openBtn = root.querySelector<HTMLElement>(
      "[data-action='open'][data-study='study-abc']",
    )!;
    assert.ok(openBtn, "open button should exist");
    openBtn.click();
    assert.deepEqual(opened, ["study-abc"]);
  });

  test("shows AI done badge when has_ml_prediction is true", async () => {
    fetchImpl = async () =>
      jsonResponse(200, {
        studies: [{ ...STUDY_ROW, has_ml_prediction: true }],
      });
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();

    const tbody = root.querySelector("[data-validations-tbody]")!;
    assert.ok(
      tbody.innerHTML.includes("validation-ml-badge--done"),
      "should show done ML badge",
    );
    const analyzeBtn = root.querySelector("[data-action='analyze']");
    assert.equal(
      analyzeBtn,
      null,
      "analyze button must not appear when analysis done",
    );
  });

  test("shows Analyze button when has_ml_prediction is false", async () => {
    fetchImpl = async () =>
      jsonResponse(200, {
        studies: [{ ...STUDY_ROW, has_ml_prediction: false }],
      });

    // Adopt admin session so mlAnalysisHtml renders for admin.
    const enc = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const h = enc({ alg: "HS256", typ: "JWT" });
    const p = enc({
      sub: 2,
      email: "admin@micd.local",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await adoptSession(`${h}.${p}.sig`, "rt2", {
      id: 2,
      email: "admin@micd.local",
      role: "admin",
    });

    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();

    const analyzeBtn = root.querySelector("[data-action='analyze']");
    assert.ok(analyzeBtn, "analyze button should appear when no ML prediction");
  });

  test("no approve/reject/review buttons in the panel (validation happens in viewer)", async () => {
    fetchImpl = async () => jsonResponse(200, { studies: [STUDY_ROW] });
    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();

    assert.equal(
      root.querySelector("[data-action='approve']"),
      null,
      "no approve button",
    );
    assert.equal(
      root.querySelector("[data-action='reject']"),
      null,
      "no reject button",
    );
    assert.equal(
      root.querySelector("[data-action='review']"),
      null,
      "no review button",
    );
  });

  test("filter chip click re-fetches with the filter param", async () => {
    const requestedUrls: string[] = [];
    fetchImpl = async (url) => {
      requestedUrls.push(url as string);
      return jsonResponse(200, { studies: [] });
    };

    const root = makeRoot();
    const handle = mountValidationsPanel(root, () => {});
    await handle.reload();

    const approvedChip = root.querySelector<HTMLElement>(
      "[data-filter='approved']",
    )!;
    assert.ok(approvedChip, "approved chip should exist");
    approvedChip.click();
    await new Promise((r) => setTimeout(r, 10));

    const lastUrl = requestedUrls[requestedUrls.length - 1];
    assert.ok(
      lastUrl.includes("validation_status=approved"),
      "filter param should appear in URL after chip click",
    );
  });
});

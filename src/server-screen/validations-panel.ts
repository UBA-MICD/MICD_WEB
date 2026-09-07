// ── Validations panel (US-26) ─────────────────────────────────────────────────
// cspell:ignore Validaciones estudio Solicitar análisis

import { authFetch, API_BASE, isAdmin } from "../auth/auth.js";
import { triggerAnalysis } from "../viewer/prediction-api.js";
import { escapeHtml } from "../shared/dom.js";
import { showToast } from "../shared/banner.js";
import { t, onLocaleChange } from "../i18n/i18n.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterValue = "all" | "none" | "approved" | "rejected" | "review";

interface StudyRow {
  orthanc_study_id: string;
  patient_name: string | null;
  modality: string | null;
  study_date: string | null;
  validation_status: "approved" | "rejected" | "review" | null;
  validated_by: string | null;
  validated_at: string | null;
  has_ml_prediction: boolean;
}

export interface ValidationsPanelHandle {
  reload(): Promise<void>;
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/** Returns the ?validation_status= query param segment for a given filter. */
export function filterToQueryParam(filter: FilterValue): string {
  return filter === "all"
    ? ""
    : `&validation_status=${encodeURIComponent(filter)}`;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

/** Minimal HTML-safe text escaping — DOM-free so this stays unit-testable. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** @internal exported only for unit tests */
export function buildBadgeHtml(
  status: "approved" | "rejected" | "review" | null,
  statusNoneLabel: string,
  statusApprovedLabel: string,
  statusRejectedLabel: string,
  statusReviewLabel: string,
): string {
  if (!status) {
    return `<span class="validation-badge validation-badge--none">${esc(statusNoneLabel)}</span>`;
  }
  const cls = `validation-badge validation-badge--${status}`;
  const label =
    status === "approved"
      ? statusApprovedLabel
      : status === "rejected"
        ? statusRejectedLabel
        : statusReviewLabel;
  return `<span class="${cls}">${esc(label)}</span>`;
}

function badgeHtml(status: StudyRow["validation_status"]): string {
  return buildBadgeHtml(
    status,
    t("validation.status.none"),
    t("validation.status.approved"),
    t("validation.status.rejected"),
    t("validation.status.review"),
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// ── Panel factory ─────────────────────────────────────────────────────────────

export function mountValidationsPanel(
  root: HTMLElement,
  /**
   * Called when the user clicks "Ver estudio". The caller (server-screen.ts)
   * is responsible for opening the study in the viewer and closing the server
   * screen — keeps this module free of circular imports.
   */
  onOpenStudy: (studyId: string) => void,
): ValidationsPanelHandle {
  const filtersEl = root.querySelector<HTMLElement>(
    "[data-validations-filters]",
  )!;
  const theadEl = root.querySelector<HTMLElement>("[data-validations-thead]")!;
  const tbodyEl = root.querySelector<HTMLElement>("[data-validations-tbody]")!;
  const emptyEl = root.querySelector<HTMLElement>("[data-validations-empty]")!;
  const errorEl = root.querySelector<HTMLElement>("[data-validations-error]")!;

  let activeFilter: FilterValue = "all";
  let studies: StudyRow[] = [];
  let loading = false;

  // ── Filter chips ────────────────────────────────────────────────────────────

  const FILTERS: FilterValue[] = [
    "all",
    "none",
    "approved",
    "rejected",
    "review",
  ];

  function renderFilters(): void {
    filtersEl.innerHTML = FILTERS.map((f) => {
      const key =
        f === "all"
          ? "validations.filterAll"
          : f === "none"
            ? "validations.filterPending"
            : f === "approved"
              ? "validations.filterApproved"
              : f === "rejected"
                ? "validations.filterRejected"
                : "validations.filterReview";
      const active = f === activeFilter;
      return `<button
        class="validations-chip${active ? " validations-chip--active" : ""}"
        data-filter="${escapeHtml(f)}"
        aria-pressed="${active}"
        type="button"
      >${escapeHtml(t(key))}</button>`;
    }).join("");
  }

  function renderHeader(): void {
    theadEl.innerHTML = `<tr>
      <th>${escapeHtml(t("validations.colPatient"))}</th>
      <th>${escapeHtml(t("validations.colModality"))}</th>
      <th>${escapeHtml(t("validations.colDate"))}</th>
      <th>${escapeHtml(t("validations.colStatus"))}</th>
      <th>${escapeHtml(t("validations.colValidatedBy"))}</th>
      <th>${escapeHtml(t("validations.colActions"))}</th>
    </tr>`;
  }

  filtersEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-filter]");
    if (!btn) return;
    const filter = btn.dataset.filter as FilterValue;
    if (filter === activeFilter) return;
    activeFilter = filter;
    renderFilters();
    void fetch();
  });

  // ── Data fetching ───────────────────────────────────────────────────────────

  async function fetch(): Promise<void> {
    if (loading) return;
    loading = true;
    emptyEl.classList.add("hidden");
    errorEl.classList.add("hidden");

    const qs =
      activeFilter === "all"
        ? ""
        : `&validation_status=${encodeURIComponent(activeFilter)}`;

    try {
      const res = await authFetch(`${API_BASE}/v1/studies?limit=100${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      studies = (data.studies ?? []) as StudyRow[];
      renderTable();
    } catch {
      errorEl.textContent = t("validations.loadError");
      errorEl.classList.remove("hidden");
      tbodyEl.innerHTML = "";
    } finally {
      loading = false;
    }
  }

  // ── Table rendering ─────────────────────────────────────────────────────────

  function renderTable(): void {
    if (studies.length === 0) {
      tbodyEl.innerHTML = "";
      emptyEl.textContent = t("validations.empty");
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    tbodyEl.innerHTML = studies.map(rowHtml).join("");
  }

  function rowHtml(s: StudyRow): string {
    const admin = isAdmin();
    return `<tr data-study-id="${escapeHtml(s.orthanc_study_id)}">
      <td>${escapeHtml(s.patient_name ?? "—")}</td>
      <td>${escapeHtml(s.modality ?? "—")}</td>
      <td>${escapeHtml(formatDate(s.study_date))}</td>
      <td>${badgeHtml(s.validation_status)}</td>
      <td>${escapeHtml(s.validated_by ?? "—")}</td>
      <td>
        <div class="validations-row-actions">
          ${mlAnalysisHtml(s.orthanc_study_id, s.has_ml_prediction, admin)}
          ${openButtonHtml(s.orthanc_study_id, s.has_ml_prediction)}
        </div>
      </td>
    </tr>`;
  }

  /**
   * Shows a done badge for all staff when the study already has an ML prediction,
   * or a "Solicitar análisis" button (admin only) when it doesn't.
   */
  function mlAnalysisHtml(
    studyId: string,
    hasPrediction: boolean,
    admin: boolean,
  ): string {
    if (hasPrediction) {
      return `<span class="validation-ml-badge validation-ml-badge--done">${escapeHtml(t("validations.mlDone"))}</span>`;
    }
    if (!admin) return "";
    return `<button class="btn btn--secondary btn--sm" data-action="analyze"
      data-study="${escapeHtml(studyId)}" type="button">
      ${escapeHtml(t("validation.analyzeWithAI"))}
    </button>`;
  }

  function openButtonHtml(studyId: string, hasPrediction: boolean): string {
    // data-needs-ml signals the click handler to show a toast instead of opening.
    const needsAttr = hasPrediction ? "" : ` data-needs-ml="true"`;
    const dimClass = hasPrediction ? "" : " btn--dim";
    return `<button class="btn btn--secondary btn--sm${dimClass}" data-action="open"
      data-study="${escapeHtml(studyId)}"
      type="button"${needsAttr}>
      ${escapeHtml(t("validations.openInViewer"))}
    </button>`;
  }

  // ── Action dispatch ─────────────────────────────────────────────────────────

  tbodyEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action!;
    const studyId = btn.dataset.study!;

    if (action === "open") {
      if (btn.dataset.needsMl === "true") {
        showToast(t("validations.openNeedsML"), "error");
        return;
      }
      onOpenStudy(studyId);
      return;
    }

    if (action === "analyze") {
      void analyzeStudy(studyId, btn as HTMLButtonElement);
      return;
    }
  });

  async function analyzeStudy(
    studyId: string,
    btn: HTMLButtonElement,
  ): Promise<void> {
    btn.disabled = true;
    btn.textContent = t("validation.analyzing");

    try {
      const result = await triggerAnalysis(studyId);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(t("validation.analysisDone"), "success");

      const rec = studies.find((s) => s.orthanc_study_id === studyId);
      if (rec) rec.has_ml_prediction = true;

      // Swap the button for the done badge in-place.
      const row = tbodyEl.querySelector<HTMLElement>(
        `[data-study-id="${CSS.escape(studyId)}"]`,
      );
      if (row) {
        const badge = document.createElement("span");
        badge.className = "validation-ml-badge validation-ml-badge--done";
        badge.textContent = t("validations.mlDone");
        btn.replaceWith(badge);

        const openBtn = row.querySelector<HTMLButtonElement>(
          '[data-action="open"]',
        );
        if (openBtn) {
          openBtn.classList.remove("btn--dim");
          openBtn.removeAttribute("data-needs-ml");
        }
      }
    } finally {
      // Re-enable only if the button is still in the DOM (error path).
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = t("validation.analyzeWithAI");
      }
    }
  }

  // ── Locale change ───────────────────────────────────────────────────────────

  onLocaleChange(() => {
    renderFilters();
    renderHeader();
    renderTable();
  });

  // ── Initial render ──────────────────────────────────────────────────────────

  renderFilters();
  renderHeader();

  return {
    reload(): Promise<void> {
      return fetch();
    },
  };
}

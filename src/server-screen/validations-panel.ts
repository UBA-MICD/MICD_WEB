// ── Validations panel (US-26) ─────────────────────────────────────────────────
// cspell:ignore Validaciones estudio Solicitar análisis

import { authFetch, API_BASE } from "../auth/auth.js";
import { escapeHtml } from "../shared/dom.js";
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

export interface OpenStudyOptions {
  /** Abre el estudio y dispara la segmentación de IA apenas termina de cargar. */
  segment?: boolean;
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
  onOpenStudy: (studyId: string, options?: OpenStudyOptions) => void,
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
    return `<tr data-study-id="${escapeHtml(s.orthanc_study_id)}">
      <td>${escapeHtml(s.patient_name ?? "—")}</td>
      <td>${escapeHtml(s.modality ?? "—")}</td>
      <td>${escapeHtml(formatDate(s.study_date))}</td>
      <td>${badgeHtml(s.validation_status)}</td>
      <td>${escapeHtml(s.validated_by ?? "—")}</td>
      <td>
        <div class="validations-row-actions">
          ${segmentButtonHtml(s.orthanc_study_id)}
        </div>
      </td>
    </tr>`;
  }

  /**
   * Única acción de la fila: abre el estudio en el visor y corre la
   * segmentación con IA (mock SAM3). Vive sólo acá, en Validaciones — es una
   * ayuda de lectura para quien valida, no una herramienta del visor general.
   *
   * No depende del clasificador ni guarda estado: cada click produce una forma
   * nueva, y al abrir el visor llega con la barra de validación activa, así que
   * este botón es también el camino para aprobar o rechazar el estudio.
   */
  function segmentButtonHtml(studyId: string): string {
    return `<button class="btn btn--secondary btn--sm btn--ai" data-action="segment"
      data-study="${escapeHtml(studyId)}" type="button">
      ${escapeHtml(t("validations.segmentWithAI"))}
    </button>`;
  }

  // ── Action dispatch ─────────────────────────────────────────────────────────

  tbodyEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action!;
    const studyId = btn.dataset.study!;

    if (action === "segment") {
      onOpenStudy(studyId, { segment: true });
    }
  });

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

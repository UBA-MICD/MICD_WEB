// ── Validations panel (US-26) ─────────────────────────────────────────────────
// cspell:ignore Validaciones estudio
//
// Standalone "Panel de Validaciones" for the server screen tab.
// Lets staff (medico + admin) browse studies by validation status and record
// validations inline, without going through the DICOM viewer.
//
// Intentionally isolated: no imports from viewer/ or server-screen internals.
// Navigation back to the viewer is delegated via the `onOpenStudy` callback so
// there is no circular dependency with server-screen.ts.

import { authFetch, API_BASE, isAdmin } from "../auth/auth.js";
import {
  submitValidation,
  submitCorrection,
  type ValidationAction,
} from "../viewer/validation-api.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
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

// ── Reject dialog ─────────────────────────────────────────────────────────────
//
// Built on demand (once) and reused. Mirrors the structure the existing
// validation-ui dialogs use so the same CSS rules apply.

let rejectDialogEl: HTMLElement | null = null;

function getRejectDialog(): HTMLElement {
  if (rejectDialogEl) return rejectDialogEl;

  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay hidden";
  overlay.id = "validations-reject-dialog";
  overlay.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="vrd-title">
      <h2 class="dialog__title" id="vrd-title"></h2>
      <div class="dialog__body">
        <label class="dialog__label" id="vrd-comment-label" for="vrd-comment"></label>
        <textarea
          id="vrd-comment"
          class="dialog__textarea"
          rows="3"
          data-dialog-autofocus
          aria-labelledby="vrd-comment-label"
        ></textarea>
        <p class="dialog__error hidden" id="vrd-error" role="alert"></p>
      </div>
      <div class="dialog__actions">
        <button class="btn btn--secondary btn--sm" id="vrd-cancel"></button>
        <button class="btn btn--danger btn--sm" id="vrd-confirm"></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  rejectDialogEl = overlay;
  return overlay;
}

/**
 * Opens the reject dialog, pre-fills i18n labels, and returns a promise that
 * resolves with the entered comment (trimmed) or null if the user cancelled.
 */
function promptRejectComment(opener: HTMLElement): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const overlay = getRejectDialog();
    const title = overlay.querySelector<HTMLElement>("#vrd-title")!;
    const commentLabel =
      overlay.querySelector<HTMLElement>("#vrd-comment-label")!;
    const textarea =
      overlay.querySelector<HTMLTextAreaElement>("#vrd-comment")!;
    const errorEl = overlay.querySelector<HTMLElement>("#vrd-error")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>("#vrd-cancel")!;
    const confirmBtn =
      overlay.querySelector<HTMLButtonElement>("#vrd-confirm")!;

    title.textContent = t("validations.rejectDialog.title");
    commentLabel.textContent = t("validations.rejectDialog.commentLabel");
    cancelBtn.textContent = t("common.cancel");
    confirmBtn.textContent = t("validations.rejectDialog.confirm");
    textarea.value = "";
    errorEl.textContent = "";
    errorEl.classList.add("hidden");

    const handleClose = (): void => {
      cancelBtn.removeEventListener("click", handleCancel);
      confirmBtn.removeEventListener("click", handleConfirm);
      overlay.removeEventListener("dialog:close", handleClose);
    };

    const handleCancel = (): void => {
      closeDialog(overlay);
      handleClose();
      resolve(null);
    };

    const handleConfirm = (): void => {
      const comment = textarea.value.trim();
      if (!comment) {
        errorEl.textContent = t("validation.dialog.commentRequired");
        errorEl.classList.remove("hidden");
        textarea.focus();
        return;
      }
      closeDialog(overlay);
      handleClose();
      resolve(comment);
    };

    overlay.addEventListener("dialog:close", () => {
      handleClose();
      resolve(null);
    });

    cancelBtn.addEventListener("click", handleCancel);
    confirmBtn.addEventListener("click", handleConfirm);

    openDialog(overlay, opener);
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
    const canCorrect = admin && s.validation_status !== null;
    return `<tr data-study-id="${escapeHtml(s.orthanc_study_id)}">
      <td>${escapeHtml(s.patient_name ?? "—")}</td>
      <td>${escapeHtml(s.modality ?? "—")}</td>
      <td>${escapeHtml(formatDate(s.study_date))}</td>
      <td>${badgeHtml(s.validation_status)}</td>
      <td>${escapeHtml(s.validated_by ?? "—")}</td>
      <td>
        <div class="validations-row-actions">
          ${actionButtonsHtml(s.orthanc_study_id, canCorrect)}
          <button class="btn btn--secondary btn--sm" data-action="open"
            data-study="${escapeHtml(s.orthanc_study_id)}"
            type="button">
            ${escapeHtml(t("validations.openInViewer"))}
          </button>
        </div>
      </td>
    </tr>`;
  }

  function actionButtonsHtml(studyId: string, isCorrection: boolean): string {
    const esc = escapeHtml(studyId);
    const corrAttr = isCorrection ? ` data-correction="true"` : "";
    return `
      <button class="btn btn--accent btn--sm" data-action="approve"
        data-study="${esc}"${corrAttr} type="button">
        ${escapeHtml(t("validation.approve"))}
      </button>
      <button class="btn btn--danger btn--sm" data-action="reject"
        data-study="${esc}"${corrAttr} type="button">
        ${escapeHtml(t("validation.reject"))}
      </button>
      <button class="btn btn--secondary btn--sm" data-action="review"
        data-study="${esc}"${corrAttr} type="button">
        ${escapeHtml(t("validation.review"))}
      </button>`;
  }

  // ── Action dispatch ─────────────────────────────────────────────────────────

  tbodyEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action!;
    const studyId = btn.dataset.study!;
    const isCorrection = btn.dataset.correction === "true";

    if (action === "open") {
      onOpenStudy(studyId);
      return;
    }

    void dispatchValidation(
      studyId,
      action as "approve" | "reject" | "review",
      isCorrection,
      btn,
    );
  });

  async function dispatchValidation(
    studyId: string,
    action: "approve" | "reject" | "review",
    isCorrection: boolean,
    opener: HTMLElement,
  ): Promise<void> {
    const validationAction: ValidationAction =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "review";

    let comment: string | undefined;
    if (action === "reject") {
      const entered = await promptRejectComment(opener);
      if (entered === null) return; // user cancelled
      comment = entered;
    }

    const submit = isCorrection ? submitCorrection : submitValidation;
    const result = await submit(studyId, validationAction, comment);

    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }

    const msgKey =
      action === "approve"
        ? "validations.actionSuccess.approved"
        : action === "reject"
          ? "validations.actionSuccess.rejected"
          : "validations.actionSuccess.review";
    showToast(t(msgKey), "success");

    // Update just the affected row's status columns without a full reload.
    updateRowInPlace(
      studyId,
      result.data.status as StudyRow["validation_status"],
      result.data.validatedBy,
    );
  }

  /** Patches the validation badge + "validated by" cell without re-fetching. */
  function updateRowInPlace(
    studyId: string,
    newStatus: StudyRow["validation_status"],
    validatedBy: string,
  ): void {
    const row = tbodyEl.querySelector<HTMLElement>(
      `[data-study-id="${CSS.escape(studyId)}"]`,
    );
    if (!row) {
      void fetch();
      return;
    }

    // Update in-memory record so subsequent re-renders are correct.
    const rec = studies.find((s) => s.orthanc_study_id === studyId);
    if (rec) {
      rec.validation_status = newStatus;
      rec.validated_by = validatedBy;
      rec.validated_at = new Date().toISOString();
    }

    // Patch the badge cell (column 4) and validated_by cell (column 5).
    const cells = row.querySelectorAll("td");
    if (cells[3]) cells[3].innerHTML = badgeHtml(newStatus);
    if (cells[4]) cells[4].textContent = validatedBy;

    // Re-render actions for this row (correction flag may have changed).
    const admin = isAdmin();
    const canCorrect = admin && newStatus !== null;
    if (cells[5]) {
      cells[5].querySelector(".validations-row-actions")!.innerHTML =
        actionButtonsHtml(studyId, canCorrect) +
        `<button class="btn btn--secondary btn--sm" data-action="open"
          data-study="${escapeHtml(studyId)}" type="button">
          ${escapeHtml(t("validations.openInViewer"))}
        </button>`;
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

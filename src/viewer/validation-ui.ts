// ── Validation UI (US-26) ─────────────────────────────────────────────────────
//
// DOM wiring for the diagnostic validation feature. Shows Aprobar / Rechazar /
// Marcar para revisión buttons in the viewer when a server study is open and
// the user has the medico or admin role.
//
// When an admin opens a study that already has a validation, the same action
// buttons submit a correction (POST /validation-correction) instead of a new
// validation. A banner inside the bar makes this mode explicit.
//
// Call initValidation() once from main.ts. Call notifyStudyLoaded(id) from
// loading.ts whenever a server study opens (or null when the viewer resets).

import { isStaff, isAdmin } from "../auth/auth.js";
import { $, escapeHtml } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { showToast } from "../shared/banner.js";
import { t, onLocaleChange, currentLocale } from "../i18n/i18n.js";
import { state } from "./state.js";
import {
  submitValidation,
  submitCorrection,
  type ValidationAction,
  type ValidationRecord,
} from "./validation-api.js";
import { triggerAnalysis } from "./prediction-api.js";
import { notifyPredictionLoaded } from "./ml-view.js";

// ── Internal state ────────────────────────────────────────────────────────────

let currentStudyId: string | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/** Called from main.ts once during bootstrap. */
export function initValidation(): void {
  wireButtons();
  onLocaleChange(refreshBar);
}

/**
 * Called from loading.ts after loadStudyFromServer resolves (pass the studyId),
 * and from resetViewerToDropZone (pass null).
 */
export function notifyStudyLoaded(
  studyId: string | null,
  validation: ValidationRecord | null = null,
): void {
  currentStudyId = studyId;
  state.serverValidation = validation
    ? {
        validationId: validation.validationId,
        status: validation.status,
        validatedBy: validation.validatedBy,
        validatedAt: validation.validatedAt,
      }
    : null;
  refreshBar();
}

// ── Bar visibility & badge ────────────────────────────────────────────────────

function refreshBar(): void {
  const bar = document.getElementById("validation-bar");
  if (!bar) return;

  const shouldShow =
    currentStudyId !== null && state.source === "server" && isStaff();

  bar.classList.toggle("hidden", !shouldShow);

  if (shouldShow) {
    renderBadge();
    renderCorrectionNotice();
    renderAIButton();
  }
}

function renderBadge(): void {
  const badge = document.getElementById("validation-status-badge");
  if (!badge) return;

  const v = state.serverValidation;
  if (!v) {
    badge.textContent = t("validation.status.none");
    badge.className = "validation-bar__status validation-bar__status--none";
    return;
  }

  const date = formatValidationDate(v.validatedAt);
  badge.textContent = `${t(`validation.status.${v.status}`)} · ${v.validatedBy} · ${date}`;
  badge.className = `validation-bar__status validation-bar__status--${v.status}`;
}

/** Shows the correction-mode notice when admin + prior validation exists. */
function renderCorrectionNotice(): void {
  const notice = document.getElementById("validation-correction-notice");
  if (!notice) return;
  const isCorrectionMode = isAdmin() && state.serverValidation !== null;
  notice.classList.toggle("hidden", !isCorrectionMode);
}

function isCorrectionMode(): boolean {
  return isAdmin() && state.serverValidation !== null;
}

function formatValidationDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale() === "en" ? "en-US" : "es-AR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Button wiring ─────────────────────────────────────────────────────────────

function renderAIButton(): void {
  const btn = document.getElementById("btn-validate-analyze-ai");
  if (!btn) return;
  btn.classList.toggle("hidden", !isAdmin());
}

function wireButtons(): void {
  document
    .getElementById("btn-validate-approve")
    ?.addEventListener("click", () => handleAction("approved"));
  document
    .getElementById("btn-validate-reject")
    ?.addEventListener("click", () => handleAction("rejected"));
  document
    .getElementById("btn-validate-review")
    ?.addEventListener("click", () => handleAction("review"));
  document
    .getElementById("btn-validate-analyze-ai")
    ?.addEventListener("click", () => void handleAIAnalysis());
}

async function handleAIAnalysis(): Promise<void> {
  const studyId = currentStudyId;
  if (!studyId || !isAdmin()) return;

  const btn = document.getElementById(
    "btn-validate-analyze-ai",
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("validation.analyzing");
  }

  try {
    const res = await triggerAnalysis(studyId);
    if (!res.ok) {
      showToast(res.error, "error");
      return;
    }
    notifyPredictionLoaded(res.data);
    showToast(t("validation.analysisDone"), "success");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("validation.analyzeWithAI");
    }
  }
}

async function handleAction(action: ValidationAction): Promise<void> {
  const studyId = currentStudyId;
  if (!studyId) return;

  const isCorrection = isCorrectionMode();
  const result = await openValidationDialog(action, isCorrection);
  if (!result.confirmed) return;

  const res = isCorrection
    ? await submitCorrection(studyId, action, result.comment || undefined)
    : await submitValidation(studyId, action, result.comment || undefined);

  if (!res.ok) {
    showToast(res.error, "error");
    return;
  }

  state.serverValidation = res.data;

  const toastKey = isCorrection
    ? "validation.toast.success.correction"
    : `validation.toast.success.${action}`;
  showToast(t(toastKey), "success");

  renderBadge();
  renderCorrectionNotice();
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface DialogResult {
  confirmed: boolean;
  comment: string;
}

function openValidationDialog(
  action: ValidationAction,
  isCorrection: boolean,
): Promise<DialogResult> {
  return new Promise((resolve) => {
    const overlay = document.getElementById("validation-dialog") as HTMLElement;
    const titleEl = document.getElementById("validation-dialog-title");
    const msgEl = document.getElementById("validation-dialog-msg");
    const commentEl = document.getElementById(
      "validation-comment",
    ) as HTMLTextAreaElement;
    const requiredNote = document.getElementById("validation-comment-required");
    const confirmBtn = document.getElementById("validation-dialog-confirm");
    const cancelBtn = document.getElementById("validation-dialog-cancel");

    if (
      !overlay ||
      !titleEl ||
      !msgEl ||
      !commentEl ||
      !requiredNote ||
      !confirmBtn ||
      !cancelBtn
    ) {
      resolve({ confirmed: false, comment: "" });
      return;
    }

    const titleKey = isCorrection
      ? "validation.dialog.titleCorrection"
      : "validation.dialog.title";
    const msgKey = isCorrection
      ? `validation.dialog.msg.correction${capitalize(action)}`
      : `validation.dialog.msg.${action}`;

    titleEl.textContent = t(titleKey);
    msgEl.textContent = t(msgKey);
    commentEl.value = "";
    requiredNote.classList.toggle("hidden", action !== "rejected");

    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    openDialog(overlay, opener);

    function finish(confirmed: boolean): void {
      cleanup();
      closeDialog(overlay);
      resolve({ confirmed, comment: commentEl.value.trim() });
    }

    function onConfirm(): void {
      if (action === "rejected" && !commentEl.value.trim()) {
        requiredNote!.classList.remove("hidden");
        commentEl.focus();
        return;
      }
      finish(true);
    }

    function onCancel(): void {
      finish(false);
    }

    function onDialogClose(): void {
      cleanup();
      resolve({ confirmed: false, comment: "" });
    }

    function cleanup(): void {
      confirmBtn!.removeEventListener("click", onConfirm);
      cancelBtn!.removeEventListener("click", onCancel);
      overlay.removeEventListener("dialog:close", onDialogClose);
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("dialog:close", onDialogClose, { once: true });
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

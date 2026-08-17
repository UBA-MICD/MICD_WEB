/* cspell:disable */
import {
  ensureAuthenticated,
  getAccessToken,
  refreshAccessToken,
  getCurrentUser,
  API_BASE,
} from "../auth/auth.js";
import { collectDicomFiles } from "../shared/folder-files.js";
import { expandFiles } from "./zip-expand.js";
import { $, escapeHtml } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { loadStudyExplorer, markStudyAsNew } from "../explorer/explorer.js";
import { showToast } from "../shared/banner.js";
import { t, onLocaleChange } from "../i18n/i18n.js";

// ── Upload (Cargar tab) ──────────────────────────────────────────────────────
//
// Every file gets its own progress row (design screen 04). The previous
// implementation moved a single bar by file index and, for folder uploads,
// used a plain fetch with no progress events at all — so a 400 MB study looked
// frozen. Everything goes through XHR now, which is the only way to observe
// upload progress in the browser.
//
// Files are uploaded one at a time on purpose: a folder can hold hundreds of
// instances, and firing them all at once would bury the API.

type UploadOutcome = "ok" | "duplicate" | "error" | "aborted";

interface UploadRow {
  file: File;
  bar: HTMLElement;
  pct: HTMLElement;
  wrap: HTMLElement;
}

/** In-flight requests, so "Cancelar" can actually stop them. */
let activeXhr: XMLHttpRequest | null = null;
let cancelled = false;
let uploading = false;
/** Study ids returned by a successful upload in this session. */
const uploadedStudyIds: string[] = [];
/** Drives the aggregate percentage, which counts the file in flight too. */
let queue = { done: 0, total: 0 };

export function getLastUploadedStudyId(): string | null {
  return uploadedStudyIds[uploadedStudyIds.length - 1] ?? null;
}

export interface UploadSummary {
  ok: number;
  duplicates: number;
  errors: number;
  total: number;
  cancelled: boolean;
  /** The study to reopen, when exactly one thing clearly succeeded. */
  studyId: string | null;
}

let completeListener: ((summary: UploadSummary) => void) | null = null;

/**
 * Notified once a queue drains. The owning screen decides what to do with the
 * result — upload.ts must not reach into navigation itself, or it and the
 * server screen would import each other.
 */
export function onUploadComplete(cb: (summary: UploadSummary) => void): void {
  completeListener = cb;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initUploadPanel(): void {
  const input = $("upload-input") as HTMLInputElement;
  input.setAttribute("multiple", "");
  input.addEventListener("change", () => {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    void (async () => {
      const { files: expanded, corruptZips, tooBigZips } = await expandFiles(selected, null);
      if (corruptZips.length > 0)
        showToast(t("upload.zipReadError", { files: corruptZips.join(", ") }), "error");
      if (tooBigZips.length > 0)
        showToast(
          t("upload.zipTooBig", { files: tooBigZips.join(", ") }),
          "warning",
        );
      const files = collectDicomFiles(expanded);
      void startUpload(files);
    })();
  });
  $("btn-upload-server")?.addEventListener("click", async () => {
    if (await ensureAuthenticated()) input.click();
  });

  const folderInput = $("upload-folder-input") as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("multiple", "");
  folderInput.addEventListener("change", () => {
    const files = collectDicomFiles(Array.from(folderInput.files ?? []));
    folderInput.value = "";
    void startUpload(files);
  });
  $("btn-upload-folder")?.addEventListener("click", async () => {
    if (await ensureAuthenticated()) folderInput.click();
  });

  initUploadDropZone();
  $("btn-refresh-studies")?.addEventListener("click", loadStudyExplorer);
  renderTransportNote();
  onLocaleChange(renderTransportNote);
}

/** Drag-and-drop onto the Cargar tab's drop area. */
function initUploadDropZone(): void {
  const zone = $("upload-drop");

  // dragover must preventDefault for the drop event to fire in Firefox/Edge.
  zone.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragenter", (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !zone.contains(related)) zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", async (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    const hasZip = dropped.some((f) => f.name.toLowerCase().endsWith(".zip"));
    if (hasZip) showUploadStatus(t("upload.unzippingGeneric"), "");
    const { files: expanded, corruptZips, tooBigZips } = await expandFiles(dropped, null);
    if (hasZip) showUploadStatus("", "");
    // Use toasts for expansion errors so they survive the per-file upload status updates.
    if (corruptZips.length > 0)
      showToast(t("upload.zipReadError", { files: corruptZips.join(", ") }), "error");
    if (tooBigZips.length > 0)
      showToast(
        t("upload.zipTooBig", { files: tooBigZips.join(", ") }),
        "warning",
      );
    const files = collectDicomFiles(expanded);
    if (files.length === 0) {
      if (corruptZips.length === 0 && tooBigZips.length === 0)
        showUploadStatus(t("upload.noDicomFound"), "error");
      return;
    }
    if (await ensureAuthenticated()) void startUpload(files);
  });
}

/**
 * States what actually protects the upload. Asserting "transmisión cifrada"
 * on a plain-HTTP dev origin would be a lie, so the wording follows the
 * protocol the page is really served over.
 */
function renderTransportNote(): void {
  const email = getCurrentUser()?.email;
  const owner = email ? t("upload.ownerSuffix", { email }) : "";
  $("upload-note").textContent =
    window.location.protocol === "https:"
      ? t("upload.transportEncrypted", { owner })
      : t("upload.transportUnencrypted", { owner });
}

// ── Queue ────────────────────────────────────────────────────────────────────

async function startUpload(files: File[]): Promise<void> {
  if (uploading) {
    showUploadStatus(t("upload.inProgress"), "error");
    return;
  }
  if (files.length === 0) {
    showUploadStatus(t("upload.noDicomFound"), "error");
    return;
  }

  // Set the flag before the first await so a concurrent call sees it immediately.
  uploading = true;
  cancelled = false;

  if (!(await ensureAuthenticated())) {
    uploading = false;
    showUploadStatus(t("upload.needLogin"), "error");
    return;
  }
  queue = { done: 0, total: files.length };
  renderTransportNote();
  const rows = renderRows(files);
  setFinishEnabled(false);
  setAggregatePercent(0);

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      if (cancelled) break;
      // Only the file count is announced; the percentage lives in an
      // aria-hidden span so progress doesn't spam the screen reader.
      showUploadStatus(
        t("upload.uploadingProgress", { current: i + 1, total: files.length }),
        "",
      );
      const outcome = await uploadOne(files[i], rows[i]);
      if (outcome === "aborted") break;
      if (outcome === "ok") ok++;
      else if (outcome === "duplicate") duplicates++;
      else errors++;
      queue.done = i + 1;
      setAggregatePercent((queue.done / queue.total) * 100);
    }
  } finally {
    uploading = false;
    activeXhr = null;
    setFinishEnabled(true);
  }

  if (cancelled) {
    showUploadStatus(t("upload.cancelled"), "error");
    completeListener?.({
      ok,
      duplicates,
      errors,
      total: files.length,
      cancelled: true,
      studyId: null,
    });
    return;
  }

  const parts = [t("upload.summaryUploaded", { ok, total: files.length })];
  if (duplicates > 0)
    parts.push(t("upload.summaryDuplicates", { count: duplicates }));
  if (errors > 0) parts.push(t("upload.summaryErrors", { count: errors }));
  showUploadStatus(parts.join(" · "), errors > 0 ? "error" : "ok");
  setAggregatePercent(100);

  await loadStudyExplorer();
  completeListener?.({
    ok,
    duplicates,
    errors,
    total: files.length,
    cancelled: false,
    studyId: getLastUploadedStudyId(),
  });
}

export function cancelUpload(): void {
  if (!uploading) return;
  cancelled = true;
  activeXhr?.abort();
}

export function isUploading(): boolean {
  return uploading;
}

// ── One file ─────────────────────────────────────────────────────────────────

function uploadOne(
  file: File,
  row: UploadRow,
  force = false,
  isRetry = false,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    activeXhr = xhr;
    xhr.open(
      "POST",
      `${API_BASE}/v1/studies/upload${force ? "?force=true" : ""}`,
    );
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      const fraction = e.loaded / e.total;
      setRowProgress(row, fraction * 100);
      // The aggregate counts the file in flight, so the number moves during a
      // single large upload instead of jumping only between files.
      if (queue.total > 0) {
        setAggregatePercent(((queue.done + fraction) / queue.total) * 100);
      }
    });

    xhr.addEventListener("abort", () => {
      setRowState(row, "aborted");
      resolve("aborted");
    });

    xhr.addEventListener("error", () => {
      setRowState(row, "error");
      showUploadStatus(t("upload.networkError"), "error");
      resolve("error");
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 201) {
        setRowProgress(row, 100);
        setRowState(row, "ok");
        rememberUploadedStudy(xhr.responseText);
        resolve("ok");
        return;
      }

      if (xhr.status === 401 && !isRetry) {
        // The in-memory token is stale, so ensureAuthenticated() alone would
        // short-circuit on it: refresh first, fall back to the login gate,
        // then retry this file exactly once.
        void (async () => {
          const recovered =
            (await refreshAccessToken()) || (await ensureAuthenticated());
          if (!recovered) {
            setRowState(row, "error");
            showUploadStatus(t("upload.sessionExpiredRetry"), "error");
            resolve("error");
            return;
          }
          resolve(await uploadOne(file, row, force, true));
        })();
        return;
      }

      if (xhr.status === 401) {
        setRowState(row, "error");
        showUploadStatus(t("upload.unauthorizedRetry"), "error");
        resolve("error");
        return;
      }

      if (xhr.status === 409) {
        setRowState(row, "duplicate");
        showDuplicateDialog(
          file,
          safeMessage(xhr.responseText),
          async (replace) => {
            resolve(replace ? await uploadOne(file, row, true) : "duplicate");
          },
        );
        return;
      }

      setRowState(row, "error");
      if (xhr.status === 413) {
        showUploadStatus(t("upload.fileTooLarge"), "error");
      } else {
        showUploadStatus(
          safeMessage(xhr.responseText) || t("upload.genericError"),
          "error",
        );
      }
      resolve("error");
    });

    xhr.send(formData);
  });
}

/** The 201 body carries the stored study, which the return flow reopens. */
function rememberUploadedStudy(responseText: string): void {
  try {
    const body = JSON.parse(responseText);
    const id = body?.study?.orthanc_study_id;
    if (typeof id === "string" && id) {
      uploadedStudyIds.push(id);
      markStudyAsNew(id);
    }
  } catch {
    // A 201 without a parseable body still counts as a success; we just
    // can't reopen the study automatically.
  }
}

/** Error bodies are not guaranteed to be JSON — never let a parse throw. */
function safeMessage(responseText: string): string {
  try {
    const body = JSON.parse(responseText);
    return body?.message ?? body?.error ?? "";
  } catch {
    return "";
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderRows(files: File[]): UploadRow[] {
  const list = $("upload-rows");
  list.innerHTML = files
    .map(
      (f, i) => `
      <li class="upload-row" id="upload-row-${i}">
        <span class="upload-row__name">${escapeHtml(f.name)}</span>
        <span class="upload-row__track" role="progressbar"
              aria-label="${escapeHtml(t("upload.rowLabel", { name: f.name }))}"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="upload-row__bar"></span>
        </span>
        <span class="upload-row__pct">0%</span>
      </li>`,
    )
    .join("");

  return files.map((file, i) => {
    const wrap = $(`upload-row-${i}`);
    return {
      file,
      wrap,
      bar: wrap.querySelector<HTMLElement>(".upload-row__bar")!,
      pct: wrap.querySelector<HTMLElement>(".upload-row__pct")!,
    };
  });
}

function setRowProgress(row: UploadRow, percent: number): void {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  row.bar.style.width = `${value}%`;
  row.pct.textContent = `${value}%`;
  row.wrap
    .querySelector(".upload-row__track")
    ?.setAttribute("aria-valuenow", String(value));
}

function setRowState(row: UploadRow, state: UploadOutcome): void {
  row.wrap.classList.remove(
    "upload-row--ok",
    "upload-row--error",
    "upload-row--duplicate",
  );
  if (state === "ok") row.wrap.classList.add("upload-row--ok");
  else if (state === "duplicate")
    row.wrap.classList.add("upload-row--duplicate");
  else if (state === "error") row.wrap.classList.add("upload-row--error");

  // The percentage cell doubles as the per-file outcome, so the result is
  // legible without colour alone carrying it (WCAG 1.4.1).
  if (state === "duplicate") row.pct.textContent = t("upload.stateDuplicate");
  else if (state === "error") row.pct.textContent = t("common.error");
  else if (state === "aborted") row.pct.textContent = t("upload.stateAborted");
}

function setAggregatePercent(percent: number): void {
  $("upload-percent").textContent = ` · ${Math.round(percent)}%`;
}

function setFinishEnabled(enabled: boolean): void {
  ($("btn-upload-finish") as HTMLButtonElement).disabled = !enabled;
}

function showUploadStatus(text: string, type: "" | "ok" | "error"): void {
  const el = $("upload-status");
  el.textContent = text;
  el.className = type
    ? `upload-status upload-status--${type}`
    : "upload-status";
}

// ── Explorer panel upload (no per-file row UI) ───────────────────────────────

/**
 * Upload files dropped onto the explorer panel. Accepts .dcm and .zip files.
 * Writes a transient status into `statusEl` while running and shows a toast
 * when done. Does not touch the upload-tab DOM.
 */
export async function startExplorerUpload(
  files: File[],
  statusEl: HTMLElement,
): Promise<void> {
  if (uploading) {
    showToast(t("upload.inProgress"), "warning");
    return;
  }

  // Set the flag before the first await so a concurrent call sees it immediately.
  uploading = true;
  cancelled = false;

  if (!(await ensureAuthenticated())) {
    uploading = false;
    showToast(t("upload.needLoginExplorer"), "warning");
    return;
  }

  statusEl.textContent = t("upload.explorerUploadingProgress", {
    count: files.length,
    plural: files.length !== 1 ? "s" : "",
  });
  statusEl.classList.remove("hidden");

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  try {
    for (const file of files) {
      if (cancelled) break;

      const outcome = await uploadOneExplorer(file);
      if (outcome === "ok") ok++;
      else if (outcome === "duplicate") duplicates++;
      else if (outcome !== "aborted") errors++;
    }
  } finally {
    uploading = false;
    activeXhr = null;
    statusEl.classList.add("hidden");
    statusEl.textContent = "";
  }

  if (cancelled) {
    showToast(t("upload.cancelled"), "warning");
    return;
  }

  const parts = [
    t("upload.explorerSummaryUploaded", {
      ok,
      total: files.length,
      plural: files.length !== 1 ? "s" : "",
    }),
  ];
  if (duplicates > 0)
    parts.push(t("upload.explorerSummaryDuplicates", { count: duplicates }));
  if (errors > 0) parts.push(t("upload.summaryErrors", { count: errors }));
  showToast(parts.join(" · "), errors > 0 ? "error" : "success");

  await loadStudyExplorer();
}

function uploadOneExplorer(
  file: File,
  isRetry = false,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    activeXhr = xhr;
    xhr.open("POST", `${API_BASE}/v1/studies/upload`);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.addEventListener("abort", () => resolve("aborted"));
    xhr.addEventListener("error", () => {
      showToast(t("upload.networkError"), "error");
      resolve("error");
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 201) {
        rememberUploadedStudy(xhr.responseText);
        resolve("ok");
        return;
      }

      if (xhr.status === 401 && !isRetry) {
        void (async () => {
          const recovered =
            (await refreshAccessToken()) || (await ensureAuthenticated());
          if (!recovered) {
            showToast(t("upload.sessionExpiredRetry"), "error");
            resolve("error");
            return;
          }
          resolve(await uploadOneExplorer(file, true));
        })();
        return;
      }

      if (xhr.status === 401) {
        showToast(t("upload.unauthorizedRetry"), "error");
        resolve("error");
        return;
      }

      if (xhr.status === 409) {
        showToast(t("upload.duplicateOnServer", { name: file.name }), "warning");
        resolve("duplicate");
        return;
      }

      if (xhr.status === 413) {
        showToast(t("upload.fileTooLarge"), "error");
      } else {
        showToast(
          safeMessage(xhr.responseText) || t("upload.genericError"),
          "error",
        );
      }
      resolve("error");
    });

    xhr.send(formData);
  });
}

// ── Duplicate confirmation ───────────────────────────────────────────────────

function showDuplicateDialog(
  file: File,
  message: string,
  done: (replace: boolean) => void,
): void {
  const dialog = $("duplicate-dialog");
  $("duplicate-msg").textContent =
    message || t("upload.duplicateMessage", { name: file.name });

  let settled = false;
  const finish = (replace: boolean): void => {
    if (settled) return;
    settled = true;
    closeDialog(dialog);
    done(replace);
  };

  ($("duplicate-yes") as HTMLButtonElement).onclick = () => finish(true);
  ($("duplicate-no") as HTMLButtonElement).onclick = () => finish(false);
  // Escape closes without replacing — the safe outcome for a destructive
  // confirmation, and the queue must not stall waiting on a promise.
  dialog.addEventListener("dialog:close", () => finish(false), { once: true });

  openDialog(dialog);
}

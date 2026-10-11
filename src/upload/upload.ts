/* cspell:disable */
import {
  ensureAuthenticated,
  getAccessToken,
  refreshAccessToken,
  getCurrentUser,
  authFetch,
  isAuthenticated,
  API_BASE,
} from "../auth/auth.js";
import { collectDicomFiles } from "../shared/folder-files.js";
import { expandFiles } from "./zip-expand.js";
import { $, escapeHtml } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { loadStudyExplorer, markStudyAsNew } from "../explorer/explorer.js";
import { showToast } from "../shared/banner.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import {
  anonymizeDicomBytes,
  AnonymizerUnavailableError,
  isAnonymizerAvailable,
} from "./local-anonymizer.js";

// ── Upload (Cargar tab) ──────────────────────────────────────────────────────
//
// A study is often hundreds of files (one per slice), so the whole upload is
// shown as ONE progress panel: a single byte-weighted percentage, the current
// phase (anonymizing / uploading file i of N), bytes and an estimated time
// left. Only the files that fail are listed, collapsed. Everything goes through
// XHR, which is the only way to observe upload progress in the browser.
//
// Files are uploaded one at a time on purpose: a folder can hold hundreds of
// instances, and firing them all at once would bury the API.

type UploadOutcome = "ok" | "duplicate" | "error" | "aborted";

/** The answer to "this file already exists", reused for the rest of the batch. */
type DuplicatePolicy = "ask" | "replace" | "skip";

/** In-flight requests, so "Cancelar" can actually stop them. */
let activeXhr: XMLHttpRequest | null = null;
let cancelled = false;
let uploading = false;
/** Study ids returned by a successful upload in this session. */
const uploadedStudyIds: string[] = [];
/** Byte-weighted progress of the running batch, including the file in flight. */
let progress = { doneBytes: 0, totalBytes: 0, startedAt: 0 };
let duplicatePolicy: DuplicatePolicy = "ask";
/** Files that did not make it, with a short reason, for the collapsed list. */
let failures: Array<{ name: string; reason: string }> = [];

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

// ── Classification catalog (Cargar tab dropdown) ─────────────────────────────
//
// Categories are owned by the backend (GET /v1/pathologies). We fetch them once,
// lazily, the first time the Cargar tab is opened by an authenticated user, and
// build one <option value=id> per category — labels come from i18n, keyed by the
// backend `key`, so they translate on the client and no descriptions live server-side.

let classificationOptionsLoaded = false;

function classificationSelect(): HTMLSelectElement | null {
  return document.getElementById(
    "upload-classification",
  ) as HTMLSelectElement | null;
}

/** The selected category id, or "" when unclassified. */
function selectedClassificationId(): string {
  return classificationSelect()?.value.trim() ?? "";
}

/** Fetch the catalog once and populate the select. Silently no-ops for a guest
 *  or on error — the blank "Sin clasificar" default stays, so upload still works. */
async function ensureClassificationOptions(): Promise<void> {
  if (classificationOptionsLoaded || !isAuthenticated()) return;
  const sel = classificationSelect();
  if (!sel) return;
  try {
    const res = await authFetch(`${API_BASE}/v1/pathologies`);
    if (!res.ok) return;
    const cats = (await res.json()) as { id: number; key: string }[];
    sel.querySelectorAll("option[data-key]").forEach((o) => o.remove());
    for (const c of cats) {
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.dataset.key = c.key;
      opt.textContent = t(`classification.${c.key}`);
      sel.appendChild(opt);
    }
    classificationOptionsLoaded = true;
  } catch {
    // leave the blank default in place
  }
}

/** Re-translate the built options on a locale change (no refetch). */
function relabelClassificationOptions(): void {
  classificationSelect()
    ?.querySelectorAll<HTMLOptionElement>("option[data-key]")
    .forEach((o) => {
      if (o.dataset.key) o.textContent = t(`classification.${o.dataset.key}`);
    });
}

export function initUploadPanel(): void {
  const input = $("upload-input") as HTMLInputElement;
  input.setAttribute("multiple", "");
  input.addEventListener("change", () => {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    void (async () => {
      const {
        files: expanded,
        corruptZips,
        tooBigZips,
      } = await expandFiles(selected, null);
      if (corruptZips.length > 0)
        showToast(
          t("upload.zipReadError", { files: corruptZips.join(", ") }),
          "error",
        );
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
    const selected = Array.from(folderInput.files ?? []);
    folderInput.value = "";
    void (async () => {
      // Expand any .zip archives found inside the chosen folder, the same as the
      // "Seleccionar archivos" and drag-drop paths — otherwise zips are dropped.
      const {
        files: expanded,
        corruptZips,
        tooBigZips,
      } = await expandFiles(selected, null);
      if (corruptZips.length > 0)
        showToast(
          t("upload.zipReadError", { files: corruptZips.join(", ") }),
          "error",
        );
      if (tooBigZips.length > 0)
        showToast(
          t("upload.zipTooBig", { files: tooBigZips.join(", ") }),
          "warning",
        );
      void startUpload(collectDicomFiles(expanded));
    })();
  });
  $("btn-upload-folder")?.addEventListener("click", async () => {
    if (await ensureAuthenticated()) folderInput.click();
  });

  initUploadDropZone();
  $("btn-refresh-studies")?.addEventListener("click", loadStudyExplorer);
  renderTransportNote();
  onLocaleChange(renderTransportNote);

  // Load the classification catalog when the Cargar tab opens; relabel on locale
  // change. Try once now in case the session is already active.
  $("tab-cargar")?.addEventListener("click", () => {
    void ensureClassificationOptions();
  });
  onLocaleChange(relabelClassificationOptions);
  void ensureClassificationOptions();
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
    const dropped = await droppedFiles(e.dataTransfer);
    const hasZip = dropped.some((f) => f.name.toLowerCase().endsWith(".zip"));
    if (hasZip) showUploadStatus(t("upload.unzippingGeneric"), "");
    const {
      files: expanded,
      corruptZips,
      tooBigZips,
    } = await expandFiles(dropped, null);
    if (hasZip) showUploadStatus("", "");
    // Use toasts for expansion errors so they survive the per-file upload status updates.
    if (corruptZips.length > 0)
      showToast(
        t("upload.zipReadError", { files: corruptZips.join(", ") }),
        "error",
      );
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
 * Files from a drop, walking into dropped folders. `dataTransfer.files` lists a
 * folder as one empty entry, so folders go through the entries API — which,
 * unlike <input webkitdirectory>, shows no browser "Upload N files?" prompt.
 * Plain files still come from getAsFile(): a file entry can be unreadable
 * (synthetic drags, some source apps) where getAsFile() works.
 * Items must be read synchronously, before the drop event returns.
 */
async function droppedFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  if (!dt.items) return Array.from(dt.files ?? []);
  const out: File[] = [];
  const dirs: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) dirs.push(entry);
    else {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  // An unreadable folder (permissions, vanished) is skipped, not fatal.
  for (const dir of dirs) await walkEntry(dir, out).catch(() => {});
  return out;
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    // Keep the folder path so collectDicomFiles groups series as it does for
    // a webkitdirectory selection.
    Object.defineProperty(file, "webkitRelativePath", {
      value: entry.fullPath.replace(/^\//, ""),
    });
    out.push(file);
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries hands back at most ~100 entries per call; read until empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return;
    for (const child of batch) await walkEntry(child, out);
  }
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
  if (!(await anonymizerReady())) {
    uploading = false;
    showUploadStatus(t("upload.anonymizerUnavailable"), "error");
    return;
  }
  if (!(await confirmClassification(files.length))) {
    uploading = false;
    return;
  }
  progress = {
    doneBytes: 0,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    startedAt: Date.now(),
  };
  duplicatePolicy = "ask";
  failures = [];
  renderTransportNote();
  showProgressPanel(files.length);
  setFinishEnabled(false);
  showUploadStatus(t("upload.startedStatus", { count: files.length }), "");

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      if (cancelled) break;
      const outcome = await uploadOne(files[i], i, files.length);
      if (outcome === "aborted") break;
      if (outcome === "ok") ok++;
      else if (outcome === "duplicate") duplicates++;
      else errors++;
      progress.doneBytes += files[i].size;
      renderProgress(progress.doneBytes);
    }
  } finally {
    uploading = false;
    activeXhr = null;
    setFinishEnabled(true);
  }

  if (cancelled) {
    finishProgressPanel("cancelled");
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
  finishProgressPanel(errors > 0 ? "errors" : "done");

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

/**
 * Anonymize a DICOM before it leaves the computer (US-16). The desktop build
 * can provide its own seam (window.api.anonymizeDicom); otherwise the raw
 * file goes only to the anonymization service on this machine
 * (local-anonymizer.ts). The backend stores what it receives and does not
 * anonymize, so this throws rather than ever handing back un-anonymized
 * bytes, and callers must not send the file when it does.
 */
async function anonymizeForUpload(file: File): Promise<File> {
  const anonBuffer = await anonymizeDicomBytes(
    await file.arrayBuffer(),
    file.name,
  );
  return new File([anonBuffer], file.name, { type: "application/dicom" });
}

/** Check the anonymizer before a queue starts, so a stopped service fails
 *  the whole batch up front with one clear message. */
async function anonymizerReady(): Promise<boolean> {
  return Boolean(window.api?.anonymizeDicom) || (await isAnonymizerAvailable());
}

function anonymizationErrorMessage(err: unknown, file: File): string {
  return err instanceof AnonymizerUnavailableError
    ? t("upload.anonymizerUnavailable")
    : t("upload.anonymizationFailed", { name: file.name });
}

async function uploadOne(
  file: File,
  index: number,
  total: number,
  force = false,
  isRetry = false,
): Promise<UploadOutcome> {
  const current = index + 1;
  let fileToSend: File;
  setPhase(t("upload.phaseAnonymizing", { current, total }));
  try {
    fileToSend = await anonymizeForUpload(file);
  } catch (err) {
    // Fail closed (US-16): a file we couldn't anonymize is never sent.
    console.error("Anonymization failed, upload cancelled:", err);
    addFailure(file, t("upload.stateNotAnonymized"));
    showUploadStatus(anonymizationErrorMessage(err, file), "error");
    return "error";
  }
  setPhase(t("upload.phaseUploading", { current, total }));

  return new Promise((resolve) => {
    const formData = new FormData();
    const classificationId = selectedClassificationId();
    if (classificationId)
      formData.append("classification_id", classificationId);
    formData.append("file", fileToSend);

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
      // Counts the file in flight, so the bar moves during one large file
      // instead of jumping only between files.
      renderProgress(progress.doneBytes + (e.loaded / e.total) * file.size);
    });

    xhr.addEventListener("abort", () => resolve("aborted"));

    xhr.addEventListener("error", () => {
      addFailure(file, t("upload.networkError"));
      showUploadStatus(t("upload.networkError"), "error");
      resolve("error");
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 201) {
        rememberUploadedStudy(xhr.responseText);
        // TK-11: stored, but the backend's PHI check may have flagged it for
        // review (warn mode, or a burned-in-annotation warning). Tell the user,
        // without blocking — the tag keywords are PHI-free.
        const tags = reviewTagNames(xhr.responseText);
        if (tags) showToast(t("upload.needsReview", { tags }), "warning");
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
            addFailure(file, t("upload.sessionExpiredRetry"));
            showUploadStatus(t("upload.sessionExpiredRetry"), "error");
            resolve("error");
            return;
          }
          resolve(await uploadOne(file, index, total, force, true));
        })();
        return;
      }

      if (xhr.status === 401) {
        addFailure(file, t("upload.unauthorizedRetry"));
        showUploadStatus(t("upload.unauthorizedRetry"), "error");
        resolve("error");
        return;
      }

      if (xhr.status === 409) {
        // A study's slices are usually all duplicates at once, so the first
        // answer applies to the rest of this batch instead of asking per file.
        const decide = async (replace: boolean): Promise<void> => {
          resolve(
            replace
              ? await uploadOne(file, index, total, true)
              : "duplicate",
          );
        };
        if (duplicatePolicy !== "ask") {
          void decide(duplicatePolicy === "replace");
          return;
        }
        showDuplicateDialog(
          file,
          safeMessage(xhr.responseText),
          total > 1,
          async (replace, cancelAll) => {
            if (cancelAll) {
              cancelled = true;
              resolve("aborted");
              return;
            }
            duplicatePolicy = replace ? "replace" : "skip";
            await decide(replace);
          },
        );
        return;
      }

      if (xhr.status === 413) {
        addFailure(file, t("upload.fileTooLarge"));
        showUploadStatus(t("upload.fileTooLarge"), "error");
      } else if (xhr.status === 422 && isNotAnonymized(xhr.responseText)) {
        // TK-11 strict mode: the backend refused to store a study that still
        // carries identifying tags, and tells us which (names only).
        addFailure(file, t("upload.stateNotAnonymized"));
        showUploadStatus(
          t("upload.notAnonymized", {
            tags: reviewTagNames(xhr.responseText) || "—",
          }),
          "error",
        );
      } else {
        const message =
          safeMessage(xhr.responseText) || t("upload.genericError");
        addFailure(file, message);
        showUploadStatus(message, "error");
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

/** True when a 422 body is the backend's "still has PHI" rejection (TK-11). */
function isNotAnonymized(responseText: string): boolean {
  try {
    return JSON.parse(responseText)?.error === "not_anonymized";
  } catch {
    return false;
  }
}

/**
 * The PHI-check finding keywords from an upload response — the 422 rejection
 * (`tags`) or the 201 review notice (`verification.findings`). Returns the
 * distinct tag names joined for display, or "" if there are none. These are
 * DICOM keywords, never the offending values.
 */
function reviewTagNames(responseText: string): string {
  try {
    const body = JSON.parse(responseText);
    const list = body?.tags ?? body?.verification?.findings ?? [];
    const names = Array.isArray(list)
      ? list.map((f: { name?: string }) => f?.name).filter(Boolean)
      : [];
    return [...new Set(names)].join(", ");
  } catch {
    return "";
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function showProgressPanel(fileCount: number): void {
  $("upload-progress").classList.remove("hidden");
  $("upload-progress").classList.remove(
    "upload-progress--done",
    "upload-progress--error",
  );
  $("upload-progress-title").textContent =
    fileCount === 1
      ? t("upload.progressTitleOne")
      : t("upload.progressTitleMany", { count: fileCount });
  $("upload-errors").classList.add("hidden");
  $("upload-error-list").innerHTML = "";
  setPhase("");
  renderProgress(0);
}

function setPhase(text: string): void {
  $("upload-phase").textContent = text;
}

/** Repaints bar, percentage, bytes and the time-left estimate. */
function renderProgress(doneBytes: number): void {
  const { totalBytes, startedAt } = progress;
  const fraction = totalBytes > 0 ? Math.min(1, doneBytes / totalBytes) : 0;
  const pct = Math.round(fraction * 100);
  $("upload-bar").style.width = `${pct}%`;
  $("upload-track").setAttribute("aria-valuenow", String(pct));
  $("upload-percent").textContent = `${pct}%`;

  const bytes = t("upload.bytesProgress", {
    done: formatBytes(doneBytes),
    total: formatBytes(totalBytes),
  });
  const eta = estimateRemaining(fraction, Date.now() - startedAt);
  $("upload-bytes").textContent = eta ? `${bytes} · ${eta}` : bytes;
}

/**
 * Remaining-time estimate from the average rate so far. Hidden for the first
 * few seconds and first few percent, where a rate would be mostly noise.
 */
export function estimateRemaining(
  fraction: number,
  elapsedMs: number,
): string {
  if (fraction < 0.02 || fraction >= 1 || elapsedMs < 3000) return "";
  const remainingMs = (elapsedMs * (1 - fraction)) / fraction;
  const minutes = Math.round(remainingMs / 60000);
  return minutes < 1
    ? t("upload.etaUnderMinute")
    : t("upload.etaMinutes", { minutes });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function addFailure(file: File, reason: string): void {
  failures.push({ name: file.name, reason });
  $("upload-errors").classList.remove("hidden");
  $("upload-errors-summary").textContent = t("upload.errorsSummary", {
    count: failures.length,
  });
  const li = document.createElement("li");
  li.innerHTML = `<span class="upload-errors__name">${escapeHtml(file.name)}</span> <span class="upload-errors__reason">${escapeHtml(reason)}</span>`;
  $("upload-error-list").appendChild(li);
}

function finishProgressPanel(result: "done" | "errors" | "cancelled"): void {
  const panel = $("upload-progress");
  panel.classList.toggle("upload-progress--done", result === "done");
  panel.classList.toggle("upload-progress--error", result !== "done");
  $("upload-progress-title").textContent =
    result === "done"
      ? t("upload.progressDone")
      : result === "errors"
        ? t("upload.progressDoneWithErrors")
        : t("upload.progressCancelled");
  setPhase("");
  if (result !== "cancelled") renderProgress(progress.totalBytes);
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
  if (!(await anonymizerReady())) {
    uploading = false;
    showToast(t("upload.anonymizerUnavailable"), "error");
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

async function uploadOneExplorer(
  file: File,
  isRetry = false,
): Promise<UploadOutcome> {
  let fileToSend: File;
  try {
    fileToSend = await anonymizeForUpload(file);
  } catch (err) {
    console.error("Anonymization failed, upload cancelled:", err);
    showToast(anonymizationErrorMessage(err, file), "error");
    return "error";
  }

  return new Promise((resolve) => {
    const formData = new FormData();
    formData.append("file", fileToSend);

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
        showToast(
          t("upload.duplicateOnServer", { name: file.name }),
          "warning",
        );
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

// ── Classify-before-upload confirmation ─────────────────────────────────────

/**
 * Asks for the study's category once files are chosen, and resolves true only
 * on "Subir". Cancel, Escape and closing all resolve false — nothing is sent.
 * Without the dialog in the page (the Buscar quick-drop shell, tests) it
 * resolves true straight away.
 */
async function confirmClassification(count: number): Promise<boolean> {
  const dialog = document.getElementById("classify-dialog");
  if (!dialog) return true;
  await ensureClassificationOptions();
  // Start blank per study so the last study's category never carries over unseen.
  const sel = classificationSelect();
  if (sel) sel.value = "";
  $("classify-msg").textContent = t("upload.classifyMessage", { count });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(ok);
    };
    ($("classify-confirm") as HTMLButtonElement).onclick = () => finish(true);
    ($("classify-cancel") as HTMLButtonElement).onclick = () => finish(false);
    dialog.addEventListener("dialog:close", () => finish(false), {
      once: true,
    });
    openDialog(dialog);
  });
}

// ── Duplicate confirmation ───────────────────────────────────────────────────

function showDuplicateDialog(
  file: File,
  message: string,
  appliesToAll: boolean,
  done: (replace: boolean, cancelAll?: boolean) => void,
): void {
  const dialog = $("duplicate-dialog");
  const base = message || t("upload.duplicateMessage", { name: file.name });
  $("duplicate-msg").textContent = appliesToAll
    ? `${base} ${t("upload.duplicateAppliesToAll")}`
    : base;

  let settled = false;
  const finish = (replace: boolean, cancelAll = false): void => {
    if (settled) return;
    settled = true;
    closeDialog(dialog);
    done(replace, cancelAll);
  };

  ($("duplicate-yes") as HTMLButtonElement).onclick = () => finish(true);
  ($("duplicate-no") as HTMLButtonElement).onclick = () => finish(false);
  const cancelAllBtn = document.getElementById(
    "duplicate-cancel-all",
  ) as HTMLButtonElement | null;
  if (cancelAllBtn) cancelAllBtn.onclick = () => finish(false, true);
  // Escape closes without replacing — the safe outcome for a destructive
  // confirmation, and the queue must not stall waiting on a promise.
  dialog.addEventListener("dialog:close", () => finish(false), { once: true });

  openDialog(dialog);
}

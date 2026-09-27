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
import { anonymizeDicomBuffer } from "../utils/dicom-anonymizer.js";

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
  if (!(await confirmClassification(files.length))) {
    uploading = false;
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

/**
 * Anonymize a DICOM before it leaves the client, so PHI never touches the
 * network. On the desktop build the real Python anonymizer runs in the main
 * process (window.api.anonymizeDicom); the browser has no Python, so it falls
 * back to the in-browser JS scrubber. Either way the backend stores what it
 * receives and does not anonymize.
 */
async function anonymizeForUpload(file: File): Promise<File> {
  const rawBuffer = await file.arrayBuffer();
  const anonBuffer = window.api?.anonymizeDicom
    ? await window.api.anonymizeDicom(rawBuffer)
    : anonymizeDicomBuffer(rawBuffer);
  return new File([anonBuffer], file.name, { type: file.type });
}

async function uploadOne(
  file: File,
  row: UploadRow,
  force = false,
  isRetry = false,
): Promise<UploadOutcome> {
  const fileToSend = await anonymizeForUpload(file);

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
          async (replace, cancelAll) => {
            if (cancelAll) {
              cancelled = true;
              setRowState(row, "aborted");
              resolve("aborted");
              return;
            }
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

async function uploadOneExplorer(
  file: File,
  isRetry = false,
): Promise<UploadOutcome> {
  const fileToSend = await anonymizeForUpload(file);

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
  done: (replace: boolean, cancelAll?: boolean) => void,
): void {
  const dialog = $("duplicate-dialog");
  $("duplicate-msg").textContent =
    message || t("upload.duplicateMessage", { name: file.name });

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

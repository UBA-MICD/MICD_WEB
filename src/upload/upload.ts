import {
  ensureAuthenticated,
  getAccessToken,
  refreshAccessToken,
  getCurrentUser,
  API_BASE,
} from "../auth/auth.js";
import { collectDicomFiles } from "../shared/folder-files.js";
import { $, escapeHtml } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { loadStudyExplorer } from "../explorer/explorer.js";

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

// ── Init ─────────────────────────────────────────────────────────────────────

export function initUploadPanel(): void {
  const input = $("upload-input") as HTMLInputElement;
  input.setAttribute("multiple", "");
  input.addEventListener("change", () => {
    const files = collectDicomFiles(Array.from(input.files ?? []));
    input.value = "";
    void startUpload(files);
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
}

/** Drag-and-drop onto the Cargar tab's drop area. */
function initUploadDropZone(): void {
  const zone = $("upload-drop");

  zone.addEventListener("dragenter", () => zone.classList.add("drag-over"));
  zone.addEventListener("dragleave", (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !zone.contains(related)) zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", async (e: DragEvent) => {
    zone.classList.remove("drag-over");
    const files = collectDicomFiles(Array.from(e.dataTransfer?.files ?? []));
    if (files.length === 0) {
      showUploadStatus("No se encontraron archivos DICOM.", "error");
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
  const owner = email ? ` · asociado a ${email}` : "";
  $("upload-note").textContent =
    window.location.protocol === "https:"
      ? `Transmisión cifrada (HTTPS)${owner}`
      : `Conexión sin cifrar (HTTP) — solo para uso local${owner}`;
}

// ── Queue ────────────────────────────────────────────────────────────────────

async function startUpload(files: File[]): Promise<void> {
  if (uploading) return;
  if (files.length === 0) {
    showUploadStatus("No se encontraron archivos DICOM.", "error");
    return;
  }
  if (!(await ensureAuthenticated())) {
    showUploadStatus("Necesitás iniciar sesión para subir estudios.", "error");
    return;
  }

  uploading = true;
  cancelled = false;
  queue = { done: 0, total: files.length };
  renderTransportNote();
  const rows = renderRows(files);
  setFinishEnabled(false);
  setAggregatePercent(0);

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    if (cancelled) break;
    // Only the file count is announced; the percentage lives in an
    // aria-hidden span so progress doesn't spam the screen reader.
    showUploadStatus(`Subiendo ${i + 1} de ${files.length} archivos`, "");
    const outcome = await uploadOne(files[i], rows[i]);
    if (outcome === "aborted") break;
    if (outcome === "ok") ok++;
    else if (outcome === "duplicate") duplicates++;
    else errors++;
    queue.done = i + 1;
    setAggregatePercent((queue.done / queue.total) * 100);
  }

  uploading = false;
  activeXhr = null;
  setFinishEnabled(true);

  if (cancelled) {
    showUploadStatus("Carga cancelada.", "error");
    return;
  }

  const parts = [`${ok} de ${files.length} subidos`];
  if (duplicates > 0) parts.push(`${duplicates} ya existían (omitidos)`);
  if (errors > 0) parts.push(`${errors} errores`);
  showUploadStatus(parts.join(" · "), errors > 0 ? "error" : "ok");
  setAggregatePercent(100);

  void loadStudyExplorer();
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
      showUploadStatus("Error de red al conectar con el servidor.", "error");
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
            showUploadStatus(
              "Sesión expirada. Iniciá sesión para subir estudios.",
              "error",
            );
            resolve("error");
            return;
          }
          resolve(await uploadOne(file, row, force, true));
        })();
        return;
      }

      if (xhr.status === 401) {
        setRowState(row, "error");
        showUploadStatus("No autorizado. Iniciá sesión de nuevo.", "error");
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
        showUploadStatus("El archivo supera el límite de 500 MB.", "error");
      } else {
        showUploadStatus(
          safeMessage(xhr.responseText) || "Error al cargar el archivo.",
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
    if (typeof id === "string" && id) uploadedStudyIds.push(id);
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
              aria-label="Progreso de ${escapeHtml(f.name)}"
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
  if (state === "duplicate") row.pct.textContent = "Duplicado";
  else if (state === "error") row.pct.textContent = "Error";
  else if (state === "aborted") row.pct.textContent = "Cancelado";
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

// ── Duplicate confirmation ───────────────────────────────────────────────────

function showDuplicateDialog(
  file: File,
  message: string,
  done: (replace: boolean) => void,
): void {
  const dialog = $("duplicate-dialog");
  $("duplicate-msg").textContent =
    message || `El estudio de ${file.name} ya existe en el servidor.`;

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

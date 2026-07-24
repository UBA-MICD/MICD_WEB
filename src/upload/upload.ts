import {
  authFetch,
  ensureAuthenticated,
  getAccessToken,
  refreshAccessToken,
  API_BASE,
} from "../auth/auth.js";
import { collectDicomFiles } from "../shared/folder-files.js";
import { $ } from "../shared/dom.js";
import { openDialog, closeDialog } from "../shared/dialog.js";
import { loadStudyExplorer } from "../explorer/explorer.js";

// ── Upload Panel ─────────────────────────────────────────────────────────────

export function initUploadPanel(): void {
  // Single file upload
  const input = $("upload-input") as HTMLInputElement;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void uploadFile(file);
    input.value = "";
  });
  $("btn-upload-server")?.addEventListener("click", async () => {
    if (await ensureAuthenticated()) input.click();
  });

  // Folder upload
  const folderInput = $("upload-folder-input") as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("multiple", "");
  folderInput.addEventListener("change", async () => {
    const files = collectDicomFiles(Array.from(folderInput.files ?? []));
    if (files.length === 0) {
      showUploadStatus(
        "No se encontraron archivos DICOM en la carpeta.",
        "error",
      );
      return;
    }
    await uploadFolderFiles(files);
    folderInput.value = "";
  });
  $("btn-upload-folder")?.addEventListener("click", async () => {
    if (await ensureAuthenticated()) folderInput.click();
  });

  $("btn-refresh-studies")?.addEventListener("click", loadStudyExplorer);
}

/**
 * Moves the progress bar. The width alone is invisible to assistive tech, so
 * aria-valuenow on the role="progressbar" wrapper has to move with it.
 */
function setUploadProgress(percent: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  $("upload-progress-bar").style.width = `${clamped}%`;
  $("upload-progress-wrap").setAttribute("aria-valuenow", String(clamped));
}

async function uploadFile(
  file: File,
  force = false,
  isRetry = false,
): Promise<void> {
  // Uploads never leave the browser without a valid session.
  if (!(await ensureAuthenticated())) {
    showUploadStatus("Necesitás iniciar sesión para subir estudios.", "error");
    return;
  }

  const progressWrap = $("upload-progress-wrap");

  progressWrap.classList.remove("hidden");
  setUploadProgress(0);
  showUploadStatus("", "");

  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const url = `${API_BASE}/v1/studies/upload${force ? "?force=true" : ""}`;
    xhr.open("POST", url);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setUploadProgress((e.loaded / e.total) * 100);
      }
    });

    xhr.addEventListener("load", () => {
      progressWrap.classList.add("hidden");

      if (xhr.status === 201) {
        showUploadStatus("Estudio cargado correctamente.", "ok");
        loadStudyExplorer();
      } else if (xhr.status === 401 && !isRetry) {
        // Access token expired mid-session: refresh first (the in-memory token
        // is stale, so ensureAuthenticated alone would short-circuit on it),
        // fall back to the login popup, then retry the upload once.
        void (async () => {
          const ok =
            (await refreshAccessToken()) || (await ensureAuthenticated());
          if (ok) {
            await uploadFile(file, force, true);
          } else {
            showUploadStatus(
              "Sesión expirada. Iniciá sesión para subir estudios.",
              "error",
            );
          }
          resolve();
        })();
        return;
      } else if (xhr.status === 401) {
        showUploadStatus("No autorizado. Iniciá sesión de nuevo.", "error");
      } else if (xhr.status === 409) {
        const body = JSON.parse(xhr.responseText);
        showDuplicateDialog(file, body.message);
      } else if (xhr.status === 413) {
        showUploadStatus("El archivo supera el límite de 500 MB.", "error");
      } else {
        const body = JSON.parse(xhr.responseText ?? "{}");
        showUploadStatus(body.error ?? "Error al cargar el archivo.", "error");
      }
      resolve();
    });

    xhr.addEventListener("error", () => {
      progressWrap.classList.add("hidden");
      showUploadStatus("Error de red al conectar con el servidor.", "error");
      resolve();
    });

    xhr.send(formData);
  });
}

async function uploadFileSilent(
  file: File,
): Promise<"ok" | "duplicate" | "error"> {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await authFetch(`${API_BASE}/v1/studies/upload`, {
      method: "POST",
      body: formData,
    });
    if (res.status === 201) return "ok";
    if (res.status === 409) return "duplicate";
    return "error";
  } catch {
    return "error";
  }
}

async function uploadFolderFiles(files: File[]): Promise<void> {
  const progressWrap = $("upload-progress-wrap");
  progressWrap.classList.remove("hidden");
  setUploadProgress(0);

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    showUploadStatus(
      `Subiendo ${i + 1} de ${files.length}: ${files[i].name}`,
      "",
    );
    setUploadProgress((i / files.length) * 100);

    const result = await uploadFileSilent(files[i]);
    if (result === "ok") ok++;
    else if (result === "duplicate") duplicates++;
    else errors++;
  }

  setUploadProgress(100);
  progressWrap.classList.add("hidden");

  const parts = [`${ok} de ${files.length} subidos`];
  if (duplicates > 0) parts.push(`${duplicates} ya existían (omitidos)`);
  if (errors > 0) parts.push(`${errors} errores`);

  showUploadStatus(parts.join(" · "), errors > 0 ? "error" : "ok");
  loadStudyExplorer();
}

function showUploadStatus(text: string, type: "" | "ok" | "error"): void {
  const el = $("upload-status");
  el.textContent = text;
  el.className = type
    ? `upload-status upload-status--${type}`
    : "upload-status";
}

function showDuplicateDialog(file: File, message: string): void {
  const dialog = $("duplicate-dialog");
  const btnYes = $("duplicate-yes");
  const btnNo = $("duplicate-no");

  $("duplicate-msg").textContent = message;

  // openDialog traps focus, inerts the background and handles Escape; Escape
  // and "Cancelar" both mean "don't replace", which is the safe default for a
  // destructive confirmation.
  btnYes.onclick = async () => {
    closeDialog(dialog);
    await uploadFile(file, true);
  };
  btnNo.onclick = () => closeDialog(dialog);

  openDialog(dialog);
}

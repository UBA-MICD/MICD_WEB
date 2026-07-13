import { ensureAuthenticated } from "./auth.js";
import {
  getConfigStatus,
  storeToken,
  deleteToken,
  searchRecords,
  getRecord,
  importFiles,
  getQuota,
  getSyncConfig,
  setSyncInterval,
  triggerSync,
  getSyncLogs,
  publishStudy,
} from "./zenodo.js";
import type {
  ZenodoRecord,
  ZenodoFile,
  ZenodoApiError,
  SyncConfig,
} from "./zenodo.js";

// ── State ─────────────────────────────────────────────────────────────────────

const searchState = {
  q: "",
  environment: "sandbox" as "sandbox" | "production",
  page: 1,
  totalPages: 1,
  total: 0,
  file_type: "",
  date_from: "",
  date_to: "",
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ── Modal open / close ────────────────────────────────────────────────────────

export function openZenodoModal(): void {
  $("zenodo-modal").classList.remove("hidden");
  switchTab("search");
}

function closeZenodoModal(): void {
  $("zenodo-modal").classList.add("hidden");
}

function switchTab(tab: "search" | "config"): void {
  ["search", "config"].forEach((t) => {
    $(`zenodo-tab-${t}`).classList.toggle("zenodo-tab--active", t === tab);
    $(`zenodo-content-${t}`).classList.toggle("hidden", t !== tab);
  });
  if (tab === "config") void loadConfigTab();
}

// ── Search tab ────────────────────────────────────────────────────────────────

async function runSearch(): Promise<void> {
  if (!(await ensureAuthenticated())) return;

  const resultsEl = $("zenodo-search-results");
  resultsEl.innerHTML =
    '<p class="zenodo-loading">Buscando en Zenodo…</p>';

  try {
    const data = await searchRecords({
      q: searchState.q,
      environment: searchState.environment,
      page: searchState.page,
      size: 10,
      file_type: searchState.file_type || undefined,
      date_from: searchState.date_from || undefined,
      date_to: searchState.date_to || undefined,
    });

    searchState.total = data.total;
    searchState.totalPages = Math.max(1, Math.ceil(data.total / 10));
    updateSearchPagination();

    if (data.records.length === 0) {
      resultsEl.innerHTML =
        '<p class="zenodo-empty">No se encontraron registros.</p>';
      return;
    }

    resultsEl.innerHTML = data.records
      .map((r) => renderRecordCard(r))
      .join("");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    resultsEl.innerHTML = `<p class="zenodo-error">Error al buscar: ${escapeHtml(msg)}</p>`;
  }
}

function renderRecordCard(r: ZenodoRecord): string {
  const dcmFiles = r.files.filter((f) => f.key.toLowerCase().endsWith(".dcm"));
  const fileCount = r.files.length;
  const dcmCount = dcmFiles.length;
  const date = r.created ? r.created.slice(0, 10) : "—";
  const importable = r.importable && dcmCount > 0;

  return `
    <div class="zenodo-record-card" data-record-id="${r.id}">
      <div class="zenodo-record-card__header">
        <span class="zenodo-record-card__title">${escapeHtml(r.title || "Sin título")}</span>
        <span class="zenodo-record-card__date">${date}</span>
      </div>
      <div class="zenodo-record-card__meta">
        <span class="zenodo-badge">${escapeHtml(r.doi || "—")}</span>
        <span>${fileCount} archivo${fileCount !== 1 ? "s" : ""}</span>
        ${dcmCount > 0 ? `<span class="zenodo-badge zenodo-badge--dcm">${dcmCount} .dcm</span>` : ""}
      </div>
      ${
        importable
          ? `<button class="btn btn--accent btn--sm zenodo-import-btn" data-record-id="${r.id}">
               Importar archivos DICOM
             </button>`
          : `<span class="zenodo-record-card__no-import">Sin archivos DICOM importables</span>`
      }
    </div>`;
}

function updateSearchPagination(): void {
  const info = $("zenodo-search-pagination-info");
  const btnPrev = $("zenodo-search-prev") as HTMLButtonElement;
  const btnNext = $("zenodo-search-next") as HTMLButtonElement;
  info.textContent =
    searchState.total > 0
      ? `${searchState.page} / ${searchState.totalPages} (${searchState.total} total)`
      : "—";
  btnPrev.disabled = searchState.page <= 1;
  btnNext.disabled = searchState.page >= searchState.totalPages;
}

// ── Import dialog ─────────────────────────────────────────────────────────────

async function openImportDialog(recordId: number): Promise<void> {
  if (!(await ensureAuthenticated())) return;

  const dialog = $("zenodo-import-dialog");
  const bodyEl = $("zenodo-import-dialog-body");
  bodyEl.innerHTML = '<p class="zenodo-loading">Cargando archivos del registro…</p>';
  dialog.classList.remove("hidden");

  try {
    const data = await getRecord(recordId, searchState.environment);
    const dcmFiles = data.files.filter((f) =>
      f.key.toLowerCase().endsWith(".dcm"),
    );

    if (dcmFiles.length === 0) {
      bodyEl.innerHTML =
        '<p class="zenodo-empty">Este registro no contiene archivos .dcm importables.</p>';
      return;
    }

    bodyEl.innerHTML = `
      <p class="zenodo-import-intro">Seleccioná los archivos DICOM a importar desde el registro <strong>${escapeHtml(String(recordId))}</strong>:</p>
      <div class="zenodo-file-list">
        ${dcmFiles
          .map(
            (f) => `
          <label class="zenodo-file-row">
            <input type="checkbox" class="zenodo-file-check" data-key="${escapeHtml(f.key)}" data-size="${f.size ?? 0}" checked />
            <span class="zenodo-file-name">${escapeHtml(f.key)}</span>
            <span class="zenodo-file-size">${formatBytes(f.size ?? 0)}</span>
          </label>`,
          )
          .join("")}
      </div>
      <label class="zenodo-overwrite-row">
        <input type="checkbox" id="zenodo-import-overwrite" />
        <span>Reemplazar duplicados</span>
      </label>
      <div id="zenodo-import-result" class="zenodo-import-result hidden"></div>
      <div class="dialog__actions" style="margin-top:16px">
        <button class="btn btn--secondary" id="zenodo-import-cancel">Cancelar</button>
        <button class="btn btn--accent" id="zenodo-import-confirm" data-record-id="${recordId}">Importar</button>
      </div>`;

    $("zenodo-import-cancel").addEventListener("click", () =>
      dialog.classList.add("hidden"),
    );

    $("zenodo-import-confirm").addEventListener("click", async () => {
      const checked = Array.from(
        bodyEl.querySelectorAll<HTMLInputElement>(
          ".zenodo-file-check:checked",
        ),
      );
      if (checked.length === 0) return;

      const files = checked.map((el) => ({
        fileKey: el.dataset.key!,
        fileSize: Number(el.dataset.size) || undefined,
      }));
      const overwrite = (
        $("zenodo-import-overwrite") as HTMLInputElement
      ).checked;

      const btn = $("zenodo-import-confirm") as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Importando…";

      const resultEl = $("zenodo-import-result");
      resultEl.className = "zenodo-import-result";

      try {
        const res = await importFiles({
          record_id: recordId,
          environment: searchState.environment,
          files,
          overwrite_duplicates: overwrite,
        });
        resultEl.className = "zenodo-import-result zenodo-import-result--ok";
        resultEl.textContent = `Importados: ${res.imported} · Duplicados: ${res.duplicates} · Fallidos: ${res.failed}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error";
        resultEl.className = "zenodo-import-result zenodo-import-result--error";
        resultEl.textContent = `Error: ${msg}`;
      } finally {
        btn.disabled = false;
        btn.textContent = "Importar";
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    bodyEl.innerHTML = `<p class="zenodo-error">Error al cargar el registro: ${escapeHtml(msg)}</p>`;
  }
}

// ── Config tab ────────────────────────────────────────────────────────────────

async function loadConfigTab(): Promise<void> {
  if (!(await ensureAuthenticated())) return;

  const el = $("zenodo-content-config");
  el.innerHTML = '<p class="zenodo-loading">Cargando configuración…</p>';

  try {
    const [status, quotaSandbox, quotaProd, syncCfg] = await Promise.allSettled(
      [
        getConfigStatus(),
        getQuota("sandbox"),
        getQuota("production"),
        getSyncConfig(),
      ],
    );

    const cfg =
      status.status === "fulfilled" ? status.value : { sandbox: { configured: false, status: "unconfigured" as const }, production: { configured: false, status: "unconfigured" as const } };
    const qs =
      quotaSandbox.status === "fulfilled" ? quotaSandbox.value : null;
    const qp =
      quotaProd.status === "fulfilled" ? quotaProd.value : null;
    const sync = syncCfg.status === "fulfilled" ? syncCfg.value : null;

    el.innerHTML = `
      <div class="zenodo-config-sections">

        <!-- Credentials -->
        <section class="zenodo-config-section">
          <h4 class="zenodo-config-section__title">Credenciales</h4>

          ${renderTokenForm("sandbox", cfg.sandbox, qs)}
          ${renderTokenForm("production", cfg.production, qp)}
        </section>

        <!-- Sync -->
        <section class="zenodo-config-section">
          <h4 class="zenodo-config-section__title">Sincronización de metadatos</h4>
          ${sync ? renderSyncSection(sync) : '<p class="zenodo-error">No se pudo cargar la configuración de sync.</p>'}
        </section>

      </div>`;

    wireConfigHandlers();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    el.innerHTML = `<p class="zenodo-error">Error al cargar configuración: ${escapeHtml(msg)}</p>`;
  }
}

function statusBadge(s: { configured: boolean; status: string }): string {
  const cls =
    s.status === "connected"
      ? "zenodo-badge--ok"
      : s.status === "error"
        ? "zenodo-badge--error"
        : "zenodo-badge--off";
  const label =
    s.status === "connected"
      ? "Conectado"
      : s.status === "error"
        ? "Error"
        : "No configurado";
  return `<span class="zenodo-badge ${cls}">${label}</span>`;
}

function renderTokenForm(
  env: "sandbox" | "production",
  envStatus: { configured: boolean; status: string; hint?: string },
  quota: Awaited<ReturnType<typeof getQuota>> | null,
): string {
  const label = env === "sandbox" ? "Sandbox" : "Producción";
  const quotaHtml = quota
    ? `<div class="zenodo-quota">
         <div class="zenodo-quota__bar-wrap">
           <div class="zenodo-quota__bar" style="width:${Math.min(100, quota.percent_used).toFixed(1)}%;${quota.alert ? "background:var(--danger);" : ""}"></div>
         </div>
         <span class="zenodo-quota__label">${formatBytes(quota.used_bytes)} / ${formatBytes(quota.limit_bytes)} (${quota.percent_used.toFixed(1)}%)</span>
       </div>`
    : "";

  return `
    <div class="zenodo-env-block" data-env="${env}">
      <div class="zenodo-env-block__header">
        <span class="zenodo-env-label">${label}</span>
        ${statusBadge(envStatus)}
        ${envStatus.hint ? `<span class="zenodo-env-hint">…${escapeHtml(envStatus.hint)}</span>` : ""}
      </div>
      ${quotaHtml}
      <div class="zenodo-token-row">
        <input
          type="password"
          class="zenodo-token-input"
          id="zenodo-token-${env}"
          placeholder="Token de API de Zenodo"
          autocomplete="off"
        />
        <button class="btn btn--accent btn--sm" id="zenodo-save-token-${env}">Guardar</button>
        ${envStatus.configured ? `<button class="btn btn--danger btn--sm" id="zenodo-delete-token-${env}">Eliminar</button>` : ""}
      </div>
      <div id="zenodo-token-msg-${env}" class="zenodo-token-msg hidden"></div>
    </div>`;
}

function renderSyncSection(sync: SyncConfig): string {
  const intervalOpts = [
    ...sync.valid_intervals.map(
      (h) =>
        `<option value="${h}" ${sync.interval_hours === h ? "selected" : ""}>${h === 168 ? "Semanal" : `Cada ${h}h`}</option>`,
    ),
    `<option value="" ${sync.interval_hours === null ? "selected" : ""}>Desactivado</option>`,
  ].join("");

  const lastRun = sync.last_run_at
    ? new Date(sync.last_run_at).toLocaleString()
    : "Nunca";

  return `
    <div class="zenodo-sync-row">
      <label class="zenodo-sync-label">Intervalo</label>
      <select id="zenodo-sync-interval" class="zenodo-select">${intervalOpts}</select>
      <button class="btn btn--secondary btn--sm" id="zenodo-sync-save">Guardar</button>
    </div>
    <div class="zenodo-sync-info">
      Última ejecución: <strong>${lastRun}</strong>
    </div>
    <div style="margin-top:10px">
      <button class="btn btn--secondary btn--sm" id="zenodo-sync-run">Ejecutar ahora</button>
    </div>
    <div id="zenodo-sync-msg" class="zenodo-token-msg hidden"></div>`;
}

function wireConfigHandlers(): void {
  (["sandbox", "production"] as const).forEach((env) => {
    const saveBtn = document.getElementById(`zenodo-save-token-${env}`);
    const deleteBtn = document.getElementById(`zenodo-delete-token-${env}`);

    saveBtn?.addEventListener("click", async () => {
      const input = $(`zenodo-token-${env}`) as HTMLInputElement;
      const token = input.value.trim();
      if (!token) return;
      saveBtn.setAttribute("disabled", "");
      const msgEl = $(`zenodo-token-msg-${env}`);
      try {
        await storeToken(env, token);
        input.value = "";
        msgEl.textContent = "Token guardado correctamente.";
        msgEl.className = "zenodo-token-msg zenodo-token-msg--ok";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error";
        msgEl.textContent = `Error: ${msg}`;
        msgEl.className = "zenodo-token-msg zenodo-token-msg--error";
      } finally {
        msgEl.classList.remove("hidden");
        saveBtn.removeAttribute("disabled");
      }
    });

    deleteBtn?.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar el token de ${env}?`)) return;
      deleteBtn.setAttribute("disabled", "");
      const msgEl = $(`zenodo-token-msg-${env}`);
      try {
        await deleteToken(env);
        msgEl.textContent = "Token eliminado.";
        msgEl.className = "zenodo-token-msg zenodo-token-msg--ok";
        void loadConfigTab();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error";
        msgEl.textContent = `Error: ${msg}`;
        msgEl.className = "zenodo-token-msg zenodo-token-msg--error";
      } finally {
        msgEl.classList.remove("hidden");
        deleteBtn.removeAttribute("disabled");
      }
    });
  });

  document.getElementById("zenodo-sync-save")?.addEventListener("click", async () => {
    const sel = $("zenodo-sync-interval") as HTMLSelectElement;
    const val = sel.value === "" ? null : Number(sel.value);
    const btn = $("zenodo-sync-save") as HTMLButtonElement;
    const msgEl = $("zenodo-sync-msg");
    btn.disabled = true;
    try {
      await setSyncInterval(val);
      msgEl.textContent = "Intervalo actualizado.";
      msgEl.className = "zenodo-token-msg zenodo-token-msg--ok";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      msgEl.textContent = `Error: ${msg}`;
      msgEl.className = "zenodo-token-msg zenodo-token-msg--error";
    } finally {
      msgEl.classList.remove("hidden");
      btn.disabled = false;
    }
  });

  document.getElementById("zenodo-sync-run")?.addEventListener("click", async () => {
    const btn = $("zenodo-sync-run") as HTMLButtonElement;
    const msgEl = $("zenodo-sync-msg");
    btn.disabled = true;
    btn.textContent = "Ejecutando…";
    try {
      const res = await triggerSync();
      msgEl.textContent = `Sync completado: ${res.records_checked} registros revisados, ${res.new_versions} versiones nuevas, ${res.errors} errores.`;
      msgEl.className = "zenodo-token-msg zenodo-token-msg--ok";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      msgEl.textContent = `Error: ${msg}`;
      msgEl.className = "zenodo-token-msg zenodo-token-msg--error";
    } finally {
      msgEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Ejecutar ahora";
    }
  });
}

// ── Publish dialog ────────────────────────────────────────────────────────────

export function openPublishDialog(orthancStudyId: string, studyLabel: string): void {
  const dialog = $("zenodo-publish-dialog");
  ($("zenodo-publish-study-id") as HTMLInputElement).value = orthancStudyId;
  $("zenodo-publish-study-label").textContent = studyLabel;
  ($("zenodo-publish-form") as HTMLFormElement).reset();
  ($("zenodo-publish-study-id") as HTMLInputElement).value = orthancStudyId;
  $("zenodo-publish-result").className = "zenodo-import-result hidden";
  $("zenodo-publish-result").textContent = "";
  dialog.classList.remove("hidden");
}

async function handlePublishSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const btn = $("zenodo-publish-submit") as HTMLButtonElement;
  const resultEl = $("zenodo-publish-result");

  const orthancStudyId = ($("zenodo-publish-study-id") as HTMLInputElement).value;
  const environment = ($("zenodo-publish-env") as HTMLSelectElement).value as "sandbox" | "production";
  const title = ($("zenodo-publish-title") as HTMLInputElement).value.trim();
  const description = ($("zenodo-publish-desc") as HTMLTextAreaElement).value.trim();
  const authorName = ($("zenodo-publish-author") as HTMLInputElement).value.trim();
  const authorAff = ($("zenodo-publish-affiliation") as HTMLInputElement).value.trim();
  const authorOrcid = ($("zenodo-publish-orcid") as HTMLInputElement).value.trim();
  const keywordsRaw = ($("zenodo-publish-keywords") as HTMLInputElement).value.trim();
  const license = ($("zenodo-publish-license") as HTMLSelectElement).value;

  const keywords = keywordsRaw
    ? keywordsRaw.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined;

  const authors = [
    {
      name: authorName,
      ...(authorAff ? { affiliation: authorAff } : {}),
      ...(authorOrcid ? { orcid: authorOrcid } : {}),
    },
  ];

  btn.disabled = true;
  btn.textContent = "Publicando…";
  resultEl.className = "zenodo-import-result hidden";

  try {
    const res = await publishStudy({
      orthanc_study_id: orthancStudyId,
      environment,
      title,
      description,
      authors,
      license: license || undefined,
      keywords,
    });
    resultEl.className = "zenodo-import-result zenodo-import-result--ok";
    resultEl.innerHTML = `
      Publicado correctamente.<br>
      DOI: <strong>${escapeHtml(res.doi)}</strong><br>
      Archivos subidos: ${res.files_uploaded} (${formatBytes(res.total_bytes)})`;
    btn.textContent = "Publicar";
    btn.disabled = false;
  } catch (err: unknown) {
    const zenErr = err as ZenodoApiError;
    const msg = zenErr.message || "Error";
    const code = zenErr.code ? ` [${zenErr.code}]` : "";
    resultEl.className = "zenodo-import-result zenodo-import-result--error";
    resultEl.textContent = `Error: ${msg}${code}`;
    btn.disabled = false;
    btn.textContent = "Publicar";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initZenodo(): void {
  // Open modal button
  $("btn-zenodo").addEventListener("click", () => {
    void openZenodoModal();
  });

  // Close modal
  $("zenodo-modal-close").addEventListener("click", closeZenodoModal);
  $("zenodo-modal").addEventListener("click", (e) => {
    if (e.target === $("zenodo-modal")) closeZenodoModal();
  });

  // Tabs
  $("zenodo-tab-search").addEventListener("click", () => switchTab("search"));
  $("zenodo-tab-config").addEventListener("click", () => switchTab("config"));

  // Search form
  $("zenodo-search-btn").addEventListener("click", () => {
    searchState.q = ($("zenodo-search-input") as HTMLInputElement).value.trim();
    searchState.environment = ($("zenodo-search-env") as HTMLSelectElement)
      .value as "sandbox" | "production";
    searchState.file_type = ($("zenodo-search-filetype") as HTMLInputElement).value.trim();
    searchState.date_from = ($("zenodo-search-date-from") as HTMLInputElement).value;
    searchState.date_to = ($("zenodo-search-date-to") as HTMLInputElement).value;
    searchState.page = 1;
    void runSearch();
  });

  $("zenodo-search-input").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") $("zenodo-search-btn").click();
  });

  // Search pagination
  $("zenodo-search-prev").addEventListener("click", () => {
    if (searchState.page > 1) {
      searchState.page--;
      void runSearch();
    }
  });
  $("zenodo-search-next").addEventListener("click", () => {
    if (searchState.page < searchState.totalPages) {
      searchState.page++;
      void runSearch();
    }
  });

  // Delegated click on import buttons inside results
  $("zenodo-search-results").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".zenodo-import-btn");
    if (!btn) return;
    const card = btn.closest<HTMLElement>(".zenodo-record-card");
    const recordId = Number(card?.dataset.recordId);
    if (recordId) void openImportDialog(recordId);
  });

  // Import dialog close via overlay click
  $("zenodo-import-dialog").addEventListener("click", (e) => {
    if (e.target === $("zenodo-import-dialog"))
      $("zenodo-import-dialog").classList.add("hidden");
  });

  // Publish dialog form
  ($("zenodo-publish-form") as HTMLFormElement).addEventListener(
    "submit",
    (e) => void handlePublishSubmit(e),
  );
  $("zenodo-publish-cancel").addEventListener("click", () =>
    $("zenodo-publish-dialog").classList.add("hidden"),
  );
  $("zenodo-publish-dialog").addEventListener("click", (e) => {
    if (e.target === $("zenodo-publish-dialog"))
      $("zenodo-publish-dialog").classList.add("hidden");
  });
}

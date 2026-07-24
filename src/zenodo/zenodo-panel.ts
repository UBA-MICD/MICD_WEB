import { authFetch, ensureAuthenticated, API_BASE } from "../auth/auth.js";
import { $, escapeHtml } from "../shared/dom.js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ZenodoRecord {
  id: number;
  doi: string;
  title: string;
  authors: { name: string; affiliation?: string }[];
  publicationDate: string;
  license: string;
  totalSize: number;
  numFiles: number;
  importable: boolean;
  files?: { key: string; size: number }[];
}

interface SearchResponse {
  records: ZenodoRecord[];
  total: number;
  page: number;
  size: number;
}

interface ConfigStatus {
  sandbox: EnvStatus;
  production: EnvStatus;
}

interface EnvStatus {
  configured: boolean;
  hint: string | null;
  last_updated: string | null;
}

interface QuotaResponse {
  environment: string;
  used_bytes: number;
  limit_bytes: number;
  percent_used: number;
  alert: boolean;
  alert_message: string | null;
  rate_limit: { requests_last_minute: number; throttle_at: number };
}

interface SyncConfig {
  interval_hours: number | null;
  last_run_at: string | null;
  valid_intervals: number[];
}

// ── State ──────────────────────────────────────────────────────────────────────

type Tab = "search" | "publish" | "config";

const state = {
  tab: "search" as Tab,
  query: "",
  fileType: "",
  environment: "sandbox" as "sandbox" | "production",
  page: 1,
  totalPages: 1,
};

// ── Init ───────────────────────────────────────────────────────────────────────

export function initZenodoPanel(): void {
  $("btn-open-zenodo").addEventListener("click", openPanel);
  $("btn-close-zenodo").addEventListener("click", closePanel);

  // Tab switching
  document.querySelectorAll<HTMLElement>(".z-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab as Tab));
  });

  // Search bar
  const input = $("z-search-input") as HTMLInputElement;
  $("btn-z-search").addEventListener("click", () => runSearch(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(input.value);
  });

  // File type chips
  $("z-filter-chips").addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".filter-chip");
    if (!chip) return;
    $("z-filter-chips")
      .querySelectorAll(".filter-chip")
      .forEach((c) => c.classList.remove("filter-chip--active"));
    chip.classList.add("filter-chip--active");
    state.fileType = chip.dataset.type ?? "";
    state.page = 1;
    if (state.query) void loadSearch();
  });

  // Environment toggle
  $("z-env-toggle").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-env]");
    if (!btn) return;
    $("z-env-toggle")
      .querySelectorAll<HTMLElement>("[data-env]")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.environment = btn.dataset.env as "sandbox" | "production";
    state.page = 1;
    if (state.query) void loadSearch();
  });

  // Pagination
  $("z-prev").addEventListener("click", () => {
    if (state.page > 1) { state.page--; void loadSearch(); }
  });
  $("z-next").addEventListener("click", () => {
    if (state.page < state.totalPages) { state.page++; void loadSearch(); }
  });

  // Import click delegation
  $("z-results").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-import-id]");
    if (btn) void importRecord(Number(btn.dataset.importId), btn);
  });
}

function openPanel(): void {
  $("zenodo-panel").classList.remove("zenodo-panel--closed");
  if (state.tab === "config") void loadConfig();
}

function closePanel(): void {
  $("zenodo-panel").classList.add("zenodo-panel--closed");
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function switchTab(tab: Tab): void {
  state.tab = tab;
  document.querySelectorAll(".z-tab").forEach((t) => t.classList.remove("z-tab--active"));
  document.querySelector<HTMLElement>(`.z-tab[data-tab="${tab}"]`)?.classList.add("z-tab--active");
  document.querySelectorAll(".z-tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`z-tab-${tab}`).classList.remove("hidden");
  if (tab === "config") void loadConfig();
  if (tab === "publish") renderPublishTab();
}

// ── Search ─────────────────────────────────────────────────────────────────────

function runSearch(raw: string): void {
  const q = raw.trim();
  if (!q) return;
  state.query = q;
  state.page = 1;
  void loadSearch();
}

async function loadSearch(): Promise<void> {
  const results = $("z-results");
  results.innerHTML = skeleton();
  setPaginationUI(state.page, 1, 0);

  const params = new URLSearchParams({
    q: state.query,
    environment: state.environment,
    page: String(state.page),
    size: "8",
  });
  if (state.fileType) params.set("file_type", state.fileType);

  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/search?${params}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data: SearchResponse = await res.json();

    const total = data.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / 8));
    state.totalPages = pages;
    setPaginationUI(state.page, pages, total);

    results.innerHTML = total === 0
      ? emptyState("Sin resultados", "Probá términos más generales o quitá filtros")
      : data.records.map(recordCard).join("");
  } catch {
    results.innerHTML = emptyState("Error al buscar", "Verificá la conexión con Zenodo", true);
  }
}

function recordCard(r: ZenodoRecord): string {
  const author = r.authors[0]?.name ?? "—";
  const more = r.authors.length > 1 ? " et al." : "";
  const year = r.publicationDate?.slice(0, 4) ?? "—";
  const importBadge = r.importable
    ? `<span class="z-badge z-badge--dicom">DICOM</span>`
    : `<span class="z-badge z-badge--muted">No importable</span>`;
  const importBtn = r.importable
    ? `<button class="btn btn--accent btn--xs" data-import-id="${r.id}">Importar</button>`
    : "";

  return `
    <div class="z-record-card">
      <p class="z-record-title">${escapeHtml(r.title)}</p>
      <p class="z-record-meta">${escapeHtml(author)}${more} · ${year}</p>
      <p class="z-record-doi">${escapeHtml(r.doi)}</p>
      <div class="z-record-footer">
        ${importBadge}
        <span class="z-badge z-badge--muted">${formatBytes(r.totalSize)}</span>
        <span class="z-badge z-badge--muted">${r.numFiles} arch.</span>
        <div style="flex:1"></div>
        ${importBtn}
      </div>
    </div>`;
}

async function importRecord(recordId: number, btn: HTMLButtonElement): Promise<void> {
  if (!(await ensureAuthenticated())) return;

  const origLabel = btn.textContent ?? "Importar";
  btn.disabled = true;
  btn.textContent = "…";

  try {
    // Get file list from record detail
    const detailRes = await authFetch(
      `${API_BASE}/v1/zenodo/records/${recordId}?environment=${state.environment}`,
    );
    if (!detailRes.ok) throw new Error(`detail ${detailRes.status}`);
    const detail: ZenodoRecord = await detailRes.json();

    const files = (detail.files ?? [])
      .filter((f) => f.key.endsWith(".dcm") || f.key.endsWith(".zip"))
      .map((f) => ({ fileKey: f.key }));

    if (files.length === 0) {
      btn.textContent = "Sin archivos";
      setTimeout(() => { btn.disabled = false; btn.textContent = origLabel; }, 2000);
      return;
    }

    const res = await authFetch(`${API_BASE}/v1/zenodo/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_id: recordId,
        environment: state.environment,
        files,
        overwrite_duplicates: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error ?? `Error ${res.status}`;
      btn.textContent = msg.length > 18 ? "Error" : msg;
      setTimeout(() => { btn.disabled = false; btn.textContent = origLabel; }, 2500);
      return;
    }

    const n = data.imported ?? 0;
    btn.textContent = `✓ ${n} importado${n !== 1 ? "s" : ""}`;
    btn.classList.add("btn--success");
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = origLabel;
      btn.classList.remove("btn--success");
    }, 3000);
  } catch {
    btn.textContent = "Error";
    setTimeout(() => { btn.disabled = false; btn.textContent = origLabel; }, 2000);
  }
}

function setPaginationUI(page: number, totalPages: number, total: number): void {
  $("z-pagination-info").textContent =
    total > 0 ? `${page} / ${totalPages}  ·  ${total} resultados` : "—";
  ($("z-prev") as HTMLButtonElement).disabled = page <= 1;
  ($("z-next") as HTMLButtonElement).disabled = page >= totalPages;
}

// ── Config ─────────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<void> {
  const container = $("z-config-content");
  container.innerHTML = `
    <div class="z-skeleton-card"><div class="z-skeleton z-skeleton--lg"></div><div class="z-skeleton z-skeleton--md"></div></div>
    <div class="z-skeleton-card"><div class="z-skeleton z-skeleton--lg"></div><div class="z-skeleton z-skeleton--md"></div></div>`;

  try {
    const [statusRes, qSRes, qPRes, syncRes] = await Promise.all([
      authFetch(`${API_BASE}/v1/zenodo/config/status`),
      authFetch(`${API_BASE}/v1/zenodo/quota?environment=sandbox`),
      authFetch(`${API_BASE}/v1/zenodo/quota?environment=production`),
      authFetch(`${API_BASE}/v1/zenodo/config/sync`),
    ]);

    const status: ConfigStatus = statusRes.ok ? await statusRes.json() : defaultStatus();
    const qS: QuotaResponse | null = qSRes.ok ? await qSRes.json() : null;
    const qP: QuotaResponse | null = qPRes.ok ? await qPRes.json() : null;
    const sync: SyncConfig = syncRes.ok ? await syncRes.json() : { interval_hours: 24, last_run_at: null, valid_intervals: [6, 12, 24, 168] };

    renderConfig(container, status, qS, qP, sync);
  } catch {
    container.innerHTML = emptyState("Error al cargar config", "Intentá de nuevo", true);
  }
}

function renderConfig(
  container: HTMLElement,
  status: ConfigStatus,
  qS: QuotaResponse | null,
  qP: QuotaResponse | null,
  sync: SyncConfig,
): void {
  container.innerHTML = `
    ${envCard("sandbox", status.sandbox, qS)}
    ${envCard("production", status.production, qP)}
    ${syncCard(sync)}`;

  // Token save/delete
  (["sandbox", "production"] as const).forEach((env) => {
    container.querySelector(`#z-${env}-save`)?.addEventListener("click", () => void saveToken(env));
    container.querySelector(`#z-${env}-delete`)?.addEventListener("click", () => void deleteToken(env));
  });

  // Sync
  container.querySelector("#z-sync-intervals")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-hours]");
    if (!btn) return;
    const hours = btn.dataset.hours === "null" ? null : Number(btn.dataset.hours);
    void setSyncInterval(hours);
  });
  container.querySelector("#btn-z-sync-now")?.addEventListener("click", () => void runSyncNow());
}

function envCard(env: "sandbox" | "production", info: EnvStatus, quota: QuotaResponse | null): string {
  const label = env === "sandbox" ? "Sandbox" : "Producción";
  const dotClass = info.configured ? "z-dot--on" : "z-dot--off";
  const statusText = info.configured ? `Conectado · ${info.hint ?? ""}` : "No configurado";

  return `
    <div class="z-env-card">
      <div class="z-env-header">
        <span class="z-section-label">${label}</span>
        <span class="z-env-status">
          <span class="z-dot ${dotClass}"></span>
          <span>${escapeHtml(statusText)}</span>
        </span>
      </div>
      ${quota ? quotaBar(quota) : ""}
      <div class="z-token-row">
        <input type="password" class="z-token-input" id="z-${env}-token"
          placeholder="Token de Zenodo…" autocomplete="off" />
        <button class="btn btn--accent btn--sm" id="z-${env}-save">Guardar</button>
        ${info.configured
          ? `<button class="btn btn--danger btn--sm" id="z-${env}-delete">✕</button>`
          : ""}
      </div>
    </div>`;
}

function quotaBar(q: QuotaResponse): string {
  const pct = Math.min(100, q.percent_used);
  const color = pct > 90 ? "#e74c3c" : pct > 70 ? "#f39c12" : "var(--accent)";
  return `
    <div class="z-quota">
      <div class="z-quota-track"><div class="z-quota-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="z-quota-text">${formatBytes(q.used_bytes)} / ${formatBytes(q.limit_bytes)} · ${pct.toFixed(1)}%${q.alert ? " ⚠️" : ""}</span>
    </div>`;
}

function syncCard(sync: SyncConfig): string {
  const lastRun = sync.last_run_at
    ? new Date(sync.last_run_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "Nunca";
  const intervals = [
    { label: "6h", value: 6 }, { label: "12h", value: 12 },
    { label: "24h", value: 24 }, { label: "Semanal", value: 168 },
    { label: "Desactivado", value: null },
  ];

  return `
    <div class="z-sync-card">
      <div class="z-section-label">Sincronización</div>
      <p class="z-sync-meta">Último run: ${escapeHtml(lastRun)}</p>
      <div class="z-sync-intervals" id="z-sync-intervals">
        ${intervals.map(({ label, value }) => `
          <button class="filter-chip ${sync.interval_hours === value ? "filter-chip--active" : ""}"
            data-hours="${value ?? "null"}">${label}</button>`).join("")}
      </div>
      <button class="btn btn--secondary btn--sm btn--full" id="btn-z-sync-now">Sincronizar ahora</button>
    </div>`;
}

async function saveToken(env: "sandbox" | "production"): Promise<void> {
  const input = document.getElementById(`z-${env}-token`) as HTMLInputElement | null;
  const btn = document.getElementById(`z-${env}-save`) as HTMLButtonElement | null;
  if (!input || !btn) return;
  const token = input.value.trim();
  if (!token) return;
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env, token }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    input.value = "";
    void loadConfig();
  } catch {
    btn.disabled = false;
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Guardar"; }, 2000);
  }
}

async function deleteToken(env: "sandbox" | "production"): Promise<void> {
  const btn = document.getElementById(`z-${env}-delete`) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = true;
  try {
    await authFetch(`${API_BASE}/v1/zenodo/config/${env}`, { method: "DELETE" });
    void loadConfig();
  } catch {
    btn.disabled = false;
  }
}

async function setSyncInterval(hours: number | null): Promise<void> {
  await authFetch(`${API_BASE}/v1/zenodo/config/sync`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interval_hours: hours }),
  });
  void loadConfig();
}

async function runSyncNow(): Promise<void> {
  const btn = document.getElementById("btn-z-sync-now") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Sincronizando…";
  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync/run`, { method: "POST" });
    const data = await res.json();
    btn.textContent = `✓ ${data.records_checked ?? 0} chequeados`;
    setTimeout(() => { btn.disabled = false; btn.textContent = "Sincronizar ahora"; void loadConfig(); }, 2500);
  } catch {
    btn.disabled = false;
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Sincronizar ahora"; }, 2000);
  }
}

// ── Publish ────────────────────────────────────────────────────────────────────

function renderPublishTab(): void {
  const container = $("z-publish-content");
  const active = document.querySelector<HTMLElement>(".study-item--active[data-id]");
  const studyId = active?.dataset.id ?? null;
  const studyName = active?.querySelector(".study-item__name")?.textContent ?? studyId;

  if (!studyId) {
    container.innerHTML = `
      <div class="z-empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
        <p>Seleccioná un estudio</p>
        <span>Cerrá este panel, hacé click en un estudio del explorador y volvé a Publicar</span>
        <button class="btn btn--secondary btn--sm" id="btn-z-close-for-study">Cerrar panel</button>
      </div>`;
    document.getElementById("btn-z-close-for-study")?.addEventListener("click", closePanel);
    return;
  }

  container.innerHTML = `
    <div class="z-publish-study">
      <div class="z-section-label">Estudio</div>
      <div class="z-study-chip">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
        ${escapeHtml(studyName ?? studyId)}
      </div>
    </div>
    <form class="z-publish-form" id="z-publish-form">
      <label class="z-field">
        <span>Título *</span>
        <input type="text" id="z-pub-title" placeholder="CT Dataset — MICD" required />
      </label>
      <label class="z-field">
        <span>Descripción *</span>
        <textarea id="z-pub-desc" rows="3" placeholder="Descripción del dataset…" required></textarea>
      </label>
      <label class="z-field">
        <span>Autores * <span class="z-field-hint">(Apellido, Nombre; separados por ;)</span></span>
        <input type="text" id="z-pub-authors" placeholder="García, Ana; López, Juan" required />
      </label>
      <label class="z-field">
        <span>Keywords <span class="z-field-hint">(separados por ,)</span></span>
        <input type="text" id="z-pub-keywords" placeholder="CT, DICOM, tórax" />
      </label>
      <div class="z-field-row">
        <label class="z-field z-field--half">
          <span>Licencia</span>
          <select id="z-pub-license">
            <option value="cc-by-4.0">CC BY 4.0</option>
            <option value="cc0-1.0">CC0 1.0</option>
            <option value="cc-by-nc-4.0">CC BY-NC 4.0</option>
          </select>
        </label>
        <label class="z-field z-field--half">
          <span>Entorno</span>
          <select id="z-pub-env">
            <option value="sandbox">Sandbox</option>
            <option value="production">Producción</option>
          </select>
        </label>
      </div>
      <p id="z-pub-feedback" class="z-pub-feedback hidden"></p>
      <button type="submit" class="btn btn--accent btn--full" id="btn-z-publish">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Publicar en Zenodo
      </button>
    </form>`;

  document.getElementById("z-publish-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void publishStudy(studyId);
  });
}

async function publishStudy(studyId: string): Promise<void> {
  if (!(await ensureAuthenticated())) return;

  const btn = document.getElementById("btn-z-publish") as HTMLButtonElement;
  const feedback = document.getElementById("z-pub-feedback") as HTMLElement;
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? "";

  btn.disabled = true;
  btn.textContent = "Publicando…";
  feedback.className = "z-pub-feedback hidden";

  const title = get("z-pub-title").trim();
  const description = get("z-pub-desc").trim();
  const authorsRaw = get("z-pub-authors").trim();
  const keywordsRaw = get("z-pub-keywords").trim();
  const license = get("z-pub-license");
  const environment = get("z-pub-env");
  const authors = authorsRaw.split(";").map((a) => ({ name: a.trim() })).filter((a) => a.name);
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()).filter(Boolean) : [];

  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orthanc_study_id: studyId, environment, title, description, authors, keywords, license }),
    });
    const data = await res.json();

    const btnEl = document.getElementById("btn-z-publish") as HTMLButtonElement;
    const fbEl = document.getElementById("z-pub-feedback") as HTMLElement;

    if (!res.ok) {
      const codeHints: Record<string, string> = {
        not_anonymized: " El estudio debe estar anonimizado primero.",
        no_credentials: " Configurá un token en la pestaña Config.",
        study_not_found: " El estudio no se encontró en la base de datos.",
      };
      fbEl.textContent = (data.error ?? `Error ${res.status}`) + (codeHints[data.code ?? ""] ?? "");
      fbEl.className = "z-pub-feedback z-pub-feedback--error";
    } else {
      fbEl.innerHTML = `✓ Publicado · DOI: <code>${escapeHtml(data.doi ?? "—")}</code> · ${data.files_uploaded ?? 0} archivo(s)`;
      fbEl.className = "z-pub-feedback z-pub-feedback--success";
    }
    btnEl.disabled = false;
    btnEl.textContent = "Publicar en Zenodo";
  } catch {
    const fbEl = document.getElementById("z-pub-feedback") as HTMLElement;
    const btnEl = document.getElementById("btn-z-publish") as HTMLButtonElement;
    fbEl.textContent = "Error de conexión.";
    fbEl.className = "z-pub-feedback z-pub-feedback--error";
    btnEl.disabled = false;
    btnEl.textContent = "Publicar en Zenodo";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function skeleton(): string {
  return Array.from({ length: 3 }).map(() => `
    <div class="z-skeleton-card">
      <div class="z-skeleton z-skeleton--lg"></div>
      <div class="z-skeleton z-skeleton--md"></div>
      <div class="z-skeleton z-skeleton--sm"></div>
    </div>`).join("");
}

function emptyState(title: string, subtitle: string, isError = false): string {
  return `
    <div class="z-empty-state${isError ? " z-empty-state--error" : ""}">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
        ${isError
          ? `<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`
          : `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`}
      </svg>
      <p>${escapeHtml(title)}</p>
      <span>${escapeHtml(subtitle)}</span>
    </div>`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function defaultStatus(): ConfigStatus {
  const empty: EnvStatus = { configured: false, hint: null, last_updated: null };
  return { sandbox: empty, production: empty };
}

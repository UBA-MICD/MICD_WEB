import { authFetch, ensureAuthenticated, isAuthenticated, API_BASE } from "../auth/auth.js";
import { $, escapeHtml, escapeAttr } from "../shared/dom.js";
import { showToast } from "../shared/banner.js";

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

type Tab = "search" | "publish" | "config" | "logs";

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
  // Starts closed in the markup; make the DOM state say so too.
  setPanelOpen(false);
  $("zenodo-panel").addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") closePanel();
  });

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
    if (state.page > 1) {
      state.page--;
      void loadSearch();
    }
  });
  $("z-next").addEventListener("click", () => {
    if (state.page < state.totalPages) {
      state.page++;
      void loadSearch();
    }
  });

  // Import click delegation
  $("z-results").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // "Ir a Config" link inside an error empty-state
    if (target.closest("#z-empty-config-link")) {
      switchTab("config");
      return;
    }

    // Cancel button inside a ZIP confirm strip
    if (target.closest(".z-zip-confirm__cancel")) {
      target.closest<HTMLElement>(".z-zip-confirm")?.remove();
      return;
    }

    // Confirm button inside a ZIP confirm strip
    const confirmBtn = target.closest<HTMLButtonElement>(".z-zip-confirm__ok");
    if (confirmBtn) {
      const strip = confirmBtn.closest<HTMLElement>(".z-zip-confirm")!;
      const recordId = Number(strip.dataset.recordId);
      strip.remove();
      const importBtn = document.querySelector<HTMLButtonElement>(`[data-import-id="${recordId}"]`);
      if (importBtn) void importRecord(recordId, importBtn);
      return;
    }

    // Regular import button
    const btn = target.closest<HTMLButtonElement>("[data-import-id]");
    if (!btn) return;
    const hasZip = btn.dataset.hasZip === "true";

    if (hasZip) {
      const card = btn.closest<HTMLElement>(".z-record-card")!;
      if (card.querySelector(".z-zip-confirm")) return;
      const totalBytes = Number(btn.closest<HTMLElement>(".z-record-card")
        ?.querySelector<HTMLElement>("[data-total-size]")?.dataset.totalSize ?? 0);
      const sizeLabel = card.querySelector<HTMLElement>(".z-badge--muted")?.textContent ?? "";
      const bigWarning = totalBytes > 500 * 1024 * 1024
        ? `<p class="z-zip-confirm__warn">⚠ Archivo grande — la descarga puede tardar varios minutos.</p>`
        : "";
      const strip = document.createElement("div");
      strip.className = "z-zip-confirm";
      strip.dataset.recordId = btn.dataset.importId!;
      strip.innerHTML = `
        <span class="z-zip-confirm__msg">
          ¿Descomprimír el ZIP (${escapeHtml(sizeLabel)}) e importar los DICOM que contenga?
        </span>
        ${bigWarning}
        <div class="z-zip-confirm__actions">
          <button class="btn btn--accent btn--xs z-zip-confirm__ok">Sí, importar</button>
          <button class="btn btn--secondary btn--xs z-zip-confirm__cancel">Cancelar</button>
        </div>`;
      card.appendChild(strip);
      return;
    }

    void importRecord(Number(btn.dataset.importId), btn);
  });
}

function openPanel(): void {
  setPanelOpen(true);
  if (state.tab === "config") void loadConfig();
}

function closePanel(): void {
  setPanelOpen(false);
  // Send focus back to the control that opened the panel, rather than leaving
  // it on a button that is now hidden.
  $("btn-open-zenodo").focus();
}

/**
 * The panel is a disclosure, so the rail button's aria-expanded has to follow
 * it. `inert` matters too: the closed panel is only translated off-screen, so
 * without it a keyboard user could tab into a panel they cannot see.
 */
function setPanelOpen(open: boolean): void {
  const panel = $("zenodo-panel");
  panel.classList.toggle("zenodo-panel--closed", !open);
  panel.inert = !open;
  $("btn-open-zenodo").setAttribute("aria-expanded", String(open));
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function switchTab(tab: Tab): void {
  state.tab = tab;
  document
    .querySelectorAll(".z-tab")
    .forEach((t) => t.classList.remove("z-tab--active"));
  document
    .querySelector<HTMLElement>(`.z-tab[data-tab="${tab}"]`)
    ?.classList.add("z-tab--active");
  document
    .querySelectorAll(".z-tab-panel")
    .forEach((p) => p.classList.add("hidden"));
  $(`z-tab-${tab}`).classList.remove("hidden");
  if (tab === "config") void loadConfig();
  if (tab === "publish") renderPublishTab();
  if (tab === "logs") void loadActivityLog();
}

/**
 * Warns before ensureAuthenticated() escalates to the full-screen login
 * (server-screen.ts): without this, a dead MICD session made the app jump
 * away from the Zenodo panel with zero explanation — confusing on its own,
 * and easy to mistake for a Zenodo-token problem. Session check is
 * synchronous, so the toast always lands before the screen switch.
 */
async function guardSession(): Promise<boolean> {
  if (isAuthenticated()) return true;
  showToast("Tu sesión de MICD expiró. Iniciá sesión para continuar.", "warning");
  return ensureAuthenticated();
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

  if (!(await guardSession())) {
    results.innerHTML = emptyState(
      "Sesión requerida",
      "Iniciá sesión para buscar en Zenodo",
      true,
    );
    showToast("Necesitás iniciar sesión para buscar en Zenodo.", "error");
    return;
  }

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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      const info = searchErrorInfo(res.status, data);
      results.innerHTML = emptyState(info.title, info.subtitle, true, info.showConfigLink);
      showToast(info.toast, "error");
      return;
    }
    const data: SearchResponse = await res.json();

    const total = data.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / 8));
    state.totalPages = pages;
    setPaginationUI(state.page, pages, total);

    results.innerHTML =
      total === 0
        ? emptyState(
            "Sin resultados",
            "Probá términos más generales o quitá filtros",
          )
        : data.records.map(recordCard).join("");
  } catch {
    results.innerHTML = emptyState(
      "Error de conexión",
      "No se pudo contactar al servidor. Revisá tu conexión e intentá de nuevo.",
      true,
    );
    showToast("Error de conexión con el servidor.", "error");
  }
}

/**
 * Maps a failed search response to user-facing copy. 429 is the practical
 * symptom a user sees when no Zenodo token is configured — Zenodo throttles
 * unauthenticated requests hard — so that case points at the Config tab
 * instead of just saying "try again later".
 */
function searchErrorInfo(
  status: number,
  data: { error?: string },
): { title: string; subtitle: string; toast: string; showConfigLink?: boolean } {
  if (status === 401) {
    return {
      title: "Sesión requerida",
      subtitle: "Tu sesión expiró. Volvé a iniciar sesión para buscar en Zenodo.",
      toast: "Tu sesión expiró. Iniciá sesión de nuevo.",
    };
  }
  if (status === 429) {
    return {
      title: "Límite de búsquedas alcanzado",
      subtitle:
        "Sin un token de Zenodo configurado, el límite de búsquedas es más bajo. Configurá uno en la pestaña Config o esperá unos minutos.",
      toast: data.error ?? "Límite de requests a Zenodo alcanzado.",
      showConfigLink: true,
    };
  }
  if (status === 503) {
    return {
      title: "Zenodo no disponible",
      subtitle: data.error ?? "Zenodo no está disponible en este momento. Intentá de nuevo más tarde.",
      toast: "Zenodo no está disponible en este momento.",
    };
  }
  return {
    title: "Error al buscar",
    subtitle: data.error ?? "Ocurrió un error inesperado. Intentá de nuevo.",
    toast: data.error ?? "Error al buscar en Zenodo.",
  };
}

function recordCard(r: ZenodoRecord): string {
  const author = r.authors[0]?.name ?? "—";
  const more = r.authors.length > 1 ? " et al." : "";
  const year = r.publicationDate?.slice(0, 4) ?? "—";
  const hasOnlyZips = (r.files ?? []).length > 0 && (r.files ?? []).every((f) => f.key.toLowerCase().endsWith(".zip"));
  const importBadge = r.importable
    ? hasOnlyZips
      ? `<span class="z-badge z-badge--zip">ZIP·DICOM</span>`
      : `<span class="z-badge z-badge--dicom">DICOM</span>`
    : `<span class="z-badge z-badge--muted">No importable</span>`;
  const importBtn = r.importable
    ? `<button class="btn btn--accent btn--xs" data-import-id="${r.id}" data-has-zip="${hasOnlyZips}">${hasOnlyZips ? "Importar ZIP" : "Importar"}</button>`
    : "";

  const zipNote = hasOnlyZips
    ? `<p class="z-record-zip-note">El servidor descomprimirá el ZIP e importará los archivos DICOM que contenga.</p>`
    : "";

  return `
    <div class="z-record-card" data-total-size="${r.totalSize}">
      <p class="z-record-title">${escapeHtml(r.title)}</p>
      <p class="z-record-meta">${escapeHtml(author)}${more} · ${year}</p>
      <p class="z-record-doi">${escapeHtml(r.doi)}</p>
      ${zipNote}
      <div class="z-record-footer">
        ${importBadge}
        <span class="z-badge z-badge--muted">${formatBytes(r.totalSize)}</span>
        <span class="z-badge z-badge--muted">${r.numFiles} arch.</span>
        <div style="flex:1"></div>
        ${importBtn}
      </div>
    </div>`;
}

function importErrorMessage(status: number, error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (status === 404) return "El dataset no existe en este entorno de Zenodo (sandbox/producción).";
  if (status === 503) return "Zenodo no está disponible en este momento. Intentá de nuevo más tarde.";
  return `No se pudo importar el dataset (error ${status}).`;
}

async function importRecord(
  recordId: number,
  btn: HTMLButtonElement,
): Promise<void> {
  if (!(await guardSession())) return;

  const origLabel = btn.textContent ?? "Importar";
  btn.disabled = true;
  btn.textContent = "…";

  try {
    // Get file list from record detail
    const detailRes = await authFetch(
      `${API_BASE}/v1/zenodo/records/${recordId}?environment=${state.environment}`,
    );
    if (!detailRes.ok) {
      const detailData = await detailRes.json().catch(() => ({}) as { error?: string });
      showToast(importErrorMessage(detailRes.status, detailData.error), "error");
      btn.disabled = false;
      btn.textContent = origLabel;
      return;
    }
    const detail: ZenodoRecord = await detailRes.json();

    const files = (detail.files ?? [])
      .filter((f) => f.key.endsWith(".dcm") || f.key.endsWith(".zip"))
      .map((f) => ({ fileKey: f.key }));

    const hasZips = files.some((f) => f.fileKey.endsWith(".zip"));
    if (hasZips) btn.textContent = "Descargando…";

    if (files.length === 0) {
      showToast("Este dataset no tiene archivos .dcm ni .zip para importar.", "warning");
      btn.textContent = "Sin archivos";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = origLabel;
      }, 2000);
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
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      showToast(importErrorMessage(res.status, data.error), "error");
      btn.disabled = false;
      btn.textContent = origLabel;
      return;
    }

    const n = (data.imported as number | undefined) ?? 0;
    const dupes = (data.duplicates as number | undefined) ?? 0;

    if (n === 0 && dupes > 0) {
      const msg =
        dupes === 1
          ? "Este archivo ya estaba importado."
          : `${dupes} archivos ya estaban importados.`;
      showToast(msg, "warning");
      btn.disabled = false;
      btn.textContent = origLabel;
      return;
    }

    btn.textContent = `✓ ${n} importado${n !== 1 ? "s" : ""}`;
    btn.classList.add("btn--success");
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = origLabel;
      btn.classList.remove("btn--success");
    }, 3000);
  } catch {
    showToast("Error de conexión al importar el dataset.", "error");
    btn.textContent = "Error";
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = origLabel;
    }, 2000);
  }
}

function setPaginationUI(
  page: number,
  totalPages: number,
  total: number,
): void {
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

    const status: ConfigStatus = statusRes.ok
      ? await statusRes.json()
      : defaultStatus();
    const qS: QuotaResponse | null = qSRes.ok ? await qSRes.json() : null;
    const qP: QuotaResponse | null = qPRes.ok ? await qPRes.json() : null;
    const sync: SyncConfig = syncRes.ok
      ? await syncRes.json()
      : {
          interval_hours: 24,
          last_run_at: null,
          valid_intervals: [6, 12, 24, 168],
        };

    renderConfig(container, status, qS, qP, sync);
  } catch {
    container.innerHTML = emptyState(
      "Error al cargar config",
      "Intentá de nuevo",
      true,
    );
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
    container
      .querySelector(`#z-${env}-save`)
      ?.addEventListener("click", () => void saveToken(env));
    container
      .querySelector(`#z-${env}-delete`)
      ?.addEventListener("click", () => void deleteToken(env));
  });

  // Sync
  container
    .querySelector("#z-sync-intervals")
    ?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-hours]",
      );
      if (!btn) return;
      const hours =
        btn.dataset.hours === "null" ? null : Number(btn.dataset.hours);
      void setSyncInterval(hours);
    });
  container
    .querySelector("#btn-z-sync-now")
    ?.addEventListener("click", () => void runSyncNow());
}

function envCard(
  env: "sandbox" | "production",
  info: EnvStatus,
  quota: QuotaResponse | null,
): string {
  const label = env === "sandbox" ? "Sandbox" : "Producción";
  const dotClass = info.configured ? "z-dot--on" : "z-dot--off";
  const statusText = info.configured
    ? `Conectado · ${info.hint ?? ""}`
    : "No configurado";

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
        ${
          info.configured
            ? `<button class="btn btn--danger btn--sm" id="z-${env}-delete">✕</button>`
            : ""
        }
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
    ? new Date(sync.last_run_at).toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Nunca";
  const intervals = [
    { label: "6h", value: 6 },
    { label: "12h", value: 12 },
    { label: "24h", value: 24 },
    { label: "Semanal", value: 168 },
    { label: "Desactivado", value: null },
  ];

  return `
    <div class="z-sync-card">
      <div class="z-section-label">Sincronización</div>
      <p class="z-sync-meta">Último run: ${escapeHtml(lastRun)}</p>
      <div class="z-sync-intervals" id="z-sync-intervals">
        ${intervals
          .map(
            ({ label, value }) => `
          <button class="filter-chip ${sync.interval_hours === value ? "filter-chip--active" : ""}"
            data-hours="${value ?? "null"}">${label}</button>`,
          )
          .join("")}
      </div>
      <button class="btn btn--secondary btn--sm btn--full" id="btn-z-sync-now">Sincronizar ahora</button>
    </div>`;
}

const TOKEN_ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Token inválido. Verificá que lo copiaste completo y que no esté revocado.",
  insufficient_permissions: "El token no tiene los permisos necesarios en Zenodo.",
  timeout: "Zenodo no respondió a tiempo. Intentá de nuevo en unos minutos.",
};

function tokenErrorMessage(reason: unknown, fallbackError: unknown): string {
  if (typeof reason === "string" && reason in TOKEN_ERROR_MESSAGES) {
    return TOKEN_ERROR_MESSAGES[reason];
  }
  return typeof fallbackError === "string" ? fallbackError : "No se pudo guardar el token.";
}

async function saveToken(env: "sandbox" | "production"): Promise<void> {
  const input = document.getElementById(
    `z-${env}-token`,
  ) as HTMLInputElement | null;
  const btn = document.getElementById(
    `z-${env}-save`,
  ) as HTMLButtonElement | null;
  if (!input || !btn) return;
  const token = input.value.trim();
  if (!token) {
    showToast("Ingresá un token de Zenodo antes de guardar.", "warning");
    input.focus();
    return;
  }
  if (!(await guardSession())) return;

  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env, token }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        showToast("Tu sesión expiró. Iniciá sesión de nuevo para guardar el token.", "error");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(tokenErrorMessage(data.reason, data.error), "error");
      }
      throw new Error(`${res.status}`);
    }
    input.value = "";
    void loadConfig();
  } catch {
    btn.disabled = false;
    btn.textContent = "Error";
    setTimeout(() => {
      btn.textContent = "Guardar";
    }, 2000);
  }
}

async function deleteToken(env: "sandbox" | "production"): Promise<void> {
  const btn = document.getElementById(
    `z-${env}-delete`,
  ) as HTMLButtonElement | null;
  if (!btn) return;
  if (!(await guardSession())) return;

  btn.disabled = true;
  try {
    await authFetch(`${API_BASE}/v1/zenodo/config/${env}`, {
      method: "DELETE",
    });
    void loadConfig();
  } catch {
    btn.disabled = false;
  }
}

async function setSyncInterval(hours: number | null): Promise<void> {
  if (!(await guardSession())) return;

  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval_hours: hours }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      showToast(data.error ?? "No se pudo actualizar la sincronización.", "error");
      return;
    }
    void loadConfig();
  } catch {
    showToast("Error de conexión al actualizar la sincronización.", "error");
  }
}

async function runSyncNow(): Promise<void> {
  const btn = document.getElementById(
    "btn-z-sync-now",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  if (!(await guardSession())) return;

  btn.disabled = true;
  btn.textContent = "Sincronizando…";
  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/config/sync/run`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}) as { error?: string });
    if (!res.ok) {
      showToast(data.error ?? "No se pudo ejecutar la sincronización.", "error");
      btn.disabled = false;
      btn.textContent = "Sincronizar ahora";
      return;
    }
    btn.textContent = `✓ ${(data as { records_checked?: number }).records_checked ?? 0} chequeados`;
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Sincronizar ahora";
      void loadConfig();
    }, 2500);
  } catch {
    showToast("Error de conexión al sincronizar.", "error");
    btn.disabled = false;
    btn.textContent = "Error";
    setTimeout(() => {
      btn.textContent = "Sincronizar ahora";
    }, 2000);
  }
}

// ── Publish ────────────────────────────────────────────────────────────────────

function renderPublishTab(): void {
  const container = $("z-publish-content");
  // The loaded study is marked with aria-current, not a .study-item--active
  // class: the explorer keys its styling off the ARIA attribute so the visual
  // and programmatic state cannot drift apart. Both explorer views mark the
  // same study, so the first match is the right one either way.
  const active = document.querySelector<HTMLElement>(
    '.study-item[aria-current="true"][data-id]',
  );
  const studyId = active?.dataset.id ?? null;
  const studyName =
    active?.querySelector(".study-item__name")?.textContent ?? studyId;

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
    document
      .getElementById("btn-z-close-for-study")
      ?.addEventListener("click", closePanel);
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
  if (!(await guardSession())) return;

  const btn = document.getElementById("btn-z-publish") as HTMLButtonElement;
  const feedback = document.getElementById("z-pub-feedback") as HTMLElement;
  const get = (id: string) =>
    (
      document.getElementById(id) as
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
    )?.value ?? "";

  btn.disabled = true;
  btn.textContent = "Publicando…";
  feedback.className = "z-pub-feedback hidden";

  const title = get("z-pub-title").trim();
  const description = get("z-pub-desc").trim();
  const authorsRaw = get("z-pub-authors").trim();
  const keywordsRaw = get("z-pub-keywords").trim();
  const license = get("z-pub-license");
  const environment = get("z-pub-env");
  const authors = authorsRaw
    .split(";")
    .map((a) => ({ name: a.trim() }))
    .filter((a) => a.name);
  const keywords = keywordsRaw
    ? keywordsRaw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  try {
    const res = await authFetch(`${API_BASE}/v1/zenodo/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orthanc_study_id: studyId,
        environment,
        title,
        description,
        authors,
        keywords,
        license,
      }),
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
      fbEl.textContent =
        (data.error ?? `Error ${res.status}`) +
        (codeHints[data.code ?? ""] ?? "");
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
  return Array.from({ length: 3 })
    .map(
      () => `
    <div class="z-skeleton-card">
      <div class="z-skeleton z-skeleton--lg"></div>
      <div class="z-skeleton z-skeleton--md"></div>
      <div class="z-skeleton z-skeleton--sm"></div>
    </div>`,
    )
    .join("");
}

function emptyState(
  title: string,
  subtitle: string,
  isError = false,
  showConfigLink = false,
): string {
  return `
    <div class="z-empty-state${isError ? " z-empty-state--error" : ""}">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
        ${
          isError
            ? `<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`
            : `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`
        }
      </svg>
      <p>${escapeHtml(title)}</p>
      <span>${escapeHtml(subtitle)}</span>
      ${showConfigLink ? `<button class="btn btn--secondary btn--sm" id="z-empty-config-link">Ir a Config</button>` : ""}
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
  const empty: EnvStatus = {
    configured: false,
    hint: null,
    last_updated: null,
  };
  return { sandbox: empty, production: empty };
}

// ── Activity Log (Logs tab) ────────────────────────────────────────────────────

interface ActivityEntry {
  id: number;
  action: string;
  resourceId: string;
  timestamp: string;
  userId: number | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  result: "success" | "error";
}

interface ActivityListResult {
  entries: ActivityEntry[];
  total: number;
  page: number;
  totalPages: number;
}

const activityState = {
  filterAction: "",
  filterResult: "",
  page: 1,
  loaded: false,
};

function initActivityLog(): void {
  const toolbar = document.getElementById("activity-filters");
  if (!toolbar) return;

  toolbar.querySelectorAll<HTMLElement>("[data-filter-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toolbar.querySelectorAll("[data-filter-action]").forEach((b) => b.classList.remove("filter-chip--active"));
      btn.classList.add("filter-chip--active");
      activityState.filterAction = btn.dataset.filterAction ?? "";
      activityState.page = 1;
      void loadActivityLog();
    });
  });

  toolbar.querySelectorAll<HTMLElement>("[data-filter-result]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toolbar.querySelectorAll("[data-filter-result]").forEach((b) => b.classList.remove("filter-chip--active"));
      btn.classList.add("filter-chip--active");
      activityState.filterResult = btn.dataset.filterResult ?? "";
      activityState.page = 1;
      void loadActivityLog();
    });
  });

  document.getElementById("btn-export-activity")?.addEventListener("click", () => void exportActivityCsv());
}

async function loadActivityLog(): Promise<void> {
  const container = document.getElementById("activity-log-content");
  if (!container) return;

  if (!activityState.loaded) {
    // Wire up filter buttons the first time we load
    initActivityLog();
    activityState.loaded = true;
  }

  container.innerHTML = `<div class="z-loading">Cargando historial…</div>`;

  const params = new URLSearchParams();
  if (activityState.filterAction) {
    // Multiple actions are comma-separated; for now we pass the first
    const actions = activityState.filterAction.split(",");
    actions.forEach((a) => params.append("action", a));
  }
  if (activityState.filterResult) params.set("result", activityState.filterResult);
  params.set("page", String(activityState.page));
  params.set("limit", "50");

  try {
    const res = await authFetch(`${API_BASE}/v1/activity?${params.toString()}`);
    if (!res.ok) {
      container.innerHTML = `<p class="z-error">Error al cargar el historial (${escapeHtml(String(res.status))}).</p>`;
      return;
    }
    const data = (await res.json()) as ActivityListResult;
    container.innerHTML = renderActivityLog(data);

    container.querySelectorAll<HTMLElement>(".activity-log__row").forEach((row) => {
      row.addEventListener("click", () => {
        const detail = row.nextElementSibling;
        if (detail?.classList.contains("activity-log__detail-row")) {
          detail.classList.toggle("hidden");
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>(".activity-log__page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activityState.page = parseInt(btn.dataset.page ?? "1", 10);
        void loadActivityLog();
      });
    });
  } catch {
    container.innerHTML = `<p class="z-error">No se pudo conectar al servidor.</p>`;
  }
}

function renderActivityLog(data: ActivityListResult): string {
  if (data.entries.length === 0) {
    return `<div class="z-empty-state"><span>No hay registros para los filtros seleccionados.</span></div>`;
  }

  const rows = data.entries
    .map((entry) => {
      const resultClass =
        entry.result === "error" ? "activity-log__result--error" : "activity-log__result--success";
      const resultLabel = entry.result === "error" ? "Error" : "Éxito";
      const date = new Date(entry.timestamp).toLocaleString("es-AR");
      const hasDetail = entry.detail !== null;
      const detailRow = hasDetail
        ? `<tr class="activity-log__detail-row hidden">
            <td colspan="5">
              <pre class="activity-log__detail">${escapeHtml(JSON.stringify(entry.detail, null, 2))}</pre>
            </td>
          </tr>`
        : "";

      return `
        <tr class="activity-log__row${hasDetail ? " activity-log__row--expandable" : ""}" tabindex="${hasDetail ? "0" : "-1"}">
          <td class="activity-log__cell">${escapeHtml(date)}</td>
          <td class="activity-log__cell activity-log__action">${escapeHtml(entry.action)}</td>
          <td class="activity-log__cell activity-log__resource">${escapeHtml(entry.resourceId)}</td>
          <td class="activity-log__cell">
            <span class="activity-log__result ${escapeAttr(resultClass)}">${escapeHtml(resultLabel)}</span>
          </td>
          <td class="activity-log__cell activity-log__detail-hint">${hasDetail ? "▶" : ""}</td>
        </tr>${detailRow}`;
    })
    .join("");

  const pagination =
    data.totalPages > 1
      ? `<div class="activity-log__pagination">
          ${data.page > 1 ? `<button class="btn btn--secondary btn--sm activity-log__page-btn" data-page="${data.page - 1}">← Anterior</button>` : ""}
          <span class="activity-log__page-info">Pág. ${data.page} / ${data.totalPages}</span>
          ${data.page < data.totalPages ? `<button class="btn btn--secondary btn--sm activity-log__page-btn" data-page="${data.page + 1}">Siguiente →</button>` : ""}
        </div>`
      : "";

  return `
    <table class="activity-log-table">
      <thead>
        <tr>
          <th>Fecha/hora</th>
          <th>Acción</th>
          <th>Recurso</th>
          <th>Resultado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${pagination}`;
}

async function exportActivityCsv(): Promise<void> {
  const params = new URLSearchParams();
  if (activityState.filterAction) {
    activityState.filterAction.split(",").forEach((a) => params.append("action", a));
  }
  if (activityState.filterResult) params.set("result", activityState.filterResult);

  try {
    const res = await authFetch(`${API_BASE}/v1/activity/export?${params.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zenodo-log.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // silently fail — user can retry
  }
}

import { authFetch, API_BASE } from "../auth/auth.js";
import { escapeHtml } from "../shared/dom.js";
import { t } from "../i18n/i18n.js";

interface OrthancStats {
  disk_used_mb: number;
  disk_max_mb: number | null;
  disk_used_pct: number | null;
  alert: boolean | null;
  count_studies: number;
  count_series: number;
  count_instances: number;
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function storageBar(stats: OrthancStats): string {
  if (stats.disk_used_pct === null || stats.disk_max_mb === null) {
    return `
      <div class="sys-storage">
        <div class="sys-storage__labels">
          <span>${escapeHtml(formatMb(stats.disk_used_mb))} ${t("system.used")}</span>
        </div>
      </div>`;
  }
  const pct = Math.min(100, stats.disk_used_pct);
  const color = pct > 90 ? "#e74c3c" : pct > 70 ? "#f39c12" : "var(--accent)";
  const alertClass = stats.alert ? " sys-storage__bar--alert" : "";
  return `
    <div class="sys-storage${alertClass}">
      <div class="sys-storage__track">
        <div class="sys-storage__fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="sys-storage__labels">
        <span>${escapeHtml(formatMb(stats.disk_used_mb))} ${t("system.of")} ${escapeHtml(formatMb(stats.disk_max_mb))}</span>
        <span>${pct.toFixed(1)}%</span>
      </div>
    </div>`;
}

function renderStats(container: HTMLElement, stats: OrthancStats): void {
  const alertBanner = stats.alert
    ? `<p class="sys-alert" role="alert">
        ⚠️ ${escapeHtml(t("orthanc.storageAlertDefault", { pct: (stats.disk_used_pct ?? 0).toFixed(1) }))}
       </p>`
    : "";

  container.innerHTML = `
    <div class="sys-section">
      <div class="sys-section__label">${t("system.orthancStorage")}</div>
      ${alertBanner}
      ${storageBar(stats)}
      <div class="sys-stats-grid">
        <div class="sys-stat">
          <span class="sys-stat__value">${escapeHtml(formatMb(stats.disk_used_mb))}</span>
          <span class="sys-stat__label">${t("system.used")}</span>
        </div>
        <div class="sys-stat">
          <span class="sys-stat__value">${stats.count_studies.toLocaleString()}</span>
          <span class="sys-stat__label">${t("system.studies")}</span>
        </div>
        <div class="sys-stat">
          <span class="sys-stat__value">${stats.count_series.toLocaleString()}</span>
          <span class="sys-stat__label">${t("system.series")}</span>
        </div>
        <div class="sys-stat">
          <span class="sys-stat__value">${stats.count_instances.toLocaleString()}</span>
          <span class="sys-stat__label">${t("system.instances")}</span>
        </div>
      </div>
    </div>`;
}

function renderError(container: HTMLElement): void {
  container.innerHTML = `<p class="sys-error">${escapeHtml(t("system.loadError"))}</p>`;
}

function renderLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="sys-section">
      <div class="sys-section__label">${t("system.orthancStorage")}</div>
      <div class="sys-skeleton sys-skeleton--bar"></div>
      <div class="sys-skeleton sys-skeleton--sm"></div>
    </div>`;
}

export function mountSystemPanel(container: HTMLElement): { reload: () => void } {
  async function reload(): Promise<void> {
    renderLoading(container);
    try {
      const res = await authFetch(`${API_BASE}/v1/orthanc/statistics`);
      if (!res.ok) { renderError(container); return; }
      const stats: OrthancStats = await res.json();
      renderStats(container, stats);
    } catch {
      renderError(container);
    }
  }

  return { reload };
}

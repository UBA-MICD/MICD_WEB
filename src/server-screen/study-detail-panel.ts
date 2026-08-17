/* cspell:disable */
import { authFetch, API_BASE } from "../auth/auth.js";
import { $, escapeHtml, escapeAttr } from "../shared/dom.js";
import { showToast } from "../shared/banner.js";
import { onSelectionChange } from "../explorer/explorer.js";
import { exportStudyByIdAsZip } from "../services/export-service.js";
import { t, onLocaleChange, currentLocale } from "../i18n/i18n.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ZenodoAuthor {
  name: string;
  affiliation?: string;
}

interface ZenodoVersion {
  id: number;
  doi: string | null;
  publicationDate: string | null;
  url: string;
}

interface ZenodoRecord {
  title: string;
  authors: ZenodoAuthor[];
  publicationDate: string | null;
  license: string | null;
  description: string | null;
}

interface StudyZenodoDetail {
  doi: string;
  status: "published" | "imported" | "both";
  record: ZenodoRecord | null;
  versions: ZenodoVersion[];
  stale: boolean;
  lastSyncedAt: string | null;
  downloads: number | null;
  newVersionAvailable: boolean;
  latestVersion: string | null;
}

interface StudyZenodoCheckResult {
  upToDate: boolean;
  newVersionAvailable: boolean;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  checkedAt: string;
}

// ── State ────────────────────────────────────────────────────────────────────

let currentStudyId: string | null = null;
let abortController: AbortController | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function panel(): HTMLElement {
  return $("study-detail-panel");
}

function content(): HTMLElement {
  return $("study-detail-content");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale() === "en" ? "en-US" : "es-AR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadgeHtml(status: StudyZenodoDetail["status"]): string {
  const badges: string[] = [];
  if (status === "published" || status === "both") {
    badges.push(
      `<span class="study-item__zenodo-badge study-item__zenodo-badge--published">📤 ${escapeHtml(t("studyDetail.published"))}</span>`,
    );
  }
  if (status === "imported" || status === "both") {
    badges.push(
      `<span class="study-item__zenodo-badge study-item__zenodo-badge--imported">📥 ${escapeHtml(t("studyDetail.imported"))}</span>`,
    );
  }
  return badges.join(" ");
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderLoading(): void {
  content().innerHTML = `<p class="study-detail-panel__loading" aria-live="polite">${escapeHtml(t("studyDetail.loadingZenodo"))}</p>`;
}

function renderError(message: string): void {
  content().innerHTML = `
    <div class="study-detail-panel__error" role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
      </svg>
      <span>${escapeHtml(message)}</span>
    </div>`;
}

function renderDetail(studyId: string, detail: StudyZenodoDetail): void {
  const staleWarning = detail.stale
    ? `<div class="study-detail-panel__stale" role="alert">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        ${escapeHtml(t("studyDetail.staleWarning"))}${detail.lastSyncedAt ? escapeHtml(t("studyDetail.lastSync", { date: formatDate(detail.lastSyncedAt) })) : ""}
      </div>`
    : "";

  const isSandboxDoi = detail.doi.startsWith("10.5072/");
  const doiBase = isSandboxDoi
    ? "https://sandbox.zenodo.org"
    : "https://zenodo.org";
  const doiMatch = detail.doi.match(/zenodo\.(\d+)$/i);
  const doiUrl = doiMatch
    ? `${doiBase}/records/${doiMatch[1]}`
    : `https://doi.org/${encodeURIComponent(detail.doi)}`;

  const authorsHtml = detail.record?.authors?.length
    ? `<p class="study-detail-panel__meta-row">
        <span class="study-detail-panel__label">${escapeHtml(t("studyDetail.authors"))}</span>
        <span>${escapeHtml(detail.record.authors.map((a) => a.name).join(", "))}</span>
      </p>`
    : "";

  const licenseHtml = detail.record?.license
    ? `<p class="study-detail-panel__meta-row">
        <span class="study-detail-panel__label">${escapeHtml(t("common.license"))}</span>
        <span>${escapeHtml(detail.record.license)}</span>
      </p>`
    : "";

  const dateHtml = detail.record?.publicationDate
    ? `<p class="study-detail-panel__meta-row">
        <span class="study-detail-panel__label">${escapeHtml(t("studyDetail.date"))}</span>
        <span>${escapeHtml(formatDate(detail.record.publicationDate))}</span>
      </p>`
    : "";

  const downloadsHtml =
    detail.downloads !== null
      ? `<p class="study-detail-panel__meta-row">
        <span class="study-detail-panel__label">${escapeHtml(t("studyDetail.downloads"))}</span>
        <span>${escapeHtml(String(detail.downloads))}</span>
      </p>`
      : "";

  const versionsHtml =
    detail.versions.length > 0
      ? `<section class="study-detail-panel__section">
        <h3 class="study-detail-panel__section-title">${escapeHtml(t("studyDetail.versionHistory"))}</h3>
        <ol class="study-detail-panel__versions">
          ${detail.versions
            .slice()
            .reverse()
            .map((v, i, arr) => {
              const isLatest = i === 0;
              const vDoi = v.doi ?? "";
              const vUrl = v.url;
              return `<li class="study-detail-panel__version${isLatest ? " study-detail-panel__version--latest" : ""}">
                <a href="${escapeAttr(vUrl)}" target="_blank" rel="noopener noreferrer" class="study-detail-panel__version-doi">${escapeHtml(vDoi || `#${v.id}`)}</a>
                <span class="study-detail-panel__version-date">${escapeHtml(formatDate(v.publicationDate))}${isLatest ? ` <em>${escapeHtml(t("common.mostRecent"))}</em>` : ""}</span>
              </li>`;
            })
            .join("")}
        </ol>
      </section>`
      : "";

  const importButtonHtml = detail.newVersionAvailable
    ? `<button
        type="button"
        class="btn btn--secondary study-detail-panel__import-btn"
        data-study-id="${escapeAttr(studyId)}"
        data-zenodo-doi="${escapeAttr(detail.versions[detail.versions.length - 1]?.doi ?? detail.doi)}"
      >
        ${escapeHtml(t("studyDetail.importLatestVersion"))}
      </button>`
    : "";

  const actionsHtml = `
    <div class="study-detail-panel__actions">
      <button type="button" class="btn btn--secondary study-detail-panel__check-btn">
        ${escapeHtml(t("studyDetail.checkUpdate"))}
      </button>
      ${importButtonHtml}
    </div>`;

  content().innerHTML = `
    ${staleWarning}
    <div class="study-detail-panel__header">
      <div class="study-detail-panel__badges">${statusBadgeHtml(detail.status)}</div>
      <a
        href="${escapeAttr(doiUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="study-detail-panel__doi"
        title="${escapeAttr(detail.doi)}"
        aria-label="${escapeAttr(t("studyDetail.openInZenodo", { doi: detail.doi }))}"
      >${escapeHtml(detail.doi)}</a>
    </div>

    ${
      detail.record
        ? `<section class="study-detail-panel__section">
          <h3 class="study-detail-panel__section-title">${escapeHtml(detail.record.title)}</h3>
          ${authorsHtml}
          ${dateHtml}
          ${licenseHtml}
          ${downloadsHtml}
        </section>`
        : ""
    }

    ${versionsHtml}
    ${actionsHtml}
    <div class="study-detail-panel__actions" style="margin-top: 8px;">
      <button
        type="button"
        class="btn btn--outline btn--sm"
        id="btn-export-study-detail"
        data-study-id="${escapeAttr(studyId)}"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        ${escapeHtml(t("studyDetail.exportAnonymizedZip"))}
      </button>
    </div>`;

  content()
    .querySelector(".study-detail-panel__check-btn")
    ?.addEventListener("click", () => void checkForUpdate(studyId));
}

// ── Logic ────────────────────────────────────────────────────────────────────

async function showDetail(studyId: string): Promise<void> {
  if (studyId === currentStudyId) return;
  currentStudyId = studyId;

  abortController?.abort();
  abortController = new AbortController();

  panel().classList.remove("hidden");
  renderLoading();

  try {
    const res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/zenodo`,
      {
        signal: abortController.signal,
      },
    );

    if (res.status === 404) {
      hideDetail();
      return;
    }
    if (!res.ok) {
      renderError(t("studyDetail.zenodoDataError"));
      return;
    }

    const detail: StudyZenodoDetail = await res.json();
    renderDetail(studyId, detail);
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    renderError(t("studyDetail.connectionError"));
  }
}

async function checkForUpdate(studyId: string): Promise<void> {
  const btn = content().querySelector<HTMLButtonElement>(
    ".study-detail-panel__check-btn",
  );
  if (!btn) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("common.checking");

  try {
    const res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/zenodo/check`,
      { method: "POST" },
    );
    const data = await res.json().catch(() => ({}) as { error?: string });
    if (!res.ok) {
      showToast(
        (data as { error?: string }).error ?? t("studyDetail.checkUpdateError"),
        "error",
      );
      return;
    }

    const result = data as StudyZenodoCheckResult;
    if (result.newVersionAvailable) {
      const dateStr = result.latestPublishedAt
        ? formatDate(result.latestPublishedAt)
        : null;
      showToast(
        t("studyDetail.newVersionAvailable", {
          version: result.latestVersion ?? "?",
        }) + (dateStr ? t("studyDetail.publishedOn", { date: dateStr }) : ""),
        "warning",
      );
    } else {
      showToast(t("studyDetail.upToDate"), "success");
    }

    // Force a re-fetch so the badge/flag reflects the fresh check immediately.
    currentStudyId = null;
    await showDetail(studyId);
  } catch {
    showToast(t("studyDetail.checkConnectionError"), "error");
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

function hideDetail(): void {
  currentStudyId = null;
  abortController?.abort();
  abortController = null;
  panel().classList.add("hidden");
  content().innerHTML = "";
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initStudyDetailPanel(): void {
  onSelectionChange((studyId) => {
    if (studyId) {
      void showDetail(studyId);
    } else {
      hideDetail();
    }
  });

  onLocaleChange(() => {
    if (!currentStudyId) return;
    const studyId = currentStudyId;
    currentStudyId = null; // showDetail() no-ops when studyId === currentStudyId
    void showDetail(studyId);
  });

  content().addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "#btn-export-study-detail",
    );
    if (btn && btn.dataset.studyId) {
      void exportStudyByIdAsZip(btn.dataset.studyId);
    }
  });
}

import {
  authFetch,
  ensureAuthenticated,
  isAuthenticated,
  API_BASE,
} from "../auth/auth.js";
import { escapeHtml, escapeAttr, formatDate } from "../shared/dom.js";
import { loadStudyFromServer } from "../viewer/loading.js";
import { t, onLocaleChange } from "../i18n/i18n.js";

// ── Study Explorer ────────────────────────────────────────────────────────────
//
// The study list appears on two surfaces: the compact panel beside the viewer,
// and the wide grid on the server screen's Search tab. They share one set of
// filters and one fetch — changing the search in either updates both — so the
// controls are found by data attribute inside a view root rather than by
// global id, which could only ever describe one of them.
//
// The two differ in what a click means:
//   viewer  ("open")   — clicking a study loads it immediately.
//   server  ("select") — clicking selects it; a confirm button opens it. This
//                        is the comp's "Open selected study" flow.

interface StudyRecord {
  id: number;
  orthanc_study_id: string;
  orthanc_instance_id: string;
  patient_name: string;
  patient_id: string;
  study_date: string;
  modality: string;
  study_description: string;
  uploaded_at: string;
  num_instances: number;
  zenodo_doi: string | null;
  zenodo_source_doi: string | null;
  validation_status?: string | null;
  validated_by?: string | null;
  validated_at?: string | null;
}

interface StudiesResponse {
  studies: StudyRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type ExplorerMode = "open" | "select";

interface ExplorerView {
  root: HTMLElement;
  mode: ExplorerMode;
  list: HTMLElement;
  search: HTMLInputElement | null;
  searchClear: HTMLElement | null;
  chips: HTMLElement | null;
  dateFrom: HTMLInputElement | null;
  dateTo: HTMLInputElement | null;
  description: HTMLInputElement | null;
  paginationInfo: HTMLElement | null;
  prev: HTMLButtonElement | null;
  next: HTMLButtonElement | null;
  clearWrap: HTMLElement | null;
}

const explorerState = {
  page: 1,
  totalPages: 1,
  search: "",
  modality: "",
  dateFrom: "",
  dateTo: "",
  description: "",
  zenodoLinked: false,
};

const views: ExplorerView[] = [];
/**
 * Studies uploaded during this session, badged "New" so the thing you just
 * added is findable in a list you did not sort. Client-side only and
 * deliberately not persisted: "new" means "new to you, just now".
 */
const newStudyIds = new Set<string>();
let selectedStudyId: string | null = null;
const selectionListeners: ((id: string | null) => void)[] = [];
let activateListener: ((id: string) => void) | null = null;

// ── Selection (server screen's select-then-confirm flow) ─────────────────────

export function getSelectedStudyId(): string | null {
  return selectedStudyId;
}

/** Notified whenever the selection changes, so the confirm button can follow. */
export function onSelectionChange(cb: (id: string | null) => void): void {
  selectionListeners.push(cb);
}

/**
 * Notified when the user activates the selection from the keyboard (Enter on
 * an option). The owning screen handles it, so Enter and the confirm button
 * take exactly the same path — including returning to the viewer.
 */
export function onSelectionActivate(cb: (id: string) => void): void {
  activateListener = cb;
}

function setSelected(id: string | null): void {
  selectedStudyId = id;
  views
    .filter((v) => v.mode === "select")
    .forEach((v) => {
      v.list.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
        const isSelected = el.dataset.id === id;
        el.setAttribute("aria-selected", String(isSelected));
        el.tabIndex = isSelected ? 0 : -1;
      });
    });
  selectionListeners.forEach((cb) => cb(id));
}

export function clearSelection(): void {
  setSelected(null);
}

/** Flags a study as freshly uploaded; cleared on reload. */
export function markStudyAsNew(studyId: string): void {
  newStudyIds.add(studyId);
}

// ── View registration ────────────────────────────────────────────────────────

function q<T extends HTMLElement>(root: HTMLElement, attr: string): T | null {
  return root.querySelector<T>(`[${attr}]`);
}

function registerView(root: HTMLElement): void {
  const list = q<HTMLElement>(root, "data-explorer-list");
  if (!list) return;

  const view: ExplorerView = {
    root,
    mode: root.dataset.explorerView === "server" ? "select" : "open",
    list,
    search: q<HTMLInputElement>(root, "data-explorer-search"),
    searchClear: q<HTMLElement>(root, "data-explorer-search-clear"),
    chips: q<HTMLElement>(root, "data-explorer-chips"),
    dateFrom: q<HTMLInputElement>(root, "data-explorer-date-from"),
    dateTo: q<HTMLInputElement>(root, "data-explorer-date-to"),
    description: q<HTMLInputElement>(root, "data-explorer-description"),
    paginationInfo: q<HTMLElement>(root, "data-explorer-pagination-info"),
    prev: q<HTMLButtonElement>(root, "data-explorer-prev"),
    next: q<HTMLButtonElement>(root, "data-explorer-next"),
    clearWrap: q<HTMLElement>(root, "data-explorer-clear-wrap"),
  };
  views.push(view);
  wireView(view);
}

function wireView(view: ExplorerView): void {
  // Activating a study: open it, or select it, depending on the surface.
  view.list.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-explorer-login]")) {
      void loadStudyExplorer();
      return;
    }
    const item = target.closest<HTMLElement>("[data-id]");
    const studyId = item?.dataset.id;
    if (!studyId) return;

    if (view.mode === "select") {
      setSelected(studyId);
    } else {
      void openStudy(studyId);
    }
  });

  if (view.mode === "select") wireListboxKeys(view);

  // Search, debounced. The other view's box is kept in step by syncControls().
  let searchTimer: ReturnType<typeof setTimeout>;
  view.search?.addEventListener("input", () => {
    const value = view.search!.value;
    view.searchClear?.classList.toggle("hidden", value.length === 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      explorerState.search = value.trim();
      applyFilterChange();
    }, 400);
  });
  view.searchClear?.addEventListener("click", () => {
    explorerState.search = "";
    applyFilterChange();
  });

  view.chips?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".filter-chip");
    if (!chip) return;
    if ("zenodoLinked" in chip.dataset) {
      explorerState.zenodoLinked = !explorerState.zenodoLinked;
    } else {
      explorerState.modality = chip.dataset.modality ?? "";
    }
    applyFilterChange();
  });

  view.dateFrom?.addEventListener("change", () => {
    explorerState.dateFrom = view.dateFrom!.value;
    applyFilterChange();
  });
  view.dateTo?.addEventListener("change", () => {
    explorerState.dateTo = view.dateTo!.value;
    applyFilterChange();
  });

  let descTimer: ReturnType<typeof setTimeout>;
  view.description?.addEventListener("input", () => {
    clearTimeout(descTimer);
    descTimer = setTimeout(() => {
      explorerState.description = view.description!.value.trim();
      applyFilterChange();
    }, 400);
  });

  q<HTMLElement>(view.root, "data-explorer-clear")?.addEventListener(
    "click",
    () => {
      explorerState.search = "";
      explorerState.modality = "";
      explorerState.dateFrom = "";
      explorerState.dateTo = "";
      explorerState.description = "";
      explorerState.zenodoLinked = false;
      applyFilterChange();
    },
  );

  view.prev?.addEventListener("click", () => {
    if (explorerState.page > 1) {
      explorerState.page--;
      void loadStudyExplorer();
    }
  });
  view.next?.addEventListener("click", () => {
    if (explorerState.page < explorerState.totalPages) {
      explorerState.page++;
      void loadStudyExplorer();
    }
  });
}

/** Arrow-key navigation for the listbox, per the WCAG listbox pattern. */
function wireListboxKeys(view: ExplorerView): void {
  view.list.addEventListener("keydown", (e: KeyboardEvent) => {
    const options = Array.from(
      view.list.querySelectorAll<HTMLElement>("[data-id]"),
    );
    if (options.length === 0) return;

    const current = options.findIndex(
      (el) => el.dataset.id === selectedStudyId,
    );

    if (e.key === "Enter" || e.key === " ") {
      if (selectedStudyId) {
        e.preventDefault();
        activateListener?.(selectedStudyId);
      }
      return;
    }

    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      next = current < 0 ? 0 : Math.min(current + 1, options.length - 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      next = current < 0 ? 0 : Math.max(current - 1, 0);
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = options.length - 1;
    }
    if (next === null) return;

    e.preventDefault();
    setSelected(options[next].dataset.id ?? null);
    options[next].focus();
  });
}

// ── Filter plumbing ──────────────────────────────────────────────────────────

/** A filter changed: reset to page 1, repaint every view's controls, refetch. */
function applyFilterChange(): void {
  explorerState.page = 1;
  syncControls();
  void loadStudyExplorer();
}

/** Pushes the shared filter state back into every view's controls. */
function syncControls(): void {
  const hasFilters = Boolean(
    explorerState.search ||
    explorerState.modality ||
    explorerState.dateFrom ||
    explorerState.dateTo ||
    explorerState.description ||
    explorerState.zenodoLinked,
  );

  views.forEach((view) => {
    if (view.search && view.search.value !== explorerState.search) {
      view.search.value = explorerState.search;
    }
    view.searchClear?.classList.toggle("hidden", explorerState.search === "");
    if (view.dateFrom) view.dateFrom.value = explorerState.dateFrom;
    if (view.dateTo) view.dateTo.value = explorerState.dateTo;
    if (
      view.description &&
      view.description.value !== explorerState.description
    ) {
      view.description.value = explorerState.description;
    }
    view.clearWrap?.classList.toggle("hidden", !hasFilters);

    view.chips
      ?.querySelectorAll<HTMLElement>(".filter-chip")
      .forEach((chip) => {
        const isActive =
          "zenodoLinked" in chip.dataset
            ? explorerState.zenodoLinked
            : (chip.dataset.modality ?? "") === explorerState.modality;
        chip.classList.toggle("filter-chip--active", isActive);
        chip.setAttribute("aria-pressed", String(isActive));
      });
  });
}

// ── Public entry points ──────────────────────────────────────────────────────

export function initStudyExplorer(): void {
  document
    .querySelectorAll<HTMLElement>("[data-explorer-view]")
    .forEach(registerView);
  syncControls();
  // Re-render whichever list is currently on screen when the locale changes —
  // the rows are HTML strings, not data-i18n markup. Never escalate to a login
  // prompt just because the language changed: only refetch when a session
  // already exists, otherwise repaint the logged-out state directly.
  onLocaleChange(() => {
    if (isAuthenticated()) void loadStudyExplorer();
    else renderLoggedOutExplorer();
  });
}

/**
 * Opens a study in the viewer and marks it current everywhere. Callers on the
 * server screen return to the viewer themselves — this only touches data.
 */
export async function openStudy(studyId: string): Promise<void> {
  views.forEach((v) =>
    v.list.querySelectorAll("[data-id]").forEach((el) => {
      el.setAttribute(
        "aria-current",
        String(el.getAttribute("data-id") === studyId),
      );
    }),
  );
  await loadStudyFromServer(studyId);
}

export async function loadStudyExplorer(): Promise<void> {
  // Every server-bound explorer action funnels through here: no session → gate.
  if (!(await ensureAuthenticated())) {
    renderLoggedOutExplorer();
    return;
  }

  views.forEach((v) => {
    v.list.innerHTML = `<li class="study-item study-item--loading">${escapeHtml(t("explorer.loadingStudies"))}</li>`;
  });

  const params = new URLSearchParams({
    page: String(explorerState.page),
    limit: "20",
  });
  if (explorerState.modality) params.set("modality", explorerState.modality);
  if (explorerState.dateFrom)
    params.set("date_from", explorerState.dateFrom.replace(/-/g, ""));
  if (explorerState.dateTo)
    params.set("date_to", explorerState.dateTo.replace(/-/g, ""));
  if (explorerState.search) params.set("search", explorerState.search);
  if (explorerState.description)
    params.set("description", explorerState.description);
  if (explorerState.zenodoLinked) params.set("zenodo_linked", "true");

  try {
    const res = await authFetch(`${API_BASE}/v1/studies?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: StudiesResponse = await res.json();

    explorerState.totalPages = data.totalPages || 1;
    updatePaginationUI(data.page, explorerState.totalPages, data.total);

    if (data.studies.length === 0) {
      const filtered =
        explorerState.search ||
        explorerState.modality ||
        explorerState.dateFrom ||
        explorerState.dateTo ||
        explorerState.description ||
        explorerState.zenodoLinked;
      views.forEach((v) => {
        v.list.innerHTML = emptyState(
          filtered
            ? t("explorer.noStudiesFiltered")
            : t("explorer.noStudiesLoaded"),
        );
      });
      setSelected(null);
      return;
    }

    views.forEach((view) => {
      view.list.innerHTML = data.studies
        .map((s) => renderStudy(s, view.mode))
        .join("");
      loadThumbnails(view.list);
    });

    // A selection from a previous page is meaningless once the list changes.
    if (!data.studies.some((s) => s.orthanc_study_id === selectedStudyId)) {
      setSelected(null);
    } else {
      setSelected(selectedStudyId);
    }
  } catch {
    views.forEach((v) => {
      v.list.innerHTML = `<li class="study-item study-item--error">${escapeHtml(t("explorer.loadError"))}</li>`;
    });
    explorerState.page = 1;
    explorerState.totalPages = 1;
    updatePaginationUI(1, 1, 0);
    setSelected(null);
  }
}

function zenodoRecordUrl(doi: string): string {
  const isSandbox = doi.startsWith("10.5072/");
  const base = isSandbox ? "https://sandbox.zenodo.org" : "https://zenodo.org";
  const match = doi.match(/zenodo\.(\d+)$/i);
  return match
    ? `${base}/records/${match[1]}`
    : `https://doi.org/${encodeURIComponent(doi)}`;
}

function renderStudy(s: StudyRecord, mode: ExplorerMode): string {
  const id = escapeAttr(s.orthanc_study_id);
  const modality = escapeHtml(s.modality || "?");
  const name = escapeHtml(s.patient_name || t("explorer.unknownPatient"));
  const date = formatDate(s.study_date);
  const desc = escapeHtml(s.study_description || "—");
  const count = Number(s.num_instances);
  const imgLabel =
    count === 1
      ? t("explorer.imageCountSingular")
      : t("explorer.imageCountPlural", { count });

  const isNew = newStudyIds.has(s.orthanc_study_id);
  const newBadge = isNew
    ? `<span class="study-item__new">${escapeHtml(t("explorer.newBadge"))}</span>`
    : "";

  function doiShort(doi: string): string {
    const suffix = doi.split("/").pop() ?? doi;
    return suffix.length > 8 ? "…" + suffix.slice(-8) : suffix;
  }

  const zenodoBadges = [
    s.zenodo_doi
      ? `<a class="study-item__zenodo-badge study-item__zenodo-badge--published"
           href="${escapeAttr(zenodoRecordUrl(s.zenodo_doi))}"
           target="_blank" rel="noopener noreferrer"
           title="${escapeAttr(s.zenodo_doi)}"
           aria-label="${escapeAttr(t("explorer.publishedOnZenodo", { doi: s.zenodo_doi }))}"
           onclick="event.stopPropagation()">📤 ${escapeHtml(t("explorer.zenodoBadge", { doi: doiShort(s.zenodo_doi) }))}</a>`
      : "",
    s.zenodo_source_doi
      ? `<a class="study-item__zenodo-badge study-item__zenodo-badge--imported"
           href="${escapeAttr(zenodoRecordUrl(s.zenodo_source_doi))}"
           target="_blank" rel="noopener noreferrer"
           title="${escapeAttr(s.zenodo_source_doi)}"
           aria-label="${escapeAttr(t("explorer.importedFromZenodo", { doi: s.zenodo_source_doi }))}"
           onclick="event.stopPropagation()">📥 ${escapeHtml(t("explorer.importedBadge", { doi: doiShort(s.zenodo_source_doi) }))}</a>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const body = `${newBadge}
    <span class="study-item__thumb">
      <img data-thumb-id="${id}" alt="" style="display:none" />
      <span class="study-item__thumb-fallback">${modality}</span>
    </span>
    <span class="study-item__info">
      <span class="study-item__name">${name}</span>
      <span class="study-item__date">${date} · ${desc}</span>
      <span class="study-item__meta">
        <span class="study-item__badge">${modality}</span>
        ${imgLabel}
        ${s.validation_status ? `<span class="study-item__validation-badge study-item__validation-badge--${escapeAttr(s.validation_status)}">${escapeHtml(t(`validation.status.${s.validation_status}`))}</span>` : ""}
      </span>
      ${zenodoBadges ? `<span class="study-item__zenodo-badges">${zenodoBadges}</span>` : ""}
    </span>`;

  // In the listbox each <li> IS the option; in the panel each row is a button,
  // because there a click acts immediately rather than selecting.
  const hasZenodo = s.zenodo_doi || s.zenodo_source_doi ? "true" : "false";
  return mode === "select"
    ? `<li class="study-item" role="option" data-id="${id}" data-has-zenodo="${hasZenodo}" aria-selected="false" tabindex="-1">${body}</li>`
    : `<li><button type="button" class="study-item" data-id="${id}" data-has-zenodo="${hasZenodo}">${body}</button></li>`;
}

function emptyState(message: string): string {
  return `
    <li class="study-item study-item--empty">
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
        <p>${message}</p>
      </div>
    </li>`;
}

/** What the viewer's panel shows without a session: the rule, in words. */
export function renderLoggedOutExplorer(): void {
  views.forEach((v) => {
    v.list.innerHTML = `
      <li class="study-item study-item--empty">
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
            <rect x="3" y="11" width="18" height="10" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>
            ${escapeHtml(t("explorer.loggedOutHintLine1"))}<br />
            ${escapeHtml(t("explorer.loggedOutHintLine2"))}
          </p>
          <button class="btn btn--accent" data-explorer-login>${escapeHtml(t("auth.login"))}</button>
        </div>
      </li>`;
  });
}

let thumbUrls: string[] = [];

/**
 * Thumbnails are a protected endpoint, so a plain <img src> can't carry the
 * bearer token — fetch each one and swap in a blob URL instead. (The CSP has
 * to allow blob: in img-src for this to render at all.)
 */
function loadThumbnails(list: HTMLElement): void {
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls = [];
  list
    .querySelectorAll<HTMLImageElement>("img[data-thumb-id]")
    .forEach(async (img) => {
      const studyId = img.dataset.thumbId!;
      try {
        const res = await authFetch(
          `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/thumbnail`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        thumbUrls.push(url);
        img.src = url;
        img.style.display = "";
        img.nextElementSibling?.setAttribute("style", "display:none");
      } catch {
        // leave the fallback badge visible (img stays display:none)
      }
    });
}

function updatePaginationUI(
  page: number,
  totalPages: number,
  total: number,
): void {
  views.forEach((view) => {
    if (view.paginationInfo) {
      view.paginationInfo.textContent =
        total > 0 ? `${page} / ${totalPages}` : "—";
    }
    if (view.prev) view.prev.disabled = page <= 1;
    if (view.next) view.next.disabled = page >= totalPages;
  });
}

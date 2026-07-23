import {
  authFetch,
  ensureAuthenticated,
  API_BASE,
} from "../auth/auth.js";
import { $, escapeHtml, escapeAttr, formatDate } from "../shared/dom.js";
import { loadStudyFromServer } from "../viewer/loading.js";

// ── Study Explorer ────────────────────────────────────────────────────────────

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
}

interface StudiesResponse {
  studies: StudyRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const explorerState = {
  page: 1,
  totalPages: 1,
  search: "",
  modality: "",
  dateFrom: "",
  dateTo: "",
};

function updateClearFiltersVisibility(): void {
  const active =
    explorerState.search ||
    explorerState.modality ||
    explorerState.dateFrom ||
    explorerState.dateTo;
  $("filter-clear-wrap").classList.toggle("hidden", !active);
}

export function initStudyExplorer(): void {
  // Click to view study
  const list = $("study-list");
  list.addEventListener("click", async (e) => {
    // Login button inside the logged-out placeholder — the gate pops the dialog.
    if ((e.target as HTMLElement).closest("#study-list-login")) {
      void loadStudyExplorer();
      return;
    }
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      ".study-item[data-id]",
    );
    if (!item) return;
    const studyId = item.dataset.id;
    if (!studyId) return;
    list
      .querySelectorAll(".study-item")
      .forEach((el) => el.classList.remove("study-item--active"));
    item.classList.add("study-item--active");
    await loadStudyFromServer(studyId);
  });

  // Search with debounce + inline clear button
  const searchInput = $("search-studies") as HTMLInputElement;
  const searchClear = $("btn-clear-search");
  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    searchClear.classList.toggle("hidden", val.length === 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      explorerState.search = val.trim();
      explorerState.page = 1;
      updateClearFiltersVisibility();
      void loadStudyExplorer();
    }, 400);
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.classList.add("hidden");
    explorerState.search = "";
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Modality chips
  const chipsContainer = $("filter-modality-chips");
  chipsContainer.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".filter-chip");
    if (!chip) return;
    chipsContainer
      .querySelectorAll(".filter-chip")
      .forEach((c) => c.classList.remove("filter-chip--active"));
    chip.classList.add("filter-chip--active");
    explorerState.modality = chip.dataset.modality ?? "";
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Date filters
  $("filter-date-from").addEventListener("change", (e) => {
    explorerState.dateFrom = (e.target as HTMLInputElement).value;
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });
  $("filter-date-to").addEventListener("change", (e) => {
    explorerState.dateTo = (e.target as HTMLInputElement).value;
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Clear all filters
  $("btn-clear-filters").addEventListener("click", () => {
    explorerState.search = "";
    explorerState.modality = "";
    explorerState.dateFrom = "";
    explorerState.dateTo = "";
    explorerState.page = 1;
    searchInput.value = "";
    searchClear.classList.add("hidden");
    ($("filter-date-from") as HTMLInputElement).value = "";
    ($("filter-date-to") as HTMLInputElement).value = "";
    chipsContainer
      .querySelectorAll(".filter-chip")
      .forEach((c) => c.classList.remove("filter-chip--active"));
    chipsContainer
      .querySelector<HTMLElement>('.filter-chip[data-modality=""]')
      ?.classList.add("filter-chip--active");
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Pagination
  $("pagination-prev").addEventListener("click", () => {
    if (explorerState.page > 1) {
      explorerState.page--;
      void loadStudyExplorer();
    }
  });
  $("pagination-next").addEventListener("click", () => {
    if (explorerState.page < explorerState.totalPages) {
      explorerState.page++;
      void loadStudyExplorer();
    }
  });

  // Close / reopen panel
  const panel = $("explorer-panel");
  const shell = document.querySelector<HTMLElement>(".app-shell")!;
  const btnClose = $("btn-close-explorer");
  const btnReopen = $("btn-reopen-explorer");
  btnClose.addEventListener("click", () => {
    panel.classList.add("explorer-panel--closed");
    shell.classList.add("explorer-closed");
    btnReopen.classList.remove("hidden");
  });
  btnReopen.addEventListener("click", () => {
    panel.classList.remove("explorer-panel--closed");
    shell.classList.remove("explorer-closed");
    btnReopen.classList.add("hidden");
  });
}

export async function loadStudyExplorer(): Promise<void> {
  // Every server-bound explorer action funnels through here: no session → popup.
  if (!(await ensureAuthenticated())) {
    renderLoggedOutExplorer();
    return;
  }

  const list = $("study-list");
  list.innerHTML =
    '<li class="study-item study-item--loading">Cargando estudios…</li>';

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

  try {
    const res = await authFetch(`${API_BASE}/v1/studies?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: StudiesResponse = await res.json();

    const totalPages = data.totalPages || 1;
    explorerState.totalPages = totalPages;
    updatePaginationUI(data.page, totalPages, data.total);

    if (data.studies.length === 0) {
      list.innerHTML = `
        <li class="study-item study-item--empty">
          <div class="empty-state">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
            <p>No hay estudios${explorerState.search || explorerState.modality || explorerState.dateFrom || explorerState.dateTo ? " con esos filtros" : " cargados"}.</p>
          </div>
        </li>`;
      return;
    }

    list.innerHTML = data.studies
      .map((s) => {
        const encodedId = encodeURIComponent(s.orthanc_study_id);
        const modality = escapeHtml(s.modality || "?");
        const name = escapeHtml(s.patient_name || "Paciente desconocido");
        const date = formatDate(s.study_date);
        const desc = escapeHtml(s.study_description || "—");
        const count = Number(s.num_instances);
        const imgLabel = count === 1 ? "1 imagen" : `${count} imágenes`;

        return `
        <li class="study-item" data-id="${escapeAttr(s.orthanc_study_id)}" title="Click para visualizar">
          <div class="study-item__thumb">
            <img data-thumb-id="${escapeAttr(s.orthanc_study_id)}" alt="${modality}" style="display:none" />
            <div class="study-item__thumb-fallback">${modality}</div>
          </div>
          <div class="study-item__info">
            <span class="study-item__name">${name}</span>
            <span class="study-item__date">${date} · ${desc}</span>
            <span class="study-item__meta">
              <span class="study-item__badge">${modality}</span>
              ${imgLabel} · Disponible
            </span>
          </div>
        </li>`;
      })
      .join("");
    loadThumbnails(list);
  } catch {
    list.innerHTML =
      '<li class="study-item study-item--error">Error al cargar estudios.</li>';
    explorerState.page = 1;
    explorerState.totalPages = 1;
    updatePaginationUI(1, 1, 0);
  }
}

/** What the explorer shows without a session: a prompt instead of studies. */
export function renderLoggedOutExplorer(): void {
  $("study-list").innerHTML = `
    <li class="study-item study-item--empty">
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <rect x="3" y="11" width="18" height="10" rx="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <p>Iniciá sesión para ver los estudios del servidor.</p>
        <button class="btn btn--accent" id="study-list-login">Iniciar sesión</button>
      </div>
    </li>`;
  explorerState.page = 1;
  explorerState.totalPages = 1;
  updatePaginationUI(1, 1, 0);
}

let thumbUrls: string[] = [];

/**
 * Thumbnails are a protected endpoint, so a plain <img src> can't carry the
 * bearer token — fetch each one and swap in a blob URL instead.
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
  const info = $("pagination-info");
  const btnPrev = $("pagination-prev") as HTMLButtonElement;
  const btnNext = $("pagination-next") as HTMLButtonElement;

  info.textContent = total > 0 ? `${page} / ${totalPages}` : "—";
  btnPrev.disabled = page <= 1;
  btnNext.disabled = page >= totalPages;
}

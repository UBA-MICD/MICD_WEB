import { parseDicomFile, calculateAutoWindowLevel } from './dicom-parser-util.js';
import type { ParsedDicom, DicomMetadata } from './dicom-parser-util.js';
import { renderDicom, createDefaultViewport, applyCanvasTransform, fitToContainer } from './dicom-renderer.js';
import type { ViewportState } from './dicom-renderer.js';
import { collectDicomFiles } from './folder-files.js';

// ── State ────────────────────────────────────────────────────────────────────

interface AppState {
  /** Where the current series comes from: local disk files or a server study. */
  source: 'local' | 'server';
  files: File[];
  /** Orthanc study id when source === 'server'. */
  serverStudyId: string | null;
  /** Ordered Orthanc instance ids when source === 'server'. */
  serverInstances: string[];
  currentIndex: number;
  parsed: ParsedDicom | null;
  viewport: ViewportState;
  activeTool: 'wl' | 'zoom' | 'pan';
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
  isMetadataOpen: boolean;
}

const state: AppState = {
  source: 'local',
  files: [],
  serverStudyId: null,
  serverInstances: [],
  currentIndex: 0,
  parsed: null,
  viewport: { windowCenter: 0, windowWidth: 0, zoom: 1, panX: 0, panY: 0 },
  activeTool: 'wl',
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  isMetadataOpen: false,
};

/** Number of images in the current series, regardless of source. */
function itemCount(): number {
  return state.source === 'server' ? state.serverInstances.length : state.files.length;
}

/** Load the image at state.currentIndex from whichever source is active. */
async function loadCurrent(): Promise<void> {
  if (state.source === 'server') {
    await loadCurrentServerInstance();
  } else {
    await loadCurrentFile();
  }
}

// ── DOM References ───────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFileInputs();
  initToolbar();
  initViewportInteraction();
  initDropZone();
  initMenuListeners();
  initKeyboardShortcuts();
  initSeriesNav();
  initResizeObserver();
  initUploadPanel();
  initStudyExplorer();
  loadStudyExplorer();
});

// ── Browser File Inputs ──────────────────────────────────────────────────────

function initFileInputs(): void {
  // Single/multi file picker
  const filesInput = $('open-files-input') as HTMLInputElement;
  filesInput.addEventListener('change', async () => {
    if (!filesInput.files || filesInput.files.length === 0) return;
    state.files = collectDicomFiles(Array.from(filesInput.files));
    state.currentIndex = 0;
    await loadCurrentFile();
    filesInput.value = '';
  });

  // Folder picker — loads every DICOM image in the folder so you can walk through them
  const folderInput = $('open-folder-input') as HTMLInputElement;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.addEventListener('change', async () => {
    if (!folderInput.files || folderInput.files.length === 0) return;
    const dcmFiles = collectDicomFiles(Array.from(folderInput.files));
    if (dcmFiles.length === 0) {
      showError('No se encontraron archivos DICOM en la carpeta seleccionada.');
      return;
    }
    state.files = dcmFiles;
    state.currentIndex = 0;
    await loadCurrentFile();
    folderInput.value = '';
  });

  // "Abrir carpeta" button → opens the folder picker (webkitdirectory)
  $('btn-open-folder')?.addEventListener('click', openFolder);
}

// ── File Loading ─────────────────────────────────────────────────────────────

function openFiles(): void {
  ($('open-files-input') as HTMLInputElement).click();
}

function openFolder(): void {
  ($('open-folder-input') as HTMLInputElement).click();
}

async function loadCurrentFile(): Promise<void> {
  if (state.files.length === 0) return;
  state.source = 'local';

  const file = state.files[state.currentIndex];
  showLoading(true);

  try {
    const arrayBuffer = await file.arrayBuffer();
    await displayDicom(arrayBuffer, file.name);
  } catch (err: any) {
    showError(`Failed to load DICOM file: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
}

async function loadCurrentServerInstance(): Promise<void> {
  if (!state.serverStudyId || state.serverInstances.length === 0) return;

  const studyId = state.serverStudyId;
  const instanceId = state.serverInstances[state.currentIndex];
  showLoading(true);

  try {
    const res = await fetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances/${encodeURIComponent(instanceId)}/file`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    await displayDicom(arrayBuffer, studyId);
  } catch (err: any) {
    showError(`Error al cargar la imagen del servidor: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
}

async function loadStudyFromServer(studyId: string): Promise<void> {
  showLoading(true);
  state.source = 'server';
  state.serverStudyId = studyId;
  state.serverInstances = [];
  state.files = [];
  state.currentIndex = 0;

  try {
    const res = await fetch(`${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { instances: Array<{ instanceId: string }> };
    state.serverInstances = (data.instances ?? []).map((i) => i.instanceId);
    if (state.serverInstances.length === 0) {
      showError('El estudio no tiene imágenes.');
      return;
    }
    await loadCurrentServerInstance();
  } catch (err: any) {
    showError(`Error al cargar el estudio del servidor: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
}

async function displayDicom(arrayBuffer: ArrayBuffer, name: string): Promise<void> {
  const parsed = parseDicomFile(arrayBuffer);
  state.parsed = parsed;

  if (!parsed.pixelData) {
    showError('No pixel data found. The file may use compressed transfer syntax.');
    return;
  }

  if (parsed.metadata.windowWidth > 0) {
    state.viewport = createDefaultViewport(parsed.metadata);
  } else {
    const auto = calculateAutoWindowLevel(
      parsed.pixelData,
      parsed.metadata.rescaleSlope,
      parsed.metadata.rescaleIntercept,
    );
    state.viewport = {
      windowCenter: auto.windowCenter,
      windowWidth: auto.windowWidth,
      zoom: 1,
      panX: 0,
      panY: 0,
    };
  }

  const container = $('viewport-container');
  state.viewport.zoom = fitToContainer(
    container.clientWidth,
    container.clientHeight,
    parsed.metadata.columns,
    parsed.metadata.rows,
  );

  hideDropZone();
  render();
  updateMetadataPanel();
  updateSeriesNav();
  updateInfoOverlay();

  $('topbar-title').textContent = name;
  $('topbar-title').title = name;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render(): void {
  if (!state.parsed?.pixelData) return;

  const canvas = $('dicom-canvas') as HTMLCanvasElement;
  renderDicom({
    canvas,
    pixelData: state.parsed.pixelData,
    metadata: state.parsed.metadata,
    viewport: state.viewport,
  });

  applyCanvasTransform(
    $('viewport-container') as HTMLCanvasElement,
    canvas,
    state.viewport,
  );

  updateInfoOverlay();
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function initToolbar(): void {
  const tools = ['wl', 'zoom', 'pan'] as const;
  tools.forEach((tool) => {
    const btn = $(`tool-${tool}`);
    btn.addEventListener('click', () => {
      state.activeTool = tool;
      updateToolbarUI();
    });
  });

  $('tool-reset').addEventListener('click', () => {
    if (!state.parsed) return;
    const container = $('viewport-container');
    if (state.parsed.metadata.windowWidth > 0) {
      state.viewport = createDefaultViewport(state.parsed.metadata);
    } else if (state.parsed.pixelData) {
      const auto = calculateAutoWindowLevel(
        state.parsed.pixelData,
        state.parsed.metadata.rescaleSlope,
        state.parsed.metadata.rescaleIntercept,
      );
      state.viewport = {
        windowCenter: auto.windowCenter,
        windowWidth: auto.windowWidth,
        zoom: 1,
        panX: 0,
        panY: 0,
      };
    }
    state.viewport.zoom = fitToContainer(
      container.clientWidth,
      container.clientHeight,
      state.parsed.metadata.columns,
      state.parsed.metadata.rows,
    );
    render();
  });

  $('tool-metadata').addEventListener('click', () => {
    state.isMetadataOpen = !state.isMetadataOpen;
    $('metadata-panel').classList.toggle('open', state.isMetadataOpen);
    $('tool-metadata').classList.toggle('active', state.isMetadataOpen);
  });

  $('btn-open').addEventListener('click', openFiles);

  updateToolbarUI();
}

function updateToolbarUI(): void {
  document.querySelectorAll('.toolbar__tool').forEach((el) => el.classList.remove('active'));
  $(`tool-${state.activeTool}`).classList.add('active');

  const viewport = $('viewport-container');
  viewport.className = 'viewport-container';
  viewport.classList.add(`cursor-${state.activeTool}`);
}

// ── Viewport Mouse Interaction ───────────────────────────────────────────────

function initViewportInteraction(): void {
  const container = $('viewport-container');

  container.addEventListener('mousedown', (e: MouseEvent) => {
    if (!state.parsed) return;
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!state.isDragging || !state.parsed) return;

    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;

    switch (state.activeTool) {
      case 'wl':
        state.viewport.windowWidth = Math.max(1, state.viewport.windowWidth + dx * 2);
        state.viewport.windowCenter += dy * 2;
        break;
      case 'zoom':
        state.viewport.zoom = Math.max(0.1, Math.min(10, state.viewport.zoom * (1 - dy * 0.005)));
        break;
      case 'pan':
        state.viewport.panX += dx;
        state.viewport.panY += dy;
        break;
    }

    render();
  });

  document.addEventListener('mouseup', () => {
    state.isDragging = false;
  });

  container.addEventListener('wheel', (e: WheelEvent) => {
    if (!state.parsed) return;
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
    state.viewport.zoom = Math.max(0.1, Math.min(10, state.viewport.zoom * zoomFactor));
    render();
  }, { passive: false });
}

// ── Drop Zone ────────────────────────────────────────────────────────────────

function initDropZone(): void {
  const dropZone = $('drop-zone');
  const container = $('viewport-container');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    document.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  container.addEventListener('dragenter', () => {
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e: DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !dropZone.contains(related)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', async (e: DragEvent) => {
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const dcmFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.toLowerCase().endsWith('.dcm')) {
        dcmFiles.push(file);
      }
    }

    if (dcmFiles.length > 0) {
      state.files = dcmFiles.sort((a, b) => a.name.localeCompare(b.name));
      state.currentIndex = 0;
      await loadCurrentFile();
    }
  });

  $('drop-zone-open').addEventListener('click', openFiles);
}

function hideDropZone(): void {
  $('drop-zone').classList.add('hidden');
}

function showDropZone(): void {
  $('drop-zone').classList.remove('hidden');
}

// ── Series Navigation ────────────────────────────────────────────────────────

function initSeriesNav(): void {
  $('nav-prev').addEventListener('click', async () => {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      await loadCurrent();
    }
  });

  $('nav-next').addEventListener('click', async () => {
    if (state.currentIndex < itemCount() - 1) {
      state.currentIndex++;
      await loadCurrent();
    }
  });
}

function updateSeriesNav(): void {
  const nav = $('series-nav');
  const count = itemCount();
  if (count <= 1) {
    nav.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');

  ($('nav-prev') as HTMLButtonElement).disabled = state.currentIndex === 0;
  ($('nav-next') as HTMLButtonElement).disabled = state.currentIndex === count - 1;
  $('nav-counter').textContent = `${state.currentIndex + 1} / ${count}`;
}

// ── Metadata Panel ───────────────────────────────────────────────────────────

function updateMetadataPanel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  const rows = [
    ['Patient Name', m.patientName],
    ['Patient ID', m.patientId],
    ['Birth Date', m.patientBirthDate],
    ['Sex', m.patientSex],
    ['', ''],
    ['Study Date', m.studyDate],
    ['Study Description', m.studyDescription],
    ['Accession #', m.accessionNumber],
    ['Referring Physician', m.referringPhysician],
    ['', ''],
    ['Modality', m.modality],
    ['Series', m.seriesDescription],
    ['Series #', m.seriesNumber],
    ['Instance #', m.instanceNumber],
    ['', ''],
    ['Dimensions', `${m.columns} × ${m.rows}`],
    ['Bits Allocated', String(m.bitsAllocated)],
    ['Bits Stored', String(m.bitsStored)],
    ['Photometric', m.photometricInterpretation],
    ['Pixel Repr.', m.pixelRepresentation === 0 ? 'Unsigned' : 'Signed'],
    ['Rescale Slope', String(m.rescaleSlope)],
    ['Rescale Intercept', String(m.rescaleIntercept)],
    ['Transfer Syntax', m.transferSyntaxUid],
  ];

  const tbody = $('metadata-tbody');
  tbody.innerHTML = '';

  rows.forEach(([label, value]) => {
    if (label === '' && value === '') {
      const tr = document.createElement('tr');
      tr.className = 'metadata-separator';
      tr.innerHTML = '<td colspan="2"><hr /></td>';
      tbody.appendChild(tr);
      return;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="meta-key">${escapeHtml(label)}</td><td class="meta-val">${escapeHtml(value || '—')}</td>`;
    tbody.appendChild(tr);
  });
}

// ── Info Overlay ─────────────────────────────────────────────────────────────

function updateInfoOverlay(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  $('overlay-tl').innerHTML = [m.patientName, m.patientId].filter(Boolean).join('<br>');
  $('overlay-tr').innerHTML = [m.studyDate, m.modality, m.studyDescription].filter(Boolean).join('<br>');
  $('overlay-bl').innerHTML = [
    `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
    `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
  ].join('<br>');
  $('overlay-br').innerHTML = [`${m.columns} × ${m.rows}`, `${m.bitsStored}bit`].join('<br>');
}

// ── UI Helpers ───────────────────────────────────────────────────────────────

function showLoading(show: boolean): void {
  $('loading-indicator').classList.toggle('hidden', !show);
}

function showError(message: string): void {
  showLoading(false);
  const el = $('error-message');
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// escapeHtml does not encode double-quotes; use this for HTML attribute values.
function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ── Menu Events (Electron only) ──────────────────────────────────────────────

function initMenuListeners(): void {
  if (!window.api) return;
  window.api.on('menu:open-files', () => void openFiles());
  window.api.on('menu:open-folder', () => void openFolder());
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

function initKeyboardShortcuts(): void {
  document.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (state.currentIndex > 0) {
        state.currentIndex--;
        await loadCurrent();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (state.currentIndex < itemCount() - 1) {
        state.currentIndex++;
        await loadCurrent();
      }
    }

    if (e.key === 'w' || e.key === 'W') {
      state.activeTool = 'wl';
      updateToolbarUI();
    } else if (e.key === 'z' || e.key === 'Z') {
      state.activeTool = 'zoom';
      updateToolbarUI();
    } else if (e.key === 'p' || e.key === 'P') {
      state.activeTool = 'pan';
      updateToolbarUI();
    } else if (e.key === 'r' || e.key === 'R') {
      $('tool-reset').click();
    } else if (e.key === 'm' || e.key === 'M') {
      $('tool-metadata').click();
    }
  });
}

// ── Resize Observer ──────────────────────────────────────────────────────────

function initResizeObserver(): void {
  const container = $('viewport-container');
  const observer = new ResizeObserver(() => {
    if (state.parsed) render();
  });
  observer.observe(container);
}

// ── Upload Panel ─────────────────────────────────────────────────────────────

const API_BASE = '/api';

function initUploadPanel(): void {
  // Single file upload
  const input = $('upload-input') as HTMLInputElement;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void uploadFile(file);
    input.value = '';
  });
  $('btn-upload-server')?.addEventListener('click', () => input.click());

  // Folder upload
  const folderInput = $('upload-folder-input') as HTMLInputElement;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('multiple', '');
  folderInput.addEventListener('change', async () => {
    const files = collectDicomFiles(Array.from(folderInput.files ?? []));
    if (files.length === 0) {
      showUploadStatus('No se encontraron archivos DICOM en la carpeta.', 'error');
      return;
    }
    await uploadFolderFiles(files);
    folderInput.value = '';
  });
  $('btn-upload-folder')?.addEventListener('click', () => folderInput.click());

  $('btn-refresh-studies')?.addEventListener('click', loadStudyExplorer);
}

async function uploadFile(file: File, force = false): Promise<void> {
  const progressWrap = $('upload-progress-wrap');
  const progressBar  = $('upload-progress-bar');

  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  showUploadStatus('', '');

  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const url = `${API_BASE}/v1/studies/upload${force ? '?force=true' : ''}`;
    xhr.open('POST', url);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        progressBar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
      }
    });

    xhr.addEventListener('load', () => {
      progressWrap.classList.add('hidden');

      if (xhr.status === 201) {
        showUploadStatus('Estudio cargado correctamente.', 'ok');
        loadStudyExplorer();
      } else if (xhr.status === 409) {
        const body = JSON.parse(xhr.responseText);
        showDuplicateDialog(file, body.message);
      } else if (xhr.status === 413) {
        showUploadStatus('El archivo supera el límite de 500 MB.', 'error');
      } else {
        const body = JSON.parse(xhr.responseText ?? '{}');
        showUploadStatus(body.error ?? 'Error al cargar el archivo.', 'error');
      }
      resolve();
    });

    xhr.addEventListener('error', () => {
      progressWrap.classList.add('hidden');
      showUploadStatus('Error de red al conectar con el servidor.', 'error');
      resolve();
    });

    xhr.send(formData);
  });
}

async function uploadFileSilent(file: File): Promise<'ok' | 'duplicate' | 'error'> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API_BASE}/v1/studies/upload`, { method: 'POST', body: formData });
    if (res.status === 201) return 'ok';
    if (res.status === 409) return 'duplicate';
    return 'error';
  } catch {
    return 'error';
  }
}

async function uploadFolderFiles(files: File[]): Promise<void> {
  const progressWrap = $('upload-progress-wrap');
  const progressBar  = $('upload-progress-bar');
  progressWrap.classList.remove('hidden');

  let ok = 0;
  let duplicates = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    showUploadStatus(`Subiendo ${i + 1} de ${files.length}: ${files[i].name}`, '');
    progressBar.style.width = `${Math.round((i / files.length) * 100)}%`;

    const result = await uploadFileSilent(files[i]);
    if (result === 'ok') ok++;
    else if (result === 'duplicate') duplicates++;
    else errors++;
  }

  progressBar.style.width = '100%';
  progressWrap.classList.add('hidden');

  const parts = [`${ok} de ${files.length} subidos`];
  if (duplicates > 0) parts.push(`${duplicates} ya existían (omitidos)`);
  if (errors > 0) parts.push(`${errors} errores`);

  showUploadStatus(parts.join(' · '), errors > 0 ? 'error' : 'ok');
  loadStudyExplorer();
}

function showUploadStatus(text: string, type: '' | 'ok' | 'error'): void {
  const el = $('upload-status');
  el.textContent = text;
  el.className = type ? `upload-status upload-status--${type}` : 'upload-status';
}

function showDuplicateDialog(file: File, message: string): void {
  const dialog = $('duplicate-dialog');
  const msg    = $('duplicate-msg');
  const btnYes = $('duplicate-yes');
  const btnNo  = $('duplicate-no');

  msg.textContent = message;
  dialog.classList.remove('hidden');

  const close = () => dialog.classList.add('hidden');
  btnYes.onclick = async () => { close(); await uploadFile(file, true); };
  btnNo.onclick = close;
}

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
  search: '',
  modality: '',
  dateFrom: '',
  dateTo: '',
};

function updateClearFiltersVisibility(): void {
  const active = explorerState.search || explorerState.modality || explorerState.dateFrom || explorerState.dateTo;
  $('filter-clear-wrap').classList.toggle('hidden', !active);
}

function initStudyExplorer(): void {
  // Click to view study
  const list = $('study-list');
  list.addEventListener('click', async (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.study-item[data-id]');
    if (!item) return;
    const studyId = item.dataset.id;
    if (!studyId) return;
    list.querySelectorAll('.study-item').forEach((el) => el.classList.remove('study-item--active'));
    item.classList.add('study-item--active');
    await loadStudyFromServer(studyId);
  });

  // Search with debounce + inline clear button
  const searchInput = $('search-studies') as HTMLInputElement;
  const searchClear = $('btn-clear-search');
  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    const val = searchInput.value;
    searchClear.classList.toggle('hidden', val.length === 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      explorerState.search = val.trim();
      explorerState.page = 1;
      updateClearFiltersVisibility();
      void loadStudyExplorer();
    }, 400);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    explorerState.search = '';
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Modality chips
  const chipsContainer = $('filter-modality-chips');
  chipsContainer.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.filter-chip');
    if (!chip) return;
    chipsContainer.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('filter-chip--active'));
    chip.classList.add('filter-chip--active');
    explorerState.modality = chip.dataset.modality ?? '';
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Date filters
  $('filter-date-from').addEventListener('change', (e) => {
    explorerState.dateFrom = (e.target as HTMLInputElement).value;
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });
  $('filter-date-to').addEventListener('change', (e) => {
    explorerState.dateTo = (e.target as HTMLInputElement).value;
    explorerState.page = 1;
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Clear all filters
  $('btn-clear-filters').addEventListener('click', () => {
    explorerState.search   = '';
    explorerState.modality = '';
    explorerState.dateFrom = '';
    explorerState.dateTo   = '';
    explorerState.page     = 1;
    searchInput.value = '';
    searchClear.classList.add('hidden');
    ($('filter-date-from') as HTMLInputElement).value = '';
    ($('filter-date-to')   as HTMLInputElement).value = '';
    chipsContainer.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('filter-chip--active'));
    chipsContainer.querySelector<HTMLElement>('.filter-chip[data-modality=""]')?.classList.add('filter-chip--active');
    updateClearFiltersVisibility();
    void loadStudyExplorer();
  });

  // Pagination
  $('pagination-prev').addEventListener('click', () => {
    if (explorerState.page > 1) { explorerState.page--; void loadStudyExplorer(); }
  });
  $('pagination-next').addEventListener('click', () => {
    if (explorerState.page < explorerState.totalPages) { explorerState.page++; void loadStudyExplorer(); }
  });

  // Close / reopen panel
  const panel    = $('explorer-panel');
  const shell    = document.querySelector<HTMLElement>('.app-shell')!;
  const btnClose  = $('btn-close-explorer');
  const btnReopen = $('btn-reopen-explorer');
  btnClose.addEventListener('click', () => {
    panel.classList.add('explorer-panel--closed');
    shell.classList.add('explorer-closed');
    btnReopen.classList.remove('hidden');
  });
  btnReopen.addEventListener('click', () => {
    panel.classList.remove('explorer-panel--closed');
    shell.classList.remove('explorer-closed');
    btnReopen.classList.add('hidden');
  });
}

async function loadStudyExplorer(): Promise<void> {
  const list = $('study-list');
  list.innerHTML = '<li class="study-item study-item--loading">Cargando estudios…</li>';

  const params = new URLSearchParams({ page: String(explorerState.page), limit: '20' });
  if (explorerState.modality) params.set('modality', explorerState.modality);
  if (explorerState.dateFrom)  params.set('date_from', explorerState.dateFrom.replace(/-/g, ''));
  if (explorerState.dateTo)    params.set('date_to',   explorerState.dateTo.replace(/-/g, ''));
  if (explorerState.search)    params.set('search',    explorerState.search);

  try {
    const res = await fetch(`${API_BASE}/v1/studies?${params}`);
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
            <p>No hay estudios${explorerState.search || explorerState.modality || explorerState.dateFrom || explorerState.dateTo ? ' con esos filtros' : ' cargados'}.</p>
          </div>
        </li>`;
      return;
    }

    list.innerHTML = data.studies.map((s) => {
      const encodedId = encodeURIComponent(s.orthanc_study_id);
      const modality  = escapeHtml(s.modality || '?');
      const name      = escapeHtml(s.patient_name || 'Paciente desconocido');
      const date      = formatDate(s.study_date);
      const desc      = escapeHtml(s.study_description || '—');
      const count     = Number(s.num_instances);
      const imgLabel  = count === 1 ? '1 imagen' : `${count} imágenes`;

      return `
        <li class="study-item" data-id="${escapeAttr(s.orthanc_study_id)}" title="Click para visualizar">
          <div class="study-item__thumb">
            <img
              src="${API_BASE}/v1/studies/${encodedId}/thumbnail"
              alt="${modality}"
              loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
            />
            <div class="study-item__thumb-fallback" style="display:none">${modality}</div>
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
    }).join('');
  } catch {
    list.innerHTML = '<li class="study-item study-item--error">Error al cargar estudios.</li>';
    explorerState.page = 1;
    explorerState.totalPages = 1;
    updatePaginationUI(1, 1, 0);
  }
}

function updatePaginationUI(page: number, totalPages: number, total: number): void {
  const info    = $('pagination-info');
  const btnPrev = $('pagination-prev') as HTMLButtonElement;
  const btnNext = $('pagination-next') as HTMLButtonElement;

  info.textContent    = total > 0 ? `${page} / ${totalPages}` : '—';
  btnPrev.disabled    = page <= 1;
  btnNext.disabled    = page >= totalPages;
}

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return raw || '—';
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

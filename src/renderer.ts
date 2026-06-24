import { parseDicomFile, calculateAutoWindowLevel } from './dicom-parser-util.js';
import type { ParsedDicom, DicomMetadata } from './dicom-parser-util.js';
import { renderDicom, createDefaultViewport, applyCanvasTransform, fitToContainer } from './dicom-renderer.js';
import type { ViewportState } from './dicom-renderer.js';

// ── State ────────────────────────────────────────────────────────────────────

interface AppState {
  files: File[];
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
  files: [],
  currentIndex: 0,
  parsed: null,
  viewport: { windowCenter: 0, windowWidth: 0, zoom: 1, panX: 0, panY: 0 },
  activeTool: 'wl',
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  isMetadataOpen: false,
};

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
    state.files = Array.from(filesInput.files).sort((a, b) => a.name.localeCompare(b.name));
    state.currentIndex = 0;
    await loadCurrentFile();
    filesInput.value = '';
  });

  // Folder picker
  const folderInput = $('open-folder-input') as HTMLInputElement;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.addEventListener('change', async () => {
    if (!folderInput.files || folderInput.files.length === 0) return;
    const dcmFiles = Array.from(folderInput.files)
      .filter((f) => f.name.toLowerCase().endsWith('.dcm'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (dcmFiles.length === 0) {
      showError('No se encontraron archivos .dcm en la carpeta seleccionada.');
      return;
    }
    state.files = dcmFiles;
    state.currentIndex = 0;
    await loadCurrentFile();
    folderInput.value = '';
  });
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

async function loadStudyFromServer(studyId: string): Promise<void> {
  showLoading(true);
  state.files = [];
  state.currentIndex = 0;

  try {
    const res = await fetch(`${API_BASE}/v1/studies/${studyId}/file`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    await displayDicom(arrayBuffer, studyId);
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
      await loadCurrentFile();
    }
  });

  $('nav-next').addEventListener('click', async () => {
    if (state.currentIndex < state.files.length - 1) {
      state.currentIndex++;
      await loadCurrentFile();
    }
  });
}

function updateSeriesNav(): void {
  const nav = $('series-nav');
  if (state.files.length <= 1) {
    nav.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');

  ($('nav-prev') as HTMLButtonElement).disabled = state.currentIndex === 0;
  ($('nav-next') as HTMLButtonElement).disabled = state.currentIndex === state.files.length - 1;
  $('nav-counter').textContent = `${state.currentIndex + 1} / ${state.files.length}`;
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
        await loadCurrentFile();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (state.currentIndex < state.files.length - 1) {
        state.currentIndex++;
        await loadCurrentFile();
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
    const files = Array.from(folderInput.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith('.dcm'),
    );
    if (files.length === 0) {
      showUploadStatus('No se encontraron archivos .dcm en la carpeta.', 'error');
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
  patient_name: string;
  study_date: string;
  modality: string;
  study_description: string;
  uploaded_at: string;
}

function initStudyExplorer(): void {
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
}

async function loadStudyExplorer(): Promise<void> {
  const list = $('study-list');
  list.innerHTML = '<li class="study-item study-item--loading">Cargando estudios…</li>';

  try {
    const res = await fetch(`${API_BASE}/v1/studies`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const studies: StudyRecord[] = await res.json();

    if (studies.length === 0) {
      list.innerHTML = '<li class="study-item study-item--empty">No hay estudios cargados.</li>';
      return;
    }

    list.innerHTML = studies.map((s) => `
      <li class="study-item" data-id="${escapeHtml(s.orthanc_study_id)}" title="Click para visualizar" style="cursor:pointer">
        <div class="study-item__badge">${escapeHtml(s.modality || '?')}</div>
        <div class="study-item__info">
          <span class="study-item__name">${escapeHtml(s.patient_name || 'Paciente desconocido')}</span>
          <span class="study-item__date">${formatDate(s.study_date)} · ${escapeHtml(s.study_description || '—')}</span>
        </div>
      </li>
    `).join('');
  } catch {
    list.innerHTML = '<li class="study-item study-item--error">Error al cargar estudios.</li>';
  }
}

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return raw || '—';
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

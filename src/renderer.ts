/**
 * renderer.ts — Renderer process entry point.
 * Orchestrates DICOM file loading, parsing, canvas rendering, and UI interaction.
 */

import { parseDicomFile, calculateAutoWindowLevel } from './dicom-parser-util.js';
import type { ParsedDicom, DicomMetadata } from './dicom-parser-util.js';
import { renderDicom, createDefaultViewport, applyCanvasTransform, fitToContainer } from './dicom-renderer.js';
import type { ViewportState } from './dicom-renderer.js';

// ── State ────────────────────────────────────────────────────────────────────

interface AppState {
  files: string[];
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
  initToolbar();
  initViewportInteraction();
  initDropZone();
  initMenuListeners();
  initKeyboardShortcuts();
  initSeriesNav();
  initResizeObserver();
  initUploadPanel();
  loadStudyExplorer();
});

// ── File Loading ─────────────────────────────────────────────────────────────

async function openFiles(): Promise<void> {
  const result = await window.api.dicom.openFiles();
  if (result.canceled || result.filePaths.length === 0) return;
  state.files = result.filePaths.sort();
  state.currentIndex = 0;
  await loadCurrentFile();
}

async function openFolder(): Promise<void> {
  const result = await window.api.dicom.openFolder();
  if (result.canceled || result.filePaths.length === 0) return;
  state.files = result.filePaths;
  state.currentIndex = 0;
  await loadCurrentFile();
}

async function loadCurrentFile(): Promise<void> {
  if (state.files.length === 0) return;

  const filePath = state.files[state.currentIndex];
  showLoading(true);

  try {
    const arrayBuffer = await window.api.dicom.readFile(filePath);
    const parsed = parseDicomFile(arrayBuffer);
    state.parsed = parsed;

    if (!parsed.pixelData) {
      showError('No pixel data found. The file may use compressed transfer syntax.');
      return;
    }

    // Initialize viewport with DICOM window values or auto-calculate
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

    // Fit zoom to container
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
    updateFileName(filePath);
  } catch (err: any) {
    showError(`Failed to load DICOM file: ${err.message || err}`);
  } finally {
    showLoading(false);
  }
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

  // Update cursor
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
        // Horizontal = window width, Vertical = window center
        state.viewport.windowWidth = Math.max(1, state.viewport.windowWidth + dx * 2);
        state.viewport.windowCenter += dy * 2;
        break;
      case 'zoom':
        // Vertical drag = zoom
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

  // Scroll wheel zoom
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

  // Prevent defaults on the whole document
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
    // Only remove highlight if leaving the drop zone entirely
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !dropZone.contains(related)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', async (e: DragEvent) => {
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Use the file paths — Electron gives us the path property
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as any;
      if (file.path) {
        paths.push(file.path);
      }
    }

    if (paths.length > 0) {
      state.files = paths.sort();
      state.currentIndex = 0;
      await loadCurrentFile();
    }
  });

  // Drop zone open button
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
    ['', ''], // separator
    ['Study Date', m.studyDate],
    ['Study Description', m.studyDescription],
    ['Accession #', m.accessionNumber],
    ['Referring Physician', m.referringPhysician],
    ['', ''], // separator
    ['Modality', m.modality],
    ['Series', m.seriesDescription],
    ['Series #', m.seriesNumber],
    ['Instance #', m.instanceNumber],
    ['', ''], // separator
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

// ── Info Overlay (HUD on viewport corners) ───────────────────────────────────

function updateInfoOverlay(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  // Top-left: patient info
  $('overlay-tl').innerHTML = [
    m.patientName,
    m.patientId,
  ].filter(Boolean).join('<br>');

  // Top-right: study info
  $('overlay-tr').innerHTML = [
    m.studyDate,
    m.modality,
    m.studyDescription,
  ].filter(Boolean).join('<br>');

  // Bottom-left: W/L and zoom
  $('overlay-bl').innerHTML = [
    `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
    `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
  ].join('<br>');

  // Bottom-right: image info
  $('overlay-br').innerHTML = [
    `${m.columns} × ${m.rows}`,
    `${m.bitsStored}bit`,
  ].join('<br>');
}

// ── UI Helpers ───────────────────────────────────────────────────────────────

function updateFileName(filePath: string): void {
  const parts = filePath.split(/[/\\]/);
  const fileName = parts[parts.length - 1] || filePath;
  $('topbar-title').textContent = fileName;
  $('topbar-title').title = filePath;
}

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

// ── Menu Events ──────────────────────────────────────────────────────────────

function initMenuListeners(): void {
  window.api.on('menu:open-files', () => void openFiles());
  window.api.on('menu:open-folder', () => void openFolder());
}

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────

function initKeyboardShortcuts(): void {
  document.addEventListener('keydown', async (e: KeyboardEvent) => {
    // Arrow keys for series navigation
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

    // Tool shortcuts
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
    if (state.parsed) {
      render();
    }
  });
  observer.observe(container);
}

// ── Upload Panel ─────────────────────────────────────────────────────────────

const API_BASE = '/api';

function initUploadPanel(): void {
  const input = document.getElementById('upload-input') as HTMLInputElement | null;
  if (!input) return;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) uploadFile(file);
    input.value = '';
  });

  const btn = document.getElementById('btn-upload-server');
  btn?.addEventListener('click', () => input.click());

  const refresh = document.getElementById('btn-refresh-studies');
  refresh?.addEventListener('click', loadStudyExplorer);
}

async function uploadFile(file: File, force = false): Promise<void> {
  const progressWrap = document.getElementById('upload-progress-wrap')!;
  const progressBar  = document.getElementById('upload-progress-bar')!;
  const uploadStatus = document.getElementById('upload-status')!;

  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  uploadStatus.textContent = '';

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
        uploadStatus.textContent = 'Estudio cargado correctamente.';
        uploadStatus.className = 'upload-status upload-status--ok';
        loadStudyExplorer();
      } else if (xhr.status === 409) {
        const body = JSON.parse(xhr.responseText);
        showDuplicateDialog(file, body.message);
      } else if (xhr.status === 413) {
        uploadStatus.textContent = 'El archivo supera el límite de 500 MB.';
        uploadStatus.className = 'upload-status upload-status--error';
      } else {
        const body = JSON.parse(xhr.responseText ?? '{}');
        uploadStatus.textContent = body.error ?? 'Error al cargar el archivo.';
        uploadStatus.className = 'upload-status upload-status--error';
      }
      resolve();
    });

    xhr.addEventListener('error', () => {
      progressWrap.classList.add('hidden');
      uploadStatus.textContent = 'Error de red al conectar con el servidor.';
      uploadStatus.className = 'upload-status upload-status--error';
      resolve();
    });

    xhr.send(formData);
  });
}

function showDuplicateDialog(file: File, message: string): void {
  const dialog = document.getElementById('duplicate-dialog')!;
  const msg    = document.getElementById('duplicate-msg')!;
  const btnYes = document.getElementById('duplicate-yes')!;
  const btnNo  = document.getElementById('duplicate-no')!;

  msg.textContent = message;
  dialog.classList.remove('hidden');

  const close = () => dialog.classList.add('hidden');

  btnYes.onclick = async () => {
    close();
    await uploadFile(file, true);
  };
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

async function loadStudyExplorer(): Promise<void> {
  const list = document.getElementById('study-list');
  if (!list) return;

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
      <li class="study-item" data-id="${s.orthanc_study_id}">
        <div class="study-item__badge">${s.modality || '?'}</div>
        <div class="study-item__info">
          <span class="study-item__name">${s.patient_name || 'Paciente desconocido'}</span>
          <span class="study-item__date">${formatDate(s.study_date)} · ${s.study_description || '—'}</span>
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

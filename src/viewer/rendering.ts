import { renderDicom, applyCanvasTransform } from "../dicom/dicom-renderer.js";
import { $, escapeHtml } from "../shared/dom.js";
import { state, itemCount } from "./state.js";

// ── Rendering ────────────────────────────────────────────────────────────────

export function render(): void {
  if (!state.parsed?.pixelData) return;

  const canvas = $("dicom-canvas") as HTMLCanvasElement;
  renderDicom({
    canvas,
    pixelData: state.parsed.pixelData,
    metadata: state.parsed.metadata,
    viewport: state.viewport,
  });

  applyCanvasTransform(
    $("viewport-container") as HTMLCanvasElement,
    canvas,
    state.viewport,
  );

  updateInfoOverlay();
}

// ── Series Navigation ────────────────────────────────────────────────────────

export function updateSeriesNav(): void {
  const nav = $("series-nav");
  const count = itemCount();

  // Condicional de UI: Si la serie contiene una (1) sola imagen, ocultar completamente
  if (count <= 1) {
    nav.classList.add("hidden");
    updateMprButtonState();
    return;
  }
  nav.classList.remove("hidden");

  ($("nav-prev") as HTMLButtonElement).disabled = state.currentIndex === 0;
  ($("nav-next") as HTMLButtonElement).disabled =
    state.currentIndex === count - 1;

  const slider = $("nav-slider") as HTMLInputElement | null;
  if (slider) {
    slider.min = "0";
    slider.max = String(count - 1);
    slider.value = String(state.currentIndex);
  }

  $("nav-counter").textContent = `Corte ${state.currentIndex + 1}/${count}`;

  updateMprButtonState();
}

// ── MPR Button Tooltip / Validation State ─────────────────────────────────────

export function updateMprButtonState(): void {
  const mprBtn = $("tool-mpr") as HTMLButtonElement | null;
  if (!mprBtn) return;

  const count = itemCount();
  if (count <= 1) {
    mprBtn.disabled = true;
    mprBtn.title =
      "Estudio no compatible con MPR: requiere una serie con más de 1 corte.";
    mprBtn.classList.add("disabled");
    return;
  }

  if (!state.parsed || !state.parsed.metadata) {
    mprBtn.disabled = true;
    mprBtn.title = "Cargando metadatos del estudio…";
    mprBtn.classList.add("disabled");
    return;
  }

  const meta = state.parsed.metadata;
  if (
    !meta.pixelSpacing ||
    meta.pixelSpacing.length < 2 ||
    meta.pixelSpacing[0] <= 0 ||
    meta.pixelSpacing[1] <= 0
  ) {
    mprBtn.disabled = true;
    mprBtn.title =
      "Estudio no compatible con MPR: falta el tag PixelSpacing (0028,0030).";
    mprBtn.classList.add("disabled");
    return;
  }

  if (!meta.imagePositionPatient || meta.imagePositionPatient.length < 3) {
    mprBtn.disabled = true;
    mprBtn.title =
      "Estudio no compatible con MPR: falta el tag ImagePositionPatient (0020,0032).";
    mprBtn.classList.add("disabled");
    return;
  }

  mprBtn.disabled = false;
  mprBtn.title = "Reconstrucción Multiplanar (MPR)";
  mprBtn.classList.remove("disabled");
}

// ── Metadata Panel ───────────────────────────────────────────────────────────

export function updateMetadataPanel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  const rows = [
    ["Patient Name", m.patientName],
    ["Patient ID", m.patientId],
    ["Birth Date", m.patientBirthDate],
    ["Sex", m.patientSex],
    ["", ""],
    ["Study Date", m.studyDate],
    ["Study Description", m.studyDescription],
    ["Accession #", m.accessionNumber],
    ["Referring Physician", m.referringPhysician],
    ["", ""],
    ["Modality", m.modality],
    ["Series", m.seriesDescription],
    ["Series #", m.seriesNumber],
    ["Instance #", m.instanceNumber],
    ["", ""],
    ["Dimensions", `${m.columns} × ${m.rows}`],
    [
      "Pixel Spacing",
      m.pixelSpacing ? `${m.pixelSpacing[0]} × ${m.pixelSpacing[1]} mm` : "—",
    ],
    [
      "Image Position",
      m.imagePositionPatient ? m.imagePositionPatient.join(", ") : "—",
    ],
    ["Bits Allocated", String(m.bitsAllocated)],
    ["Bits Stored", String(m.bitsStored)],
    ["Photometric", m.photometricInterpretation],
    ["Pixel Repr.", m.pixelRepresentation === 0 ? "Unsigned" : "Signed"],
    ["Rescale Slope", String(m.rescaleSlope)],
    ["Rescale Intercept", String(m.rescaleIntercept)],
    ["Transfer Syntax", m.transferSyntaxUid],
  ];

  const tbody = $("metadata-tbody");
  tbody.innerHTML = "";

  rows.forEach(([label, value]) => {
    if (label === "" && value === "") {
      const tr = document.createElement("tr");
      tr.className = "metadata-separator";
      tr.innerHTML = '<td colspan="2"><hr /></td>';
      tbody.appendChild(tr);
      return;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="meta-key">${escapeHtml(label)}</td><td class="meta-val">${escapeHtml(value || "—")}</td>`;
    tbody.appendChild(tr);
  });
}

// ── Info Overlay ─────────────────────────────────────────────────────────────

export function updateInfoOverlay(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  $("overlay-tl").innerHTML = [m.patientName, m.patientId]
    .filter(Boolean)
    .join("<br>");
  $("overlay-tr").innerHTML = [m.studyDate, m.modality, m.studyDescription]
    .filter(Boolean)
    .join("<br>");
  $("overlay-bl").innerHTML = [
    `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
    `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
  ].join("<br>");
  $("overlay-br").innerHTML = [
    `${m.columns} × ${m.rows}`,
    `${m.bitsStored}bit`,
  ].join("<br>");
}

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
  if (count <= 1) {
    nav.classList.add("hidden");
    return;
  }
  nav.classList.remove("hidden");

  ($("nav-prev") as HTMLButtonElement).disabled = state.currentIndex === 0;
  ($("nav-next") as HTMLButtonElement).disabled =
    state.currentIndex === count - 1;
  $("nav-counter").textContent = `${state.currentIndex + 1} / ${count}`;
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

  // Every value here comes out of the DICOM file, i.e. untrusted input, and
  // goes into innerHTML. It was interpolated raw before, so a crafted study
  // could inject markup — and the CSP allows 'unsafe-inline' scripts.
  const lines = (parts: (string | number)[]): string =>
    parts
      .filter((part) => part !== "" && part !== null && part !== undefined)
      .map((part) => escapeHtml(String(part)))
      .join("<br>");

  $("overlay-tl").innerHTML = lines([m.patientName, m.patientId]);
  $("overlay-tr").innerHTML = lines([
    m.studyDate,
    m.modality,
    m.studyDescription,
  ]);
  $("overlay-bl").innerHTML = lines([
    `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
    `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
  ]);
  $("overlay-br").innerHTML = lines([
    `${m.columns} × ${m.rows}`,
    `${m.bitsStored}bit`,
  ]);

  updateCanvasLabel();
}

/**
 * The canvas is the whole point of the app and was an unlabelled black box to
 * assistive tech. Describe what is on it, refreshed whenever the overlay is.
 */
function updateCanvasLabel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;
  const count = itemCount();

  const parts = [
    "Imagen DICOM",
    m.patientName && `paciente ${m.patientName}`,
    m.modality,
    m.studyDate,
    m.studyDescription,
    count > 1 && `imagen ${state.currentIndex + 1} de ${count}`,
    `${m.columns} por ${m.rows} píxeles`,
  ].filter(Boolean);

  $("dicom-canvas").setAttribute("aria-label", parts.join(", "));
}

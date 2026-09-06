import { renderDicom, applyCanvasTransform } from "../dicom/dicom-renderer.js";
import { $, escapeHtml } from "../shared/dom.js";
import { state, itemCount } from "./state.js";
import { mpr3DViewer } from "./mpr.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import { getViewportManager } from "./viewport-registry.js";

// ── Rendering ────────────────────────────────────────────────────────────────

export function render(): void {
  const canvas = $("dicom-canvas") as HTMLCanvasElement;

  if (state.is3DMode && mpr3DViewer.isActive) {
    // 3D Unified Viewport rendering
    mpr3DViewer.render(canvas);

    // Show and update depth slider and orientation widget
    update3DControls();
    updateOrientationLabels();
    return;
  }

  // Standard 2D Slice rendering
  hide3DControls();
  if (!state.parsed?.pixelData) {
    updateOrientationLabels();
    return;
  }

  const manager = getViewportManager();
  const activeVp = manager?.activeViewport;
  const overlay = activeVp?.data.overlay;

  renderDicom({
    canvas,
    pixelData: state.parsed.pixelData,
    metadata: state.parsed.metadata,
    viewport: state.viewport,
    overlayPixelData: overlay?.parsed?.pixelData,
    overlayMetadata: overlay?.parsed?.metadata,
    overlayViewport: overlay?.viewport,
  });

  applyCanvasTransform(
    $("viewport-container") as HTMLCanvasElement,
    canvas,
    state.viewport,
  );

  updateInfoOverlay();
  updateOrientationLabels();
}

// ── 2D Orientation Labels (A, P, L, R) ───────────────────────────────────────

export function updateOrientationLabels(): void {
  const top = $("mpr-orient-top");
  const bottom = $("mpr-orient-bottom");
  const left = $("mpr-orient-left");
  const right = $("mpr-orient-right");

  if (!state.parsed?.pixelData || state.is3DMode) {
    if (top) top.textContent = "";
    if (bottom) bottom.textContent = "";
    if (left) left.textContent = "";
    if (right) right.textContent = "";
    return;
  }

  if (top) top.textContent = "A";
  if (bottom) bottom.textContent = "P";
  if (left) left.textContent = "R";
  if (right) right.textContent = "L";
}

// ── 3D Controls Update ───────────────────────────────────────────────────────

export function update3DControls(): void {
  const depthWrap = $("mpr-depth-slider-wrap");
  const orientWidget = $("mpr-orientation-widget");
  const refCube = $("mpr-reference-cube");

  if (depthWrap) depthWrap.classList.remove("hidden");
  if (orientWidget) orientWidget.classList.remove("hidden");
  if (refCube) refCube.classList.remove("hidden");

  const depthInfo = mpr3DViewer.getDepthInfo();
  const depthSlider = $("mpr-depth-slider") as HTMLInputElement | null;
  const depthCounter = $("mpr-depth-counter");

  if (depthSlider) {
    depthSlider.min = "0";
    depthSlider.max = String(Math.max(0, depthInfo.total - 1));
    depthSlider.value = String(depthInfo.current);
  }

  if (depthCounter) {
    depthCounter.textContent = t("viewer.mpr.sliceCounter", {
      current: depthInfo.current + 1,
      total: depthInfo.total,
    });
  }

  updateMprButtonState();

  // Update Tri-Planar sliders
  if (mpr3DViewer.volume) {
    const scrollAxial = $("mpr-scroll-axial") as HTMLInputElement | null;
    const scrollCoronal = $("mpr-scroll-coronal") as HTMLInputElement | null;
    const scrollSagittal = $("mpr-scroll-sagittal") as HTMLInputElement | null;

    if (scrollAxial && document.activeElement !== scrollAxial) {
      scrollAxial.min = "0";
      scrollAxial.max = String(Math.max(0, mpr3DViewer.volume.depth - 1));
      scrollAxial.value = String(mpr3DViewer.crosshair.z);
    }
    if (scrollCoronal && document.activeElement !== scrollCoronal) {
      scrollCoronal.min = "0";
      scrollCoronal.max = String(Math.max(0, mpr3DViewer.volume.rows - 1));
      scrollCoronal.value = String(mpr3DViewer.crosshair.y);
    }
    if (scrollSagittal && document.activeElement !== scrollSagittal) {
      scrollSagittal.min = "0";
      scrollSagittal.max = String(Math.max(0, mpr3DViewer.volume.cols - 1));
      scrollSagittal.value = String(mpr3DViewer.crosshair.x);
    }
  }
}

export function hide3DControls(): void {
  const depthWrap = $("mpr-depth-slider-wrap");
  const orientWidget = $("mpr-orientation-widget");
  const refCube = $("mpr-reference-cube");

  if (depthWrap) depthWrap.classList.add("hidden");
  if (orientWidget) orientWidget.classList.add("hidden");
  if (refCube) refCube.classList.add("hidden");
}

// ── Series Navigation ────────────────────────────────────────────────────────

export function updateSeriesNav(): void {
  const nav = $("series-nav");
  const count = itemCount();

  if (count <= 1 || state.is3DMode) {
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

  $("nav-counter").textContent = t("viewer.nav.sliceCounter", {
    current: state.currentIndex + 1,
    count,
  });

  updateMprButtonState();
}

// ── MPR Button Tooltip / Validation State ─────────────────────────────────────

export function updateMprButtonState(): void {
  const mprBtn = $("tool-mpr") as HTMLButtonElement | null;
  if (!mprBtn) return;

  const count = itemCount();
  if (count <= 1) {
    mprBtn.disabled = true;
    mprBtn.title = t("viewer.mpr.notCompatibleSlices");
    mprBtn.classList.add("disabled");
    return;
  }

  if (!state.parsed || !state.parsed.metadata) {
    mprBtn.disabled = true;
    mprBtn.title = t("viewer.mpr.loadingMetadata");
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
    mprBtn.title = t("viewer.mpr.notCompatiblePixelSpacing");
    mprBtn.classList.add("disabled");
    return;
  }

  if (!meta.imagePositionPatient || meta.imagePositionPatient.length < 3) {
    mprBtn.disabled = true;
    mprBtn.title = t("viewer.mpr.notCompatibleImagePosition");
    mprBtn.classList.add("disabled");
    return;
  }

  mprBtn.disabled = false;
  mprBtn.title = state.is3DMode
    ? t("viewer.mpr.backTo2D")
    : t("viewer.mpr.enabledTitle");
  mprBtn.classList.remove("disabled");
  mprBtn.classList.toggle("active", state.is3DMode);
}

// ── Metadata Panel ───────────────────────────────────────────────────────────

export function updateMetadataPanel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  const rows = [
    [t("viewer.metadata.patientName"), m.patientName],
    [t("viewer.metadata.patientId"), m.patientId],
    [t("viewer.metadata.birthDate"), m.patientBirthDate],
    [t("viewer.metadata.sex"), m.patientSex],
    ["", ""],
    [t("viewer.metadata.studyDate"), m.studyDate],
    [t("viewer.metadata.studyDescription"), m.studyDescription],
    [t("viewer.metadata.accessionNumber"), m.accessionNumber],
    [t("viewer.metadata.referringPhysician"), m.referringPhysician],
    ["", ""],
    [t("viewer.metadata.modality"), m.modality],
    [t("viewer.metadata.series"), m.seriesDescription],
    [t("viewer.metadata.seriesNumber"), m.seriesNumber],
    [t("viewer.metadata.instanceNumber"), m.instanceNumber],
    ["", ""],
    [t("viewer.metadata.dimensions"), `${m.columns} × ${m.rows}`],
    [
      t("viewer.metadata.pixelSpacing"),
      m.pixelSpacing ? `${m.pixelSpacing[0]} × ${m.pixelSpacing[1]} mm` : "—",
    ],
    [
      t("viewer.metadata.imagePosition"),
      m.imagePositionPatient ? m.imagePositionPatient.join(", ") : "—",
    ],
    [t("viewer.metadata.bitsAllocated"), String(m.bitsAllocated)],
    [t("viewer.metadata.bitsStored"), String(m.bitsStored)],
    [t("viewer.metadata.photometric"), m.photometricInterpretation],
    [
      t("viewer.metadata.pixelRepr"),
      m.pixelRepresentation === 0
        ? t("viewer.metadata.valueUnsigned")
        : t("viewer.metadata.valueSigned"),
    ],
    [t("viewer.metadata.rescaleSlope"), String(m.rescaleSlope)],
    [t("viewer.metadata.rescaleIntercept"), String(m.rescaleIntercept)],
    [t("viewer.metadata.transferSyntax"), m.transferSyntaxUid],
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

  const overlayTl = document.getElementById("overlay-tl");
  const overlayTr = document.getElementById("overlay-tr");
  const overlayBl = document.getElementById("overlay-bl");
  const overlayBr = document.getElementById("overlay-br");

  if (overlayTl) overlayTl.innerHTML = lines([m.patientName, m.patientId]);
  if (overlayTr) {
    overlayTr.innerHTML = lines([m.studyDate, m.modality, m.studyDescription]);
  }
  if (overlayBl) {
    overlayBl.innerHTML = lines([
      `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
      `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
    ]);
  }
  if (overlayBr) {
    overlayBr.innerHTML = lines([
      `${m.columns} × ${m.rows}`,
      `${m.bitsStored}bit`,
    ]);
  }

  updateCanvasLabel();
  updateWlControlsUI();
}

export function updateWlControlsUI(): void {
  const valWW = $("val-ww");
  const valWL = $("val-wl");
  const sliderWW = $("slider-ww") as HTMLInputElement | null;
  const sliderWL = $("slider-wl") as HTMLInputElement | null;

  const ww = Math.round(state.viewport.windowWidth);
  const wl = Math.round(state.viewport.windowCenter);

  if (valWW) valWW.textContent = String(ww);
  if (valWL) valWL.textContent = String(wl);

  if (sliderWW) {
    if (ww > parseInt(sliderWW.max, 10)) {
      sliderWW.max = String(Math.ceil(ww * 1.5));
    }
    if (document.activeElement !== sliderWW) {
      sliderWW.value = String(ww);
    }
  }

  if (sliderWL) {
    if (wl < parseInt(sliderWL.min, 10)) {
      sliderWL.min = String(Math.floor(wl - 1000));
    }
    if (wl > parseInt(sliderWL.max, 10)) {
      sliderWL.max = String(Math.ceil(wl + 1000));
    }
    if (document.activeElement !== sliderWL) {
      sliderWL.value = String(wl);
    }
  }
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
    t("viewer.canvasLabel.imageDicom"),
    m.patientName && t("viewer.canvasLabel.patient", { name: m.patientName }),
    m.modality,
    m.studyDate,
    m.studyDescription,
    count > 1 &&
      t("viewer.canvasLabel.imageOf", {
        current: state.currentIndex + 1,
        total: count,
      }),
    t("viewer.canvasLabel.pixels", { cols: m.columns, rows: m.rows }),
  ].filter(Boolean);

  $("dicom-canvas").setAttribute("aria-label", parts.join(", "));
}

// Re-run every computed-text render on a locale switch: these build their own
// markup/attributes rather than going through data-i18n, so main.ts's global
// applyTranslations() pass doesn't reach them.
onLocaleChange(() => {
  updateMetadataPanel();
  updateSeriesNav();
  updateInfoOverlay();
});

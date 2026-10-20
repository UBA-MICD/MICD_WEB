import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  viewerFixtureHtml,
  stubCanvas2DContext,
} from "../../test/viewer-fixture.ts";
import {
  render,
  update3DControls,
  hide3DControls,
  updateSeriesNav,
  updateMprButtonState,
  updateMetadataPanel,
  updateInfoOverlay,
  updateWlControlsUI,
  updateOrientationLabels,
} from "./rendering.ts";
import { state, itemCount } from "./state.ts";
import { mpr3DViewer } from "./mpr.ts";

test.before(() => {
  installDom();
  stubCanvas2DContext();
});
test.after(() => uninstallDom());

function resetState(): void {
  state.source = "local";
  state.files = [];
  state.serverStudyId = null;
  state.serverInstances = [];
  state.currentIndex = 0;
  state.parsed = null;
  state.viewport = {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  state.activeTool = "wl";
  state.is3DMode = false;
  mpr3DViewer.isActive = false;
}

const baseMeta = {
  patientName: "DOE, JOHN",
  patientId: "MRN1",
  patientBirthDate: "1980-01-01",
  patientSex: "M",
  studyDate: "2024-01-15",
  studyDescription: "CT CHEST",
  studyInstanceUid: "1.2.3",
  accessionNumber: "ACC1",
  referringPhysician: "",
  seriesDescription: "CHEST",
  seriesNumber: "1",
  modality: "CT",
  instanceNumber: "1",
  sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
  rows: 2,
  columns: 2,
  bitsAllocated: 16,
  bitsStored: 12,
  highBit: 11,
  pixelRepresentation: 0 as const,
  samplesPerPixel: 1,
  photometricInterpretation: "MONOCHROME2",
  rescaleIntercept: 0,
  rescaleSlope: 1,
  windowCenter: 40,
  windowWidth: 400,
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  transferSyntaxUid: "1.2.840.10008.1.2.1",
};

test.beforeEach(() => {
  setBody(viewerFixtureHtml());
  resetState();
});

test("render() does nothing when there is no parsed pixel data (and hides 3D controls)", () => {
  const wrap = document.getElementById("mpr-depth-slider-wrap")!;
  wrap.classList.remove("hidden");
  render();
  assert.equal(wrap.classList.contains("hidden"), true);
});

test("render() draws the 2D slice and updates the info overlay when pixel data is present", () => {
  state.parsed = {
    metadata: baseMeta,
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  render();
  const canvas = document.getElementById("dicom-canvas") as HTMLCanvasElement;
  assert.equal(canvas.width, 2);
  assert.equal(canvas.height, 2);
  assert.notEqual(document.getElementById("overlay-tl")!.innerHTML, "");
});

test("render() delegates to mpr3DViewer when in active 3D mode", () => {
  state.is3DMode = true;
  mpr3DViewer.isActive = true;
  let rendered = false;
  const orig = mpr3DViewer.render.bind(mpr3DViewer);
  (mpr3DViewer as any).render = (canvas: any) => {
    rendered = true;
  };
  try {
    render();
    assert.equal(rendered, true);
    assert.equal(
      document
        .getElementById("mpr-depth-slider-wrap")!
        .classList.contains("hidden"),
      false,
    );
  } finally {
    (mpr3DViewer as any).render = orig;
  }
});

test("update3DControls sets the depth slider range/value and the depth counter text", () => {
  const orig = mpr3DViewer.getDepthInfo.bind(mpr3DViewer);
  (mpr3DViewer as any).getDepthInfo = () => ({ current: 2, total: 5 });
  try {
    update3DControls();
    const slider = document.getElementById(
      "mpr-depth-slider",
    ) as HTMLInputElement;
    assert.equal(slider.min, "0");
    assert.equal(slider.max, "4");
    assert.equal(slider.value, "2");
    assert.notEqual(
      document.getElementById("mpr-depth-counter")!.textContent,
      "",
    );
  } finally {
    (mpr3DViewer as any).getDepthInfo = orig;
  }
});

test("hide3DControls hides the depth slider and orientation widget", () => {
  const wrap = document.getElementById("mpr-depth-slider-wrap")!;
  const widget = document.getElementById("mpr-orientation-widget")!;
  wrap.classList.remove("hidden");
  widget.classList.remove("hidden");
  hide3DControls();
  assert.equal(wrap.classList.contains("hidden"), true);
  assert.equal(widget.classList.contains("hidden"), true);
});

test("updateSeriesNav hides the nav when there's 0-1 items or in 3D mode", () => {
  updateSeriesNav();
  assert.equal(
    document.getElementById("series-nav")!.classList.contains("hidden"),
    true,
  );

  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.is3DMode = true;
  updateSeriesNav();
  assert.equal(
    document.getElementById("series-nav")!.classList.contains("hidden"),
    true,
  );
});

test("updateSeriesNav shows and wires the nav for a multi-item series", () => {
  state.files = [
    new File(["a"], "a.dcm"),
    new File(["b"], "b.dcm"),
    new File(["c"], "c.dcm"),
  ];
  state.currentIndex = 0;
  updateSeriesNav();

  const nav = document.getElementById("series-nav")!;
  assert.equal(nav.classList.contains("hidden"), false);
  assert.equal(
    (document.getElementById("nav-prev") as HTMLButtonElement).disabled,
    true,
  );
  assert.equal(
    (document.getElementById("nav-next") as HTMLButtonElement).disabled,
    false,
  );
  const slider = document.getElementById("nav-slider") as HTMLInputElement;
  assert.equal(slider.max, "2");
  assert.notEqual(document.getElementById("nav-counter")!.textContent, "");

  state.currentIndex = 2;
  updateSeriesNav();
  assert.equal(
    (document.getElementById("nav-next") as HTMLButtonElement).disabled,
    true,
  );
});

test("updateMprButtonState disables with a reason for <=1 items, missing metadata, bad pixelSpacing, and bad imagePosition", () => {
  const btn = document.getElementById("tool-mpr") as HTMLButtonElement;

  updateMprButtonState(); // count <= 1
  assert.equal(btn.disabled, true);
  assert.equal(btn.classList.contains("disabled"), true);

  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.parsed = null;
  updateMprButtonState(); // no parsed metadata
  assert.equal(btn.disabled, true);

  state.parsed = {
    metadata: { ...baseMeta, pixelSpacing: undefined },
    pixelData: null,
    rawDataSet: {},
  } as any;
  updateMprButtonState(); // bad pixel spacing
  assert.equal(btn.disabled, true);

  state.parsed = {
    metadata: {
      ...baseMeta,
      pixelSpacing: [0.5, 0.5] as [number, number],
      imagePositionPatient: undefined,
    },
    pixelData: null,
    rawDataSet: {},
  } as any;
  updateMprButtonState(); // bad image position
  assert.equal(btn.disabled, true);
});

test("updateMprButtonState enables the button and reflects is3DMode in title/active class", () => {
  const btn3D = document.getElementById("tool-view-3d") as HTMLButtonElement;
  const btnMpr = document.getElementById("tool-mpr") as HTMLButtonElement;
  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.parsed = {
    metadata: {
      ...baseMeta,
      pixelSpacing: [0.5, 0.5] as [number, number],
      imagePositionPatient: [0, 0, 0] as [number, number, number],
    },
    pixelData: null,
    rawDataSet: {},
  } as any;

  updateMprButtonState();
  assert.equal(btn3D.disabled, false);
  assert.equal(btn3D.classList.contains("active"), false);
  assert.equal(btnMpr.disabled, false);
  assert.equal(btnMpr.classList.contains("active"), false);

  state.is3DMode = true;
  updateMprButtonState();
  assert.equal(btn3D.classList.contains("active"), true);

  state.is3DMode = false;
  state.isMprMode = true;
  updateMprButtonState();
  assert.equal(btnMpr.classList.contains("active"), true);
});

test("updateMprButtonState is a no-op when the button doesn't exist", () => {
  document.getElementById("tool-view-3d")?.remove();
  document.getElementById("tool-mpr")?.remove();
  assert.doesNotThrow(() => updateMprButtonState());
});

test("updateMetadataPanel renders rows and separators, and returns early with no parsed study", () => {
  updateMetadataPanel();
  assert.equal(document.getElementById("metadata-tbody")!.children.length, 0);

  state.parsed = { metadata: baseMeta, pixelData: null, rawDataSet: {} } as any;
  updateMetadataPanel();
  const tbody = document.getElementById("metadata-tbody")!;
  assert.ok(tbody.children.length > 10);
  assert.ok(tbody.querySelectorAll(".metadata-separator").length >= 3);
});

test("updateMetadataPanel escapes DICOM-derived values", () => {
  state.parsed = {
    metadata: { ...baseMeta, patientName: "<img src=x onerror=alert(1)>" },
    pixelData: null,
    rawDataSet: {},
  } as any;
  updateMetadataPanel();
  const tbody = document.getElementById("metadata-tbody")!;
  assert.equal(tbody.querySelector("img"), null);
  assert.match(tbody.innerHTML, /&lt;img/);
});

test("updateMetadataPanel shows an em dash placeholder for missing pixelSpacing/imagePosition", () => {
  state.parsed = { metadata: baseMeta, pixelData: null, rawDataSet: {} } as any;
  updateMetadataPanel();
  const text = document.getElementById("metadata-tbody")!.textContent!;
  assert.match(text, /—/);
});

test("updateInfoOverlay is a no-op with no parsed study, and escapes untrusted content when present", () => {
  updateInfoOverlay();
  assert.equal(document.getElementById("overlay-tl")!.innerHTML, "");

  state.parsed = {
    metadata: { ...baseMeta, studyDescription: "<script>alert(1)</script>" },
    pixelData: null,
    rawDataSet: {},
  } as any;
  state.viewport = {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1.5,
    panX: 0,
    panY: 0,
  };
  updateInfoOverlay();

  assert.match(document.getElementById("overlay-tl")!.innerHTML, /DOE/);
  assert.match(
    document.getElementById("overlay-tr")!.innerHTML,
    /&lt;script&gt;/,
  );
  assert.match(document.getElementById("overlay-bl")!.innerHTML, /150%/);
  assert.notEqual(
    document.getElementById("dicom-canvas")!.getAttribute("aria-label"),
    null,
  );
});

test("updateInfoOverlay's canvas label mentions slice position only for multi-item series", () => {
  state.parsed = { metadata: baseMeta, pixelData: null, rawDataSet: {} } as any;
  updateInfoOverlay();
  const single = document
    .getElementById("dicom-canvas")!
    .getAttribute("aria-label")!;

  state.files = [new File(["a"], "a.dcm"), new File(["b"], "b.dcm")];
  state.currentIndex = 1;
  updateInfoOverlay();
  const multi = document
    .getElementById("dicom-canvas")!
    .getAttribute("aria-label")!;

  assert.notEqual(single, multi);
});

test("updateWlControlsUI syncs displayed values and widens slider ranges as needed", () => {
  state.viewport = {
    windowCenter: -2000,
    windowWidth: 9000,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  updateWlControlsUI();

  assert.equal(document.getElementById("val-ww")!.textContent, "9000");
  assert.equal(document.getElementById("val-wl")!.textContent, "-2000");

  const sliderWW = document.getElementById("slider-ww") as HTMLInputElement;
  const sliderWL = document.getElementById("slider-wl") as HTMLInputElement;
  assert.equal(sliderWW.value, "9000");
  assert.equal(Number(sliderWW.max) >= 9000, true);
  assert.equal(sliderWL.value, "-2000");
  assert.equal(Number(sliderWL.min) <= -2000, true);
});

test("updateWlControlsUI does not fight the user while a slider is focused", () => {
  const sliderWW = document.getElementById("slider-ww") as HTMLInputElement;
  sliderWW.focus();
  sliderWW.value = "77";
  state.viewport = {
    windowCenter: 0,
    windowWidth: 999,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  updateWlControlsUI();
  assert.equal(sliderWW.value, "77");
});

test("updateOrientationLabels clears labels when there is no pixel data or in 3D mode", () => {
  state.parsed = null;
  updateOrientationLabels();
  assert.equal(document.getElementById("mpr-orient-top")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-bottom")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-left")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-right")!.textContent, "");

  state.parsed = {
    metadata: baseMeta,
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  state.is3DMode = true;
  updateOrientationLabels();
  assert.equal(document.getElementById("mpr-orient-top")!.textContent, "");

  state.is3DMode = false;
});

test("updateOrientationLabels shows A/P/R/L in 2D mode with pixel data", () => {
  state.parsed = {
    metadata: baseMeta,
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  state.is3DMode = false;

  updateOrientationLabels();
  assert.equal(document.getElementById("mpr-orient-top")!.textContent, "A");
  assert.equal(document.getElementById("mpr-orient-bottom")!.textContent, "P");
  assert.equal(document.getElementById("mpr-orient-left")!.textContent, "R");
  assert.equal(document.getElementById("mpr-orient-right")!.textContent, "L");
});

test("updateOrientationLabels shows S/I/R/L for coronal orientation", () => {
  state.parsed = {
    metadata: {
      ...baseMeta,
      imageOrientationPatient: [1, 0, 0, 0, 0, -1],
    },
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  state.is3DMode = false;

  updateOrientationLabels();
  assert.equal(document.getElementById("mpr-orient-top")!.textContent, "S");
  assert.equal(document.getElementById("mpr-orient-bottom")!.textContent, "I");
  assert.equal(document.getElementById("mpr-orient-left")!.textContent, "R");
  assert.equal(document.getElementById("mpr-orient-right")!.textContent, "L");
});

test("updateOrientationLabels clears labels when IOP is missing or degenerate (AC-5)", () => {
  state.parsed = {
    metadata: {
      ...baseMeta,
      imageOrientationPatient: undefined,
    },
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
  state.is3DMode = false;

  updateOrientationLabels();
  assert.equal(document.getElementById("mpr-orient-top")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-bottom")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-left")!.textContent, "");
  assert.equal(document.getElementById("mpr-orient-right")!.textContent, "");
});

test("a locale change re-renders the metadata panel, series nav, and info overlay", async () => {
  const { setLocale, currentLocale } = await import("../i18n/i18n.ts");
  const original = currentLocale();
  state.parsed = { metadata: baseMeta, pixelData: null, rawDataSet: {} } as any;
  updateInfoOverlay();
  const before = document.getElementById("overlay-tl")!.innerHTML;
  document.getElementById("overlay-tl")!.innerHTML = "";

  setLocale(original === "es" ? "en" : "es");
  assert.notEqual(document.getElementById("overlay-tl")!.innerHTML, "");
  setLocale(original);
});

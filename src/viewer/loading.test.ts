/**
 * Tests for loading.ts: loadCurrent's cache-hit/miss paths, file/folder
 * input wiring, the drop zone, displayParsed, and loadStudyFromServer. Uses
 * jsdom via test/dom-setup.ts and the shared viewer fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  viewerFixtureHtml,
  stubCanvas2DContext,
} from "../../test/viewer-fixture.ts";
import {
  loadCurrent,
  resetViewerToDropZone,
  initFileInputs,
  openFiles,
  openFolder,
  initDropZone,
  displayParsed,
  loadStudyFromServer,
  seriesKeyFor,
  initialViewportFor,
} from "./loading.ts";
import { state } from "./state.ts";
import { dicomCache } from "./cache.ts";
import { getViewportManager } from "./viewport-registry.ts";
import { adoptSession, logout, type AuthUser } from "../auth/auth.ts";

test.before(() => {
  installDom();
  stubCanvas2DContext();
});
test.after(() => uninstallDom());

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
  transferSyntaxUid: "1.2.840.10008.1.2.1",
};

function mockParsed(overrides: Partial<typeof baseMeta> = {}) {
  return {
    metadata: { ...baseMeta, ...overrides },
    pixelData: new Uint16Array([0, 1, 2, 3]),
    rawDataSet: {},
  } as any;
}

function withFakeDicomParser(
  dataSet: any,
  run: () => Promise<void>,
): Promise<void> {
  const previous = (globalThis as any).dicomParser;
  (globalThis as any).dicomParser = { parseDicom: () => dataSet };
  return run().finally(() => {
    (globalThis as any).dicomParser = previous;
  });
}

function fakeDataSet(): any {
  return {
    elements: { x7fe00010: { dataOffset: 0, length: 8 } },
    byteArray: new Uint8Array(64),
    string(tag: string) {
      return (
        {
          x00280004: "MONOCHROME2",
          x00080060: "CT",
        } as Record<string, string>
      )[tag];
    },
    uint16(tag: string) {
      return (
        {
          x00280010: 2,
          x00280011: 2,
          x00280100: 16,
          x00280101: 12,
          x00280102: 11,
          x00280103: 0,
          x00280002: 1,
        } as Record<string, number>
      )[tag];
    },
    floatString() {
      return undefined;
    },
  };
}

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
  dicomCache.clear();
}

test.beforeEach(() => {
  setBody(viewerFixtureHtml());
  resetState();
});

test("loadCurrent uses the cached slice without refetching", async () => {
  dicomCache.set(0, mockParsed());
  await loadCurrent();
  assert.equal(state.parsed?.metadata.studyDescription, "CT CHEST");
  assert.notEqual(document.getElementById("topbar-title")!.textContent, "");
});

test("loadCurrent shows an error when the index can't be resolved", async () => {
  state.source = "local";
  state.files = [];
  await loadCurrent();
  assert.equal(
    document.getElementById("error-message")!.classList.contains("hidden"),
    false,
  );
});

test("resetViewerToDropZone clears state and shows the drop zone", () => {
  state.parsed = mockParsed();
  state.files = [new File(["x"], "a.dcm")] as any;
  resetViewerToDropZone();
  assert.equal(state.parsed, null);
  assert.equal(state.files.length, 0);
  assert.equal(
    document.getElementById("drop-zone")!.classList.contains("hidden"),
    false,
  );
  assert.equal(
    document.getElementById("series-nav")!.classList.contains("hidden"),
    true,
  );
});

test("openFiles/openFolder click their respective inputs", () => {
  let filesClicked = false;
  let folderClicked = false;
  document
    .getElementById("open-files-input")!
    .addEventListener("click", () => (filesClicked = true));
  document
    .getElementById("open-folder-input")!
    .addEventListener("click", () => (folderClicked = true));
  openFiles();
  openFolder();
  assert.equal(filesClicked, true);
  assert.equal(folderClicked, true);
});

test("initFileInputs: choosing files parses and displays the first one", async () => {
  initFileInputs();
  const input = document.getElementById("open-files-input") as HTMLInputElement;
  const file = new File(["x"], "a.dcm");
  Object.defineProperty(input, "files", { value: [file], configurable: true });

  await withFakeDicomParser(fakeDataSet(), async () => {
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(state.files.length, 1);
  assert.equal(state.parsed !== null, true);
});

test("initFileInputs: an empty file selection is a no-op", async () => {
  initFileInputs();
  const input = document.getElementById("open-files-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [], configurable: true });
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.files.length, 0);
});

test("initFileInputs: a folder selection with no DICOM files shows an error", async () => {
  initFileInputs();
  const input = document.getElementById(
    "open-folder-input",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["x"], "notes.txt")],
    configurable: true,
  });
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    document.getElementById("error-message")!.classList.contains("hidden"),
    false,
  );
});

test("initFileInputs: btn-open-folder click opens the folder picker", () => {
  initFileInputs();
  let clicked = false;
  document
    .getElementById("open-folder-input")!
    .addEventListener("click", () => (clicked = true));
  document
    .getElementById("btn-open-folder")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(clicked, true);
});

test("initDropZone: dragenter adds drag-over, dragleave outside removes it", () => {
  initDropZone();
  const container = document.getElementById("viewport-container")!;
  const dropZone = document.getElementById("drop-zone")!;

  container.dispatchEvent(
    new Event("dragenter", { bubbles: true, cancelable: true }),
  );
  assert.equal(dropZone.classList.contains("drag-over"), true);

  const leave = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperty(leave, "relatedTarget", { value: null });
  dropZone.dispatchEvent(leave);
  assert.equal(dropZone.classList.contains("drag-over"), false);
});

test("initDropZone: dropping .dcm files loads the first one", async () => {
  initDropZone();
  const dropZone = document.getElementById("drop-zone")!;
  const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: { files: [new File(["x"], "b.dcm"), new File(["x"], "a.dcm")] },
  });

  await withFakeDicomParser(fakeDataSet(), async () => {
    dropZone.dispatchEvent(dropEvt);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

  // sorted by name: a.dcm before b.dcm
  assert.equal(state.files[0]?.name, "a.dcm");
  assert.equal(dropZone.classList.contains("drag-over"), false);
});

test("initDropZone: dropping extension-less PACS files loads them (not just *.dcm)", async () => {
  initDropZone();
  const dropZone = document.getElementById("drop-zone")!;
  const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: {
      files: [new File(["x"], "IM000002"), new File(["x"], "IM000001")],
    },
  });

  await withFakeDicomParser(fakeDataSet(), async () => {
    dropZone.dispatchEvent(dropEvt);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

  // Numeric-aware sort: IM000001 before IM000002.
  assert.equal(state.files[0]?.name, "IM000001");
  assert.equal(state.files.length, 2);
});

test("initDropZone: dropping only non-dcm files is a no-op", async () => {
  initDropZone();
  const dropZone = document.getElementById("drop-zone")!;
  const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvt, "dataTransfer", {
    value: { files: [new File(["x"], "notes.txt")] },
  });
  dropZone.dispatchEvent(dropEvt);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.files.length, 0);
});

test("initDropZone: drop-zone-open click delegates to openFiles", () => {
  initDropZone();
  let clicked = false;
  document
    .getElementById("open-files-input")!
    .addEventListener("click", () => (clicked = true));
  document
    .getElementById("drop-zone-open")!
    .dispatchEvent(new MouseEvent("click"));
  assert.equal(clicked, true);
});

test("displayParsed shows an error when pixelData is missing", () => {
  displayParsed(
    { metadata: baseMeta, pixelData: null, rawDataSet: {} } as any,
    "empty",
  );
  assert.equal(
    document.getElementById("error-message")!.classList.contains("hidden"),
    false,
  );
});

test("displayParsed sets the topbar title and renders the canvas", () => {
  displayParsed(mockParsed(), "My Study");
  assert.equal(
    document.getElementById("topbar-title")!.textContent,
    "My Study",
  );
  assert.equal(
    document.getElementById("drop-zone")!.classList.contains("hidden"),
    true,
  );
  const canvas = document.getElementById("dicom-canvas") as HTMLCanvasElement;
  assert.equal(canvas.width, 2);
});

// ── loadStudyFromServer ──────────────────────────────────────────────────────

const testUser: AuthUser = {
  id: 1,
  email: "radiologist@example.com",
  role: "medico",
};

test.beforeEach(async () => {
  await logout().catch(() => {});
});

test("loadStudyFromServer shows an error when the instances fetch fails", async () => {
  await adoptSession("fake-token", "fake-refresh", testUser);
  (globalThis as any).fetch = async () => new Response(null, { status: 500 });
  await loadStudyFromServer("study-1");
  assert.equal(
    document.getElementById("error-message")!.classList.contains("hidden"),
    false,
  );
});

test("loadStudyFromServer shows an error when the study has no instances", async () => {
  await adoptSession("fake-token", "fake-refresh", testUser);
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ instances: [] }), { status: 200 });
  await loadStudyFromServer("study-1");
  assert.equal(
    document.getElementById("error-message")!.classList.contains("hidden"),
    false,
  );
});

test("loadStudyFromServer loads the first instance on success", async () => {
  await adoptSession("fake-token", "fake-refresh", testUser);
  let call = 0;
  (globalThis as any).fetch = async (url: string) => {
    call++;
    if (url.includes("/instances") && !url.includes("/file")) {
      return new Response(
        JSON.stringify({ instances: [{ instanceId: "i1" }] }),
        { status: 200 },
      );
    }
    return new Response(new ArrayBuffer(8), { status: 200 });
  };

  await withFakeDicomParser(fakeDataSet(), async () => {
    await loadStudyFromServer("study-1");
  });

  assert.equal(state.serverStudyId, "study-1");
  assert.equal(state.serverInstances.length, 1);
});

// ── Window/level reset across series (imagen negra al abrir otro estudio) ────

function parsedWith(
  overrides: Partial<import("../dicom/dicom-parser-util.ts").DicomMetadata>,
): import("../dicom/dicom-parser-util.ts").ParsedDicom {
  return {
    metadata: {
      patientName: "Anon",
      patientId: "1",
      patientBirthDate: "",
      patientSex: "",
      studyDate: "",
      studyDescription: "",
      studyInstanceUid: "1.2.3",
      accessionNumber: "",
      referringPhysician: "",
      seriesDescription: "S",
      seriesNumber: "1",
      modality: "CT",
      instanceNumber: "1",
      sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
      rows: 8,
      columns: 8,
      bitsAllocated: 16,
      bitsStored: 12,
      highBit: 11,
      pixelRepresentation: 0,
      samplesPerPixel: 1,
      photometricInterpretation: "MONOCHROME2",
      rescaleIntercept: 0,
      rescaleSlope: 1,
      windowCenter: 40,
      windowWidth: 400,
      transferSyntaxUid: "1.2.840.10008.1.2.1",
      ...overrides,
    },
    pixelData: new Uint16Array(64),
    rawDataSet: null,
  };
}

test("seriesKeyFor prefers SeriesInstanceUID", () => {
  assert.equal(
    seriesKeyFor(parsedWith({ seriesInstanceUid: "1.2.9.9" })),
    "1.2.9.9",
  );
});

test("seriesKeyFor falls back to a composite key without SeriesInstanceUID", () => {
  const key = seriesKeyFor(parsedWith({}));
  assert.ok(key.includes("1.2.3"), "should carry the study UID");
  assert.ok(key.includes("CT"), "should carry the modality");
  assert.ok(key.includes("8x8"), "should carry the dimensions");
});

test("seriesKeyFor separates two series of the same study", () => {
  assert.notEqual(
    seriesKeyFor(parsedWith({ seriesInstanceUid: "1.2.3.1" })),
    seriesKeyFor(parsedWith({ seriesInstanceUid: "1.2.3.2" })),
  );
});

test("initialViewportFor takes the window stored in the DICOM", () => {
  const vp = initialViewportFor(parsedWith({ windowCenter: 50, windowWidth: 350 }));
  assert.equal(vp.windowCenter, 50);
  assert.equal(vp.windowWidth, 350);
});

test("initialViewportFor computes an automatic window when the DICOM has none", () => {
  const vp = initialViewportFor(parsedWith({ windowWidth: 0, windowCenter: 0 }));
  assert.ok(vp.windowWidth > 0, "an automatic window must be non-degenerate");
});

test("displayParsed resets the window when a different series is opened", () => {
  stubCanvas2DContext();
  // Primera serie, con el usuario ajustando el brillo a mano.
  displayParsed(parsedWith({ seriesInstanceUid: "serie-A" }), "A");
  state.viewport.windowCenter = -600;
  state.viewport.windowWidth = 1500;

  // Otra serie: hereda -600/1500 ⇒ se ve negra. Debe reiniciarse.
  displayParsed(
    parsedWith({
      seriesInstanceUid: "serie-B",
      windowCenter: 40,
      windowWidth: 400,
    }),
    "B",
  );

  assert.equal(state.viewport.windowCenter, 40);
  assert.equal(state.viewport.windowWidth, 400);
});

test("displayParsed keeps the user's window while scrolling the same series", () => {
  stubCanvas2DContext();
  displayParsed(parsedWith({ seriesInstanceUid: "serie-A" }), "corte 1");

  const manager = getViewportManager();
  const vp = manager?.activeViewport;
  if (vp) {
    vp.data.viewport.windowCenter = -600;
    vp.data.viewport.windowWidth = 1500;
  } else {
    state.viewport.windowCenter = -600;
    state.viewport.windowWidth = 1500;
  }

  // Mismo SeriesInstanceUID, otro corte: el ajuste manual debe sobrevivir.
  displayParsed(
    parsedWith({ seriesInstanceUid: "serie-A", instanceNumber: "2" }),
    "corte 2",
  );

  const current = vp ? vp.data.viewport : state.viewport;
  assert.equal(current.windowCenter, -600, "el W/L manual no debe reiniciarse");
  assert.equal(current.windowWidth, 1500);
});

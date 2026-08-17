/* cspell:disable */
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDescriptiveFilename,
  buildStudyZip,
  downloadBlob,
  exportCurrentViewToPNG,
  exportCurrentStudyAsZip,
  exportStudyByIdAsZip,
  type StudyExportMetadata,
} from "./export-service.ts";
import { anonymizeDicomBuffer, PII_TAGS } from "../utils/dicom-anonymizer.ts";
import { state } from "../viewer/state.ts";
import { dicomCache } from "../viewer/cache.ts";

// ── Environment & Mocking Setup ─────────────────────────────────────────────

function setupBrowserEnvironment() {
  const elementsMap = new Map<string, any>();

  const bannerEl = {
    textContent: "",
    className: "",
    classList: {
      remove: () => {},
      add: () => {},
    },
  };
  elementsMap.set("app-banner", bannerEl);

  (globalThis as any).window = globalThis;
  (globalThis as any).URL = {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
  };

  (globalThis as any).document = {
    getElementById: (id: string) => elementsMap.get(id) || null,
    createElement: (tag: string) => {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          click: () => {},
        };
      }
      return {};
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };

  return { bannerEl, elementsMap };
}

/**
 * Stubs the Electron preload bridge's `saveFile` for one call.
 *
 * `false` is what the real bridge returns when the user dismisses the native
 * save dialog, and a throw is what a failed disk write looks like. Both used
 * to be reported to the user as a successful export.
 */
async function withDesktopSaveFile<T>(
  saveFile: (filename: string, data: ArrayBuffer) => Promise<boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  (globalThis as any).api = { saveFile };
  try {
    return await fn();
  } finally {
    delete (globalThis as any).api;
  }
}

function oneLocalFile() {
  return {
    name: "slice1.dcm",
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  } as unknown as File;
}

function resetState() {
  state.files = [];
  state.source = "local";
  state.serverStudyId = null;
  state.serverInstances = [];
  state.parsed = null;
  dicomCache.clear();
}

// ── Filename & Zip Unit Tests ───────────────────────────────────────────────

test("generateDescriptiveFilename formats metadata correctly", () => {
  const meta: StudyExportMetadata = {
    studyDate: "2024-05-12",
    modality: "CT",
    studyDescription: "CHEST_ABDOMEN_SCAN",
  };
  const filename = generateDescriptiveFilename(meta, "zip");
  assert.equal(filename, "20240512_CT_CHEST_ABDOMEN_SCAN.zip");
});

test("generateDescriptiveFilename cleans special chars and limits description length", () => {
  const meta: StudyExportMetadata = {
    studyDate: "2023.08.15",
    modality: "MR!!",
    studyDescription:
      "Brain & Spine / Multi-sequence - Very Long Description Exceeding Limit",
  };
  const filename = generateDescriptiveFilename(meta, "png");
  assert.equal(filename, "20230815_MR_Brain_Spine_Multi_sequence_Ver.png");
});

test("generateDescriptiveFilename handles missing or empty metadata safely", () => {
  const filename = generateDescriptiveFilename(undefined, ".zip");
  assert.match(filename, /^\d{8}_DICOM_Export\.zip$/);
});

test("generateDescriptiveFilename excludes PII and UUIDs", () => {
  const meta: StudyExportMetadata = {
    patientName: "John Doe",
    patientId: "12345-6789-UUID",
    studyDate: "2022-01-01",
    modality: "DX",
    studyDescription: "XRAY CHEST",
  };
  const filename = generateDescriptiveFilename(meta, "zip");
  assert.equal(filename, "20220101_DX_XRAY_CHEST.zip");
  assert.equal(filename.includes("John"), false);
  assert.equal(filename.includes("12345"), false);
});

test("generateDescriptiveFilename handles invalid date, empty modality and long description", () => {
  const meta: StudyExportMetadata = {
    studyDate: "INVALID_DATE_STRING",
    modality: "---",
    studyDescription: "---",
  };
  const filename = generateDescriptiveFilename(meta, "zip");
  assert.match(filename, /^\d{8}_STUDY_Study\.zip$/);
});

test("buildStudyZip compresses files into a valid ZIP blob", () => {
  setupBrowserEnvironment();

  const files = [
    { name: "slice1.dcm", buffer: new Uint8Array([10, 20, 30, 40]).buffer },
    { name: "slice2.dcm", buffer: new Uint8Array([50, 60, 70, 80]).buffer },
  ];

  const blob = buildStudyZip(files);
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);
});

// ── Desktop save-dialog seam ────────────────────────────────────────────────

test("downloadBlob reports whether the desktop save dialog wrote a file", async () => {
  setupBrowserEnvironment();
  const blob = new Blob(["zip-bytes"], { type: "application/zip" });

  const saved = await withDesktopSaveFile(
    async () => true,
    () => downloadBlob(blob, "study.zip"),
  );
  assert.equal(saved, true);

  const canceled = await withDesktopSaveFile(
    async () => false,
    () => downloadBlob(blob, "study.zip"),
  );
  assert.equal(canceled, false);
});

test("downloadBlob reports success on the browser's <a download> path", async () => {
  setupBrowserEnvironment();
  const blob = new Blob(["png-bytes"], { type: "image/png" });
  assert.equal(await downloadBlob(blob, "view.png"), true);
});

test("exportCurrentViewToPNG reports cancellation, not success, when the save dialog is dismissed", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  const mockCanvas = {
    toBlob: (cb: (blob: Blob | null) => void) => {
      cb(new Blob(["png-binary-content"], { type: "image/png" }));
    },
  } as unknown as HTMLCanvasElement;

  await withDesktopSaveFile(
    async () => false,
    () => exportCurrentViewToPNG(mockCanvas, "custom_view.png"),
  );

  assert.equal(
    bannerEl.textContent,
    "Exportación cancelada: no se guardó ningún archivo.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--warning");
});

test("exportCurrentViewToPNG rejects and reports an error when the disk write fails", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  const mockCanvas = {
    toBlob: (cb: (blob: Blob | null) => void) => {
      cb(new Blob(["png-binary-content"], { type: "image/png" }));
    },
  } as unknown as HTMLCanvasElement;

  await assert.rejects(
    () =>
      withDesktopSaveFile(
        async () => {
          throw new Error("EACCES: permission denied");
        },
        () => exportCurrentViewToPNG(mockCanvas, "custom_view.png"),
      ),
    /EACCES/,
  );

  assert.match(bannerEl.textContent, /EACCES/);
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

test("exportCurrentStudyAsZip reports cancellation, not success, when the save dialog is dismissed", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();
  state.files = [oneLocalFile()];

  await withDesktopSaveFile(
    async () => false,
    () => exportCurrentStudyAsZip({ anonymize: false }),
  );

  assert.equal(
    bannerEl.textContent,
    "Exportación cancelada: no se guardó ningún archivo.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--warning");
});

test("exportCurrentStudyAsZip surfaces a failed disk write as an error", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();
  state.files = [oneLocalFile()];

  await withDesktopSaveFile(
    async () => {
      throw new Error("ENOSPC: no space left on device");
    },
    () => exportCurrentStudyAsZip({ anonymize: false }),
  );

  assert.match(bannerEl.textContent, /ENOSPC/);
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

// ── Anonymizer Unit Tests ───────────────────────────────────────────────────

test("anonymizeDicomBuffer replaces PII offsets with spaces (0x20)", () => {
  const textEncoder = new TextEncoder();
  const samplePiiName = "DOE^JOHN^MIDDLE";
  const nameBytes = textEncoder.encode(samplePiiName);

  const bufferSize = 100;
  const originalUint8 = new Uint8Array(bufferSize);
  const dataOffset = 20;

  originalUint8.set(nameBytes, dataOffset);

  const mockParser = {
    parseDicom: () => ({
      elements: {
        x00100010: { dataOffset: 20, length: nameBytes.length },
      },
    }),
  };

  const anonymizedBuffer = anonymizeDicomBuffer(originalUint8.buffer, {
    customParser: mockParser,
  });

  const anonymizedUint8 = new Uint8Array(anonymizedBuffer);

  for (let i = dataOffset; i < dataOffset + nameBytes.length; i++) {
    assert.equal(anonymizedUint8[i], 0x20);
  }
  assert.equal(originalUint8[dataOffset], nameBytes[0]);
});

test("anonymizeDicomBuffer handles missing parser or corrupt buffer gracefully", () => {
  const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  const result = anonymizeDicomBuffer(buffer, { customParser: null });
  assert.equal(result.byteLength, 5);
});

test("anonymizeDicomBuffer handles corrupt buffer throwing in parser", () => {
  const mockParser = {
    parseDicom: () => {
      throw new Error("Invalid DICOM header");
    },
  };
  const input = new Uint8Array([1, 2, 3, 4]).buffer;
  const result = anonymizeDicomBuffer(input, { customParser: mockParser });
  assert.equal(result.byteLength, 4);
});

test("anonymizeDicomBuffer handles out-of-bounds dataOffset or invalid element lengths", () => {
  const mockParser = {
    parseDicom: () => ({
      elements: {
        x00100010: { dataOffset: 999, length: 50 },
        x00100020: { dataOffset: -5, length: 10 },
        x00100030: { dataOffset: 0, length: 0 },
      },
    }),
  };
  const input = new Uint8Array(20).buffer;
  const result = anonymizeDicomBuffer(input, { customParser: mockParser });
  assert.equal(result.byteLength, 20);
});

test("anonymizeDicomBuffer supports custom tags and replacement byte", () => {
  const input = new Uint8Array([65, 66, 67, 68, 69]); // ABCDE
  const mockParser = {
    parseDicom: () => ({
      elements: {
        customTag: { dataOffset: 1, length: 3 },
      },
    }),
  };
  const result = anonymizeDicomBuffer(input, {
    customParser: mockParser,
    tagsToScrub: ["customTag"],
    replacementByte: 0x58, // 'X'
  });
  const resultArray = new Uint8Array(result);
  assert.equal(resultArray[0], 65); // A
  assert.equal(resultArray[1], 88); // X
  assert.equal(resultArray[2], 88); // X
  assert.equal(resultArray[3], 88); // X
  assert.equal(resultArray[4], 69); // E
});

test("anonymizeDicomBuffer lists standard DICOM PII tags", () => {
  assert.ok(PII_TAGS.includes("x00100010"));
  assert.ok(PII_TAGS.includes("x00100020"));
  assert.ok(PII_TAGS.includes("x00100030"));
  assert.ok(PII_TAGS.includes("x00100040"));
});

// ── Tests para exportCurrentViewToPNG ───────────────────────────────────────

test("exportCurrentViewToPNG error case: canvas does not exist", async () => {
  const { bannerEl } = setupBrowserEnvironment();

  await exportCurrentViewToPNG("non-existent-canvas");

  assert.equal(
    bannerEl.textContent,
    "No se encontró el canvas de renderizado para exportar PNG.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

test("exportCurrentViewToPNG error case: toBlob returns null/fails", async () => {
  const { bannerEl } = setupBrowserEnvironment();

  const mockCanvas = {
    toBlob: (cb: (blob: Blob | null) => void) => {
      cb(null);
    },
  } as unknown as HTMLCanvasElement;

  await assert.rejects(
    async () => {
      await exportCurrentViewToPNG(mockCanvas);
    },
    {
      name: "Error",
      message: "Canvas toBlob failed",
    },
  );

  assert.equal(
    bannerEl.textContent,
    "Error al generar imagen PNG desde el canvas.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

test("exportCurrentViewToPNG success case: renders PNG and triggers download", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  state.parsed = {
    metadata: {
      studyDate: "20240101",
      modality: "CT",
      studyDescription: "CHEST",
    },
  } as any;

  const mockCanvas = {
    toBlob: (cb: (blob: Blob | null) => void) => {
      cb(new Blob(["png-binary-content"], { type: "image/png" }));
    },
  } as unknown as HTMLCanvasElement;

  await exportCurrentViewToPNG(mockCanvas, "custom_view.png");

  assert.equal(bannerEl.textContent, "Imagen PNG descargada con éxito.");
  assert.equal(bannerEl.className, "app-banner app-banner--success");
});

// ── Tests para exportCurrentStudyAsZip ──────────────────────────────────────

test("exportCurrentStudyAsZip error case: no files or study loaded", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  await exportCurrentStudyAsZip();

  assert.equal(
    bannerEl.textContent,
    "Error al exportar estudio: No hay ningún estudio cargado para exportar.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

test("exportCurrentStudyAsZip error case: server study has 0 instances", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  state.source = "server";
  state.serverStudyId = "study-empty-123";
  state.serverInstances = [];

  await exportCurrentStudyAsZip();

  assert.equal(
    bannerEl.textContent,
    "Error al exportar estudio: El estudio no contiene imágenes.",
  );
  assert.equal(bannerEl.className, "app-banner app-banner--error");
});

test("exportCurrentStudyAsZip success case: local files export", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  const file1 = {
    name: "slice1.dcm",
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  } as unknown as File;

  state.files = [file1];
  state.parsed = {
    metadata: {
      studyDate: "20240201",
      modality: "MR",
      studyDescription: "BRAIN",
    },
  } as any;

  await exportCurrentStudyAsZip({ anonymize: true });

  assert.match(bannerEl.textContent, /Estudio exportado exitosamente como/);
  assert.equal(bannerEl.className, "app-banner app-banner--success");
});

test("exportCurrentStudyAsZip async success case: server study with cache and authFetch", async () => {
  const { bannerEl } = setupBrowserEnvironment();
  resetState();

  state.source = "server";
  state.serverStudyId = "study-server-999";
  state.serverInstances = ["inst-1", "inst-2"];

  // Populate instance 0 in cache
  dicomCache.set(0, {
    rawDataSet: {
      byteArray: {
        buffer: new Uint8Array([100, 101, 102]).buffer,
      },
    },
  } as any);

  // Mock global fetch for instance 1
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("inst-2")) {
      return new Response(new Uint8Array([200, 201, 202]).buffer, {
        status: 200,
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  try {
    await exportCurrentStudyAsZip({ anonymize: true });
    assert.match(bannerEl.textContent, /Estudio exportado exitosamente como/);
    assert.equal(bannerEl.className, "app-banner app-banner--success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Tests para exportStudyByIdAsZip ─────────────────────────────────────────

test("exportStudyByIdAsZip error case: /instances endpoint returns HTTP 500", async () => {
  const { bannerEl } = setupBrowserEnvironment();

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    return new Response("Internal Error", { status: 500 });
  };

  try {
    await exportStudyByIdAsZip("study-error-500");
    assert.equal(bannerEl.textContent, "Error al exportar estudio: HTTP 500");
    assert.equal(bannerEl.className, "app-banner app-banner--error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exportStudyByIdAsZip error case: zero instances returned", async () => {
  const { bannerEl } = setupBrowserEnvironment();

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    return new Response(JSON.stringify({ instances: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await exportStudyByIdAsZip("study-zero-instances");
    assert.equal(
      bannerEl.textContent,
      "Error al exportar estudio: El estudio seleccionado no contiene instancias.",
    );
    assert.equal(bannerEl.className, "app-banner app-banner--error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exportStudyByIdAsZip success case: fetches instances iteratively and creates ZIP", async () => {
  const { bannerEl } = setupBrowserEnvironment();

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    if (url.endsWith("/instances")) {
      return new Response(
        JSON.stringify({
          instances: [{ instanceId: "inst-A" }, { instanceId: "inst-B" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/file")) {
      return new Response(new Uint8Array([50, 60, 70]).buffer, {
        status: 200,
      });
    }
    return new Response("Not Found", { status: 404 });
  };

  try {
    const meta: StudyExportMetadata = {
      studyDate: "20240315",
      modality: "CT",
      studyDescription: "CHEST_SCAN",
    };

    await exportStudyByIdAsZip("study-success-123", meta, { anonymize: true });

    assert.match(
      bannerEl.textContent,
      /Estudio exportado exitosamente como '20240315_CT_CHEST_SCAN.zip'/,
    );
    assert.equal(bannerEl.className, "app-banner app-banner--success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

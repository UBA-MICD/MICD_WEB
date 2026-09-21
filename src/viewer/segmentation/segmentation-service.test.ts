import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { decodeMaskRle, requestSegmentation } from "./segmentation-api.ts";
import {
  buildDerivedDicom,
  segmentarConIA,
  SegmentationError,
} from "./segmentation-service.ts";
import { API_BASE } from "../../auth/auth.ts";
import type { ParsedDicom } from "../../dicom/dicom-parser-util.ts";

const SEGMENT_URL = `${API_BASE}/v1/ml/segmentation`;

const API_RESPONSE = {
  seed: 12345,
  model: "mock-sam3",
  simulated: true,
  contour: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ],
  mask: { width: 4, height: 2, rle: [2, 3, 3], pixelCount: 3 },
  derived: {
    sopInstanceUid: "1.2.999.1",
    seriesInstanceUid: "1.2.999.2",
    seriesDescription: "Segmentación IA (mock SAM3)",
    referencedSopInstanceUid: "1.2.3.4.5",
    referencedSopClassUid: "1.2.840.10008.5.1.4.1.1.2",
    derivationDescription: "Segmentación automática simulada (mock SAM3)",
  },
  inferenceMs: 1800,
};

function makeDicom(): ParsedDicom {
  return {
    metadata: {
      patientName: "Anon",
      patientId: "1",
      patientBirthDate: "",
      patientSex: "",
      studyDate: "",
      studyDescription: "",
      studyInstanceUid: "1.2.3.4",
      accessionNumber: "",
      referringPhysician: "",
      seriesDescription: "AX CT",
      seriesNumber: "1",
      seriesInstanceUid: "1.2.3.4.9",
      modality: "CT",
      instanceNumber: "1",
      sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
      sopInstanceUid: "1.2.3.4.5",
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
    },
    pixelData: new Uint16Array(64),
    rawDataSet: null,
  };
}

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  (globalThis as { fetch?: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => fetchImpl(url, init);
});

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

// ── decodeMaskRle ─────────────────────────────────────────────────────────────

test("decodeMaskRle expands alternating runs starting with zeros", () => {
  assert.deepEqual(
    Array.from(decodeMaskRle([2, 3, 3], 4, 2)),
    [0, 0, 1, 1, 1, 0, 0, 0],
  );
});

test("decodeMaskRle handles a leading zero-length run", () => {
  assert.deepEqual(Array.from(decodeMaskRle([0, 2, 2], 2, 2)), [1, 1, 0, 0]);
});

test("decodeMaskRle never writes past the mask", () => {
  assert.equal(decodeMaskRle([0, 999], 2, 2).length, 4);
});

// ── requestSegmentation ───────────────────────────────────────────────────────

test("requestSegmentation POSTs rows/columns to the ML endpoint", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, SEGMENT_URL);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      rows: 8,
      columns: 8,
      sopInstanceUid: "1.2.3.4.5",
      sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
      studyInstanceUid: "1.2.3.4",
    });
    return jsonResponse(201, API_RESPONSE);
  };

  const result = await requestSegmentation({
    rows: 8,
    columns: 8,
    sopInstanceUid: "1.2.3.4.5",
    sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
    studyInstanceUid: "1.2.3.4",
  });
  assert.equal(result.ok, true);
});

// ── buildDerivedDicom ─────────────────────────────────────────────────────────

test("buildDerivedDicom keeps the pixels and every other metadata field", () => {
  const original = makeDicom();
  const derived = buildDerivedDicom(original, API_RESPONSE.derived);

  assert.equal(derived.pixelData, original.pixelData);
  assert.equal(derived.metadata.rows, original.metadata.rows);
  assert.equal(derived.metadata.columns, original.metadata.columns);
  assert.equal(derived.metadata.patientId, original.metadata.patientId);
  assert.equal(derived.metadata.modality, original.metadata.modality);
  assert.equal(
    derived.metadata.studyInstanceUid,
    original.metadata.studyInstanceUid,
  );
});

test("buildDerivedDicom assigns new SOP/Series UIDs and the mock description", () => {
  const derived = buildDerivedDicom(makeDicom(), API_RESPONSE.derived);

  assert.equal(derived.metadata.sopInstanceUid, "1.2.999.1");
  assert.equal(derived.metadata.seriesInstanceUid, "1.2.999.2");
  assert.equal(
    derived.metadata.seriesDescription,
    "Segmentación IA (mock SAM3)",
  );
});

test("buildDerivedDicom references the source image", () => {
  const derived = buildDerivedDicom(makeDicom(), API_RESPONSE.derived);

  assert.deepEqual(derived.metadata.referencedImageSequence, [
    {
      referencedSopClassUid: "1.2.840.10008.5.1.4.1.1.2",
      referencedSopInstanceUid: "1.2.3.4.5",
    },
  ]);
  assert.equal(derived.referencedSopInstanceUid, "1.2.3.4.5");
});

test("buildDerivedDicom does not mutate the original", () => {
  const original = makeDicom();
  const before = JSON.stringify(original.metadata);
  buildDerivedDicom(original, API_RESPONSE.derived);
  assert.equal(JSON.stringify(original.metadata), before);
});

// ── segmentarConIA ────────────────────────────────────────────────────────────

test("segmentarConIA returns mask, contour and derived DICOM", async () => {
  fetchImpl = async () => jsonResponse(201, API_RESPONSE);

  const result = await segmentarConIA(makeDicom());

  assert.deepEqual(result.contorno, API_RESPONSE.contour);
  assert.equal(result.mascara.pixelCount, 3);
  assert.deepEqual(Array.from(result.mascara.data), [0, 0, 1, 1, 1, 0, 0, 0]);
  assert.equal(result.dicomDerivado.metadata.sopInstanceUid, "1.2.999.1");
  assert.equal(result.simulado, true);
  assert.equal(result.seed, 12345);
});

test("segmentarConIA forwards the seed when one is given", async () => {
  let sentSeed: unknown;
  fetchImpl = async (_url, init) => {
    sentSeed = JSON.parse(String(init?.body)).seed;
    return jsonResponse(201, API_RESPONSE);
  };

  await segmentarConIA(makeDicom(), { seed: 99 });
  assert.equal(sentSeed, 99);
});

test("segmentarConIA rejects an image with no dimensions", async () => {
  const dicom = makeDicom();
  dicom.metadata.rows = 0;

  await assert.rejects(
    () => segmentarConIA(dicom),
    (err: unknown) => err instanceof SegmentationError,
  );
});

test("segmentarConIA surfaces the backend error", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "Sin permisos." });

  await assert.rejects(
    () => segmentarConIA(makeDicom()),
    (err: unknown) =>
      err instanceof SegmentationError &&
      err.status === 403 &&
      err.message === "Sin permisos.",
  );
});

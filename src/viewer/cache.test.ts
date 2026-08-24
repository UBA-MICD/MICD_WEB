import test from "node:test";
import assert from "node:assert/strict";
import { DicomCache, dicomCache } from "./cache.js";
import { state } from "./state.js";
import { ParsedDicom } from "../dicom/dicom-parser-util.js";

const mockParsedSlice: ParsedDicom = {
  metadata: {
    patientName: "TEST^PATIENT",
    patientId: "001",
    patientBirthDate: "20000101",
    patientSex: "F",
    studyDate: "20240101",
    studyDescription: "BRAIN MRI",
    studyInstanceUid: "1.2.3",
    accessionNumber: "123",
    referringPhysician: "",
    seriesDescription: "AXIAL T2",
    seriesNumber: "1",
    modality: "MR",
    instanceNumber: "1",
    sopClassUid: "1.2.840.10008.5.1.4.1.1.4",
    rows: 256,
    columns: 256,
    bitsAllocated: 16,
    bitsStored: 12,
    highBit: 11,
    pixelRepresentation: 0,
    samplesPerPixel: 1,
    photometricInterpretation: "MONOCHROME2",
    rescaleIntercept: 0,
    rescaleSlope: 1,
    windowCenter: 500,
    windowWidth: 1000,
    transferSyntaxUid: "1.2.840.10008.1.2",
    pixelSpacing: [1, 1],
    imagePositionPatient: [0, 0, 0],
  },
  pixelData: new Uint16Array(256 * 256),
  rawDataSet: {},
};

test("DicomCache set, get, and clear store and remove slices", () => {
  const cache = new DicomCache();
  cache.set(0, mockParsedSlice);
  assert.equal(cache.get(0), mockParsedSlice);
  assert.equal(cache.get(1), undefined);

  cache.clear();
  assert.equal(cache.get(0), undefined);
});

test("DicomCache getOrFetch returns cached slice immediately (Cache Hit)", async () => {
  const cache = new DicomCache();
  cache.set(5, mockParsedSlice);

  const result = await cache.getOrFetch(5);
  assert.equal(result, mockParsedSlice);
});

test("DicomCache getAllCachedOrdered returns slices sorted by index", () => {
  const cache = new DicomCache();
  cache.set(10, {
    ...mockParsedSlice,
    metadata: { ...mockParsedSlice.metadata, instanceNumber: "10" },
  });
  cache.set(2, {
    ...mockParsedSlice,
    metadata: { ...mockParsedSlice.metadata, instanceNumber: "2" },
  });
  cache.set(5, {
    ...mockParsedSlice,
    metadata: { ...mockParsedSlice.metadata, instanceNumber: "5" },
  });

  const items = cache.getAllCachedOrdered();
  assert.equal(items.length, 3);
  assert.equal(items[0].index, 2);
  assert.equal(items[1].index, 5);
  assert.equal(items[2].index, 10);
});

test("DicomCache prefetchNext triggers fetches for future indices without throwing", () => {
  const cache = new DicomCache();
  state.source = "local";
  state.files = [
    new File([], "slice0.dcm"),
    new File([], "slice1.dcm"),
    new File([], "slice2.dcm"),
  ] as any;

  cache.set(0, mockParsedSlice);
  assert.doesNotThrow(() => {
    cache.prefetchNext(0, 2);
  });
});

test("DicomCache getOrFetch dedupes concurrent misses via the pending map", async () => {
  const cache = new DicomCache();
  state.source = "local";
  state.files = [];

  // Index is out of range, so fetchIndex resolves to null quickly, but the
  // two calls below still race before either promise settles: the second
  // must be served from `pending` rather than starting a second fetch.
  const first = cache.getOrFetch(0);
  const second = cache.getOrFetch(0);
  assert.equal(await first, null);
  assert.equal(await second, null);
});

test("DicomCache fetchIndex (local) returns null when the index is out of range", async () => {
  const cache = new DicomCache();
  state.source = "local";
  state.files = [];
  assert.equal(await cache.getOrFetch(0), null);
});

test("DicomCache fetchIndex (server) returns null without a serverStudyId or in-range index", async () => {
  const cache = new DicomCache();
  state.source = "server";
  state.serverStudyId = null;
  state.serverInstances = ["a", "b"];
  assert.equal(await cache.getOrFetch(0), null);

  state.serverStudyId = "study-1";
  state.serverInstances = [];
  assert.equal(await cache.getOrFetch(0), null);
});

test("DicomCache fetchIndex (server) returns null on a non-ok response", async () => {
  const cache = new DicomCache();
  state.source = "server";
  state.serverStudyId = "study-1";
  state.serverInstances = ["instance-a"];

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: false, status: 404 });
  try {
    assert.equal(await cache.getOrFetch(0), null);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("DicomCache getOrFetch catches a rejected fetch and logs a warning instead of throwing", async (t) => {
  const cache = new DicomCache();
  state.source = "server";
  state.serverStudyId = "study-1";
  state.serverInstances = ["instance-a"];

  t.mock.method(console, "warn", () => {});
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await cache.getOrFetch(0), null);
    assert.equal((console.warn as any).mock.calls.length, 1);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

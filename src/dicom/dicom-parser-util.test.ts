import test from "node:test";
import assert from "node:assert/strict";
import { validateVolumetricTags, DicomMetadata } from "./dicom-parser-util.js";

const mockMetaBase: DicomMetadata = {
  patientName: "DOE^JOHN",
  patientId: "12345",
  patientBirthDate: "1980-01-01",
  patientSex: "M",
  studyDate: "2024-01-01",
  studyDescription: "CT CHEST",
  studyInstanceUid: "1.2.3.4",
  accessionNumber: "ACC123",
  referringPhysician: "",
  seriesDescription: "CHEST 5mm",
  seriesNumber: "2",
  modality: "CT",
  instanceNumber: "1",
  sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
  rows: 512,
  columns: 512,
  bitsAllocated: 16,
  bitsStored: 12,
  highBit: 11,
  pixelRepresentation: 0,
  samplesPerPixel: 1,
  photometricInterpretation: "MONOCHROME2",
  rescaleIntercept: -1024,
  rescaleSlope: 1,
  windowCenter: 40,
  windowWidth: 400,
  transferSyntaxUid: "1.2.840.10008.1.2.1",
};

test("validateVolumetricTags returns invalid if metadata list has <= 1 slice", () => {
  const resultSingle = validateVolumetricTags([
    {
      ...mockMetaBase,
      pixelSpacing: [0.7, 0.7],
      imagePositionPatient: [-150, -150, 10],
    },
  ]);
  assert.equal(resultSingle.valid, false);
  assert.match(resultSingle.reason || "", /more than 1 slice/i);
});

test("validateVolumetricTags returns invalid if PixelSpacing is missing or zero", () => {
  const slices: DicomMetadata[] = [
    {
      ...mockMetaBase,
      imagePositionPatient: [-150, -150, 0],
    },
    {
      ...mockMetaBase,
      imagePositionPatient: [-150, -150, 5],
    },
  ];
  const result = validateVolumetricTags(slices);
  assert.equal(result.valid, false);
  assert.match(result.reason || "", /PixelSpacing/i);
});

test("validateVolumetricTags returns invalid if ImagePositionPatient is missing", () => {
  const slices: DicomMetadata[] = [
    {
      ...mockMetaBase,
      pixelSpacing: [0.8, 0.8],
    },
    {
      ...mockMetaBase,
      pixelSpacing: [0.8, 0.8],
    },
  ];
  const result = validateVolumetricTags(slices);
  assert.equal(result.valid, false);
  assert.match(result.reason || "", /ImagePositionPatient/i);
});

test("validateVolumetricTags returns valid when all volumetric tags are present across multiple slices", () => {
  const slices: DicomMetadata[] = [
    {
      ...mockMetaBase,
      pixelSpacing: [0.75, 0.75],
      imagePositionPatient: [-100, -100, 0],
    },
    {
      ...mockMetaBase,
      pixelSpacing: [0.75, 0.75],
      imagePositionPatient: [-100, -100, 2.5],
    },
    {
      ...mockMetaBase,
      pixelSpacing: [0.75, 0.75],
      imagePositionPatient: [-100, -100, 5.0],
    },
  ];
  const result = validateVolumetricTags(slices);
  assert.equal(result.valid, true);
  assert.equal(result.reason, undefined);
});

test("calculateAutoWindowLevel computes correct center and width from pixel array", () => {
  const { calculateAutoWindowLevel } = require("./dicom-parser-util.js");
  const pixels = new Int16Array([0, 100, 200, 300, 400]);
  const wl = calculateAutoWindowLevel(pixels, 1, -1024);

  assert.equal(wl.windowCenter, -824);
  assert.equal(wl.windowWidth, 400);
});

test("calculateAutoWindowLevel computes correct values for unsigned 8-bit pixels", () => {
  const { calculateAutoWindowLevel } = require("./dicom-parser-util.js");
  const pixels = new Uint8Array([50, 100, 150, 200]);
  const wl = calculateAutoWindowLevel(pixels, 2, 10);

  // min = 50*2+10 = 110, max = 200*2+10 = 410
  // center = (110 + 410) / 2 = 260
  // width = 410 - 110 = 300
  assert.equal(wl.windowCenter, 260);
  assert.equal(wl.windowWidth, 300);
});

test("calculateAutoWindowLevel applies soft tissue default for CT modality", () => {
  const {
    calculateAutoWindowLevel,
    WINDOW_PRESETS,
  } = require("./dicom-parser-util.js");
  const pixels = new Int16Array([0, 100, 200, 300, 400]);
  const wl = calculateAutoWindowLevel(pixels, 1, -1024, "CT");

  assert.equal(wl.windowCenter, 40);
  assert.equal(wl.windowWidth, 400);
  assert.equal(wl.windowCenter, WINDOW_PRESETS.softTissue.windowCenter);
  assert.equal(wl.windowWidth, WINDOW_PRESETS.softTissue.windowWidth);
});

test("calculateAutoWindowLevel uses min/max for non-CT modality", () => {
  const { calculateAutoWindowLevel } = require("./dicom-parser-util.js");
  const pixels = new Int16Array([0, 100, 200, 300, 400]);
  const wl = calculateAutoWindowLevel(pixels, 1, -1024, "MR");

  assert.equal(wl.windowCenter, -824);
  assert.equal(wl.windowWidth, 400);
});

// cspell:disable
// ── parseDicomFile / extractMetadata / extractPixelData ─────────────────────
//
// dicom-parser-util.ts calls a global `dicomParser` (loaded via a <script>
// tag / window.dicomParser in the real app — see the file's own comment).
// That's a clean injection seam: rather than constructing byte-perfect real
// DICOM files, we install a fake `dicomParser.parseDicom()` that returns a
// controllable fake dataSet exposing the exact surface this module actually
// calls (string/uint16/floatString/elements/byteArray).

interface FakeElement {
  dataOffset: number;
  length: number;
}

function fakeDataSet(opts: {
  strings?: Record<string, string>;
  uint16s?: Record<string, number>;
  floats?: Record<string, number>;
  throwing?: string[]; // tags whose accessor throws
  pixelDataElement?: FakeElement | null;
  byteArray?: Uint8Array;
}): any {
  const throwing = new Set(opts.throwing ?? []);
  const elements: Record<string, FakeElement> = {};
  if (opts.pixelDataElement !== null) {
    elements.x7fe00010 = opts.pixelDataElement ?? { dataOffset: 0, length: 8 };
  }
  const byteArray = opts.byteArray ?? new Uint8Array(64);
  return {
    elements,
    byteArray,
    string(tag: string) {
      if (throwing.has(tag)) throw new Error(`boom:${tag}`);
      return opts.strings?.[tag];
    },
    uint16(tag: string) {
      if (throwing.has(tag)) throw new Error(`boom:${tag}`);
      return opts.uint16s?.[tag];
    },
    floatString(tag: string) {
      if (throwing.has(tag)) throw new Error(`boom:${tag}`);
      return opts.floats?.[tag];
    },
  };
}

function withFakeDicomParser(dataSet: any, run: () => void): void {
  const previous = (globalThis as any).dicomParser;
  (globalThis as any).dicomParser = { parseDicom: () => dataSet };
  try {
    run();
  } finally {
    (globalThis as any).dicomParser = previous;
  }
}

test("parseDicomFile extracts patient/study/series metadata and formats name/date", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: {
      x00100010: "DOE^JOHN^",
      x00100020: "MRN1",
      x00100030: "19800101",
      x00080020: "20240115",
      x00080090: "SMITH^JANE",
    },
    uint16s: { x00280010: 2, x00280011: 2, x00280100: 16 },
    pixelDataElement: { dataOffset: 0, length: 8 },
  });

  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });

  assert.equal(result.metadata.patientName, "DOE, JOHN");
  assert.equal(result.metadata.patientBirthDate, "1980-01-01");
  assert.equal(result.metadata.studyDate, "2024-01-15");
  assert.equal(result.metadata.referringPhysician, "SMITH, JANE");
  assert.equal(result.rawDataSet, dataSet);
});

test("parseDicomFile: safeString/safeUint16/safeFloat fall back when the accessor throws", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    throwing: ["x00100010", "x00280010", "x00281052"],
    pixelDataElement: null,
  });

  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });

  assert.equal(result.metadata.patientName, "");
  assert.equal(result.metadata.rows, 0);
  assert.equal(result.metadata.rescaleIntercept, 0);
  assert.equal(result.pixelData, null); // no pixel data element
});

test("parseDicomFile parses window center/width, taking the first of multiple values", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: { x00281050: "40\\80", x00281051: "400\\800" },
    pixelDataElement: null,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  assert.equal(result.metadata.windowCenter, 40);
  assert.equal(result.metadata.windowWidth, 400);
});

test("parseDicomFile leaves window center/width at 0 when the tags are absent", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({ pixelDataElement: null });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  assert.equal(result.metadata.windowCenter, 0);
  assert.equal(result.metadata.windowWidth, 0);
});

test("parseDicomFile parses pixelSpacing/imagePositionPatient/imageOrientationPatient when valid", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: {
      x00280030: "0.7\\0.7",
      x00200032: "-150\\-150\\10",
      x00200037: "1\\0\\0\\0\\1\\0",
    },
    pixelDataElement: null,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  assert.deepEqual(result.metadata.pixelSpacing, [0.7, 0.7]);
  assert.deepEqual(result.metadata.imagePositionPatient, [-150, -150, 10]);
  assert.deepEqual(result.metadata.imageOrientationPatient, [1, 0, 0, 0, 1, 0]);
});

test("parseDicomFile leaves geometry tags undefined when malformed (too few parts or NaN)", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: {
      x00280030: "0.7", // only one part
      x00200032: "-150\\abc\\10", // NaN part
      x00200037: "1\\0\\0\\0\\1", // only 5 parts
    },
    pixelDataElement: null,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  assert.equal(result.metadata.pixelSpacing, undefined);
  assert.equal(result.metadata.imagePositionPatient, undefined);
  assert.equal(result.metadata.imageOrientationPatient, undefined);
});

test("parseDicomFile: extractPixelData returns null for missing, zero-length, or encapsulated pixel data", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");

  withFakeDicomParser(fakeDataSet({ pixelDataElement: null }), () => {
    assert.equal(parseDicomFile(new ArrayBuffer(16)).pixelData, null);
  });
  withFakeDicomParser(
    fakeDataSet({ pixelDataElement: { dataOffset: 0, length: 0 } }),
    () => {
      assert.equal(parseDicomFile(new ArrayBuffer(16)).pixelData, null);
    },
  );
  withFakeDicomParser(
    fakeDataSet({ pixelDataElement: { dataOffset: 0, length: 0xffffffff } }),
    () => {
      assert.equal(parseDicomFile(new ArrayBuffer(16)).pixelData, null);
    },
  );
});

test("parseDicomFile: extractPixelData reads 8-bit pixel data as Uint8Array", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const dataSet = fakeDataSet({
    uint16s: { x00280100: 8 },
    pixelDataElement: { dataOffset: 0, length: 4 },
    byteArray: bytes,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(bytes.buffer);
  });
  assert.ok(result.pixelData instanceof Uint8Array);
  assert.equal(result.pixelData.length, 4);
});

test("parseDicomFile: extractPixelData reads signed 16-bit pixel data as Int16Array", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const bytes = new Uint8Array(8);
  const dataSet = fakeDataSet({
    uint16s: { x00280100: 16, x00280103: 1 },
    pixelDataElement: { dataOffset: 0, length: 8 },
    byteArray: bytes,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(bytes.buffer);
  });
  assert.ok(result.pixelData instanceof Int16Array);
  assert.equal(result.pixelData.length, 4);
});

test("parseDicomFile: extractPixelData reads unsigned 16-bit pixel data as Uint16Array", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const bytes = new Uint8Array(8);
  const dataSet = fakeDataSet({
    uint16s: { x00280100: 16, x00280103: 0 },
    pixelDataElement: { dataOffset: 0, length: 8 },
    byteArray: bytes,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(bytes.buffer);
  });
  assert.ok(result.pixelData instanceof Uint16Array);
  assert.equal(result.pixelData.length, 4);
});

test("parseDicomFile: extractPixelData falls back to Uint8Array for an unrecognized bitsAllocated", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const bytes = new Uint8Array(8);
  const dataSet = fakeDataSet({
    uint16s: { x00280100: 32 },
    pixelDataElement: { dataOffset: 0, length: 8 },
    byteArray: bytes,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(bytes.buffer);
  });
  assert.ok(result.pixelData instanceof Uint8Array);
  assert.equal(result.pixelData.length, 8);
});

test("formatPatientName (via parseDicomFile) only strips the very last trailing separator", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: { x00100010: "DOE^JOHN^^^" },
    pixelDataElement: null,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  // Every ^ becomes ", ", then only the final ", " is trimmed off the end —
  // this is the module's actual (slightly quirky) behavior, not idealized.
  assert.equal(result.metadata.patientName, "DOE, JOHN, , ");
});

test("formatDicomDate (via parseDicomFile) leaves a short/malformed date untouched", () => {
  const { parseDicomFile } = require("./dicom-parser-util.js");
  const dataSet = fakeDataSet({
    strings: { x00080020: "2024" },
    pixelDataElement: null,
  });
  let result: any;
  withFakeDicomParser(dataSet, () => {
    result = parseDicomFile(new ArrayBuffer(16));
  });
  assert.equal(result.metadata.studyDate, "2024");
});

test("WINDOW_PRESETS contains exact values for required presets", () => {
  const { WINDOW_PRESETS } = require("./dicom-parser-util.js");
  assert.deepEqual(WINDOW_PRESETS.lung, {
    name: "Pulmón",
    windowCenter: -600,
    windowWidth: 1500,
  });
  assert.deepEqual(WINDOW_PRESETS.bone, {
    name: "Hueso",
    windowCenter: 400,
    windowWidth: 1800,
  });
  assert.deepEqual(WINDOW_PRESETS.softTissue, {
    name: "Tejido Blando",
    windowCenter: 40,
    windowWidth: 400,
  });
  assert.deepEqual(WINDOW_PRESETS.brain, {
    name: "Cerebro",
    windowCenter: 40,
    windowWidth: 80,
  });
});
// cspell:enable

import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDescriptiveFilename,
  exportStudyToZip,
  type StudyExportMetadata,
} from "./export-service.ts";
import { anonymizeDicomBuffer, PII_TAGS } from "../utils/dicom-anonymizer.ts";

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

test("anonymizeDicomBuffer replaces PII offsets with spaces (0x20)", () => {
  // Create a buffer simulating binary DICOM layout
  const textEncoder = new TextEncoder();
  const samplePiiName = "DOE^JOHN^MIDDLE"; // 15 bytes
  const nameBytes = textEncoder.encode(samplePiiName);

  const bufferSize = 100;
  const originalUint8 = new Uint8Array(bufferSize);
  const dataOffset = 20;

  // Insert PII string at byte offset 20
  originalUint8.set(nameBytes, dataOffset);

  // Mock parser that returns dataOffset: 20, length: 15 for PatientName
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

  // Check that PII bytes at offset [20..35] are now space character (0x20)
  for (let i = dataOffset; i < dataOffset + nameBytes.length; i++) {
    assert.equal(anonymizedUint8[i], 0x20);
  }

  // Check that original buffer was not mutated (immutable copy returned)
  assert.equal(originalUint8[dataOffset], nameBytes[0]);
});

test("anonymizeDicomBuffer handles missing parser or corrupt buffer gracefully", () => {
  const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  const result = anonymizeDicomBuffer(buffer, { customParser: null });
  assert.equal(result.byteLength, 5);
});

test("anonymizeDicomBuffer lists standard DICOM PII tags", () => {
  assert.ok(PII_TAGS.includes("x00100010")); // PatientName
  assert.ok(PII_TAGS.includes("x00100020")); // PatientID
  assert.ok(PII_TAGS.includes("x00100030")); // PatientBirthDate
  assert.ok(PII_TAGS.includes("x00100040")); // PatientSex
});

test("exportStudyToZip compresses files into a valid ZIP blob", () => {
  // Mock window.URL if not present in Node
  if (typeof window === "undefined" || !window.URL) {
    (globalThis as any).window = globalThis;
    (globalThis as any).URL = {
      createObjectURL: () => "blob:mock-url",
      revokeObjectURL: () => {},
    };
  }
  if (typeof document === "undefined") {
    (globalThis as any).document = {
      createElement: () => ({
        href: "",
        download: "",
        click: () => {},
      }),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    };
  }

  const files = [
    { name: "slice1.dcm", buffer: new Uint8Array([10, 20, 30, 40]).buffer },
    { name: "slice2.dcm", buffer: new Uint8Array([50, 60, 70, 80]).buffer },
  ];

  const blob = exportStudyToZip(files, "test_study.zip");
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);
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

test("generateDescriptiveFilename handles invalid date, empty modality and long description", () => {
  const meta: StudyExportMetadata = {
    studyDate: "INVALID_DATE_STRING",
    modality: "---",
    studyDescription: "---",
  };
  const filename = generateDescriptiveFilename(meta, "zip");
  assert.match(filename, /^\d{8}_STUDY_Study\.zip$/);
});

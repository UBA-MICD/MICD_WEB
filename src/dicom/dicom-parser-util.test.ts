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
  assert.match(resultSingle.reason || "", /más de 1 corte/i);
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

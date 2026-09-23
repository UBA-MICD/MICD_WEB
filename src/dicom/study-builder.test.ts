import test from "node:test";
import assert from "node:assert/strict";
import { StudyBuilder, buildStudy, sortSlices } from "./study-builder.js";
import type { DicomMetadata, ParsedDicom } from "./dicom-parser-util.js";

function createMockParsed(
  opts: Partial<DicomMetadata> & {
    ipp?: [number, number, number];
    iop?: number[];
  },
): ParsedDicom {
  const metadata: DicomMetadata = {
    patientName: opts.patientName ?? "DOE^JOHN",
    patientId: opts.patientId ?? "PAT001",
    patientBirthDate: "1980-01-01",
    patientSex: "M",
    studyDate: opts.studyDate ?? "2024-01-15",
    studyDescription: opts.studyDescription ?? "CT ABDOMEN",
    studyInstanceUid: opts.studyInstanceUid ?? "1.2.840.10008.study.1",
    accessionNumber: "ACC001",
    referringPhysician: "",
    seriesDescription: opts.seriesDescription ?? "Axial 2.5mm",
    seriesNumber: opts.seriesNumber ?? "2",
    seriesInstanceUid: opts.seriesInstanceUid ?? "1.2.840.10008.series.1",
    modality: opts.modality ?? "CT",
    instanceNumber: opts.instanceNumber ?? "1",
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
    pixelSpacing: [0.7, 0.7],
    imagePositionPatient: opts.ipp ?? [-150, -150, 0],
    imageOrientationPatient: opts.iop ?? [1, 0, 0, 0, 1, 0],
    ...opts,
  };

  return {
    metadata,
    pixelData: new Int16Array(64),
    rawDataSet: {},
  };
}

test("sortSlices orders primarily by projectedDistance", () => {
  const slices = [
    { name: "file_c.dcm", projectedDistance: 50.0, instanceNumber: 99 },
    { name: "file_a.dcm", projectedDistance: -10.0, instanceNumber: 5 },
    { name: "file_b.dcm", projectedDistance: 20.0, instanceNumber: 1 },
  ];

  const sorted = sortSlices(slices);
  assert.equal(sorted[0].name, "file_a.dcm"); // -10.0
  assert.equal(sorted[1].name, "file_b.dcm"); // 20.0
  assert.equal(sorted[2].name, "file_c.dcm"); // 50.0
});

test("sortSlices falls back to instanceNumber when projectedDistance is missing or equal", () => {
  const slicesWithEqualDist = [
    { name: "frame_b.dcm", projectedDistance: 10.0, instanceNumber: 2 },
    { name: "frame_a.dcm", projectedDistance: 10.0, instanceNumber: 1 },
  ];
  const sortedEqual = sortSlices(slicesWithEqualDist);
  assert.equal(sortedEqual[0].name, "frame_a.dcm");
  assert.equal(sortedEqual[1].name, "frame_b.dcm");

  const slicesMissingDist = [
    { name: "slice_30.dcm", projectedDistance: null, instanceNumber: 30 },
    { name: "slice_10.dcm", projectedDistance: null, instanceNumber: 10 },
    { name: "slice_20.dcm", projectedDistance: null, instanceNumber: 20 },
  ];
  const sortedMissing = sortSlices(slicesMissingDist);
  assert.equal(sortedMissing[0].name, "slice_10.dcm");
  assert.equal(sortedMissing[1].name, "slice_20.dcm");
  assert.equal(sortedMissing[2].name, "slice_30.dcm");
});

test("sortSlices falls back to natural alphanumeric filename when metadata is absent", () => {
  const slices = [
    { name: "image-10.dcm", projectedDistance: null, instanceNumber: null },
    { name: "image-2.dcm", projectedDistance: null, instanceNumber: null },
    { name: "image-1.dcm", projectedDistance: null, instanceNumber: null },
  ];

  const sorted = sortSlices(slices);
  assert.equal(sorted[0].name, "image-1.dcm");
  assert.equal(sorted[1].name, "image-2.dcm");
  assert.equal(sorted[2].name, "image-10.dcm");
});

test("StudyBuilder builds and sorts an artificially scrambled multi-slice volume", async () => {
  const iopAxial = [1, 0, 0, 0, 1, 0]; // Normal = [0, 0, 1]

  // Simulate 4 slices acquired at Z = 0, 5, 10, 15 mm, but delivered in scrambled order
  // with arbitrary hashed names (similar to ZIP decompression output)
  const mockSlices: Record<string, ParsedDicom> = {
    "hash_c.dcm": createMockParsed({
      ipp: [-100, -100, 10.0],
      iop: iopAxial,
      instanceNumber: "3",
    }),
    "hash_a.dcm": createMockParsed({
      ipp: [-100, -100, 0.0],
      iop: iopAxial,
      instanceNumber: "1",
    }),
    "hash_d.dcm": createMockParsed({
      ipp: [-100, -100, 15.0],
      iop: iopAxial,
      instanceNumber: "4",
    }),
    "hash_b.dcm": createMockParsed({
      ipp: [-100, -100, 5.0],
      iop: iopAxial,
      instanceNumber: "2",
    }),
  };

  const inputs = Object.keys(mockSlices).map((name) => ({
    name,
    buffer: new ArrayBuffer(16),
  }));

  const builder = new StudyBuilder({
    parseFn: (_buf) => {
      // Return corresponding mock based on simulated lookup
      // In this test, we cycle through or match input names
      const match = inputs.find((inp) => inp.buffer === _buf);
      return mockSlices[match ? match.name : "hash_a.dcm"];
    },
  });

  const study = await builder.buildStudy(inputs);

  assert.equal(study.totalSlices, 4);
  assert.equal(study.series.length, 1);
  const series = study.primarySeries!;
  assert.ok(series, "Primary series should exist");

  // Verify slices are ordered strictly by physical Z (projected distance)
  assert.equal(series.slices[0].name, "hash_a.dcm");
  assert.equal(series.slices[0].projectedDistance, 0.0);
  assert.equal(series.slices[0].index, 0);

  assert.equal(series.slices[1].name, "hash_b.dcm");
  assert.equal(series.slices[1].projectedDistance, 5.0);
  assert.equal(series.slices[1].index, 1);

  assert.equal(series.slices[2].name, "hash_c.dcm");
  assert.equal(series.slices[2].projectedDistance, 10.0);
  assert.equal(series.slices[2].index, 2);

  assert.equal(series.slices[3].name, "hash_d.dcm");
  assert.equal(series.slices[3].projectedDistance, 15.0);
  assert.equal(series.slices[3].index, 3);

  // Plane normal & orientation labels
  assert.deepEqual(series.planeNormal, [0, 0, 1]);
  assert.deepEqual(series.orientationLabels, {
    top: "A",
    bottom: "P",
    left: "R",
    right: "L",
    rowOrientation: "L",
    colOrientation: "P",
  });

  // Calculated slice spacing: |15 - 0| / (4 - 1) = 5.0 mm
  assert.equal(series.spacingBetweenSlices, 5.0);
});

test("StudyBuilder groups distinct SeriesInstanceUIDs into separate series", async () => {
  const slice1SeriesA = createMockParsed({
    seriesInstanceUid: "series.A",
    instanceNumber: "1",
    ipp: [0, 0, 0],
  });
  const slice2SeriesA = createMockParsed({
    seriesInstanceUid: "series.A",
    instanceNumber: "2",
    ipp: [0, 0, 2.5],
  });
  const slice1SeriesB = createMockParsed({
    seriesInstanceUid: "series.B",
    seriesDescription: "Coronal Recon",
    instanceNumber: "1",
    iop: [1, 0, 0, 0, 0, -1],
    ipp: [0, 0, 0],
  });

  const map: Record<string, ParsedDicom> = {
    "a1.dcm": slice1SeriesA,
    "a2.dcm": slice2SeriesA,
    "b1.dcm": slice1SeriesB,
  };

  const inputs = Object.keys(map).map((name) => ({
    name,
    buffer: new ArrayBuffer(8),
  }));

  const study = await buildStudy(inputs, {
    parseFn: (_buf) => {
      const match = inputs.find((inp) => inp.buffer === _buf);
      return map[match ? match.name : "a1.dcm"];
    },
  });

  assert.equal(study.series.length, 2);
  assert.equal(study.totalSlices, 3);

  // Series A should be primarySeries because it has 2 slices vs 1 slice in B
  assert.equal(study.primarySeries?.seriesInstanceUid, "series.A");
  assert.equal(study.primarySeries?.slices.length, 2);

  // Series B has coronal orientation
  const seriesB = study.series.find((s) => s.seriesInstanceUid === "series.B")!;
  assert.ok(seriesB);
  assert.deepEqual(seriesB.orientationLabels?.top, "S");
  assert.deepEqual(seriesB.orientationLabels?.bottom, "I");
});

test("StudyBuilder handles unparseable inputs gracefully", async () => {
  const validParsed = createMockParsed({ instanceNumber: "1" });

  const inputs = [
    { name: "valid.dcm", buffer: new ArrayBuffer(8) },
    { name: "corrupt.dcm", buffer: new ArrayBuffer(8) },
  ];

  const study = await buildStudy(inputs, {
    parseFn: (_buf) => {
      const match = inputs.find((inp) => inp.buffer === _buf);
      if (match?.name === "corrupt.dcm") {
        throw new Error("Invalid DICOM header");
      }
      return validParsed;
    },
  });

  // Corrupt item skipped, valid item preserved
  assert.equal(study.totalSlices, 1);
  assert.equal(study.series[0].slices[0].name, "valid.dcm");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMeasurementOverlay,
  setActiveDrawing,
  getActiveDrawing,
  setSelectedAnnotationId,
  getSelectedAnnotationId,
  hitTestAnnotation,
} from "./measurement-overlay.ts";
import { addAnnotation, clearAnnotations } from "./annotation-state.ts";
import type { LengthAnnotation, EllipseAnnotation } from "./types.ts";
import type { DicomMetadata } from "../../dicom/dicom-parser-util.ts";
import type { ViewportState } from "../../dicom/dicom-renderer.ts";

function createMockCanvas(w = 500, h = 500): HTMLCanvasElement {
  const drawnCalls: string[] = [];
  const ctx: any = {
    canvas: { width: w, height: h },
    clearRect: () => drawnCalls.push("clearRect"),
    beginPath: () => drawnCalls.push("beginPath"),
    moveTo: () => drawnCalls.push("moveTo"),
    lineTo: () => drawnCalls.push("lineTo"),
    stroke: () => drawnCalls.push("stroke"),
    fill: () => drawnCalls.push("fill"),
    arc: () => drawnCalls.push("arc"),
    ellipse: () => drawnCalls.push("ellipse"),
    save: () => drawnCalls.push("save"),
    restore: () => drawnCalls.push("restore"),
    fillRect: () => drawnCalls.push("fillRect"),
    strokeRect: () => drawnCalls.push("strokeRect"),
    fillText: () => drawnCalls.push("fillText"),
    setLineDash: () => drawnCalls.push("setLineDash"),
    measureText: (text: string) => ({ width: (text || "").length * 7 }),
  };

  return {
    width: w,
    height: h,
    getContext: (type: string) => (type === "2d" ? ctx : null),
    _drawnCalls: drawnCalls,
  } as any;
}

const mockViewport: ViewportState = {
  windowCenter: 40,
  windowWidth: 400,
  zoom: 1,
  panX: 0,
  panY: 0,
};

const mockMetadata: DicomMetadata = {
  patientName: "Test Patient",
  patientId: "123",
  patientBirthDate: "",
  patientSex: "O",
  studyDate: "2026-01-01",
  studyDescription: "Test Study",
  studyInstanceUid: "1.2.3",
  accessionNumber: "ACC123",
  referringPhysician: "",
  seriesDescription: "Test Series",
  seriesNumber: "1",
  modality: "CT",
  instanceNumber: "1",
  sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
  sopInstanceUid: "1.2.3.4.5",
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
  pixelSpacing: [0.5, 0.5],
  transferSyntaxUid: "1.2.840.10008.1.2.1",
};

test.beforeEach(() => {
  clearAnnotations();
  setActiveDrawing(null);
  setSelectedAnnotationId(null);
});

test("activeDrawing and selectedAnnotationId state getters and setters", () => {
  assert.equal(getActiveDrawing(), null);
  setActiveDrawing({
    type: "length",
    start: { x: 10, y: 20 },
    end: { x: 30, y: 40 },
  });
  assert.deepEqual(getActiveDrawing(), {
    type: "length",
    start: { x: 10, y: 20 },
    end: { x: 30, y: 40 },
  });

  assert.equal(getSelectedAnnotationId(), null);
  setSelectedAnnotationId("ann-123");
  assert.equal(getSelectedAnnotationId(), "ann-123");
  setSelectedAnnotationId(null);
  assert.equal(getSelectedAnnotationId(), null);
});

test("renderMeasurementOverlay safely ignores missing canvas or metadata", () => {
  assert.doesNotThrow(() => {
    renderMeasurementOverlay({
      canvas: null,
      viewport: mockViewport,
      metadata: mockMetadata,
    });
  });

  const canvas = createMockCanvas();
  assert.doesNotThrow(() => {
    renderMeasurementOverlay({
      canvas,
      viewport: mockViewport,
      metadata: null,
    });
  });
});

test("renderMeasurementOverlay safely handles canvas with 0 dimensions", () => {
  const zeroCanvas = createMockCanvas(0, 0);
  assert.doesNotThrow(() => {
    renderMeasurementOverlay({
      canvas: zeroCanvas,
      viewport: mockViewport,
      metadata: mockMetadata,
    });
  });
});

test("renderMeasurementOverlay renders length and ellipse annotations", () => {
  const canvas = createMockCanvas(512, 512);

  const lengthAnn: LengthAnnotation = {
    id: "len-1",
    type: "length",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 0,
    start: { x: 100, y: 100 },
    end: { x: 200, y: 200 },
    distance: 50.0,
    isCalibrated: true,
    unit: "mm",
  };
  addAnnotation(lengthAnn);

  const ellipseAnn: EllipseAnnotation = {
    id: "ell-1",
    type: "ellipse",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 0,
    center: { x: 256, y: 256 },
    radiusX: 50,
    radiusY: 30,
    area: 4712.3,
    isCalibrated: true,
    unit: "mm²",
    meanHu: 35.5,
    stdDevHu: 12.0,
  };
  addAnnotation(ellipseAnn);

  renderMeasurementOverlay({
    canvas,
    viewport: mockViewport,
    metadata: mockMetadata,
    sopInstanceUid: "1.2.3.4.5",
  });

  const calls = (canvas as any)._drawnCalls;
  assert.ok(calls.includes("clearRect"));
  assert.ok(calls.includes("stroke"));
  assert.ok(calls.includes("fillText"));
});

test("renderMeasurementOverlay renders in-progress active drawings", () => {
  const canvas = createMockCanvas(512, 512);

  setActiveDrawing({
    type: "length",
    start: { x: 50, y: 50 },
    end: { x: 150, y: 150 },
  });

  renderMeasurementOverlay({
    canvas,
    viewport: mockViewport,
    metadata: mockMetadata,
    sopInstanceUid: "1.2.3.4.5",
  });

  let calls = (canvas as any)._drawnCalls;
  assert.ok(calls.includes("stroke"));

  setActiveDrawing({
    type: "ellipse",
    center: { x: 200, y: 200 },
    radiusX: 40,
    radiusY: 25,
  });

  renderMeasurementOverlay({
    canvas,
    viewport: mockViewport,
    metadata: mockMetadata,
    pixelData: new Int16Array(512 * 512),
    sopInstanceUid: "1.2.3.4.5",
  });

  calls = (canvas as any)._drawnCalls;
  assert.ok(calls.includes("ellipse"));
});

test("hitTestAnnotation detects length and ellipse selections correctly", () => {
  const lengthAnn: LengthAnnotation = {
    id: "len-1",
    type: "length",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 0,
    start: { x: 100, y: 100 },
    end: { x: 200, y: 100 },
    distance: 50.0,
    isCalibrated: true,
    unit: "mm",
  };

  const ellipseAnn: EllipseAnnotation = {
    id: "ell-1",
    type: "ellipse",
    sopInstanceUid: "1.2.3.4.5",
    sliceIndex: 0,
    center: { x: 300, y: 300 },
    radiusX: 40,
    radiusY: 40,
    area: 5026.5,
    isCalibrated: true,
    unit: "mm²",
  };

  const annotations = [lengthAnn, ellipseAnn];

  // In 512x512 with 512x512 image, zoom=1, pan=0, flipY=true:
  // (x_w, y_w) -> screen:
  // x_s = 256 + 0 + (x_w - 256)*1 = x_w
  // y_s = 256 + 0 - (y_w - 256)*1 = 512 - y_w
  // For start(100, 100): screen is (100, 412). For end(200, 100): screen is (200, 412).
  // Hit near midpoint (150, 412):
  const hitLength = hitTestAnnotation(
    150,
    412,
    annotations,
    mockViewport,
    512,
    512,
    512,
    512,
  );
  assert.equal(hitLength?.id, "len-1");

  // Miss length:
  const missLength = hitTestAnnotation(
    150,
    350,
    annotations,
    mockViewport,
    512,
    512,
    512,
    512,
  );
  assert.notEqual(missLength?.id, "len-1");

  // For ellipse center(300, 300): screen is (300, 512 - 300) = (300, 212).
  const hitEllipse = hitTestAnnotation(
    300,
    212,
    annotations,
    mockViewport,
    512,
    512,
    512,
    512,
  );
  assert.equal(hitEllipse?.id, "ell-1");

  // Miss everything:
  const missAll = hitTestAnnotation(
    10,
    10,
    annotations,
    mockViewport,
    512,
    512,
    512,
    512,
  );
  assert.equal(missAll, null);
});

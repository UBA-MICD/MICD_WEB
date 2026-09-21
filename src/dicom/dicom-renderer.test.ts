/**
 * dicom-renderer.ts is pure canvas math with no other DOM dependency, so
 * (like mpr.test.ts's WebGL2 mock) a fake canvas/2D-context object is
 * injected directly — no jsdom needed here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  renderDicom,
  applyCanvasTransform,
  createDefaultViewport,
  resetViewport,
  fitToContainer,
} from "./dicom-renderer.ts";
import type { DicomMetadata } from "./dicom-parser-util.ts";

function fakeContext(): any {
  return {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    created: [] as Array<{ w: number; h: number }>,
    putCalls: [] as Array<{ data: Uint8ClampedArray; x: number; y: number }>,
    createImageData(w: number, h: number) {
      this.created.push({ w, h });
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData(imageData: { data: Uint8ClampedArray }, x: number, y: number) {
      this.putCalls.push({ data: imageData.data, x, y });
    },
  };
}

function fakeCanvas(ctx: any): any {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: (kind: string) => (kind === "2d" ? ctx : null),
  };
}

const baseMeta: DicomMetadata = {
  patientName: "",
  patientId: "",
  patientBirthDate: "",
  patientSex: "",
  studyDate: "",
  studyDescription: "",
  studyInstanceUid: "",
  accessionNumber: "",
  referringPhysician: "",
  seriesDescription: "",
  seriesNumber: "",
  modality: "",
  instanceNumber: "",
  sopClassUid: "",
  rows: 2,
  columns: 2,
  bitsAllocated: 16,
  bitsStored: 16,
  highBit: 15,
  pixelRepresentation: 0,
  samplesPerPixel: 1,
  photometricInterpretation: "MONOCHROME2",
  rescaleIntercept: 0,
  rescaleSlope: 1,
  windowCenter: 128,
  windowWidth: 256,
  transferSyntaxUid: "",
};

const baseViewport = {
  windowCenter: 128,
  windowWidth: 256,
  zoom: 1,
  panX: 0,
  panY: 0,
};

test("renderDicom does nothing when getContext returns null", () => {
  const canvas = fakeCanvas(null);
  assert.doesNotThrow(() =>
    renderDicom({
      canvas,
      pixelData: new Uint16Array([0, 100, 200, 300]),
      metadata: baseMeta,
      viewport: baseViewport,
    }),
  );
});

test("renderDicom does nothing when rows or columns is 0", () => {
  const ctx = fakeContext();
  const canvas = fakeCanvas(ctx);
  renderDicom({
    canvas,
    pixelData: new Uint16Array([]),
    metadata: { ...baseMeta, rows: 0 },
    viewport: baseViewport,
  });
  assert.equal(ctx.created.length, 0);
});

test("renderDicom resizes the canvas to match image dimensions", () => {
  const ctx = fakeContext();
  const canvas = fakeCanvas(ctx);
  canvas.width = 99;
  canvas.height = 99;
  renderDicom({
    canvas,
    pixelData: new Uint16Array([0, 100, 200, 300]),
    metadata: baseMeta,
    viewport: baseViewport,
  });
  assert.equal(canvas.width, 2);
  assert.equal(canvas.height, 2);
});

test("renderDicom does not resize when canvas already matches", () => {
  const ctx = fakeContext();
  const canvas = fakeCanvas(ctx);
  canvas.width = 2;
  canvas.height = 2;
  let resized = false;
  Object.defineProperty(canvas, "width", {
    get: () => 2,
    set: () => {
      resized = true;
    },
  });
  renderDicom({
    canvas,
    pixelData: new Uint16Array([0, 100, 200, 300]),
    metadata: baseMeta,
    viewport: baseViewport,
  });
  assert.equal(resized, false);
});

test("renderDicom maps monochrome pixels through window/level with clamping", () => {
  const ctx = fakeContext();
  const canvas = fakeCanvas(ctx);
  // window center 128, width 256 -> range [0, 256]
  renderDicom({
    canvas,
    pixelData: new Uint16Array([(-1000 >>> 0) & 0xffff, 0, 128, 5000]),
    metadata: baseMeta,
    viewport: baseViewport,
  });
  const out = ctx.putCalls[0].data;
  // pixel 1 (value 0) is below minValue(0) -> 0
  assert.equal(out[4], 0);
  // pixel 2 (value 128) is mid-range -> ~128
  assert.ok(out[8] > 100 && out[8] < 156);
  // alpha channel always 255
  assert.equal(out[3], 255);
  assert.equal(out[7], 255);
});

test("renderDicom inverts intensity for MONOCHROME1", () => {
  const ctx1 = fakeContext();
  renderDicom({
    canvas: fakeCanvas(ctx1),
    pixelData: new Uint16Array([300, 300, 300, 300]), // clamps to 255 (max)
    metadata: baseMeta,
    viewport: baseViewport,
  });
  const normal = ctx1.putCalls[0].data[0];

  const ctx2 = fakeContext();
  renderDicom({
    canvas: fakeCanvas(ctx2),
    pixelData: new Uint16Array([300, 300, 300, 300]),
    metadata: { ...baseMeta, photometricInterpretation: "MONOCHROME1" },
    viewport: baseViewport,
  });
  const inverted = ctx2.putCalls[0].data[0];

  assert.equal(normal, 255);
  assert.equal(inverted, 0);
});

test("renderDicom applies rescale slope/intercept before windowing", () => {
  const ctx = fakeContext();
  renderDicom({
    canvas: fakeCanvas(ctx),
    pixelData: new Uint16Array([1000, 1000, 1000, 1000]),
    metadata: { ...baseMeta, rescaleSlope: 1, rescaleIntercept: -1000 },
    viewport: baseViewport, // window [0,256], modality value = 0 -> intensity 0
  });
  assert.equal(ctx.putCalls[0].data[0], 0);
});

test("renderDicom uses a fallback range of 1 when windowWidth is 0", () => {
  const ctx = fakeContext();
  assert.doesNotThrow(() =>
    renderDicom({
      canvas: fakeCanvas(ctx),
      pixelData: new Uint16Array([0, 1, 2, 3]),
      metadata: baseMeta,
      viewport: { windowCenter: 0, windowWidth: 0, zoom: 1, panX: 0, panY: 0 },
    }),
  );
});

test("renderDicom renders RGB pixel data for photometric RGB with 3 samples/pixel", () => {
  const ctx = fakeContext();
  const meta: DicomMetadata = {
    ...baseMeta,
    photometricInterpretation: "RGB",
    samplesPerPixel: 3,
    rows: 1,
    columns: 2,
  };
  renderDicom({
    canvas: fakeCanvas(ctx),
    pixelData: new Uint8Array([10, 20, 30, 40, 50, 60]),
    metadata: meta,
    viewport: baseViewport,
  });
  const out = ctx.putCalls[0].data;
  assert.deepEqual(Array.from(out.slice(0, 4)), [10, 20, 30, 255]);
  assert.deepEqual(Array.from(out.slice(4, 8)), [40, 50, 60, 255]);
});

test("renderDicom sets high-quality image smoothing", () => {
  const ctx = fakeContext();
  renderDicom({
    canvas: fakeCanvas(ctx),
    pixelData: new Uint16Array([0, 100, 200, 300]),
    metadata: baseMeta,
    viewport: baseViewport,
  });
  assert.equal(ctx.imageSmoothingEnabled, true);
  assert.equal(ctx.imageSmoothingQuality, "high");
});

test("applyCanvasTransform sets a translate+scale CSS transform", () => {
  const imageCanvas: any = { style: {} };
  applyCanvasTransform({} as any, imageCanvas, {
    windowCenter: 0,
    windowWidth: 0,
    zoom: 2.5,
    panX: 10,
    panY: -5,
  });
  assert.equal(imageCanvas.style.transform, "translate(10px, -5px) scale(2.5)");
});

test("createDefaultViewport reads window center/width from metadata with zoom 1 and no pan", () => {
  const vp = createDefaultViewport({
    ...baseMeta,
    windowCenter: 40,
    windowWidth: 400,
  });
  assert.deepEqual(vp, {
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
});

test("resetViewport is equivalent to createDefaultViewport", () => {
  assert.deepEqual(resetViewport(baseMeta), createDefaultViewport(baseMeta));
});

test("fitToContainer returns 1 when the image has zero width or height", () => {
  assert.equal(fitToContainer(800, 600, 0, 512), 1);
  assert.equal(fitToContainer(800, 600, 512, 0), 1);
});

test("fitToContainer scales to the smaller axis with a 10% margin", () => {
  // container 800x600, image 400x400 -> scaleX=2, scaleY=1.5 -> min=1.5 * 0.9
  assert.equal(fitToContainer(800, 600, 400, 400), 1.5 * 0.9);
});

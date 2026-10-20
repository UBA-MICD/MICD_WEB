import test from "node:test";
import assert from "node:assert/strict";
import {
  renderSegmentationOverlay,
  segmentationAreaMm2,
  SEGMENTATION_COLORS,
  SEGMENTATION_LINE_WIDTH,
  type SegmentationLayer,
} from "./segmentation-overlay.ts";
import type { DicomMetadata } from "../../dicom/dicom-parser-util.ts";

interface Recorded {
  calls: string[];
  points: Array<[number, number]>;
  lineWidths: number[];
  strokeStyles: unknown[];
  fillStyles: unknown[];
}

function createMockCanvas(
  w = 256,
  h = 256,
): {
  canvas: HTMLCanvasElement;
  rec: Recorded;
} {
  const rec: Recorded = {
    calls: [],
    points: [],
    lineWidths: [],
    strokeStyles: [],
    fillStyles: [],
  };
  const ctx: any = {
    canvas: { width: w, height: h },
    save: () => rec.calls.push("save"),
    restore: () => rec.calls.push("restore"),
    beginPath: () => rec.calls.push("beginPath"),
    closePath: () => rec.calls.push("closePath"),
    moveTo: (x: number, y: number) => {
      rec.calls.push("moveTo");
      rec.points.push([x, y]);
    },
    lineTo: (x: number, y: number) => {
      rec.calls.push("lineTo");
      rec.points.push([x, y]);
    },
    fill: () => {
      rec.calls.push("fill");
      rec.fillStyles.push(ctx.fillStyle);
    },
    stroke: () => {
      rec.calls.push("stroke");
      rec.lineWidths.push(ctx.lineWidth);
      rec.strokeStyles.push(ctx.strokeStyle);
    },
  };
  const canvas = {
    width: w,
    height: h,
    getContext: (type: string) => (type === "2d" ? ctx : null),
  } as unknown as HTMLCanvasElement;
  return { canvas, rec };
}

const METADATA = { rows: 256, columns: 256 } as DicomMetadata;

function makeLayer(
  overrides: Partial<SegmentationLayer> = {},
): SegmentationLayer {
  return {
    contorno: [
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 80 },
      { x: 10, y: 80 },
    ],
    mascara: {
      width: 256,
      height: 256,
      data: new Uint8Array(0),
      pixelCount: 4800,
    },
    visible: true,
    seed: 1,
    simulado: true,
    ...overrides,
  };
}

test("draws the contour in image pixel coordinates, untransformed", () => {
  // Esto es lo que hace que el contorno acompañe al DICOM: se dibuja en el
  // canvas de la imagen tal cual, y el CSS transform del canvas lo mueve.
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({ canvas, metadata: METADATA, layer: makeLayer() });

  assert.deepEqual(rec.points, [
    [10, 20],
    [90, 20],
    [90, 80],
    [10, 80],
  ]);
});

test("closes the path so the region is a single closed shape", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({ canvas, metadata: METADATA, layer: makeLayer() });

  assert.ok(rec.calls.includes("closePath"));
  assert.equal(rec.calls.filter((c) => c === "moveTo").length, 1);
  assert.equal(rec.calls.filter((c) => c === "lineTo").length, 3);
});

test("strokes turquoise and fills by default", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({ canvas, metadata: METADATA, layer: makeLayer() });

  assert.equal(rec.strokeStyles[0], SEGMENTATION_COLORS.stroke);
  assert.equal(rec.fillStyles[0], SEGMENTATION_COLORS.fill);
});

test("fill: false draws only the border", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({
    canvas,
    metadata: METADATA,
    layer: makeLayer(),
    fill: false,
  });

  assert.ok(!rec.calls.includes("fill"));
  assert.ok(rec.calls.includes("stroke"));
});

test("divides the line width by the zoom so the border stays ~2 screen px", () => {
  for (const zoom of [1, 2, 4]) {
    const { canvas, rec } = createMockCanvas();
    renderSegmentationOverlay({
      canvas,
      metadata: METADATA,
      layer: makeLayer(),
      zoom,
    });
    assert.equal(rec.lineWidths[0], SEGMENTATION_LINE_WIDTH / zoom);
  }
});

test("a zoom of 0 or missing falls back to a width of 1x", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({
    canvas,
    metadata: METADATA,
    layer: makeLayer(),
    zoom: 0,
  });
  assert.equal(rec.lineWidths[0], SEGMENTATION_LINE_WIDTH);
});

test("draws nothing when the layer is hidden", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({
    canvas,
    metadata: METADATA,
    layer: makeLayer({ visible: false }),
  });
  assert.deepEqual(rec.calls, []);
});

test("draws nothing without a layer, metadata or canvas", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({ canvas, metadata: METADATA, layer: null });
  renderSegmentationOverlay({ canvas, metadata: null, layer: makeLayer() });
  renderSegmentationOverlay({
    canvas: null,
    metadata: METADATA,
    layer: makeLayer(),
  });
  assert.deepEqual(rec.calls, []);
});

test("draws nothing for a degenerate contour", () => {
  const { canvas, rec } = createMockCanvas();
  renderSegmentationOverlay({
    canvas,
    metadata: METADATA,
    layer: makeLayer({
      contorno: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    }),
  });
  assert.deepEqual(rec.calls, []);
});

// ── Área ─────────────────────────────────────────────────────────────────────

test("segmentationAreaMm2 multiplies the pixel count by the pixel spacing", () => {
  const metadata = { ...METADATA, pixelSpacing: [0.5, 0.5] } as DicomMetadata;
  assert.equal(segmentationAreaMm2(makeLayer(), metadata), 4800 * 0.25);
});

test("segmentationAreaMm2 returns null for an uncalibrated image", () => {
  assert.equal(segmentationAreaMm2(makeLayer(), METADATA), null);
});

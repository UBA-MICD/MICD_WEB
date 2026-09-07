import test from "node:test";
import assert from "node:assert/strict";
import {
  Matrix4,
  MPRVolume,
  MPRCamera,
  MPREngine,
  mprEngine,
  type MPRVolumeData,
} from "./mpr-engine.js";

// ── WebGL2 Context Mock ──────────────────────────────────────────────────────

function createMockWebGL2Context(): any {
  return {
    canvas: {},
    TEXTURE_3D: 0x806f,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_WRAP_R: 0x8072,
    CLAMP_TO_EDGE: 0x812f,
    R8: 0x8229,
    RED: 0x1903,
    UNSIGNED_BYTE: 0x1401,
    COLOR_BUFFER_BIT: 0x4000,
    TRIANGLES: 0x0004,
    FLOAT: 0x1406,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    UNPACK_ALIGNMENT: 0x0cf5,

    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: (_prog: any, name: string) => ({ name }),
    uniformMatrix4fv: () => {},
    uniform1i: () => {},
    uniform1f: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    pixelStorei: () => {},
    texImage3D: () => {},
    texParameteri: () => {},
    createTexture: () => ({}),
    deleteTexture: () => {},
    deleteProgram: () => {},
    deleteShader: () => {},
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    drawArrays: () => {},
  };
}

function sampleVolumeData(): MPRVolumeData {
  const depth = 10;
  const rows = 16;
  const cols = 16;
  return {
    depth,
    rows,
    cols,
    data: new Int16Array(depth * rows * cols),
    pixelSpacing: [1.5, 1.5], // [dy, dx] in mm
    sliceSpacing: 3.0, // dz in mm
    rescaleSlope: 1.0,
    rescaleIntercept: 0.0,
    windowCenter: 40,
    windowWidth: 400,
  };
}

// ── Matrix4 Tests ────────────────────────────────────────────────────────────

test("Matrix4: create and identity return 4x4 identity matrix", () => {
  const mat = Matrix4.create();
  assert.equal(mat.length, 16);
  assert.equal(mat[0], 1);
  assert.equal(mat[5], 1);
  assert.equal(mat[10], 1);
  assert.equal(mat[15], 1);
  assert.equal(mat[1], 0);
  assert.equal(mat[4], 0);
});

test("Matrix4: multiply performs column-major matrix multiplication", () => {
  const a = Matrix4.identity();
  const b = Matrix4.translate(Matrix4.identity(), [10, 20, 30]);
  const prod = Matrix4.multiply(a, b);
  assert.deepEqual(Array.from(prod), Array.from(b));
});

test("Matrix4: invert correctly inverts identity and affine matrices (M * M^-1 = I)", () => {
  const ident = Matrix4.identity();
  const invIdent = Matrix4.invert(ident);
  assert.ok(invIdent);
  assert.deepEqual(Array.from(invIdent), Array.from(ident));

  // Complex affine matrix: Translation * RotationY * Scale
  let m = Matrix4.identity();
  m = Matrix4.translate(m, [15, -25, 50]);
  m = Matrix4.rotateY(m, Math.PI / 3);
  m = Matrix4.scale(m, [2, 1.5, 0.8]);

  const inv = Matrix4.invert(m);
  assert.ok(inv, "Matrix must be invertible");

  const prod = Matrix4.multiply(m, inv!);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const expected = i === j ? 1 : 0;
      const actual = prod[j * 4 + i];
      assert.ok(
        Math.abs(actual - expected) < 1e-4,
        `Index (${i}, ${j}): expected ${expected}, got ${actual}`,
      );
    }
  }
});

test("Matrix4: invert returns null for singular (non-invertible) matrix", () => {
  const singular = new Float32Array(16); // all zeros
  const inv = Matrix4.invert(singular);
  assert.equal(inv, null);
});

test("Matrix4: transpose switches rows and columns", () => {
  const m = new Float32Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  const t = Matrix4.transpose(m);
  assert.equal(t[1], 5);
  assert.equal(t[4], 2);
  assert.equal(t[2], 9);
  assert.equal(t[8], 3);
});

test("Matrix4: transformPoint applies affine transformation with perspective divide", () => {
  let m = Matrix4.identity();
  m = Matrix4.translate(m, [10, 20, 30]);
  m = Matrix4.scale(m, [2, 3, 4]);

  const pt = Matrix4.transformPoint(m, [1, 1, 1]);
  assert.deepEqual(pt, [12, 23, 34]);
});

// ── MPRVolume Tests ──────────────────────────────────────────────────────────

test("MPRVolume: calculates physical dimensions and unit mappings", () => {
  const data = sampleVolumeData();
  const volume = new MPRVolume(data);

  // cols=16 * dx=1.5 = 24 mm
  // rows=16 * dy=1.5 = 24 mm
  // depth=10 * dz=3.0 = 30 mm
  assert.deepEqual(volume.physicalSize, [24, 24, 30]);

  // Texture center [0.5, 0.5, 0.5] maps to world origin [0, 0, 0] when untransformed
  const texToWorld = volume.getTexToWorldMatrix();
  const worldCenter = Matrix4.transformPoint(texToWorld, [0.5, 0.5, 0.5]);
  assert.ok(Math.abs(worldCenter[0]) < 1e-5);
  assert.ok(Math.abs(worldCenter[1]) < 1e-5);
  assert.ok(Math.abs(worldCenter[2]) < 1e-5);

  // World origin [0, 0, 0] maps to texture center [0.5, 0.5, 0.5]
  const worldToTex = volume.getWorldToTexMatrix();
  const texCenter = Matrix4.transformPoint(worldToTex, [0, 0, 0]);
  assert.ok(Math.abs(texCenter[0] - 0.5) < 1e-5);
  assert.ok(Math.abs(texCenter[1] - 0.5) < 1e-5);
  assert.ok(Math.abs(texCenter[2] - 0.5) < 1e-5);
});

test("MPRVolume: transformation methods update world matrices without mutating texture", () => {
  const volume = new MPRVolume(sampleVolumeData());

  volume.translate(10, -5, 15);
  assert.deepEqual(volume.transform.translation, [10, -5, 15]);

  volume.rotate(0.2, 0.4, -0.1);
  assert.deepEqual(volume.transform.rotation, [0.2, 0.4, -0.1]);

  volume.scale(1.5);
  assert.equal(volume.transform.scale, 1.5);

  // Reset restores identity
  volume.resetTransform();
  assert.deepEqual(volume.transform.translation, [0, 0, 0]);
  assert.deepEqual(volume.transform.rotation, [0, 0, 0]);
  assert.equal(volume.transform.scale, 1.0);
});

// ── MPRCamera & Static Orthogonal Projection Tests ───────────────────────────

test("MPRCamera: Axial, Coronal, and Sagittal cameras have static orthogonal bases", () => {
  const axial = new MPRCamera("axial");
  assert.deepEqual(axial.uAxis, [1, 0, 0]);
  assert.deepEqual(axial.vAxis, [0, -1, 0]);
  assert.deepEqual(axial.normal, [0, 0, 1]);

  const coronal = new MPRCamera("coronal");
  assert.deepEqual(coronal.uAxis, [1, 0, 0]);
  assert.deepEqual(coronal.vAxis, [0, 0, 1]);
  assert.deepEqual(coronal.normal, [0, 1, 0]);

  const sagittal = new MPRCamera("sagittal");
  assert.deepEqual(sagittal.uAxis, [0, 1, 0]);
  assert.deepEqual(sagittal.vAxis, [0, 0, 1]);
  assert.deepEqual(sagittal.normal, [1, 0, 0]);
});

test("MPRCamera: setSliceIndex and getSliceIndex bidirectional mapping", () => {
  const camera = new MPRCamera("axial");
  const totalSlices = 100;
  const totalDimensionMm = 300;

  camera.setSliceIndex(50, totalSlices, totalDimensionMm);
  const retrievedIndex = camera.getSliceIndex(totalSlices, totalDimensionMm);
  assert.equal(retrievedIndex, 50);

  camera.setSliceIndex(0, totalSlices, totalDimensionMm);
  assert.equal(camera.sliceOffset, -150);
  assert.equal(camera.getSliceIndex(totalSlices, totalDimensionMm), 0);

  camera.setSliceIndex(99, totalSlices, totalDimensionMm);
  assert.equal(camera.sliceOffset, 150);
  assert.equal(camera.getSliceIndex(totalSlices, totalDimensionMm), 99);
});

test("MPRCamera: M_screenToTex extracts orthogonal slice center accurately", () => {
  const volume = new MPRVolume(sampleVolumeData());
  const camera = new MPRCamera("axial");

  const screenToTex = camera.getScreenToTexMatrix(volume, 512, 512);

  // Screen quad center (0, 0) should map to texture center (0.5, 0.5, 0.5)
  const centerTex = Matrix4.transformPoint(screenToTex, [0, 0, 0]);
  assert.ok(Math.abs(centerTex[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(centerTex[1] - 0.5) < 1e-4);
  assert.ok(Math.abs(centerTex[2] - 0.5) < 1e-4);

  // Screen quad top-left (-1, 1) should map to top-left voxel coordinates (u=0, v=0, w=0.5)
  const tlTex = Matrix4.transformPoint(screenToTex, [-1, 1, 0]);
  assert.ok(Math.abs(tlTex[0] - 0.0) < 1e-4);
  assert.ok(Math.abs(tlTex[1] - 0.0) < 1e-4);
  assert.ok(Math.abs(tlTex[2] - 0.5) < 1e-4);
});

test("MPRCamera: Volume rotation obliquely samples volume texture while camera remains static", () => {
  const volume = new MPRVolume(sampleVolumeData());
  const camera = new MPRCamera("axial");

  // Rotate volume by 45 degrees around Y
  volume.setRotation(0, Math.PI / 4, 0);

  // Camera basis remains untouched (strictly static)
  assert.deepEqual(camera.uAxis, [1, 0, 0]);
  assert.deepEqual(camera.vAxis, [0, -1, 0]);
  assert.deepEqual(camera.normal, [0, 0, 1]);

  const screenToTex = camera.getScreenToTexMatrix(volume, 512, 512);

  // Center is still at (0.5, 0.5, 0.5)
  const centerTex = Matrix4.transformPoint(screenToTex, [0, 0, 0]);
  assert.ok(Math.abs(centerTex[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(centerTex[1] - 0.5) < 1e-4);
  assert.ok(Math.abs(centerTex[2] - 0.5) < 1e-4);

  // But across the X axis, texture Z coordinate varies obliquely!
  const leftTex = Matrix4.transformPoint(screenToTex, [-1, 0, 0]);
  const rightTex = Matrix4.transformPoint(screenToTex, [1, 0, 0]);
  assert.notEqual(leftTex[2], rightTex[2]);
  assert.ok(Math.abs(leftTex[2] - 0.5) > 0.1);
});

// ── MPREngine Tests ──────────────────────────────────────────────────────────

test("MPREngine: loadVolume initializes cameras, window/level, and volume", () => {
  const engine = new MPREngine();
  const data = sampleVolumeData();
  engine.loadVolume(data);

  assert.ok(engine.volume);
  assert.equal(engine.windowCenter, 40);
  assert.equal(engine.windowWidth, 400);
});

test("MPREngine: initGL compiles WebGL2 pipeline and creates fullscreen quad VAO", () => {
  const engine = new MPREngine();
  const mockCanvas: any = {
    getContext: (type: string) =>
      type === "webgl2" ? createMockWebGL2Context() : null,
  };

  const success = engine.initGL(mockCanvas);
  assert.equal(success, true);
});

test("MPREngine: renderView uploads texture and renders orthogonal slice", () => {
  const engine = new MPREngine();
  engine.loadVolume(sampleVolumeData());

  let drawCount = 0;
  const mockCtx = createMockWebGL2Context();
  mockCtx.drawArrays = () => {
    drawCount++;
  };

  const mockCanvas: any = {
    getContext: (type: string) => (type === "webgl2" ? mockCtx : null),
    clientWidth: 400,
    clientHeight: 400,
    width: 400,
    height: 400,
  };

  assert.equal(engine.renderView("axial", mockCanvas), true);
  assert.equal(drawCount, 1);

  assert.equal(engine.renderView("coronal", mockCanvas), true);
  assert.equal(drawCount, 2);

  assert.equal(engine.renderView("sagittal", mockCanvas), true);
  assert.equal(drawCount, 3);
});

test("MPREngine: renderAll calls renderView on all specified canvases", () => {
  const engine = new MPREngine();
  engine.loadVolume(sampleVolumeData());

  let renders = 0;
  const mockCtx = createMockWebGL2Context();
  mockCtx.drawArrays = () => renders++;

  const createCanvas = () =>
    ({
      getContext: (type: string) => (type === "webgl2" ? mockCtx : null),
      clientWidth: 200,
      clientHeight: 200,
      width: 200,
      height: 200,
    }) as any;

  engine.renderAll({
    axial: createCanvas(),
    coronal: createCanvas(),
    sagittal: createCanvas(),
  });

  assert.equal(renders, 3);
});

test("MPREngine: volume manipulation updates volume transform", () => {
  const engine = new MPREngine();
  engine.loadVolume(sampleVolumeData());

  engine.rotateVolume(0.1, 0.2, 0.3);
  assert.deepEqual(engine.volume!.transform.rotation, [0.1, 0.2, 0.3]);

  engine.translateVolume(5, -10, 15);
  assert.deepEqual(engine.volume!.transform.translation, [5, -10, 15]);

  engine.scaleVolume(1.2);
  assert.equal(engine.volume!.transform.scale, 1.2);

  engine.resetVolumeTransform();
  assert.deepEqual(engine.volume!.transform.translation, [0, 0, 0]);
  assert.deepEqual(engine.volume!.transform.rotation, [0, 0, 0]);
  assert.equal(engine.volume!.transform.scale, 1.0);
});

test("mprEngine singleton instance is exported", () => {
  assert.ok(mprEngine instanceof MPREngine);
});

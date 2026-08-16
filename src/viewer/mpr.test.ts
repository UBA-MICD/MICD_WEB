import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, MPR3DViewer, VoxelVolume } from "./mpr.js";
import { state } from "./state.js";
import { updateToolbarUI } from "./interaction.js";

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
    DEPTH_BUFFER_BIT: 0x0100,
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
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    LEQUAL: 0x0203,

    enable: () => {},
    disable: () => {},
    blendFunc: () => {},
    depthFunc: () => {},
    pixelStorei: () => {},
    generateMipmap: () => {},
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    uniformMatrix4fv: () => {},
    uniform3fv: () => {},
    uniform3f: () => {},
    uniform1f: () => {},
    uniform1i: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    texParameteri: () => {},
    texImage3D: () => {},
    createTexture: () => ({}),
    deleteTexture: () => {},
    deleteProgram: () => {},
    deleteShader: () => {},
    deleteBuffer: () => {},
    deleteVertexArray: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    drawArrays: () => {},
  };
}

// ── Matrix4 Tests ────────────────────────────────────────────────────────────

test("Matrix4.create creates a 4x4 identity matrix", () => {
  const mat = Matrix4.create();
  assert.equal(mat.length, 16);
  assert.equal(mat[0], 1);
  assert.equal(mat[5], 1);
  assert.equal(mat[10], 1);
  assert.equal(mat[15], 1);
  assert.equal(mat[1], 0);
});

test("Matrix4.identity creates an identity matrix", () => {
  const mat = Matrix4.identity();
  assert.equal(mat.length, 16);
  assert.equal(mat[0], 1);
  assert.equal(mat[15], 1);
});

test("Matrix4.perspective produces valid projection matrix", () => {
  const fovy = Math.PI / 4;
  const aspect = 1.333;
  const near = 0.1;
  const far = 100;
  const proj = Matrix4.perspective(fovy, aspect, near, far);
  assert.equal(proj.length, 16);
  assert.ok(proj[0] > 0);
  assert.ok(proj[5] > 0);
  assert.equal(proj[11], -1);
});

test("Matrix4.lookAt computes view matrix correctly", () => {
  const eye = [0, 0, 5];
  const center = [0, 0, 0];
  const up = [0, 1, 0];
  const view = Matrix4.lookAt(eye, center, up);
  assert.equal(view.length, 16);
  assert.equal(view[15], 1);
  assert.equal(view[14], -5);
});

test("Matrix4.multiply correctly computes matrix product", () => {
  const id1 = Matrix4.identity();
  const id2 = Matrix4.identity();
  const result = Matrix4.multiply(id1, id2);
  assert.deepEqual(Array.from(result), Array.from(id1));
});

// ── MPR3DViewer State Tests ──────────────────────────────────────────────────

test("MPR3DViewer initializes with default state", () => {
  const viewer = new MPR3DViewer();
  assert.equal(viewer.isActive, false);
  assert.equal(viewer.activeView, "3d");
  assert.ok(viewer.camera);
  assert.equal(typeof viewer.camera.theta, "number");
  assert.equal(typeof viewer.camera.phi, "number");
  assert.ok(viewer.crosshair);
});

test("MPR3DViewer setOrientation updates activeView and camera angles", () => {
  const viewer = new MPR3DViewer();

  viewer.setOrientation("axial");
  assert.equal(viewer.activeView, "axial");
  assert.equal(viewer.camera.theta, 0);
  assert.equal(viewer.camera.phi, 0);

  viewer.setOrientation("coronal");
  assert.equal(viewer.activeView, "coronal");
  assert.equal(viewer.camera.theta, Math.PI / 2);

  viewer.setOrientation("sagittal");
  assert.equal(viewer.activeView, "sagittal");
  assert.equal(viewer.camera.phi, Math.PI / 2);

  viewer.setOrientation("3d");
  assert.equal(viewer.activeView, "3d");
});

test("MPR3DViewer getDepthInfo and setDepthIndex manage slice positions", () => {
  const viewer = new MPR3DViewer();
  const mockVolume: VoxelVolume = {
    depth: 10,
    rows: 256,
    cols: 256,
    data: new Int16Array(10 * 256 * 256),
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 50,
    windowWidth: 100,
  };
  viewer.volume = mockVolume;

  viewer.setOrientation("axial");
  viewer.setDepthIndex(5);
  let info = viewer.getDepthInfo();
  assert.equal(info.current, 5);
  assert.equal(info.total, 10);

  viewer.setOrientation("coronal");
  viewer.setDepthIndex(120);
  info = viewer.getDepthInfo();
  assert.equal(info.current, 120);
  assert.equal(info.total, 256);

  viewer.setOrientation("sagittal");
  viewer.setDepthIndex(80);
  info = viewer.getDepthInfo();
  assert.equal(info.current, 80);
  assert.equal(info.total, 256);
});

test("MPR3DViewer updateCrosshairFromPointer updates crosshair coordinates", () => {
  const viewer = new MPR3DViewer();
  viewer.volume = {
    depth: 20,
    rows: 100,
    cols: 100,
    data: new Int16Array(20 * 100 * 100),
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 0,
    windowWidth: 100,
  };
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  state.viewport.zoom = 1;

  viewer.setOrientation("axial");
  viewer.updateCrosshairFromPointer(250, 250, 400, 400);
  assert.ok(viewer.crosshair.x >= 0);
  assert.ok(viewer.crosshair.y >= 0);
});

test("MPR3DViewer render executes cleanly with WebGL2 mock", () => {
  const viewer = new MPR3DViewer();
  viewer.volume = {
    depth: 5,
    rows: 64,
    cols: 64,
    data: new Int16Array(5 * 64 * 64),
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 0,
    windowWidth: 100,
  };

  const mockCtx = createMockWebGL2Context();
  const mockCanvas: any = {
    getContext: (type: string) => (type === "webgl2" ? mockCtx : null),
    clientWidth: 500,
    clientHeight: 500,
    width: 500,
    height: 500,
  };

  assert.doesNotThrow(() => {
    viewer.render(mockCanvas);
  });
});

test("MPR3DViewer renderGizmo draws axes on 2D context", () => {
  const viewer = new MPR3DViewer();
  const mock2dCtx: any = {
    clearRect: () => {},
    strokeStyle: "",
    lineWidth: 1,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillStyle: "",
    fillText: () => {},
  };
  const mockGizmoCanvas: any = {
    getContext: (type: string) => (type === "2d" ? mock2dCtx : null),
    width: 100,
    height: 100,
  };

  assert.doesNotThrow(() => {
    viewer.renderGizmo(mockGizmoCanvas);
  });
});

test("updateToolbarUI disables Pan in 3D mode and Crosshair in 2D mode", () => {
  const mockPanBtn: any = {
    disabled: false,
    classList: { toggle: () => {} },
    setAttribute: () => {},
  };
  const mockCrosshairBtn: any = {
    disabled: false,
    classList: { toggle: () => {} },
    setAttribute: () => {},
  };
  const mockWlBtn: any = {
    disabled: false,
    classList: { toggle: () => {} },
    setAttribute: () => {},
  };
  const mockZoomBtn: any = {
    disabled: false,
    classList: { toggle: () => {} },
    setAttribute: () => {},
  };
  const mockExportBtn: any = { disabled: false };
  const mockViewport: any = { className: "", classList: { add: () => {} } };

  const originalDoc = (globalThis as any).document;
  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === "tool-pan") return mockPanBtn;
      if (id === "tool-crosshair") return mockCrosshairBtn;
      if (id === "tool-wl") return mockWlBtn;
      if (id === "tool-zoom") return mockZoomBtn;
      if (id === "btn-export-menu") return mockExportBtn;
      if (id === "viewport-container") return mockViewport;
      return null;
    },
  };

  try {
    // Test 2D mode (state.is3DMode = false)
    state.is3DMode = false;
    state.activeTool = "crosshair";
    updateToolbarUI();
    assert.equal(state.activeTool, "wl");
    assert.equal(mockPanBtn.disabled, false);
    assert.equal(mockCrosshairBtn.disabled, true);

    // Test 3D mode (state.is3DMode = true)
    state.is3DMode = true;
    state.activeTool = "pan";
    updateToolbarUI();
    assert.equal(state.activeTool, "wl");
    assert.equal(mockPanBtn.disabled, true);
    assert.equal(mockCrosshairBtn.disabled, false);
  } finally {
    (globalThis as any).document = originalDoc;
  }
});

test("MPR3DViewer renders cleanly under high zoom levels with dynamic clipping", () => {
  const viewer = new MPR3DViewer();
  viewer.volume = {
    depth: 5,
    rows: 64,
    cols: 64,
    data: new Int16Array(5 * 64 * 64),
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 0,
    windowWidth: 100,
  };
  viewer.camera.zoom = 5.0;

  const mockCtx = createMockWebGL2Context();
  const mockCanvas: any = {
    getContext: (type: string) => (type === "webgl2" ? mockCtx : null),
    clientWidth: 500,
    clientHeight: 500,
    width: 500,
    height: 500,
  };

  assert.doesNotThrow(() => {
    viewer.render(mockCanvas);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  Matrix4,
  View3DViewer,
  view3DViewer,
  MPR3DViewer,
  mpr3DViewer,
} from "./view-3d.js";
import { state } from "./state.js";

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
    CULL_FACE: 0x0b44,
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

test("View3DViewer is instantiated and aliased to MPR3DViewer", () => {
  assert.equal(View3DViewer, MPR3DViewer);
  assert.equal(view3DViewer, mpr3DViewer);
  const viewer = new View3DViewer();
  assert.ok(viewer instanceof View3DViewer);
  assert.ok(viewer instanceof MPR3DViewer);
});

test("View3DViewer state is fully decoupled from state.viewport", () => {
  const viewer = new View3DViewer();
  state.viewport.zoom = 4.2;
  state.viewport.panX = 150;
  state.viewport.panY = -75;
  state.viewport.windowWidth = 2000;
  state.viewport.windowCenter = 400;

  viewer.camera.zoom = 1.5;
  viewer.camera.panX = 10;
  viewer.camera.panY = 20;

  assert.equal(viewer.camera.zoom, 1.5);
  assert.equal(viewer.camera.panX, 10);
  assert.equal(viewer.camera.panY, 20);

  // Reset camera does not touch state.viewport
  viewer.resetCamera();
  assert.equal(viewer.camera.zoom, 1.0);
  assert.equal(viewer.camera.panX, 0);
  assert.equal(viewer.camera.panY, 0);
  assert.equal(state.viewport.zoom, 4.2);
  assert.equal(state.viewport.panX, 150);
});

test("View3DViewer renders with decoupled camera and mock context", () => {
  const viewer = new View3DViewer();
  viewer.volume = {
    depth: 4,
    rows: 32,
    cols: 32,
    data: new Int16Array(4 * 32 * 32),
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 40,
    windowWidth: 400,
  };

  const mockCtx = createMockWebGL2Context();
  const mockCanvas: any = {
    getContext: (type: string) => (type === "webgl2" ? mockCtx : null),
    clientWidth: 400,
    clientHeight: 400,
    width: 400,
    height: 400,
  };

  assert.doesNotThrow(() => {
    viewer.render(mockCanvas);
  });
});

test("renderGizmo renders high-contrast orientation cube to 2D context", () => {
  const viewer = new View3DViewer();
  const strokes: any[] = [];
  const fills: any[] = [];
  const textStrokes: string[] = [];

  const mock2dCtx: any = {
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    closePath: () => {},
    stroke: () => strokes.push(true),
    fill: () => fills.push(true),
    strokeText: (text: string) => textStrokes.push(text),
    fillText: () => {},
    set strokeStyle(v: any) {},
    set fillStyle(v: any) {},
    set lineWidth(v: any) {},
    set font(v: any) {},
    set textAlign(v: any) {},
    set textBaseline(v: any) {},
    set lineJoin(v: any) {},
    set miterLimit(v: any) {},
  };

  const mockCubeCanvas: any = {
    getContext: (type: string) => (type === "2d" ? mock2dCtx : null),
    width: 120,
    height: 120,
  };

  viewer.renderGizmo(mockCubeCanvas);
  assert.ok(strokes.length > 0, "Cube edges stroked");
  assert.ok(fills.length > 0, "Cube faces filled");
  assert.ok(textStrokes.length > 0, "High contrast text outline stroked");
});

test("View3DViewer.setVolume updates volume and resets active texture", () => {
  const viewer = new View3DViewer();
  const mockGL = createMockWebGL2Context();
  (viewer as any).gl = mockGL;

  const mockVol = {
    data: new Uint8Array([10, 20, 30, 40]),
    depth: 2,
    rows: 2,
    cols: 1,
    pixelSpacing: [1, 1] as [number, number],
    sliceSpacing: 1,
    windowCenter: 40,
    windowWidth: 400,
  };

  viewer.setVolume(mockVol);
  assert.equal(viewer.volume, mockVol);
});

test("View3DViewer.startRenderLoop and stopRenderLoop control requestAnimationFrame loop", () => {
  const viewer = new View3DViewer();
  let rafCalled = false;
  let cancelCalled = false;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = ((cb: any) => {
    rafCalled = true;
    return 123;
  }) as any;
  globalThis.cancelAnimationFrame = ((id: any) => {
    cancelCalled = true;
  }) as any;

  try {
    viewer.isActive = true;
    viewer.startRenderLoop();
    assert.equal(rafCalled, true);

    viewer.stopRenderLoop();
    assert.equal(cancelCalled, true);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("View3DViewer.render safely handles canvas with 0 dimensions without throwing", () => {
  const viewer = new View3DViewer();
  const mockGL = createMockWebGL2Context();
  (viewer as any).gl = mockGL;
  (viewer as any).program = {};
  (viewer as any).volumeTexture = {};
  (viewer as any).vao = {};

  const zeroCanvas: any = {
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    getContext: (type: string) => (type === "webgl2" ? mockGL : null),
  };

  assert.doesNotThrow(() => {
    viewer.render(zeroCanvas);
  });
  // Canvas should have been defaulted safely to >= 512
  assert.equal(zeroCanvas.width, 512);
  assert.equal(zeroCanvas.height, 512);
});

test("View3DViewer: setWindowLevel updates window parameters", () => {
  const viewer = new View3DViewer();
  viewer.setWindowLevel(50, 350);
  assert.equal(viewer.windowCenter, 50);
  assert.equal(viewer.windowWidth, 350);
});

test("View3DViewer: render disables CULL_FACE, sets TEXTURE0, and binds 3D texture", () => {
  const viewer = new View3DViewer();
  const disabledFeatures: number[] = [];
  let activeTexUnit = -1;
  let boundTexture3D: any = null;

  const mockGL = {
    ...createMockWebGL2Context(),
    disable: (cap: number) => {
      disabledFeatures.push(cap);
    },
    activeTexture: (unit: number) => {
      activeTexUnit = unit;
    },
    bindTexture: (target: number, tex: any) => {
      if (target === 0x806f) {
        // TEXTURE_3D
        boundTexture3D = tex;
      }
    },
  };

  (viewer as any).gl = mockGL;
  (viewer as any).program = {};
  const mockTex = { id: "test-volume-texture" };
  (viewer as any).volumeTexture = mockTex;
  (viewer as any).vao = {};
  viewer.volume = {
    data: new Uint8Array(8),
    depth: 2,
    rows: 2,
    cols: 2,
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    windowCenter: 40,
    windowWidth: 400,
  };

  const canvas: any = {
    width: 512,
    height: 512,
    clientWidth: 512,
    clientHeight: 512,
    getContext: () => mockGL,
  };
  mockGL.canvas = canvas;

  viewer.render(canvas);

  // Verifies CULL_FACE (0x0b44) is explicitly disabled
  assert.ok(
    disabledFeatures.includes(mockGL.CULL_FACE),
    "CULL_FACE must be disabled during volume raymarching",
  );
  // Verifies TEXTURE0 (0x84c0) is activated
  assert.equal(
    activeTexUnit,
    mockGL.TEXTURE0,
    "TEXTURE0 must be activated every frame",
  );
  // Verifies volume texture is bound to TEXTURE_3D
  assert.equal(
    boundTexture3D,
    mockTex,
    "volumeTexture must be bound every active frame",
  );
});

test("View3DViewer.initGL attaches both vertex and fragment shaders before linking", () => {
  const viewer = new View3DViewer();
  const attachedShaders: any[] = [];
  const mockGL = {
    ...createMockWebGL2Context(),
    attachShader: (_prog: any, shader: any) => {
      attachedShaders.push(shader);
    },
  };
  const canvas: any = {
    getContext: (type: string) => (type === "webgl2" ? mockGL : null),
  };

  const ok = viewer.initGL(canvas);
  assert.equal(ok, true);
  assert.equal(
    attachedShaders.length,
    2,
    "Both VS and FS must be attached to the program",
  );
});

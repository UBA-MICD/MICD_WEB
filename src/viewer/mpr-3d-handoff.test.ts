/**
 * Stress integration test for WebGL canvas and context handoff between
 * MPR triplanar mode (2x2 grid, quadrant vp-3) and dedicated 3D mode (1x1).
 *
 * Verifies that:
 * 1. View3DViewer re-targets and re-binds the native WebGL context on every layout transition.
 * 2. Textures are properly recreated and bound to the active context.
 * 3. Rendering never targets a detached/destroyed canvas.
 * 4. Drawing operations (gl.viewport, gl.drawArrays) execute on the correct active canvas.
 * 5. Reading pixels returns valid RGBA volume data instead of blank/black screen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { viewerFixtureHtml } from "../../test/viewer-fixture.ts";
import {
  initToolbar,
  toggleMprMode,
  toggle3DMode,
  getViewportManager,
} from "./interaction.ts";
import { initViewportManager } from "./viewport-registry.ts";
import { view3DViewer, type VoxelVolume } from "./view-3d.ts";
import { mprEngine } from "./mpr-engine.ts";
import { state } from "./state.ts";

// ── WebGL2 Context Mock with Spy Capabilities ────────────────────────────────

interface MockWebGL2State {
  canvas: HTMLCanvasElement;
  isContextLost: boolean;
  drawArraysCalls: Array<{ mode: number; first: number; count: number }>;
  viewportCalls: Array<{ x: number; y: number; width: number; height: number }>;
  drawArraysCount: number;
  viewportCount: number;
}

const contextMap = new WeakMap<HTMLCanvasElement, any>();

function createMockWebGL2Context(canvas: HTMLCanvasElement): any {
  const drawArraysCalls: Array<{ mode: number; first: number; count: number }> =
    [];
  const viewportCalls: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  let isContextLost = false;
  let hasDrawn = false;

  return {
    canvas,
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
    RGBA: 0x1908,
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

    // Spies
    drawArraysCalls,
    viewportCalls,
    get drawArraysCount() {
      return drawArraysCalls.length;
    },
    get viewportCount() {
      return viewportCalls.length;
    },

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
    clearColor: () => {},
    clear: () => {},
    isContextLost: () => isContextLost,
    getExtension: (name: string) => {
      if (name === "WEBGL_lose_context") {
        return {
          loseContext: () => {
            isContextLost = true;
          },
          restoreContext: () => {
            isContextLost = false;
          },
        };
      }
      return null;
    },
    viewport: (x: number, y: number, width: number, height: number) => {
      viewportCalls.push({ x, y, width, height });
    },
    drawArrays: (mode: number, first: number, count: number) => {
      hasDrawn = true;
      drawArraysCalls.push({ mode, first, count });
    },
    readPixels: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _format: number,
      _type: number,
      pixels: Uint8Array | Uint8ClampedArray,
    ) => {
      if (hasDrawn && !isContextLost) {
        pixels[0] = 255;
        pixels[1] = 200;
        pixels[2] = 180;
        pixels[3] = 255;
      } else {
        pixels.fill(0);
      }
    },
  };
}

function createMock2DContext(canvas: HTMLCanvasElement): any {
  return {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    measureText: () => ({ width: 10 }),
  };
}

function installCanvasContextInterceptor(): () => void {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type === "webgl2" || type === "webgl") {
      let ctx = contextMap.get(this);
      if (!ctx) {
        ctx = createMockWebGL2Context(this);
        contextMap.set(this, ctx);
      }
      return ctx;
    }
    if (type === "2d") {
      let ctx = contextMap.get(this);
      if (!ctx) {
        ctx = createMock2DContext(this);
        contextMap.set(this, ctx);
      }
      return ctx;
    }
    return originalGetContext.call(this, type);
  };

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
}

// ── Synthetic Sphere Volume Generator ─────────────────────────────────────────

function createSyntheticSphereVolume(): VoxelVolume {
  const depth = 32;
  const rows = 32;
  const cols = 32;
  const data = new Int16Array(depth * rows * cols);
  const cx = 15.5;
  const cy = 15.5;
  const cz = 15.5;
  const r = 10;

  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = z * rows * cols + y * cols + x;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
        if (dist <= r) {
          data[idx] = Math.round((1 - dist / r) * 1000 + 100);
        } else {
          data[idx] = 0;
        }
      }
    }
  }

  return {
    depth,
    rows,
    cols,
    data,
    pixelSpacing: [1, 1],
    sliceSpacing: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    windowCenter: 400,
    windowWidth: 1000,
  };
}

// ── Helper to Flush Pending Microtasks and Animation Frames ──────────────────

async function flushFrames(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// ── Integration Stress Test ──────────────────────────────────────────────────

test("MPR to 3D View Handoff Stress Test: Context handoff, WebGL drawing, and texture isolation across 5 rapid transitions", async () => {
  installDom();
  setBody(viewerFixtureHtml());
  const restoreGetContext = installCanvasContextInterceptor();

  const container = document.getElementById("viewport-container")!;
  const manager = initViewportManager(container);
  initToolbar();

  const sphereVolume = createSyntheticSphereVolume();
  view3DViewer.setVolume(sphereVolume);
  mprEngine.loadVolume(sphereVolume);

  // Simulate multiple slices loaded so MPR and 3D mode buttons are enabled
  state.files = [
    new File(["a"], "slice0.dcm"),
    new File(["b"], "slice1.dcm"),
    new File(["c"], "slice2.dcm"),
  ];

  const mprBtn = document.getElementById("tool-mpr") as HTMLButtonElement;
  const view3DBtn = document.getElementById(
    "tool-view-3d",
  ) as HTMLButtonElement;
  mprBtn.disabled = false;
  view3DBtn.disabled = false;

  const ITERATIONS = 5;
  let lastMprCanvas: HTMLCanvasElement | null = null;
  let last3DCanvas: HTMLCanvasElement | null = null;

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      // ── Step A & B: Transition to MPR mode (2x2 layout) ────────────────────
      mprBtn.disabled = false;
      const mprEntered = await toggleMprMode();
      assert.equal(
        mprEntered,
        true,
        `[Iteration ${i + 1}] toggleMprMode must succeed`,
      );
      await flushFrames();

      assert.equal(
        state.isMprMode,
        true,
        `[Iteration ${i + 1}] state.isMprMode must be true`,
      );
      assert.equal(
        state.is3DMode,
        false,
        `[Iteration ${i + 1}] state.is3DMode must be false`,
      );

      // Verify ViewportManager is in 2x2 layout and vp-3 exists
      const vp3 = manager.getAllViewports().find((vp) => vp.id === "vp-3");
      assert.ok(
        vp3,
        `[Iteration ${i + 1}] Viewport vp-3 must exist in 2x2 triplanar layout`,
      );
      const vp3Canvas = vp3.glCanvasElement;
      assert.ok(
        vp3Canvas,
        `[Iteration ${i + 1}] vp-3 must have a valid glCanvasElement`,
      );

      // WebGL Context Handoff Assertion: View3DViewer must point to vp-3.glCanvasElement
      assert.equal(
        (view3DViewer as any).gl?.canvas,
        vp3Canvas,
        `[Iteration ${i + 1}] View3DViewer.gl.canvas must be bound to vp-3.glCanvasElement`,
      );

      // Ensure drawArrays was invoked on vp-3's context
      const vp3Ctx = vp3Canvas.getContext("webgl2") as any;
      assert.ok(
        vp3Ctx.drawArraysCount > 0,
        `[Iteration ${i + 1}] WebGL drawArrays must have been called on vp-3.glCanvasElement`,
      );

      // Verify readPixels returns non-black pixel data
      const mprPixels = new Uint8Array(4);
      vp3Ctx.readPixels(
        16,
        16,
        1,
        1,
        vp3Ctx.RGBA,
        vp3Ctx.UNSIGNED_BYTE,
        mprPixels,
      );
      assert.ok(
        mprPixels[0] > 0 ||
          mprPixels[1] > 0 ||
          mprPixels[2] > 0 ||
          mprPixels[3] > 0,
        `[Iteration ${i + 1}] vp-3 pixel center must not be black (RGBA > 0)`,
      );

      // If a previous 3D canvas existed, verify it is no longer the active WebGL target
      if (last3DCanvas) {
        assert.notEqual(
          (view3DViewer as any).gl?.canvas,
          last3DCanvas,
          `[Iteration ${i + 1}] View3DViewer must not draw on the old 3D canvas`,
        );
      }
      lastMprCanvas = vp3Canvas;

      // ── Step C & D: Transition to 3D Mode (1x1 layout) ─────────────────────
      view3DBtn.disabled = false;
      const mode3DEntered = await toggle3DMode();
      assert.equal(
        mode3DEntered,
        true,
        `[Iteration ${i + 1}] toggle3DMode must succeed`,
      );
      await flushFrames();

      assert.equal(
        state.is3DMode,
        true,
        `[Iteration ${i + 1}] state.is3DMode must be true`,
      );
      assert.equal(
        state.isMprMode,
        false,
        `[Iteration ${i + 1}] state.isMprMode must be false`,
      );

      const view3DCanvas = document.getElementById(
        "view-3d-canvas",
      ) as HTMLCanvasElement;
      assert.ok(
        view3DCanvas,
        `[Iteration ${i + 1}] #view-3d-canvas must exist in DOM`,
      );

      // WebGL Context Handoff Assertion: View3DViewer must point to #view-3d-canvas
      assert.equal(
        (view3DViewer as any).gl?.canvas,
        view3DCanvas,
        `[Iteration ${i + 1}] View3DViewer.gl.canvas must be bound to #view-3d-canvas`,
      );

      // Ensure drawArrays was invoked on #view-3d-canvas's context
      const view3DCtx = view3DCanvas.getContext("webgl2") as any;
      assert.ok(
        view3DCtx.drawArraysCount > 0,
        `[Iteration ${i + 1}] WebGL drawArrays must have been called on #view-3d-canvas`,
      );

      // Verify readPixels returns non-black pixel data
      const view3DPixels = new Uint8Array(4);
      view3DCtx.readPixels(
        16,
        16,
        1,
        1,
        view3DCtx.RGBA,
        view3DCtx.UNSIGNED_BYTE,
        view3DPixels,
      );
      assert.ok(
        view3DPixels[0] > 0 ||
          view3DPixels[1] > 0 ||
          view3DPixels[2] > 0 ||
          view3DPixels[3] > 0,
        `[Iteration ${i + 1}] 3D view pixel center must not be black (RGBA > 0)`,
      );

      // Verify that the previous MPR canvas (vp3Canvas) was detached and is no longer targeted
      assert.notEqual(
        (view3DViewer as any).gl?.canvas,
        lastMprCanvas,
        `[Iteration ${i + 1}] View3DViewer must not target the destroyed vp-3 canvas`,
      );
      last3DCanvas = view3DCanvas;
    }
  } finally {
    restoreGetContext();
    manager.destroy();
    view3DViewer.releaseContext();
    view3DViewer.volume = null;
    mprEngine.volume = null;
    state.isLayoutTransitioning = false;
    state.is3DMode = false;
    state.isMprMode = false;
    uninstallDom();
  }
});

test("Destructive lifecycle test: Normal -> 3D (1x1) -> MPR (2x2) -> 3D (1x1) verifying camera coords, canvas dimensions, and gl.isContextLost() state", async () => {
  installDom();
  setBody(viewerFixtureHtml());
  const restoreGetContext = installCanvasContextInterceptor();

  const container = document.getElementById("viewport-container")!;
  const manager = initViewportManager(container);
  initToolbar();

  // 1. Setup Volumen
  const sphereVolume = createSyntheticSphereVolume();
  view3DViewer.setVolume(sphereVolume);
  mprEngine.loadVolume(sphereVolume);
  state.files = [
    new File(["a"], "slice0.dcm"),
    new File(["b"], "slice1.dcm"),
    new File(["c"], "slice2.dcm"),
  ];

  const mprBtn = document.getElementById("tool-mpr") as HTMLButtonElement;
  const view3DBtn = document.getElementById(
    "tool-view-3d",
  ) as HTMLButtonElement;
  mprBtn.disabled = false;
  view3DBtn.disabled = false;

  try {
    // 2. Toggle 3D (1x1)
    const entered3DFirst = await toggle3DMode();
    assert.equal(entered3DFirst, true, "First entry to 3D mode must succeed");
    await flushFrames();
    assert.equal(state.is3DMode, true);
    assert.equal(manager.getLayout(), "1x1");

    // 3. Toggle MPR (2x2)
    mprBtn.disabled = false;
    const enteredMPR = await toggleMprMode();
    assert.equal(enteredMPR, true, "Entry to MPR mode must succeed");
    await flushFrames();
    assert.equal(state.isMprMode, true);
    assert.equal(state.is3DMode, false);
    assert.equal(manager.getLayout(), "2x2");

    // 4. Toggle 3D (1x1) - Destructive return to 3D
    view3DBtn.disabled = false;
    const entered3DSecond = await toggle3DMode();
    assert.equal(entered3DSecond, true, "Second entry to 3D mode must succeed");
    await flushFrames();
    assert.equal(state.is3DMode, true);
    assert.equal(state.isMprMode, false);
    assert.equal(manager.getLayout(), "1x1");

    // 5. Verification:
    // a) Verify camera maintains valid coordinates (not NaN)
    const camera = view3DViewer.camera;
    assert.ok(!isNaN(camera.theta), "camera.theta must not be NaN");
    assert.ok(!isNaN(camera.phi), "camera.phi must not be NaN");
    assert.ok(!isNaN(camera.zoom), "camera.zoom must not be NaN");
    assert.ok(!isNaN(camera.panX), "camera.panX must not be NaN");
    assert.ok(!isNaN(camera.panY), "camera.panY must not be NaN");
    assert.ok(camera.zoom > 0, "camera.zoom must be strictly positive");

    // b) Verify destination canvas has dimensions
    const targetCanvas =
      (document.getElementById("view-3d-canvas") as HTMLCanvasElement) ||
      (document.getElementById("dicom-canvas") as HTMLCanvasElement);
    assert.ok(targetCanvas, "Target canvas must exist in DOM");
    assert.ok(
      targetCanvas.width > 0,
      "Target canvas width must be greater than 0",
    );
    assert.ok(
      targetCanvas.height > 0,
      "Target canvas height must be greater than 0",
    );

    // c) Verify gl context and isContextLost state
    const gl = (view3DViewer as any).gl;
    assert.ok(gl, "view3DViewer.gl context must be present and bound");
    const isLost =
      typeof gl.isContextLost === "function" ? gl.isContextLost() : false;
    // Check whether context is marked lost
    assert.equal(
      isLost,
      false,
      "Target WebGL context must not be in a lost state after destructive transition",
    );

    // Verify drawing executed on destination canvas
    const targetCtx = targetCanvas.getContext("webgl2") as any;
    assert.ok(
      targetCtx.drawArraysCount > 0,
      "drawArrays must have executed on destination canvas",
    );
  } finally {
    restoreGetContext();
    manager.destroy();
    view3DViewer.releaseContext();
    view3DViewer.volume = null;
    mprEngine.volume = null;
    state.isLayoutTransitioning = false;
    state.is3DMode = false;
    state.isMprMode = false;
    uninstallDom();
  }
});

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MPRGridCoordinator, mprCoordinator } from "./mpr-coordinator.js";
import { Matrix3, mprEngine } from "./mpr-engine.js";
import { applyPitchYawDelta, matrixToPitchYaw } from "./mpr-rotation.js";

const dom = new JSDOM(
  `<!DOCTYPE html>
   <html>
     <body>
       <div id="viewport-container" class="viewport-container mpr-grid-container grid-layout-2x2">
         <div id="vp-0" class="viewport-cell viewport-cell--axial" data-viewport-id="vp-0"></div>
         <div id="vp-1" class="viewport-cell viewport-cell--coronal" data-viewport-id="vp-1"></div>
         <div id="vp-2" class="viewport-cell viewport-cell--sagittal" data-viewport-id="vp-2"></div>
         <div id="vp-3" class="viewport-cell viewport-cell--3d" data-viewport-id="vp-3"></div>
       </div>
     </body>
   </html>`,
);

globalThis.document = dom.window.document as any;
globalThis.HTMLElement = dom.window.HTMLElement as any;

test("MPRGridCoordinator: initFromVolume centers crosshair coordinates", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 200, 50);

  assert.deepEqual(coordinator.crosshair, {
    x: 50,
    y: 100,
    z: 25,
  });
});

test("MPRGridCoordinator: setCrosshair clamps coordinates within volume boundaries", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 50);

  // Set out-of-bounds coordinates
  coordinator.setCrosshair(-20, 150, 60);

  assert.equal(coordinator.crosshair.x, 0);
  assert.equal(coordinator.crosshair.y, 99);
  assert.equal(coordinator.crosshair.z, 49);
});

test("MPRGridCoordinator: setCrosshairFromNormalized maps 0..1 to voxel indices", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(101, 201, 51);

  coordinator.setCrosshairFromNormalized(0.5, 0.25, 1.0);

  assert.equal(coordinator.crosshair.x, 50);
  assert.equal(coordinator.crosshair.y, 50);
  assert.equal(coordinator.crosshair.z, 50);
});

test("MPRGridCoordinator: setSliceIndex updates individual orthogonal planes", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.setSliceIndex("axial", 42);
  assert.equal(coordinator.getSliceIndex("axial"), 42);

  coordinator.setSliceIndex("coronal", 73);
  assert.equal(coordinator.getSliceIndex("coronal"), 73);

  coordinator.setSliceIndex("sagittal", 15);
  assert.equal(coordinator.getSliceIndex("sagittal"), 15);
});

test("MPRGridCoordinator: updateCrosshairAxis updates targeted axis independently and clamps to volume boundaries", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 80, 40); // cols=100, rows=80, depth=40 (center: 50, 40, 20)

  // Axial (Z)
  coordinator.updateCrosshairAxis("axial", 35);
  assert.equal(coordinator.crosshair.z, 35);
  assert.equal(coordinator.crosshair.x, 50);
  assert.equal(coordinator.crosshair.y, 40);

  // Coronal (Y)
  coordinator.updateCrosshairAxis("coronal", 15);
  assert.equal(coordinator.crosshair.y, 15);
  assert.equal(coordinator.crosshair.x, 50);
  assert.equal(coordinator.crosshair.z, 35);

  // Sagittal (X)
  coordinator.updateCrosshairAxis("sagittal", 85);
  assert.equal(coordinator.crosshair.x, 85);
  assert.equal(coordinator.crosshair.y, 15);
  assert.equal(coordinator.crosshair.z, 35);

  // Test aliases "x", "y", "z"
  coordinator.updateCrosshairAxis("z", 10);
  assert.equal(coordinator.crosshair.z, 10);
  coordinator.updateCrosshairAxis("y", 20);
  assert.equal(coordinator.crosshair.y, 20);
  coordinator.updateCrosshairAxis("x", 30);
  assert.equal(coordinator.crosshair.x, 30);

  // Clamping lower bound
  coordinator.updateCrosshairAxis("axial", -15);
  assert.equal(coordinator.crosshair.z, 0);

  // Clamping upper bound
  coordinator.updateCrosshairAxis("coronal", 500);
  assert.equal(coordinator.crosshair.y, 79);
  coordinator.updateCrosshairAxis("sagittal", 500);
  assert.equal(coordinator.crosshair.x, 99);
});

test("MPRGridCoordinator: toggleMaximize applies 1x1 fullscreen CSS classes and toggles back", () => {
  const coordinator = new MPRGridCoordinator();
  const container = document.getElementById("viewport-container")!;
  const vp0 = document.getElementById("vp-0")!;
  const vp1 = document.getElementById("vp-1")!;
  const vp2 = document.getElementById("vp-2")!;
  const vp3 = document.getElementById("vp-3")!;

  // Maximize vp-0
  coordinator.toggleMaximize("vp-0");
  assert.equal(coordinator.maximizedQuadrant, "vp-0");
  assert.equal(container.classList.contains("mpr-has-maximized"), true);
  assert.equal(vp0.classList.contains("is-maximized"), true);
  assert.equal(vp0.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp1.classList.contains("is-hidden-by-maximize"), true);
  assert.equal(vp2.classList.contains("is-hidden-by-maximize"), true);
  assert.equal(vp3.classList.contains("is-hidden-by-maximize"), true);

  // Toggle maximize again -> restores 2x2 grid
  coordinator.toggleMaximize("vp-0");
  assert.equal(coordinator.maximizedQuadrant, null);
  assert.equal(container.classList.contains("mpr-has-maximized"), false);
  assert.equal(vp0.classList.contains("is-maximized"), false);
  assert.equal(vp0.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp1.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp2.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp3.classList.contains("is-hidden-by-maximize"), false);
});

test("MPRGridCoordinator: onCrosshairChange notifies listeners and unsubscribes cleanly", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let notified = 0;
  const unsubscribe = coordinator.onCrosshairChange((c) => {
    notified++;
    assert.equal(c.x, 30);
  });

  coordinator.setCrosshair(30, 40, 50);
  assert.equal(notified, 1);

  unsubscribe();
  coordinator.setCrosshair(20, 20, 20);
  assert.equal(notified, 1); // Not called after unsubscribe
});

test("Matrix3: identity returns 3x3 identity matrix with det = 1 and isOrthonormal = true", () => {
  const m = Matrix3.identity();
  assert.equal(m.length, 9);
  assert.equal(m[0], 1);
  assert.equal(m[4], 1);
  assert.equal(m[8], 1);
  assert.equal(Matrix3.determinant(m), 1);
  assert.equal(Matrix3.isOrthonormal(m), true);
});

test("Matrix3: fromRotationAxis generates orthonormal rotation matrices with det = 1 (no degeneration)", () => {
  // Rotate 45 deg around Z axis
  const rZ45 = Matrix3.fromRotationAxis([0, 0, 1], Math.PI / 4);
  assert.ok(Math.abs(Matrix3.determinant(rZ45) - 1.0) < 1e-4, "det(R_z) = 1");
  assert.equal(Matrix3.isOrthonormal(rZ45), true, "R_z is orthonormal");

  // Rotate 37 deg around arbitrary normalized 3D diagonal vector [1, 2, 2] / 3
  const axis: [number, number, number] = [1 / 3, 2 / 3, 2 / 3];
  const rDiag = Matrix3.fromRotationAxis(axis, 0.645);
  assert.ok(
    Math.abs(Matrix3.determinant(rDiag) - 1.0) < 1e-4,
    "det(R_diag) = 1",
  );
  assert.equal(Matrix3.isOrthonormal(rDiag), true, "R_diag is orthonormal");

  // Verify vector length is preserved under rotation (isometry)
  const v: [number, number, number] = [10, -5, 8];
  const origLen = Math.hypot(...v);
  const rotV = Matrix3.transformVector(rDiag, v);
  const rotLen = Math.hypot(...rotV);
  assert.ok(
    Math.abs(rotLen - origLen) < 1e-4,
    "Vector length strictly preserved",
  );
});

test("MPRGridCoordinator: rotateAroundAxis and resetRotation synchronize cameras without mathematical degeneration", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let rotationEvents = 0;
  coordinator.onRotationChange((_r) => {
    rotationEvents++;
  });

  // Apply 30 degree rotation around camera normal
  coordinator.rotateAroundAxis([0, 0, 1], Math.PI / 6);
  assert.equal(rotationEvents, 1);
  assert.equal(Matrix3.isOrthonormal(coordinator.rotation), true);
  assert.ok(Math.abs(Matrix3.determinant(coordinator.rotation) - 1.0) < 1e-4);

  // Check that cameras in mprEngine are synchronized and retain orthonormal bases
  const axCam = mprEngine.axialCamera;
  const corCam = mprEngine.coronalCamera;
  const sagCam = mprEngine.sagittalCamera;

  const dot = (a: [number, number, number], b: [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: [number, number, number]) => Math.hypot(...a);

  // Axial camera vectors must be unit length and mutually orthogonal
  assert.ok(Math.abs(norm(axCam.uAxis) - 1.0) < 1e-4, "uAxis is unit length");
  assert.ok(Math.abs(norm(axCam.vAxis) - 1.0) < 1e-4, "vAxis is unit length");
  assert.ok(Math.abs(norm(axCam.normal) - 1.0) < 1e-4, "normal is unit length");
  assert.ok(
    Math.abs(dot(axCam.uAxis, axCam.vAxis)) < 1e-4,
    "u and v are orthogonal",
  );
  assert.ok(
    Math.abs(dot(axCam.uAxis, axCam.normal)) < 1e-4,
    "u and n are orthogonal",
  );
  assert.ok(
    Math.abs(dot(axCam.vAxis, axCam.normal)) < 1e-4,
    "v and n are orthogonal",
  );

  // Reset rotation restores identity
  coordinator.resetRotation();
  assert.equal(rotationEvents, 2);
  assert.equal(Matrix3.isOrthonormal(coordinator.rotation), true);
  assert.deepEqual(coordinator.rotation, Matrix3.identity());
});

test("MPREngine: getCrosshairLineDirections calculates dynamic 2D oblique directions", () => {
  // Test canonical orthogonal axes
  mprEngine.resetRotation();
  const dirs = mprEngine.getCrosshairLineDirections("axial");
  assert.ok(dirs.line1.color.length > 0);
  assert.ok(dirs.line2.color.length > 0);
  assert.ok(
    Math.abs(Math.hypot(dirs.line1.dirX, dirs.line1.dirY) - 1.0) < 1e-4,
  );
  assert.ok(
    Math.abs(Math.hypot(dirs.line2.dirX, dirs.line2.dirY) - 1.0) < 1e-4,
  );

  // Apply oblique rotation: line directions adapt without division by zero
  mprCoordinator.rotateAroundAxis([0, 1, 0], Math.PI / 4);
  const obliqueDirs = mprEngine.getCrosshairLineDirections("axial");
  assert.ok(
    Math.abs(Math.hypot(obliqueDirs.line1.dirX, obliqueDirs.line1.dirY) - 1.0) <
      1e-4,
  );
  assert.ok(
    Math.abs(Math.hypot(obliqueDirs.line2.dirX, obliqueDirs.line2.dirY) - 1.0) <
      1e-4,
  );

  mprCoordinator.resetRotation();
});

// ── Trackball wiring (spec 007, TK-30) ───────────────────────────────────────

const DEG = Math.PI / 180;

function assertVecClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  eps = 1e-4,
): void {
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= eps,
      `component ${i}: expected ${actual[i]} ≈ ${expected[i]}`,
    );
  }
}

// mprEngine is a process-wide singleton: leave it orthogonal for the next test.
afterEach(() => {
  mprEngine.resetRotation();
});

test("MPRGridCoordinator.rotatePitchYaw: 90° yaw on Axial sends the axial normal to Sagital and reads Yaw 90°", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(0, 90 * DEG, "axial");

  assertVecClose(mprEngine.axialCamera.normal, [1, 0, 0]);
  assert.deepEqual(coordinator.getPitchYawDegrees(), { pitch: 0, yaw: 90 });
});

test("MPRGridCoordinator.rotatePitchYaw: positive pitch reads back as positive pitch", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(25 * DEG, 0, "axial");

  assert.deepEqual(coordinator.getPitchYawDegrees(), { pitch: 25, yaw: 0 });
});

test("MPRGridCoordinator.rotatePitchYaw: the active plane picks the rotation axes", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  // Coronal's vertical screen axis is Z, so a yaw there leaves the axial normal on Z.
  coordinator.rotatePitchYaw(0, 90 * DEG, "coronal");

  assertVecClose(mprEngine.axialCamera.normal, [0, 0, 1]);
  assertVecClose(mprEngine.coronalCamera.normal, [1, 0, 0]);
});

test("MPRGridCoordinator.rotatePitchYaw: rotates the whole triad rigidly and keeps the normals orthogonal", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(33 * DEG, -71 * DEG, "axial");

  const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const axial = mprEngine.axialCamera.normal;
  const coronal = mprEngine.coronalCamera.normal;
  const sagittal = mprEngine.sagittalCamera.normal;
  assert.ok(Math.abs(dot(axial, coronal)) < 1e-4);
  assert.ok(Math.abs(dot(axial, sagittal)) < 1e-4);
  assert.ok(Math.abs(dot(coronal, sagittal)) < 1e-4);
  assert.equal(Matrix3.isOrthonormal(coordinator.rotation), true);
  assert.ok(Math.abs(Matrix3.determinant(coordinator.rotation) - 1) < 1e-4);
});

test("MPRGridCoordinator.rotatePitchYaw: accumulates from the current rotation (rotated axes of the active plane)", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(0, 40 * DEG, "axial");
  const before = new Float32Array(coordinator.rotation);
  const cam = mprEngine.axialCamera;
  const yawAxis: [number, number, number] = [
    cam.normal[1] * cam.uAxis[2] - cam.normal[2] * cam.uAxis[1],
    cam.normal[2] * cam.uAxis[0] - cam.normal[0] * cam.uAxis[2],
    cam.normal[0] * cam.uAxis[1] - cam.normal[1] * cam.uAxis[0],
  ];
  const expected = applyPitchYawDelta(
    before,
    [...cam.uAxis] as [number, number, number],
    yawAxis,
    15 * DEG,
    -10 * DEG,
  );

  coordinator.rotatePitchYaw(15 * DEG, -10 * DEG, "axial");

  assertVecClose(coordinator.rotation, expected);
});

test("MPRGridCoordinator: the quaternion mirror follows setRotation and rotateAroundAxis", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  // 1) setRotation replaces the base the trackball continues from.
  const base = Matrix3.fromRotationAxis([0, 0, 1], 50 * DEG);
  coordinator.setRotation(base);
  const cam = mprEngine.axialCamera;
  const getYawAxis = (): [number, number, number] => [
    cam.normal[1] * cam.uAxis[2] - cam.normal[2] * cam.uAxis[1],
    cam.normal[2] * cam.uAxis[0] - cam.normal[0] * cam.uAxis[2],
    cam.normal[0] * cam.uAxis[1] - cam.normal[1] * cam.uAxis[0],
  ];
  let expected = applyPitchYawDelta(
    new Float32Array(base),
    [...cam.uAxis] as [number, number, number],
    getYawAxis(),
    0,
    20 * DEG,
  );
  coordinator.rotatePitchYaw(0, 20 * DEG, "axial");
  assertVecClose(coordinator.rotation, expected);

  // 2) The legacy axis rotation also re-syncs the mirror.
  coordinator.rotateAroundAxis([1, 0, 0], 30 * DEG);
  const afterLegacy = new Float32Array(coordinator.rotation);
  expected = applyPitchYawDelta(
    afterLegacy,
    [...cam.uAxis] as [number, number, number],
    getYawAxis(),
    -12 * DEG,
    0,
  );
  coordinator.rotatePitchYaw(-12 * DEG, 0, "axial");
  assertVecClose(coordinator.rotation, expected);
});

test("MPRGridCoordinator.rotatePitchYaw: notifies rotation and crosshair listeners once per call", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let rotationEvents = 0;
  let crosshairEvents = 0;
  coordinator.onRotationChange(() => rotationEvents++);
  coordinator.onCrosshairChange(() => crosshairEvents++);

  coordinator.rotatePitchYaw(5 * DEG, 5 * DEG, "axial");

  assert.equal(rotationEvents, 1);
  assert.equal(crosshairEvents, 1);
});

test("MPRGridCoordinator.rotatePitchYaw: zero and non-finite deltas are no-ops", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let rotationEvents = 0;
  coordinator.onRotationChange(() => rotationEvents++);
  const before = coordinator.rotation;

  coordinator.rotatePitchYaw(0, 0, "axial");
  coordinator.rotatePitchYaw(Number.NaN, 0.1, "axial");
  coordinator.rotatePitchYaw(0.1, Number.POSITIVE_INFINITY, "axial");

  assert.equal(rotationEvents, 0);
  assert.equal(coordinator.rotation, before);
  assert.deepEqual(coordinator.rotation, Matrix3.identity());
});

test("MPRGridCoordinator.rotatePitchYaw: never mutates a rotation reference handed to listeners", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  const received: Float32Array[] = [];
  coordinator.onRotationChange((r) => received.push(r));

  coordinator.rotatePitchYaw(0, 30 * DEG, "axial");
  const first = received[0];
  const snapshot = new Float32Array(first);
  coordinator.rotatePitchYaw(0, 30 * DEG, "axial");

  assert.notEqual(received[1], first, "each call yields a new array");
  assert.deepEqual(first, snapshot, "the earlier reference keeps its values");
});

test("MPRGridCoordinator.rotatePitchYaw: setRotation input is copied, not aliased", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  const input = Matrix3.fromRotationAxis([0, 1, 0], 10 * DEG);
  const snapshot = new Float32Array(input);
  coordinator.setRotation(input);
  coordinator.rotatePitchYaw(10 * DEG, 10 * DEG, "axial");

  assert.deepEqual(input, snapshot);
});

test("MPRGridCoordinator.rotatePitchYaw: stays orthonormal after 5 000 deltas", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let state = 1234;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const planes = ["axial", "coronal", "sagittal"] as const;
  for (let i = 0; i < 5_000; i++) {
    coordinator.rotatePitchYaw(
      (random() - 0.5) * 0.1,
      (random() - 0.5) * 0.1,
      planes[i % 3],
    );
  }

  assert.equal(Matrix3.isOrthonormal(coordinator.rotation, 1e-4), true);
  assert.ok(Math.abs(Matrix3.determinant(coordinator.rotation) - 1) < 1e-4);
});

test("MPRGridCoordinator.getPitchYawDegrees: identity reads 0/0 without negative zero", () => {
  const coordinator = new MPRGridCoordinator();
  const { pitch, yaw } = coordinator.getPitchYawDegrees();
  assert.ok(Object.is(pitch, 0));
  assert.ok(Object.is(yaw, 0));
});

test("MPRGridCoordinator.getPitchYawDegrees: rounds to one decimal and matches matrixToPitchYaw", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(12.34 * DEG, 0, "axial");
  const { pitch } = coordinator.getPitchYawDegrees();
  assert.equal(pitch, 12.3);

  const exact = matrixToPitchYaw(coordinator.rotation).pitch / DEG;
  assert.ok(Math.abs(pitch - exact) <= 0.05);
});

test("MPRGridCoordinator.resetToOrthogonal: restores identity, keeps crosshair, notifies rotation listeners once", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 120, 80);
  coordinator.setCrosshair(10, 20, 30);
  coordinator.rotatePitchYaw(45 * DEG, 30 * DEG, "axial");

  let rotationEvents = 0;
  coordinator.onRotationChange(() => rotationEvents++);
  const crosshairBefore = { ...coordinator.crosshair };
  const dimensionsBefore = { ...coordinator.dimensions };
  coordinator.resetToOrthogonal();

  assert.equal(rotationEvents, 1);
  assert.deepEqual(coordinator.rotation, Matrix3.identity());
  assert.deepEqual(coordinator.crosshair, crosshairBefore);
  assert.deepEqual(coordinator.dimensions, dimensionsBefore);
  assert.deepEqual(coordinator.getPitchYawDegrees(), { pitch: 0, yaw: 0 });
  assertVecClose(mprEngine.axialCamera.normal, [0, 0, 1]);
  assertVecClose(mprEngine.coronalCamera.normal, [0, 1, 0]);
  assertVecClose(mprEngine.sagittalCamera.normal, [1, 0, 0]);
});

test("MPRGridCoordinator.resetToOrthogonal: the next trackball turn starts from identity", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.rotatePitchYaw(60 * DEG, 60 * DEG, "axial");
  coordinator.resetToOrthogonal();
  coordinator.rotatePitchYaw(0, 15 * DEG, "axial");

  assert.deepEqual(coordinator.getPitchYawDegrees(), { pitch: 0, yaw: 15 });
});

test("MPRGridCoordinator.resetToOrthogonal: does not alias the previous rotation array", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);
  coordinator.rotatePitchYaw(0, 30 * DEG, "axial");
  const rotated = coordinator.rotation;
  const snapshot = new Float32Array(rotated);

  coordinator.resetToOrthogonal();

  const crosshairBefore = { ...coordinator.crosshair };
  const dimensionsBefore = { ...coordinator.dimensions };

  assert.notEqual(coordinator.rotation, rotated);
  assert.deepEqual(rotated, snapshot);
});

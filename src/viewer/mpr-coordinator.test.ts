import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MPRGridCoordinator, mprCoordinator } from "./mpr-coordinator.js";
import { Matrix3, mprEngine } from "./mpr-engine.js";

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

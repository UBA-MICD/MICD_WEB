import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, MPR3DViewer } from "./mpr.js";

test("Matrix4.identity creates a 4x4 identity matrix", () => {
  const mat = Matrix4.identity();
  assert.equal(mat.length, 16);
  assert.equal(mat[0], 1);
  assert.equal(mat[5], 1);
  assert.equal(mat[10], 1);
  assert.equal(mat[15], 1);
  assert.equal(mat[1], 0);
  assert.equal(mat[4], 0);
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

test("MPR3DViewer initializes with default state", () => {
  const viewer = new MPR3DViewer();
  assert.equal(viewer.isActive, false);
  assert.equal(viewer.activeView, "3d");
  assert.ok(viewer.camera);
  assert.equal(typeof viewer.camera.theta, "number");
  assert.equal(typeof viewer.camera.phi, "number");
  assert.ok(viewer.crosshair);
  assert.equal(typeof viewer.crosshair.x, "number");
  assert.equal(typeof viewer.crosshair.y, "number");
  assert.equal(typeof viewer.crosshair.z, "number");
});

test("MPR3DViewer render handles missing WebGL context gracefully", () => {
  const viewer = new MPR3DViewer();
  assert.doesNotThrow(() => {
    viewer.render(null);
  });
});

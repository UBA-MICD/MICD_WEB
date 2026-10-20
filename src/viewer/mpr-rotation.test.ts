import test from "node:test";
import assert from "node:assert/strict";
import { Matrix3 } from "./mpr-engine.js";
import {
  applyPitchYawDelta,
  applyPitchYawDeltaQuat,
  matrix3ToQuat,
  matrixToPitchYaw,
  orthonormalize,
  pitchYawToMatrix3,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatToMatrix3,
  type Quat,
  type Vec3,
} from "./mpr-rotation.js";

const DEG = Math.PI / 180;
const EPS = 1e-5;

function assertClose(actual: number, expected: number, eps = EPS): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} ≈ ${expected} (±${eps})`,
  );
}

function assertMatrixClose(
  actual: Float32Array,
  expected: Float32Array,
  eps = EPS,
): void {
  for (let i = 0; i < 9; i++) assertClose(actual[i], expected[i], eps);
}

/** Deterministic LCG so the "many random deltas" tests are reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test("quatFromAxisAngle: matches Matrix3.fromRotationAxis (Rodrigues)", () => {
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 2, 3],
    [-0.3, 0.7, 0.2],
  ];
  for (const axis of axes) {
    for (const deg of [-170, -45, 0, 30, 90, 179]) {
      const fromQuat = quatToMatrix3(quatFromAxisAngle(axis, deg * DEG));
      const rodrigues = Matrix3.fromRotationAxis(axis, deg * DEG);
      assertMatrixClose(fromQuat, rodrigues);
    }
  }
});

test("quatFromAxisAngle: zero-length axis yields identity", () => {
  assert.deepEqual(quatFromAxisAngle([0, 0, 0], 1.2), [1, 0, 0, 0]);
});

test("quatNormalize: unit length; degenerate input falls back to identity", () => {
  assert.deepEqual(quatNormalize([2, 0, 0, 0]), [1, 0, 0, 0]);
  assert.deepEqual(quatNormalize([0, 0, 0, 0]), [1, 0, 0, 0]);
  const n = quatNormalize([1, 2, 3, 4]);
  assertClose(Math.hypot(n[0], n[1], n[2], n[3]), 1);
});

test("R(θ)·R(−θ) = I", () => {
  const axis: Vec3 = [0.2, -0.5, 0.8];
  const forward = quatFromAxisAngle(axis, 37 * DEG);
  const backward = quatFromAxisAngle(axis, -37 * DEG);
  assertMatrixClose(
    quatToMatrix3(quatMultiply(forward, backward)),
    Matrix3.identity(),
  );
});

test("quatMultiply: applies the right operand first (same as matrix product)", () => {
  const a = quatFromAxisAngle([1, 0, 0], 40 * DEG);
  const b = quatFromAxisAngle([0, 1, 0], 25 * DEG);
  const viaQuat = quatToMatrix3(quatMultiply(a, b));
  const viaMatrix = Matrix3.multiply(quatToMatrix3(a), quatToMatrix3(b));
  assertMatrixClose(viaQuat, viaMatrix);
});

test("matrix3ToQuat: round-trips quaternion → matrix → quaternion", () => {
  const random = makeRandom(7);
  for (let i = 0; i < 200; i++) {
    const axis: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
    const q = quatFromAxisAngle(axis, (random() - 0.5) * 2 * Math.PI);
    const matrix = quatToMatrix3(q);
    const back = matrix3ToQuat(matrix);
    assertMatrixClose(quatToMatrix3(back), matrix, 1e-4);
    assert.ok(back[0] >= 0, "quaternion sign is canonicalised to w >= 0");
  }
});

test("matrix3ToQuat: covers every Shepperd branch (180° turns on each axis)", () => {
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const axis of axes) {
    const matrix = Matrix3.fromRotationAxis(axis, Math.PI);
    assertMatrixClose(quatToMatrix3(matrix3ToQuat(matrix)), matrix, 1e-4);
  }
  assertMatrixClose(
    quatToMatrix3(matrix3ToQuat(Matrix3.identity())),
    Matrix3.identity(),
  );
});

test("orthonormalize: restores orthonormality with det +1 after 10 000 deltas", () => {
  const random = makeRandom(42);
  let matrix = Matrix3.identity();
  for (let i = 0; i < 10_000; i++) {
    matrix = applyPitchYawDelta(
      matrix,
      [1, 0, 0],
      [0, 1, 0],
      (random() - 0.5) * 0.1,
      (random() - 0.5) * 0.1,
    );
  }
  const cleaned = orthonormalize(matrix);
  assert.ok(Matrix3.isOrthonormal(cleaned, 1e-4));
  assertClose(Matrix3.determinant(cleaned), 1, 1e-4);
});

test("orthonormalize: repairs a skewed matrix and keeps the first column's direction", () => {
  const skewed = new Float32Array([2, 0, 0, 1, 1, 0, 0, 0, 5]);
  const fixed = orthonormalize(skewed);
  assert.ok(Matrix3.isOrthonormal(fixed, 1e-5));
  assertClose(Matrix3.determinant(fixed), 1, 1e-5);
  assertClose(fixed[0], 1);
});

test("orthonormalize: degenerate input falls back to identity", () => {
  assertMatrixClose(orthonormalize(new Float32Array(9)), Matrix3.identity());
  const parallel = new Float32Array([1, 0, 0, 2, 0, 0, 0, 0, 1]);
  assertMatrixClose(orthonormalize(parallel), Matrix3.identity());
});

test("matrixToPitchYaw: identity reads 0°/0°", () => {
  const { pitch, yaw, roll } = matrixToPitchYaw(Matrix3.identity());
  assertClose(pitch, 0);
  assertClose(yaw, 0);
  assertClose(roll, 0);
});

test("matrixToPitchYaw: recovers (pitch, yaw, roll) built by pitchYawToMatrix3", () => {
  for (const pitch of [-80, -45, -10, 0, 12, 60, 85]) {
    for (const yaw of [-170, -90, -30.5, 0, 45, 120, 179]) {
      for (const roll of [-60, 0, 25]) {
        const matrix = pitchYawToMatrix3(pitch * DEG, yaw * DEG, roll * DEG);
        const read = matrixToPitchYaw(matrix);
        assertClose(read.pitch, pitch * DEG, 1e-4);
        assertClose(read.yaw, yaw * DEG, 1e-4);
        assertClose(read.roll, roll * DEG, 1e-4);
      }
    }
  }
});

test("matrixToPitchYaw: stays finite and keeps yaw at ±90° pitch (gimbal)", () => {
  for (const pitch of [90, -90]) {
    const matrix = pitchYawToMatrix3(pitch * DEG, 33 * DEG, 0);
    const read = matrixToPitchYaw(matrix);
    assert.ok(Number.isFinite(read.pitch));
    assert.ok(Number.isFinite(read.yaw));
    assertClose(read.pitch, pitch * DEG, 1e-3);
    assertClose(read.yaw, 33 * DEG, 1e-3);
    assertClose(read.roll, 0, 1e-3);
  }
});

test("matrixToPitchYaw: pitch is clamped even if m12 drifts past ±1", () => {
  const drifted = Matrix3.identity();
  drifted[7] = -1.0001;
  const { pitch } = matrixToPitchYaw(drifted);
  assertClose(pitch, Math.PI / 2, 1e-6);
});

test("applyPitchYawDelta: 90° yaw on Axial maps the axial normal onto Sagital", () => {
  // Active plane = axial: u = X (horizontal), v = Y (vertical), n = Z.
  const rotated = applyPitchYawDelta(
    Matrix3.identity(),
    [1, 0, 0],
    [0, 1, 0],
    0,
    90 * DEG,
  );
  // Rotating 90° around Y sends Z=(0,0,1) to X=(1,0,0).
  const normal = Matrix3.transformVector(rotated, [0, 0, 1]);
  assertClose(normal[0], 1);
  assertClose(normal[1], 0);
  assertClose(normal[2], 0);
});

test("applyPitchYawDelta: 90° pitch on Axial maps the axial normal onto Coronal", () => {
  const rotated = applyPitchYawDelta(
    Matrix3.identity(),
    [1, 0, 0],
    [0, 1, 0],
    90 * DEG,
    0,
  );
  const normal = Matrix3.transformVector(rotated, [0, 0, 1]);
  assertClose(Math.abs(normal[1]), 1);
  assertClose(normal[0], 0);
  assertClose(normal[2], 0);
});

test("applyPitchYawDelta: positive deltas read back as positive yaw / pitch", () => {
  const yawed = applyPitchYawDelta(
    Matrix3.identity(),
    [1, 0, 0],
    [0, 1, 0],
    0,
    20 * DEG,
  );
  const readYaw = matrixToPitchYaw(yawed);
  assertClose(readYaw.yaw, 20 * DEG, 1e-4);
  assertClose(readYaw.pitch, 0, 1e-4);

  const pitched = applyPitchYawDelta(
    Matrix3.identity(),
    [1, 0, 0],
    [0, 1, 0],
    20 * DEG,
    0,
  );
  const readPitch = matrixToPitchYaw(pitched);
  assertClose(readPitch.pitch, 20 * DEG, 1e-4);
  assertClose(readPitch.yaw, 0, 1e-4);
});

test("applyPitchYawDelta: the triad stays orthonormal (normals ⟂ each other)", () => {
  const rotated = applyPitchYawDelta(
    Matrix3.identity(),
    [1, 0, 0],
    [0, 1, 0],
    33 * DEG,
    -71 * DEG,
  );
  assert.ok(Matrix3.isOrthonormal(rotated, 1e-5));
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const normalAxial = Matrix3.transformVector(rotated, [0, 0, 1]);
  const normalCoronal = Matrix3.transformVector(rotated, [0, 1, 0]);
  const normalSagittal = Matrix3.transformVector(rotated, [1, 0, 0]);
  assertClose(dot(normalAxial, normalCoronal), 0);
  assertClose(dot(normalAxial, normalSagittal), 0);
  assertClose(dot(normalCoronal, normalSagittal), 0);
});

test("applyPitchYawDelta: zero deltas leave the matrix unchanged", () => {
  const start = pitchYawToMatrix3(10 * DEG, 20 * DEG, 5 * DEG);
  assertMatrixClose(
    applyPitchYawDelta(start, [1, 0, 0], [0, 1, 0], 0, 0),
    start,
  );
});

test("applyPitchYawDeltaQuat: agrees with the matrix form", () => {
  const start = pitchYawToMatrix3(15 * DEG, -40 * DEG, 0);
  const startQuat: Quat = matrix3ToQuat(start);
  const viaMatrix = applyPitchYawDelta(
    start,
    [1, 0, 0],
    [0, 0, 1],
    12 * DEG,
    -8 * DEG,
  );
  const viaQuat = quatToMatrix3(
    applyPitchYawDeltaQuat(startQuat, [1, 0, 0], [0, 0, 1], 12 * DEG, -8 * DEG),
  );
  assertMatrixClose(viaQuat, viaMatrix, 1e-4);
});

test("applyPitchYawDeltaQuat: stays unit-length and orthonormal after 10 000 deltas", () => {
  const random = makeRandom(99);
  let q: Quat = [1, 0, 0, 0];
  for (let i = 0; i < 10_000; i++) {
    q = applyPitchYawDeltaQuat(
      q,
      [1, 0, 0],
      [0, 1, 0],
      (random() - 0.5) * 0.2,
      (random() - 0.5) * 0.2,
    );
  }
  assertClose(Math.hypot(q[0], q[1], q[2], q[3]), 1, 1e-9);
  assert.ok(Matrix3.isOrthonormal(quatToMatrix3(q), 1e-5));
});

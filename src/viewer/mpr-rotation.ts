/**
 * mpr-rotation.ts — Pure rotation math for the MPR trackball (spec 007, TK-30).
 *
 * DOM-free and dependency-free on purpose (constitution II and VII): it runs under
 * the bare `tsx --test` runner and is consumed by `MPRGridCoordinator`.
 *
 * Conventions (shared with `Matrix3` in mpr-engine.ts):
 *  - A 3x3 matrix is a column-major `Float32Array(9)`: element (row r, col c) is
 *    `m[c * 3 + r]`. Columns 0/1/2 are the rotated basis vectors u', v', n'.
 *  - A quaternion is `[w, x, y, z]`, unit length for rotations.
 *  - Angles are in radians; callers convert to degrees for display.
 *  - Rotations follow the right-hand rule (same as `Matrix3.fromRotationAxis`).
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Euler read-out (YXZ order: R = Ry(yaw) · Rx(pitch) · Rz(roll)), in radians. */
export interface PitchYawRoll {
  pitch: number;
  yaw: number;
  roll: number;
}

/** Below this |m12| the YXZ decomposition is treated as gimbal-locked. */
const GIMBAL_THRESHOLD = 0.999999;

const IDENTITY_QUAT: Quat = [1, 0, 0, 0];

function identityMatrix3(): Float32Array {
  const out = new Float32Array(9);
  out[0] = 1;
  out[4] = 1;
  out[8] = 1;
  return out;
}

function multiplyMatrix3(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[col * 3 + row] =
        a[row] * b[col * 3] +
        a[row + 3] * b[col * 3 + 1] +
        a[row + 6] * b[col * 3 + 2];
    }
  }
  return out;
}

function normalizeVec3(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ── Quaternions ──────────────────────────────────────────────────────────────

/**
 * Unit quaternion for a rotation of `rad` around `axis`:
 * q = (cos(θ/2), â · sin(θ/2)). A zero-length axis yields the identity.
 */
export function quatFromAxisAngle(axis: Vec3, rad: number): Quat {
  const unitAxis = normalizeVec3(axis);
  if (!unitAxis) return [...IDENTITY_QUAT];
  const half = rad / 2;
  const sinHalf = Math.sin(half);
  return [
    Math.cos(half),
    unitAxis[0] * sinHalf,
    unitAxis[1] * sinHalf,
    unitAxis[2] * sinHalf,
  ];
}

/** Hamilton product `a ⊗ b`: applies `b` first, then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

/** Returns a unit-length copy; a degenerate quaternion falls back to identity. */
export function quatNormalize(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(length) || length < 1e-12) return [...IDENTITY_QUAT];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** Converts a unit quaternion into a column-major 3x3 rotation matrix. */
export function quatToMatrix3(q: Quat): Float32Array {
  const [w, x, y, z] = quatNormalize(q);
  const out = new Float32Array(9);
  // Column 0
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + w * z);
  out[2] = 2 * (x * z - w * y);
  // Column 1
  out[3] = 2 * (x * y - w * z);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z + w * x);
  // Column 2
  out[6] = 2 * (x * z + w * y);
  out[7] = 2 * (y * z - w * x);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

/**
 * Converts a column-major rotation matrix into a unit quaternion (Shepperd's
 * method: branches on the largest diagonal term for numerical stability).
 * The sign is canonicalised so that `w >= 0`.
 */
export function matrix3ToQuat(m: Float32Array): Quat {
  const m00 = m[0];
  const m10 = m[1];
  const m20 = m[2];
  const m01 = m[3];
  const m11 = m[4];
  const m21 = m[5];
  const m02 = m[6];
  const m12 = m[7];
  const m22 = m[8];
  const trace = m00 + m11 + m22;

  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }

  const unit = quatNormalize(q);
  return unit[0] < 0 ? [-unit[0], -unit[1], -unit[2], -unit[3]] : unit;
}

// ── Matrix hygiene ───────────────────────────────────────────────────────────

/**
 * Re-projects a drifted matrix onto the nearest proper rotation with Gram-Schmidt:
 * u' = û, v' = normalize(v − (v·û)û), n' = u' × v' (so det = +1). A matrix whose
 * u/v columns are degenerate cannot be repaired and falls back to the identity.
 */
export function orthonormalize(m: Float32Array): Float32Array {
  const u = normalizeVec3([m[0], m[1], m[2]]);
  if (!u) return identityMatrix3();

  const v: Vec3 = [m[3], m[4], m[5]];
  const projection = dotVec3(v, u);
  const vOrthogonal = normalizeVec3([
    v[0] - projection * u[0],
    v[1] - projection * u[1],
    v[2] - projection * u[2],
  ]);
  if (!vOrthogonal) return identityMatrix3();

  const n = crossVec3(u, vOrthogonal);
  return new Float32Array([
    u[0],
    u[1],
    u[2],
    vOrthogonal[0],
    vOrthogonal[1],
    vOrthogonal[2],
    n[0],
    n[1],
    n[2],
  ]);
}

// ── Pitch / Yaw ──────────────────────────────────────────────────────────────

/**
 * Reads Pitch/Yaw/Roll out of an accumulated rotation (display only — the state
 * of truth stays the matrix/quaternion, which avoids gimbal lock).
 *
 *   pitch = asin(−m12)   yaw = atan2(m02, m22)   roll = atan2(m10, m11)
 *
 * Pitch is in [−π/2, π/2] and yaw in (−π, π]. At |pitch| → 90° the yaw/roll pair
 * is ambiguous: roll is reported as 0 and yaw = atan2(−m20, m00).
 */
export function matrixToPitchYaw(m: Float32Array): PitchYawRoll {
  const m12 = m[7];
  const clamped = Math.max(-1, Math.min(1, m12));
  const pitch = Math.asin(-clamped);

  if (Math.abs(clamped) > GIMBAL_THRESHOLD) {
    return { pitch, yaw: Math.atan2(-m[2], m[0]), roll: 0 };
  }
  return {
    pitch,
    yaw: Math.atan2(m[6], m[8]),
    roll: Math.atan2(m[1], m[4]),
  };
}

/** Builds R = Ry(yaw) · Rx(pitch) · Rz(roll), the inverse of `matrixToPitchYaw`. */
export function pitchYawToMatrix3(
  pitch: number,
  yaw: number,
  roll = 0,
): Float32Array {
  const qYaw = quatFromAxisAngle([0, 1, 0], yaw);
  const qPitch = quatFromAxisAngle([1, 0, 0], pitch);
  const qRoll = quatFromAxisAngle([0, 0, 1], roll);
  return quatToMatrix3(quatMultiply(qYaw, quatMultiply(qPitch, qRoll)));
}

/**
 * Applies an incremental trackball rotation to an accumulated rotation matrix:
 *
 *   R_new = R(û_a, Δpitch) · R(v̂_a, Δyaw) · R_old
 *
 * `uAxis`/`vAxis` are the horizontal and vertical screen axes of the active plane
 * expressed in volume space. Yaw (horizontal drag) turns around `vAxis`; pitch
 * (vertical drag) turns around `uAxis`. Rodrigues is evaluated through the unit
 * quaternion of each axis-angle, which is algebraically identical.
 */
export function applyPitchYawDelta(
  m: Float32Array,
  uAxis: Vec3,
  vAxis: Vec3,
  dPitch: number,
  dYaw: number,
): Float32Array {
  const yawMatrix = quatToMatrix3(quatFromAxisAngle(vAxis, dYaw));
  const pitchMatrix = quatToMatrix3(quatFromAxisAngle(uAxis, dPitch));
  return multiplyMatrix3(pitchMatrix, multiplyMatrix3(yawMatrix, m));
}

/**
 * Quaternion form of `applyPitchYawDelta`, used by the coordinator to accumulate
 * without `Float32` matrix drift: q_new = normalize(q_pitch ⊗ q_yaw ⊗ q_old).
 */
export function applyPitchYawDeltaQuat(
  q: Quat,
  uAxis: Vec3,
  vAxis: Vec3,
  dPitch: number,
  dYaw: number,
): Quat {
  const qYaw = quatFromAxisAngle(vAxis, dYaw);
  const qPitch = quatFromAxisAngle(uAxis, dPitch);
  return quatNormalize(quatMultiply(qPitch, quatMultiply(qYaw, q)));
}

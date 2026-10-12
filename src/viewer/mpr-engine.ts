/**
 * mpr-engine.ts — True Multiplanar Reconstruction (MPR) Rendering Engine (UI-8 Phase 2).
 *
 * Core Architecture:
 *  - Static Orthogonal Cameras: Fixed projection planes for Axial, Coronal, and Sagittal views.
 *    The camera never moves during volume manipulation; the projection plane is always frontal
 *    and perpendicular to the observer.
 *  - Matrix Inversion: Volume rotation, translation, and scale are applied to the 3D volume's
 *    world transform matrix. The inverse matrix (M_worldToTex) maps static screen-space cutting
 *    planes into normalized [0, 1]^3 3D texture space.
 *  - Single-Pass Slice Extraction: A hardware-accelerated WebGL2 fragment shader samples
 *    the 3D texture along the arbitrary cutting plane with trilinear interpolation (60+ FPS).
 */

import { getCanonicalFlip } from "../dicom/spatial-math.js";
import { state as appState } from "./state.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type MPRPlane = "axial" | "coronal" | "sagittal";

export interface MPRVolumeData {
  depth: number; // Z dimension (number of slices)
  rows: number; // Y dimension
  cols: number; // X dimension
  data: Int16Array | Uint16Array | Float32Array;
  pixelSpacing: [number, number]; // [rowSpacing (dy), colSpacing (dx)] in mm
  sliceSpacing: number; // dz in mm
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number;
  windowWidth: number;
  imageOrientationPatient?: [number, number, number, number, number, number];
  flipX?: boolean;
  flipY?: boolean;
}

export interface MPRTransform {
  translation: [number, number, number]; // [tx, ty, tz] in mm
  rotation: [number, number, number]; // [pitch (X), yaw (Y), roll (Z)] in radians
  scale: number; // uniform scale factor
}

// ── Matrix3 Math Helper (US-50 Phase 2: Oblique MPR Math) ────────────────────

export class Matrix3 {
  public static create(): Float32Array {
    const out = new Float32Array(9);
    out[0] = 1;
    out[4] = 1;
    out[8] = 1;
    return out;
  }

  public static identity(): Float32Array {
    return Matrix3.create();
  }

  /**
   * Column-major matrix multiplication: out = a * b
   */
  public static multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[j * 3 + i] =
          a[i] * b[j * 3] + a[i + 3] * b[j * 3 + 1] + a[i + 6] * b[j * 3 + 2];
      }
    }
    return out;
  }

  /**
   * Transforms a 3D vector: out = M * v
   */
  public static transformVector(
    m: Float32Array,
    v: [number, number, number],
  ): [number, number, number] {
    const x = v[0];
    const y = v[1];
    const z = v[2];
    return [
      m[0] * x + m[3] * y + m[6] * z,
      m[1] * x + m[4] * y + m[7] * z,
      m[2] * x + m[5] * y + m[8] * z,
    ];
  }

  /**
   * Rodrigues rotation formula around an arbitrary unit axis vector.
   * Generates a column-major 3x3 rotation matrix.
   */
  public static fromRotationAxis(
    axis: [number, number, number],
    rad: number,
  ): Float32Array {
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const x = axis[0] / len;
    const y = axis[1] / len;
    const z = axis[2] / len;

    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const t = 1 - c;

    const out = new Float32Array(9);
    // Column 0
    out[0] = t * x * x + c;
    out[1] = t * x * y + s * z;
    out[2] = t * x * z - s * y;

    // Column 1
    out[3] = t * x * y - s * z;
    out[4] = t * y * y + c;
    out[5] = t * y * z + s * x;

    // Column 2
    out[6] = t * x * z + s * y;
    out[7] = t * y * z - s * x;
    out[8] = t * z * z + c;

    return out;
  }

  public static determinant(m: Float32Array): number {
    return (
      m[0] * (m[4] * m[8] - m[7] * m[5]) -
      m[3] * (m[1] * m[8] - m[7] * m[2]) +
      m[6] * (m[1] * m[5] - m[4] * m[2])
    );
  }

  public static isOrthonormal(m: Float32Array, eps = 1e-4): boolean {
    const c0: [number, number, number] = [m[0], m[1], m[2]];
    const c1: [number, number, number] = [m[3], m[4], m[5]];
    const c2: [number, number, number] = [m[6], m[7], m[8]];

    const dot = (a: [number, number, number], b: [number, number, number]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    const d00 = dot(c0, c0);
    const d11 = dot(c1, c1);
    const d22 = dot(c2, c2);
    const d01 = dot(c0, c1);
    const d02 = dot(c0, c2);
    const d12 = dot(c1, c2);

    return (
      Math.abs(d00 - 1) < eps &&
      Math.abs(d11 - 1) < eps &&
      Math.abs(d22 - 1) < eps &&
      Math.abs(d01) < eps &&
      Math.abs(d02) < eps &&
      Math.abs(d12) < eps &&
      Math.abs(Matrix3.determinant(m) - 1) < eps
    );
  }
}

// ── Matrix4 Math Helper ──────────────────────────────────────────────────────

export class Matrix4 {
  public static create(): Float32Array {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  }

  public static identity(): Float32Array {
    return Matrix4.create();
  }

  public static multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] =
          a[i] * b[j * 4] +
          a[i + 4] * b[j * 4 + 1] +
          a[i + 8] * b[j * 4 + 2] +
          a[i + 12] * b[j * 4 + 3];
      }
    }
    return out;
  }

  public static invert(m: Float32Array): Float32Array | null {
    const out = new Float32Array(16);
    const a00 = m[0],
      a01 = m[1],
      a02 = m[2],
      a03 = m[3];
    const a10 = m[4],
      a11 = m[5],
      a12 = m[6],
      a13 = m[7];
    const a20 = m[8],
      a21 = m[9],
      a22 = m[10],
      a23 = m[11];
    const a30 = m[12],
      a31 = m[13],
      a32 = m[14],
      a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    const det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det || Math.abs(det) < 1e-15) return null;
    const invDet = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
    out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
    out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
    out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
    out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
    out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
    out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
    out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
    out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;

    return out;
  }

  public static transpose(m: Float32Array): Float32Array {
    const out = new Float32Array(16);
    out[0] = m[0];
    out[1] = m[4];
    out[2] = m[8];
    out[3] = m[12];
    out[4] = m[1];
    out[5] = m[5];
    out[6] = m[9];
    out[7] = m[13];
    out[8] = m[2];
    out[9] = m[6];
    out[10] = m[10];
    out[11] = m[14];
    out[12] = m[3];
    out[13] = m[7];
    out[14] = m[11];
    out[15] = m[15];
    return out;
  }

  public static translate(
    m: Float32Array,
    v: [number, number, number],
  ): Float32Array {
    const t = new Float32Array([
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      v[0],
      v[1],
      v[2],
      1,
    ]);
    return Matrix4.multiply(m, t);
  }

  public static rotateX(m: Float32Array, rad: number): Float32Array {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const r = new Float32Array([
      1,
      0,
      0,
      0,
      0,
      c,
      s,
      0,
      0,
      -s,
      c,
      0,
      0,
      0,
      0,
      1,
    ]);
    return Matrix4.multiply(m, r);
  }

  public static rotateY(m: Float32Array, rad: number): Float32Array {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const r = new Float32Array([
      c,
      0,
      -s,
      0,
      0,
      1,
      0,
      0,
      s,
      0,
      c,
      0,
      0,
      0,
      0,
      1,
    ]);
    return Matrix4.multiply(m, r);
  }

  public static rotateZ(m: Float32Array, rad: number): Float32Array {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const r = new Float32Array([
      c,
      s,
      0,
      0,
      -s,
      c,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ]);
    return Matrix4.multiply(m, r);
  }

  public static scale(
    m: Float32Array,
    v: [number, number, number],
  ): Float32Array {
    const s = new Float32Array([
      v[0],
      0,
      0,
      0,
      0,
      v[1],
      0,
      0,
      0,
      0,
      v[2],
      0,
      0,
      0,
      0,
      1,
    ]);
    return Matrix4.multiply(m, s);
  }

  public static ortho(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
  ): Float32Array {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr,
      0,
      0,
      0,
      0,
      -2 * bt,
      0,
      0,
      0,
      0,
      2 * nf,
      0,
      (left + right) * lr,
      (top + bottom) * bt,
      (far + near) * nf,
      1,
    ]);
  }

  public static transformPoint(
    m: Float32Array,
    v: [number, number, number],
  ): [number, number, number] {
    const x = v[0],
      y = v[1],
      z = v[2];
    const rx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const ry = m[1] * x + m[5] * y + m[9] * z + m[13];
    const rz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const rw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const w = rw || 1.0;
    return [rx / w, ry / w, rz / w];
  }
}

// ── MPR Volume Representation & Matrix Inversion ─────────────────────────────

export class MPRVolume {
  public readonly data: MPRVolumeData;
  public readonly physicalSize: [number, number, number]; // [Sx, Sy, Sz] in mm
  public readonly transform: MPRTransform;
  public readonly flipX: boolean;
  public readonly flipY: boolean;

  private texToWorldMatrix: Float32Array = Matrix4.identity();
  private worldToTexMatrix: Float32Array = Matrix4.identity();

  constructor(data: MPRVolumeData) {
    this.data = data;
    const sx = data.cols * (data.pixelSpacing[1] || 1);
    const sy = data.rows * (data.pixelSpacing[0] || 1);
    const sz = data.depth * (data.sliceSpacing || 1);
    this.physicalSize = [sx, sy, sz];

    if (data.flipX !== undefined && data.flipY !== undefined) {
      this.flipX = data.flipX;
      this.flipY = data.flipY;
    } else if (data.imageOrientationPatient) {
      const canonical = getCanonicalFlip(data.imageOrientationPatient);
      this.flipX = canonical.flipX;
      this.flipY = canonical.flipY;
    } else {
      this.flipX = false;
      this.flipY = false;
    }

    this.transform = {
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1.0,
    };

    this.updateMatrices();
  }

  /**
   * Recalculates M_texToWorld and M_worldToTex.
   *
   * Coordinates:
   *  - Texture Space T = (u, v, w) in [0, 1]^3.
   *  - Centered Physical Volume Space = (u - 0.5) * Sx, (v - 0.5) * Sy, (w - 0.5) * Sz.
   *  - World Space = Transform (Rotation, Translation, Scale) * Physical Volume.
   */
  public updateMatrices(): void {
    const [sx, sy, sz] = this.physicalSize;
    const [tx, ty, tz] = this.transform.translation;
    const [rx, ry, rz] = this.transform.rotation;
    const s = this.transform.scale;

    // Matrix mapping [0, 1]^3 texture coordinates to centered physical mm:
    // P_vol = [sx*u - sx/2, sy*v - sy/2, sz*w - sz/2, 1]
    const texToVol = new Float32Array([
      sx,
      0,
      0,
      0,
      0,
      sy,
      0,
      0,
      0,
      0,
      sz,
      0,
      -sx / 2,
      -sy / 2,
      -sz / 2,
      1,
    ]);

    // Volume World Transform: Translation * RotationZ * RotationY * RotationX * Scale
    let volTransform = Matrix4.identity();
    volTransform = Matrix4.translate(volTransform, [tx, ty, tz]);
    volTransform = Matrix4.rotateZ(volTransform, rz);
    volTransform = Matrix4.rotateY(volTransform, ry);
    volTransform = Matrix4.rotateX(volTransform, rx);
    const flipXScale = this.flipX ? -1 : 1;
    const flipYScale = this.flipY ? -1 : 1;
    volTransform = Matrix4.scale(volTransform, [
      s * flipXScale,
      s * flipYScale,
      s,
    ]);

    // M_texToWorld = volTransform * texToVol
    this.texToWorldMatrix = Matrix4.multiply(volTransform, texToVol);

    // M_worldToTex = (M_texToWorld)^-1
    const inv = Matrix4.invert(this.texToWorldMatrix);
    this.worldToTexMatrix = inv || Matrix4.identity();
  }

  public rotate(pitch: number, yaw: number, roll: number): void {
    this.transform.rotation[0] += pitch;
    this.transform.rotation[1] += yaw;
    this.transform.rotation[2] += roll;
    this.updateMatrices();
  }

  public setRotation(pitch: number, yaw: number, roll: number): void {
    this.transform.rotation[0] = pitch;
    this.transform.rotation[1] = yaw;
    this.transform.rotation[2] = roll;
    this.updateMatrices();
  }

  public translate(dx: number, dy: number, dz: number): void {
    this.transform.translation[0] += dx;
    this.transform.translation[1] += dy;
    this.transform.translation[2] += dz;
    this.updateMatrices();
  }

  public setTranslation(x: number, y: number, z: number): void {
    this.transform.translation[0] = x;
    this.transform.translation[1] = y;
    this.transform.translation[2] = z;
    this.updateMatrices();
  }

  public scale(factor: number): void {
    this.transform.scale = Math.max(
      0.05,
      Math.min(20, this.transform.scale * factor),
    );
    this.updateMatrices();
  }

  public setScale(s: number): void {
    this.transform.scale = Math.max(0.05, Math.min(20, s));
    this.updateMatrices();
  }

  public resetTransform(): void {
    this.transform.translation = [0, 0, 0];
    this.transform.rotation = [0, 0, 0];
    this.transform.scale = 1.0;
    this.updateMatrices();
  }

  public getWorldToTexMatrix(): Float32Array {
    return this.worldToTexMatrix;
  }

  public getTexToWorldMatrix(): Float32Array {
    return this.texToWorldMatrix;
  }
}

// ── Static Orthogonal Cameras ────────────────────────────────────────────────

export class MPRCamera {
  public readonly plane: MPRPlane;

  // Base canonical basis vectors in World Space:
  public readonly baseUAxis: [number, number, number];
  public readonly baseVAxis: [number, number, number];
  public readonly baseNormal: [number, number, number];

  // Active (possibly rotated/oblique) basis vectors:
  public uAxis: [number, number, number];
  public vAxis: [number, number, number];
  public normal: [number, number, number];

  public sliceOffset = 0; // Displacement in mm along viewing normal
  public zoom = 1.0;

  constructor(plane: MPRPlane) {
    this.plane = plane;

    switch (plane) {
      case "axial":
        // Radiological standard (RPLA/LPS): Looking from feet towards head (+Z)
        // Screen Right: Patient Left (+X)
        // Screen Up: Patient Anterior (-Y in DICOM space)
        // Normal: Superior (+Z)
        this.baseUAxis = [1, 0, 0];
        this.baseVAxis = [0, -1, 0];
        this.baseNormal = [0, 0, 1];
        break;

      case "coronal":
        // Radiological standard: Looking from Anterior towards Posterior (+Y)
        // Screen Right: Patient Left (+X)
        // Screen Up: Patient Superior (+Z in DICOM space, Head pointing to top)
        // Normal: Posterior (+Y)
        this.baseUAxis = [1, 0, 0];
        this.baseVAxis = [0, 0, 1];
        this.baseNormal = [0, 1, 0];
        break;

      case "sagittal":
        // Radiological standard: Looking from Patient Right towards Left (+X)
        // Screen Right: Patient Posterior (+Y)
        // Screen Up: Patient Superior (+Z in DICOM space, Head pointing to top)
        // Normal: Left (+X)
        this.baseUAxis = [0, 1, 0];
        this.baseVAxis = [0, 0, 1];
        this.baseNormal = [1, 0, 0];
        break;
    }

    this.uAxis = [...this.baseUAxis];
    this.vAxis = [...this.baseVAxis];
    this.normal = [...this.baseNormal];
  }

  public applyRotation(r: Float32Array): void {
    this.uAxis = Matrix3.transformVector(r, this.baseUAxis);
    this.vAxis = Matrix3.transformVector(r, this.baseVAxis);
    this.normal = Matrix3.transformVector(r, this.baseNormal);
  }

  public resetRotation(): void {
    this.uAxis = [...this.baseUAxis];
    this.vAxis = [...this.baseVAxis];
    this.normal = [...this.baseNormal];
  }

  public setSliceOffset(offsetMm: number): void {
    this.sliceOffset = offsetMm;
  }

  public setSliceIndex(
    index: number,
    totalSlices: number,
    totalDimensionMm: number,
  ): void {
    if (totalSlices <= 1) {
      this.sliceOffset = 0;
      return;
    }
    const clampedIndex = Math.max(0, Math.min(totalSlices - 1, index));
    const ratio = clampedIndex / (totalSlices - 1); // 0..1
    this.sliceOffset = (ratio - 0.5) * totalDimensionMm;
  }

  public getSliceIndex(totalSlices: number, totalDimensionMm: number): number {
    if (totalSlices <= 1 || totalDimensionMm <= 0) return 0;
    const ratio = this.sliceOffset / totalDimensionMm + 0.5;
    return Math.max(
      0,
      Math.min(totalSlices - 1, Math.round(ratio * (totalSlices - 1))),
    );
  }

  /**
   * Constructs the M_screenToWorld matrix.
   * Maps 2D normalized screen quad coordinates [-1, 1]^2 to World Space mm coordinates.
   */
  public getScreenToWorldMatrix(
    viewportWidth: number,
    viewportHeight: number,
    baseWidthMm: number,
    baseHeightMm: number,
  ): Float32Array {
    const vpAspect = (viewportWidth || 1) / (viewportHeight || 1);
    const sliceAspect = (baseWidthMm || 1) / (baseHeightMm || 1);

    let halfW: number;
    let halfH: number;

    if (vpAspect > sliceAspect) {
      halfH = baseHeightMm / 2 / this.zoom;
      halfW = halfH * vpAspect;
    } else {
      halfW = baseWidthMm / 2 / this.zoom;
      halfH = halfW / vpAspect;
    }

    // World center point = sliceOffset along the normal vector
    const cx = this.normal[0] * this.sliceOffset;
    const cy = this.normal[1] * this.sliceOffset;
    const cz = this.normal[2] * this.sliceOffset;

    // Column-major affine matrix:
    // P_world = [halfW * uAxis] * x_ndc + [halfH * vAxis] * y_ndc + Center
    return new Float32Array([
      halfW * this.uAxis[0],
      halfW * this.uAxis[1],
      halfW * this.uAxis[2],
      0,

      halfH * this.vAxis[0],
      halfH * this.vAxis[1],
      halfH * this.vAxis[2],
      0,

      this.normal[0],
      this.normal[1],
      this.normal[2],
      0,

      cx,
      cy,
      cz,
      1,
    ]);
  }

  /**
   * Computes the effective physical dimensions of the volume projected along the camera's uAxis and vAxis.
   * In canonical orthogonal orientations, this matches the exact slice dimensions (e.g. sx, sy for axial).
   * In oblique orientations (Pitch/Yaw), it adapts dynamically to the rotated volume bounding box,
   * avoiding aspect-ratio collapse, empty borders, and harsh diagonal clipping.
   */
  public getBaseDimensions(volume: MPRVolume): [number, number] {
    const [sx, sy, sz] = volume.physicalSize || [1, 1, 1];
    const baseW =
      Math.abs(this.uAxis[0]) * sx +
      Math.abs(this.uAxis[1]) * sy +
      Math.abs(this.uAxis[2]) * sz;
    const baseH =
      Math.abs(this.vAxis[0]) * sx +
      Math.abs(this.vAxis[1]) * sy +
      Math.abs(this.vAxis[2]) * sz;
    return [baseW || 1, baseH || 1];
  }

  /**
   * Constructs the M_screenToTex matrix for this camera view:
   * M_screenToTex = M_worldToTex * M_screenToWorld.
   */
  public getScreenToTexMatrix(
    volume: MPRVolume,
    viewportWidth: number,
    viewportHeight: number,
  ): Float32Array {
    const [baseW, baseH] = this.getBaseDimensions(volume);

    const screenToWorld = this.getScreenToWorldMatrix(
      viewportWidth,
      viewportHeight,
      baseW,
      baseH,
    );
    const worldToTex = volume.getWorldToTexMatrix();
    return Matrix4.multiply(worldToTex, screenToWorld);
  }
}

// ── WebGL2 MPR Shader Sources ────────────────────────────────────────────────

const MPR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;

uniform mat4 u_screenToTex;

out vec3 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    vec4 texPos = u_screenToTex * vec4(a_position, 0.0, 1.0);
    v_texCoord = texPos.xyz / texPos.w;
}
`;

const MPR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec3 v_texCoord;
out vec4 fragColor;

uniform sampler3D u_volume;
uniform float u_windowCenter;
uniform float u_windowWidth;

void main() {
    // Voxel volume bounding box clipping [0, 1]^3 with smooth boundary feathering
    vec3 d0 = v_texCoord;
    vec3 d1 = vec3(1.0) - v_texCoord;
    float edgeDist = min(min(min(d0.x, d1.x), min(d0.y, d1.y)), min(d0.z, d1.z));

    if (edgeDist < 0.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Hardware-accelerated trilinear interpolation across 3D texture voxels
    float density = texture(u_volume, v_texCoord).r;

    // Window / Level transfer function
    float minW = u_windowCenter - u_windowWidth * 0.5;
    float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);

    // Smooth boundary feathering across margin to eliminate harsh straight diagonal cut lines
    float edgeFade = smoothstep(0.0, 0.015, edgeDist);
    fragColor = vec4(vec3(intensity * edgeFade), 1.0);
}
`;

// ── WebGL2 MPR Engine ────────────────────────────────────────────────────────

interface GLContextState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  texture: WebGLTexture | null;
  textureVersion: number;
}

export class MPREngine {
  public volume: MPRVolume | null = null;
  public readonly axialCamera: MPRCamera;
  public readonly coronalCamera: MPRCamera;
  public readonly sagittalCamera: MPRCamera;

  public windowCenter = 40;
  public windowWidth = 400;

  public crosshairWorld: [number, number, number] = [0, 0, 0];
  public crosshairNormalized: [number, number, number] = [0.5, 0.5, 0.5];
  public rotationMatrix: Float32Array = Matrix3.identity();

  private contextCache: Map<HTMLCanvasElement, GLContextState> = new Map();
  private volumeVersion = 0;

  constructor() {
    this.axialCamera = new MPRCamera("axial");
    this.coronalCamera = new MPRCamera("coronal");
    this.sagittalCamera = new MPRCamera("sagittal");
  }

  /** Sets rotation matrix (3x3) for oblique MPR slicing across all 3 viewports. */
  public setRotation(r: Float32Array): void {
    this.rotationMatrix = new Float32Array(r);
    this.axialCamera.applyRotation(this.rotationMatrix);
    this.coronalCamera.applyRotation(this.rotationMatrix);
    this.sagittalCamera.applyRotation(this.rotationMatrix);
    this.syncCameraSliceOffsets();
  }

  /** Resets rotation to canonical orthogonal Cartesian axes. */
  public resetRotation(): void {
    this.setRotation(Matrix3.identity());
  }

  /** Synchronizes orthogonal slice depths so planes pass through current crosshairWorld. */
  public syncCameraSliceOffsets(): void {
    const [x, y, z] = this.crosshairWorld;
    this.axialCamera.setSliceOffset(
      this.axialCamera.normal[0] * x +
        this.axialCamera.normal[1] * y +
        this.axialCamera.normal[2] * z,
    );
    this.coronalCamera.setSliceOffset(
      this.coronalCamera.normal[0] * x +
        this.coronalCamera.normal[1] * y +
        this.coronalCamera.normal[2] * z,
    );
    this.sagittalCamera.setSliceOffset(
      this.sagittalCamera.normal[0] * x +
        this.sagittalCamera.normal[1] * y +
        this.sagittalCamera.normal[2] * z,
    );
  }

  /** Loads volume data into the MPR engine. */
  public loadVolume(data: MPRVolumeData): void {
    this.volume = new MPRVolume(data);
    this.windowCenter = data.windowCenter;
    this.windowWidth = data.windowWidth;
    if (this === mprEngine && appState?.viewport && data.windowWidth > 0) {
      appState.viewport.windowCenter = data.windowCenter;
      appState.viewport.windowWidth = data.windowWidth;
    }
    this.volumeVersion++;

    // Initialize slice offsets and crosshair to volume centers
    this.crosshairWorld = [0, 0, 0];
    this.crosshairNormalized = [0.5, 0.5, 0.5];
    this.axialCamera.setSliceOffset(0);
    this.coronalCamera.setSliceOffset(0);
    this.sagittalCamera.setSliceOffset(0);
  }

  /**
   * Compiles WebGL2 shaders and initializes quad geometry on the specified canvas.
   */
  public initGL(canvas: HTMLCanvasElement): boolean {
    if (this.contextCache.has(canvas)) return true;

    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return false;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) return false;
    gl.shaderSource(vs, MPR_VERTEX_SHADER);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      return false;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs) return false;
    gl.shaderSource(fs, MPR_FRAGMENT_SHADER);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      gl.deleteShader(fs);
      return false;
    }

    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return false;
    }

    // Fullscreen quad in NDC [-1, 1]
    const quadVertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) return false;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(
      0,
      2,
      gl.FLOAT,
      false,
      2 * Float32Array.BYTES_PER_ELEMENT,
      0,
    );

    const state: GLContextState = {
      gl,
      program,
      vao,
      vbo,
      texture: null,
      textureVersion: -1,
    };

    this.contextCache.set(canvas, state);
    return true;
  }

  /**
   * Uploads the 3D volume texture to the GL context if dirty.
   */
  private ensureTexture(state: GLContextState): void {
    if (!this.volume || state.textureVersion === this.volumeVersion) return;
    const gl = state.gl;
    const { depth, rows, cols, data, rescaleSlope, rescaleIntercept } =
      this.volume.data;

    const totalVoxels = depth * rows * cols;
    const normalized = new Uint8Array(totalVoxels);

    for (let i = 0; i < totalVoxels; i++) {
      const hu = data[i] * rescaleSlope + rescaleIntercept;
      const norm = Math.max(
        0,
        Math.min(255, Math.round(((hu + 1024) / 4095) * 255)),
      );
      normalized[i] = norm;
    }

    if (state.texture) {
      gl.deleteTexture(state.texture);
    }

    const texture = gl.createTexture();
    if (!texture) return;

    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.R8,
      cols,
      rows,
      depth,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      normalized,
    );

    // Trilinear interpolation enabled for seamless 60 FPS rotation
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    state.texture = texture;
    state.textureVersion = this.volumeVersion;
  }

  public getCamera(plane: MPRPlane): MPRCamera {
    switch (plane) {
      case "axial":
        return this.axialCamera;
      case "coronal":
        return this.coronalCamera;
      case "sagittal":
        return this.sagittalCamera;
    }
  }

  /**
   * Renders the slice plane onto the provided canvas.
   */
  public renderView(plane: MPRPlane, canvas: HTMLCanvasElement): boolean {
    if (!this.volume) return false;
    if (!this.contextCache.has(canvas) && !this.initGL(canvas)) return false;

    const ctxState = this.contextCache.get(canvas);
    if (!ctxState) return false;

    const gl = ctxState.gl;
    this.ensureTexture(ctxState);
    if (!ctxState.texture) return false;

    const width = canvas.clientWidth || canvas.width || 300;
    const height = canvas.clientHeight || canvas.height || 300;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(ctxState.program);

    // Compute M_screenToTex
    const camera = this.getCamera(plane);
    const screenToTex = camera.getScreenToTexMatrix(this.volume, width, height);

    const uScreenToTexLoc = gl.getUniformLocation(
      ctxState.program,
      "u_screenToTex",
    );
    const uVolumeLoc = gl.getUniformLocation(ctxState.program, "u_volume");
    const uWindowCenterLoc = gl.getUniformLocation(
      ctxState.program,
      "u_windowCenter",
    );
    const uWindowWidthLoc = gl.getUniformLocation(
      ctxState.program,
      "u_windowWidth",
    );

    gl.uniformMatrix4fv(uScreenToTexLoc, false, screenToTex);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, ctxState.texture);
    gl.uniform1i(uVolumeLoc, 0);

    // Ensure W/L uniform is synchronized from global state for the active MPR engine
    if (
      this === mprEngine &&
      appState?.viewport &&
      appState.viewport.windowWidth > 0
    ) {
      this.windowCenter = appState.viewport.windowCenter;
      this.windowWidth = appState.viewport.windowWidth;
    }

    // Window/Level normalized [0, 1] relative to HU [-1024, 3071]
    const normCenter = (this.windowCenter + 1024) / 4095;
    const normWidth = Math.max(1e-4, this.windowWidth / 4095);

    gl.uniform1f(uWindowCenterLoc, normCenter);
    gl.uniform1f(uWindowWidthLoc, normWidth);

    gl.bindVertexArray(ctxState.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    return true;
  }

  /**
   * Convenience method to render all three views concurrently.
   */
  public renderAll(
    canvases: Partial<Record<MPRPlane, HTMLCanvasElement>>,
  ): void {
    if (canvases.axial) this.renderView("axial", canvases.axial);
    if (canvases.coronal) this.renderView("coronal", canvases.coronal);
    if (canvases.sagittal) this.renderView("sagittal", canvases.sagittal);
  }

  // ── Volume Transformations (Mouse Events act on Volume, Not Camera) ─────────

  public rotateVolume(pitch: number, yaw: number, roll: number): void {
    if (!this.volume) return;
    this.volume.rotate(pitch, yaw, roll);
  }

  public setVolumeRotation(pitch: number, yaw: number, roll: number): void {
    if (!this.volume) return;
    this.volume.setRotation(pitch, yaw, roll);
  }

  public translateVolume(dx: number, dy: number, dz: number): void {
    if (!this.volume) return;
    this.volume.translate(dx, dy, dz);
  }

  public setVolumeTranslation(x: number, y: number, z: number): void {
    if (!this.volume) return;
    this.volume.setTranslation(x, y, z);
  }

  public scaleVolume(factor: number): void {
    if (!this.volume) return;
    this.volume.scale(factor);
  }

  public setVolumeScale(s: number): void {
    if (!this.volume) return;
    this.volume.setScale(s);
  }

  public resetVolumeTransform(): void {
    if (!this.volume) return;
    this.volume.resetTransform();
  }

  public setSlicePosition(plane: MPRPlane, offsetMm: number): void {
    this.getCamera(plane).setSliceOffset(offsetMm);
  }

  public setSliceIndex(plane: MPRPlane, index: number): void {
    if (!this.volume || !this.volume.data) return;
    const [sx, sy, sz] = this.volume.physicalSize || [1, 1, 1];
    const { depth, rows, cols } = this.volume.data;

    if (plane === "axial") {
      this.axialCamera.setSliceIndex(index, depth, sz);
    } else if (plane === "coronal") {
      this.coronalCamera.setSliceIndex(index, rows, sy);
    } else if (plane === "sagittal") {
      this.sagittalCamera.setSliceIndex(index, cols, sx);
    }
  }

  public setWindowLevel(center: number, width: number): void {
    this.windowCenter = center;
    this.windowWidth = Math.max(1, width);
    if (this === mprEngine && appState?.viewport) {
      appState.viewport.windowCenter = center;
      appState.viewport.windowWidth = this.windowWidth;
    }
  }

  /**
   * Converts a 2D screen mouse delta (pixels) into a 3D world space displacement (mm)
   * on the orthogonal viewing plane of the active camera.
   */
  public convert2DTo3DDelta(
    plane: MPRPlane,
    deltaScreenX: number,
    deltaScreenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): [number, number, number] {
    if (!this.volume) return [0, 0, 0];
    const camera = this.getCamera(plane);
    const [baseW, baseH] = camera.getBaseDimensions(this.volume);

    const vpAspect = (viewportWidth || 1) / (viewportHeight || 1);
    const sliceAspect = (baseW || 1) / (baseH || 1);

    let halfW: number;
    let halfH: number;

    if (vpAspect > sliceAspect) {
      halfH = baseH / 2 / camera.zoom;
      halfW = halfH * vpAspect;
    } else {
      halfW = baseW / 2 / camera.zoom;
      halfH = halfW / vpAspect;
    }

    // Delta in NDC [-1, 1]
    const dxNdc = (2 * deltaScreenX) / (viewportWidth || 1);
    const dyNdc = (-2 * deltaScreenY) / (viewportHeight || 1);

    // 3D world delta = (dxNdc * halfW) * uAxis + (dyNdc * halfH) * vAxis
    const dxWorld =
      dxNdc * halfW * camera.uAxis[0] + dyNdc * halfH * camera.vAxis[0];
    const dyWorld =
      dxNdc * halfW * camera.uAxis[1] + dyNdc * halfH * camera.vAxis[1];
    const dzWorld =
      dxNdc * halfW * camera.uAxis[2] + dyNdc * halfH * camera.vAxis[2];

    return [dxWorld, dyWorld, dzWorld];
  }

  /**
   * Translates the volume along the camera's orthogonal plane, ensuring 1:1 visual
   * correspondence with mouse movement, clamped to prevent losing the volume.
   */
  public applyPanDelta2D(
    plane: MPRPlane,
    deltaScreenX: number,
    deltaScreenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!this.volume) return;
    const [dx, dy, dz] = this.convert2DTo3DDelta(
      plane,
      deltaScreenX,
      deltaScreenY,
      viewportWidth,
      viewportHeight,
    );

    if (typeof this.volume.translate === "function") {
      this.volume.translate(dx, dy, dz);
    }
    this.clampVolumeTranslation();
  }

  /** Restricts volume translation so the patient volume cannot be lost in the void. */
  public clampVolumeTranslation(): void {
    if (!this.volume || !this.volume.transform) return;
    const [sx, sy, sz] = this.volume.physicalSize || [1, 1, 1];
    const s = this.volume.transform.scale ?? 1;

    // Bounded to 85% of volume dimensions
    const maxTx = sx * s * 0.85;
    const maxTy = sy * s * 0.85;
    const maxTz = sz * s * 0.85;

    const [tx, ty, tz] = this.volume.transform.translation;
    this.volume.transform.translation[0] = Math.max(
      -maxTx,
      Math.min(maxTx, tx),
    );
    this.volume.transform.translation[1] = Math.max(
      -maxTy,
      Math.min(maxTy, ty),
    );
    this.volume.transform.translation[2] = Math.max(
      -maxTz,
      Math.min(maxTz, tz),
    );
    this.volume.updateMatrices();
  }

  public getCrosshairWorld(): [number, number, number] {
    return [...this.crosshairWorld];
  }

  public getCrosshairNormalized(): [number, number, number] {
    return [...this.crosshairNormalized];
  }

  /**
   * Sets the 3D crosshair position in world space with strict boundary clamping
   * to volume texture coordinates [0, 1]^3, updating all 3 orthogonal camera slice offsets.
   */
  public setCrosshairWorld(x: number, y: number, z: number): void {
    if (!this.volume) {
      this.crosshairWorld = [x, y, z];
      return;
    }

    // Transform world coordinates to texture coordinates [0, 1]^3
    const worldToTex = this.volume.getWorldToTexMatrix();
    const texCoords = Matrix4.transformPoint(worldToTex, [x, y, z]);

    // Clamping: strictly enforce [0.0, 1.0]^3
    const clampedU = Math.max(0.0, Math.min(1.0, texCoords[0]));
    const clampedV = Math.max(0.0, Math.min(1.0, texCoords[1]));
    const clampedW = Math.max(0.0, Math.min(1.0, texCoords[2]));

    this.crosshairNormalized = [clampedU, clampedV, clampedW];

    // Transform clamped texture coords back to world space
    const texToWorld = this.volume.getTexToWorldMatrix();
    this.crosshairWorld = Matrix4.transformPoint(texToWorld, [
      clampedU,
      clampedV,
      clampedW,
    ]);

    // Update camera slice offsets to pass through crosshair point
    this.syncCameraSliceOffsets();
  }

  /**
   * Updates crosshair position from 2D screen movement delta on the active plane.
   */
  public applyCrosshairDelta2D(
    plane: MPRPlane,
    deltaScreenX: number,
    deltaScreenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const [dx, dy, dz] = this.convert2DTo3DDelta(
      plane,
      deltaScreenX,
      deltaScreenY,
      viewportWidth,
      viewportHeight,
    );
    const [x, y, z] = this.crosshairWorld;
    this.setCrosshairWorld(x + dx, y + dy, z + dz);
  }

  /**
   * Sets crosshair position from absolute screen click/drag coordinates on the active plane.
   */
  public setCrosshairFromScreen(
    plane: MPRPlane,
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!this.volume) return;
    const camera = this.getCamera(plane);
    const [baseW, baseH] = camera.getBaseDimensions(this.volume);

    const screenToWorld = camera.getScreenToWorldMatrix(
      viewportWidth,
      viewportHeight,
      baseW,
      baseH,
    );

    const xNdc = (2 * screenX) / (viewportWidth || 1) - 1;
    const yNdc = 1 - (2 * screenY) / (viewportHeight || 1);

    const worldPoint = Matrix4.transformPoint(screenToWorld, [xNdc, yNdc, 0]);
    this.setCrosshairWorld(worldPoint[0], worldPoint[1], worldPoint[2]);
  }

  /**
   * Computes the 2D screen pixel coordinates of the current 3D crosshair for a viewport.
   */
  public getCrosshairScreenCoords(
    plane: MPRPlane,
    viewportWidth: number,
    viewportHeight: number,
  ): [number, number] {
    if (!this.volume) return [viewportWidth / 2, viewportHeight / 2];
    const camera = this.getCamera(plane);
    const [baseW, baseH] = camera.getBaseDimensions(this.volume);

    const screenToWorld = camera.getScreenToWorldMatrix(
      viewportWidth,
      viewportHeight,
      baseW,
      baseH,
    );
    const worldToScreen = Matrix4.invert(screenToWorld);
    if (!worldToScreen) return [viewportWidth / 2, viewportHeight / 2];

    const ndc = Matrix4.transformPoint(worldToScreen, this.crosshairWorld);
    const screenX = ((ndc[0] + 1) / 2) * viewportWidth;
    const screenY = ((1 - ndc[1]) / 2) * viewportHeight;

    return [screenX, screenY];
  }

  /**
   * Returns clinical color codes for the intersecting crosshair lines in each plane.
   *  - Axial: Vertical is Sagittal (#f87171), Horizontal is Coronal (#34d399)
   *  - Coronal: Vertical is Sagittal (#f87171), Horizontal is Axial (#38bdf8)
   *  - Sagittal: Vertical is Coronal (#34d399), Horizontal is Axial (#38bdf8)
   */
  public getCrosshairColors(plane: MPRPlane): {
    vertical: string;
    horizontal: string;
  } {
    switch (plane) {
      case "axial":
        return { vertical: "#f87171", horizontal: "#34d399" };
      case "coronal":
        return { vertical: "#f87171", horizontal: "#38bdf8" };
      case "sagittal":
        return { vertical: "#34d399", horizontal: "#38bdf8" };
    }
  }

  /**
   * Computes the 2D unit direction vectors on the viewing canvas for the two intersecting
   * crosshair lines (which represent the intersections of the other two cut planes).
   */
  public getCrosshairLineDirections(plane: MPRPlane): {
    line1: { dirX: number; dirY: number; color: string };
    line2: { dirX: number; dirY: number; color: string };
  } {
    const cam = this.getCamera(plane);
    const n = cam.normal;
    const u = cam.uAxis;
    const v = cam.vAxis;

    let otherCam1: MPRCamera;
    let otherCam2: MPRCamera;
    let col1: string;
    let col2: string;

    if (plane === "axial") {
      otherCam1 = this.coronalCamera;
      otherCam2 = this.sagittalCamera;
      col1 = "#34d399"; // Coronal line = Emerald
      col2 = "#f87171"; // Sagittal line = Coral
    } else if (plane === "coronal") {
      otherCam1 = this.axialCamera;
      otherCam2 = this.sagittalCamera;
      col1 = "#38bdf8"; // Axial line = Sky Blue
      col2 = "#f87171"; // Sagittal line = Coral
    } else {
      otherCam1 = this.axialCamera;
      otherCam2 = this.coronalCamera;
      col1 = "#38bdf8"; // Axial line = Sky Blue
      col2 = "#34d399"; // Coronal line = Emerald
    }

    const n1 = otherCam1.normal;
    const n2 = otherCam2.normal;

    // Cross product: L = n x n_other gives 3D line direction of intersection
    // Project into screen space (u, v) where ScreenX = u, ScreenY = -v
    const computeScreenDir = (otherN: [number, number, number]) => {
      const lx = n[1] * otherN[2] - n[2] * otherN[1];
      const ly = n[2] * otherN[0] - n[0] * otherN[2];
      const lz = n[0] * otherN[1] - n[1] * otherN[0];

      const sx = lx * u[0] + ly * u[1] + lz * u[2];
      const sy = -(lx * v[0] + ly * v[1] + lz * v[2]); // -v because screen Y points down

      const len = Math.hypot(sx, sy);
      if (len < 1e-5) return { dirX: 1, dirY: 0 };
      return { dirX: sx / len, dirY: sy / len };
    };

    const d1 = computeScreenDir(n1);
    const d2 = computeScreenDir(n2);

    return {
      line1: { ...d1, color: col1 },
      line2: { ...d2, color: col2 },
    };
  }

  /**
   * Renders high-contrast clinical crosshair lines with a center gap on a 2D canvas context.
   * Dynamically aligns lines along oblique plane intersections and draws rotation indicators.
   */
  public renderCrosshair(
    plane: MPRPlane,
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const [cx, cy] = this.getCrosshairScreenCoords(
      plane,
      viewportWidth,
      viewportHeight,
    );
    const { line1, line2 } = this.getCrosshairLineDirections(plane);
    const gap = 8; // Center clearance gap
    const span = Math.max(viewportWidth, viewportHeight) * 1.5;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 3;
    ctx.lineWidth = 1.5;

    // Line 1
    ctx.strokeStyle = line1.color;
    ctx.beginPath();
    ctx.moveTo(cx - span * line1.dirX, cy - span * line1.dirY);
    ctx.lineTo(cx - gap * line1.dirX, cy - gap * line1.dirY);
    ctx.moveTo(cx + gap * line1.dirX, cy + gap * line1.dirY);
    ctx.lineTo(cx + span * line1.dirX, cy + span * line1.dirY);
    ctx.stroke();

    // Line 2
    ctx.strokeStyle = line2.color;
    ctx.beginPath();
    ctx.moveTo(cx - span * line2.dirX, cy - span * line2.dirY);
    ctx.lineTo(cx - gap * line2.dirX, cy - gap * line2.dirY);
    ctx.moveTo(cx + gap * line2.dirX, cy + gap * line2.dirY);
    ctx.lineTo(cx + span * line2.dirX, cy + span * line2.dirY);
    ctx.stroke();

    // Clinical rotation handle dots along the lines
    if (typeof ctx.arc === "function") {
      const handleDist = 55;
      ctx.fillStyle = line1.color;
      ctx.beginPath();
      ctx.arc(
        cx + handleDist * line1.dirX,
        cy + handleDist * line1.dirY,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx.arc(
        cx - handleDist * line1.dirX,
        cy - handleDist * line1.dirY,
        2.5,
        0,
        Math.PI * 2,
      );
      if (typeof ctx.fill === "function") ctx.fill();

      ctx.fillStyle = line2.color;
      ctx.beginPath();
      ctx.arc(
        cx + handleDist * line2.dirX,
        cy + handleDist * line2.dirY,
        2.5,
        0,
        Math.PI * 2,
      );
      ctx.arc(
        cx - handleDist * line2.dirX,
        cy - handleDist * line2.dirY,
        2.5,
        0,
        Math.PI * 2,
      );
      if (typeof ctx.fill === "function") ctx.fill();
    }

    ctx.restore();
  }

  public destroy(): void {
    for (const state of this.contextCache.values()) {
      const gl = state.gl;
      if (state.texture) gl.deleteTexture(state.texture);
      gl.deleteBuffer(state.vbo);
      gl.deleteVertexArray(state.vao);
      gl.deleteProgram(state.program);
    }
    this.contextCache.clear();
    this.volume = null;
  }
}

export const mprEngine = new MPREngine();

/**
 * spatial-math.ts — Pure 3D spatial geometry & DICOM patient orientation engine.
 *
 * Implements standard DICOM Patient Coordinate System (LPS) mathematics:
 *  - Vector Cross Product and Dot Product
 *  - Plane Normal Computation: N = R x C
 *  - Spatial Slice Distance Projection: dist = IPP · N
 *  - Anatomical Orientation Classification (RLPA: Right-Left, Posterior-Anterior, Head-Foot)
 */

export type Vector3D = [number, number, number];

/**
 * Normalizes -0 to 0.
 */
function cleanZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Computes the 3D cross product of two vectors: a x b.
 */
export function crossProduct3D(
  a: Vector3D | readonly number[],
  b: Vector3D | readonly number[],
): Vector3D {
  return [
    cleanZero(a[1] * b[2] - a[2] * b[1]),
    cleanZero(a[2] * b[0] - a[0] * b[2]),
    cleanZero(a[0] * b[1] - a[1] * b[0]),
  ];
}

/**
 * Computes the 3D dot product of two vectors: a · b.
 */
export function dotProduct3D(
  a: Vector3D | readonly number[],
  b: Vector3D | readonly number[],
): number {
  return cleanZero(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/**
 * Computes the Euclidean magnitude (length) of a 3D vector.
 */
export function vectorMagnitude3D(v: Vector3D | readonly number[]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Normalizes a 3D vector to unit length.
 * Returns [0, 0, 0] if the vector magnitude is 0.
 */
export function normalize3D(v: Vector3D | readonly number[]): Vector3D {
  const mag = vectorMagnitude3D(v);
  if (mag <= 1e-9) {
    return [0, 0, 0];
  }
  return [cleanZero(v[0] / mag), cleanZero(v[1] / mag), cleanZero(v[2] / mag)];
}

/**
 * Computes the unit normal vector of a DICOM image plane from ImageOrientationPatient (0020,0037).
 *
 * @param iop Array of 6 numbers: [Rx, Ry, Rz, Cx, Cy, Cz]
 * @returns Unit normal vector N = R x C, or null if iop is invalid or degenerate.
 */
export function computePlaneNormal(
  iop: readonly number[] | undefined | null,
): Vector3D | null {
  if (!iop || iop.length < 6) return null;
  const r: Vector3D = [iop[0], iop[1], iop[2]];
  const c: Vector3D = [iop[3], iop[4], iop[5]];

  const normal = crossProduct3D(r, c);
  const unitNormal = normalize3D(normal);

  if (vectorMagnitude3D(unitNormal) <= 1e-9) {
    return null;
  }
  return unitNormal;
}

/**
 * Calculates the projected scalar distance of a slice along its plane normal.
 *
 * In the DICOM standard, slices in a volumetric acquisition must be sorted by
 * projecting ImagePositionPatient (0020,0032) onto the plane normal vector
 * N = R x C derived from ImageOrientationPatient (0020,0037):
 *   dist = IPP · N
 *
 * @param ipp ImagePositionPatient [x, y, z] (0020,0032)
 * @param iop ImageOrientationPatient [Rx, Ry, Rz, Cx, Cy, Cz] (0020,0037)
 * @returns Scalar distance in millimeters, or null if tags are missing or invalid.
 */
export function calculateSpatialDistance(
  ipp: Vector3D | readonly number[] | undefined | null,
  iop: readonly number[] | undefined | null,
): number | null {
  if (!ipp || ipp.length < 3) return null;
  const normal = computePlaneNormal(iop);
  if (!normal) return null;

  return dotProduct3D(ipp, normal);
}

/** Options for orientation label determination. */
export interface OrientationLabelOptions {
  /**
   * If true, uses "H" (Head) and "F" (Foot).
   * If false (default), uses "S" (Superior) and "I" (Inferior).
   */
  useHeadFoot?: boolean;
}

/**
 * Returns the primary anatomical single-letter code for a 3D direction vector in LPS coordinates:
 *  - X axis: +X = L (Left), -X = R (Right)
 *  - Y axis: +Y = P (Posterior), -Y = A (Anterior)
 *  - Z axis: +Z = S (Superior) or H (Head), -Z = I (Inferior) or F (Foot)
 */
export function getAnatomicalLetter(
  v: Vector3D | readonly number[],
  options?: OrientationLabelOptions,
): string {
  if (!v || v.length < 3) return "";

  const absX = Math.abs(v[0]);
  const absY = Math.abs(v[1]);
  const absZ = Math.abs(v[2]);

  if (absX < 1e-5 && absY < 1e-5 && absZ < 1e-5) {
    return "";
  }

  const useHeadFoot = options?.useHeadFoot ?? false;
  const headLetter = useHeadFoot ? "H" : "S";
  const footLetter = useHeadFoot ? "F" : "I";

  if (absX >= absY && absX >= absZ) {
    return v[0] >= 0 ? "L" : "R";
  } else if (absY >= absX && absY >= absZ) {
    return v[1] >= 0 ? "P" : "A";
  } else {
    return v[2] >= 0 ? headLetter : footLetter;
  }
}

/**
 * Returns the full English anatomical name for a 3D direction vector in LPS coordinates:
 * "Left", "Right", "Posterior", "Anterior", "Superior" (or "Head"), "Inferior" (or "Foot").
 */
export function getAnatomicalName(
  v: Vector3D | readonly number[],
  options?: OrientationLabelOptions,
): string {
  const letter = getAnatomicalLetter(v, options);
  switch (letter) {
    case "L":
      return "Left";
    case "R":
      return "Right";
    case "P":
      return "Posterior";
    case "A":
      return "Anterior";
    case "S":
      return "Superior";
    case "H":
      return "Head";
    case "I":
      return "Inferior";
    case "F":
      return "Foot";
    default:
      return "";
  }
}

/**
 * Cardinal orientation labels for the four viewport borders (Top, Bottom, Left, Right).
 */
export interface OrientationLabels {
  top: string;
  bottom: string;
  left: string;
  right: string;
  rowOrientation: string;
  colOrientation: string;
}

/**
 * Determines the anatomical orientation labels for the viewport borders from ImageOrientationPatient.
 *
 * In DICOM display convention:
 *  - Row vector R = [Rx, Ry, Rz] points from screen-left to screen-right (columns direction).
 *    -> Screen-right is +R, screen-left is -R.
 *  - Column vector C = [Cx, Cy, Cz] points from screen-top to screen-bottom (rows direction).
 *    -> Screen-bottom is +C, screen-top is -C.
 *
 * @param iop ImageOrientationPatient (0020,0037)
 * @param options Label customization options (useHeadFoot)
 * @returns Cardinal viewport labels { top, bottom, left, right, rowOrientation, colOrientation }, or null if invalid.
 */
export function getOrientationLabels(
  iop: readonly number[] | undefined | null,
  options?: OrientationLabelOptions,
): OrientationLabels | null {
  if (!iop || iop.length < 6) return null;

  const r: Vector3D = [iop[0], iop[1], iop[2]];
  const c: Vector3D = [iop[3], iop[4], iop[5]];

  const negR: Vector3D = [-r[0], -r[1], -r[2]];
  const negC: Vector3D = [-c[0], -c[1], -c[2]];

  const right = getAnatomicalLetter(r, options);
  const left = getAnatomicalLetter(negR, options);
  const bottom = getAnatomicalLetter(c, options);
  const top = getAnatomicalLetter(negC, options);

  return {
    top,
    bottom,
    left,
    right,
    rowOrientation: right,
    colOrientation: bottom,
  };
}

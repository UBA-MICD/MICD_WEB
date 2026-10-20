import test from "node:test";
import assert from "node:assert/strict";
import {
  crossProduct3D,
  dotProduct3D,
  vectorMagnitude3D,
  normalize3D,
  computePlaneNormal,
  calculateSpatialDistance,
  getAnatomicalLetter,
  getAnatomicalName,
  getOrientationLabels,
} from "./spatial-math.js";

test("crossProduct3D computes standard right-handed orthogonal products", () => {
  const i = [1, 0, 0];
  const j = [0, 1, 0];
  const k = [0, 0, 1];

  assert.deepEqual(crossProduct3D(i, j), [0, 0, 1]);
  assert.deepEqual(crossProduct3D(j, k), [1, 0, 0]);
  assert.deepEqual(crossProduct3D(k, i), [0, 1, 0]);

  // Anti-commutativity
  assert.deepEqual(crossProduct3D(j, i), [0, 0, -1]);
});

test("dotProduct3D computes standard scalar product", () => {
  assert.equal(dotProduct3D([1, 2, 3], [4, -5, 6]), 12); // 4 - 10 + 18 = 12
  assert.equal(dotProduct3D([1, 0, 0], [0, 1, 0]), 0); // Orthogonal
  assert.equal(dotProduct3D([0, 0, 5], [0, 0, 5]), 25);
});

test("vectorMagnitude3D and normalize3D compute correct norms and handle zero vector", () => {
  assert.equal(vectorMagnitude3D([3, 4, 0]), 5);
  assert.equal(vectorMagnitude3D([0, 0, 0]), 0);

  const normalized = normalize3D([0, 3, 4]);
  assert.equal(Math.abs(normalized[0] - 0) < 1e-6, true);
  assert.equal(Math.abs(normalized[1] - 0.6) < 1e-6, true);
  assert.equal(Math.abs(normalized[2] - 0.8) < 1e-6, true);

  // Zero vector shouldn't produce NaNs
  assert.deepEqual(normalize3D([0, 0, 0]), [0, 0, 0]);
});

test("computePlaneNormal computes correct unit normal for axial, coronal and sagittal", () => {
  // Axial: R = [1, 0, 0], C = [0, 1, 0] -> N = [0, 0, 1]
  const axialIop = [1, 0, 0, 0, 1, 0];
  const axialNormal = computePlaneNormal(axialIop);
  assert.deepEqual(axialNormal, [0, 0, 1]);

  // Coronal: R = [1, 0, 0], C = [0, 0, -1] -> N = [0, 1, 0]
  const coronalIop = [1, 0, 0, 0, 0, -1];
  const coronalNormal = computePlaneNormal(coronalIop);
  assert.deepEqual(coronalNormal, [0, 1, 0]);

  // Sagittal: R = [0, 1, 0], C = [0, 0, -1] -> N = [-1, 0, 0]
  const sagittalIop = [0, 1, 0, 0, 0, -1];
  const sagittalNormal = computePlaneNormal(sagittalIop);
  assert.deepEqual(sagittalNormal, [-1, 0, 0]);

  // Invalid / degenerate inputs return null
  assert.equal(computePlaneNormal(undefined), null);
  assert.equal(computePlaneNormal([1, 0, 0]), null);
  assert.equal(computePlaneNormal([1, 0, 0, 1, 0, 0]), null); // Collinear vectors (R x C = 0)
});

test("calculateSpatialDistance computes projected scalar position onto plane normal", () => {
  // Axial slice at Z = 45.5 mm
  const axialIop = [1, 0, 0, 0, 1, 0]; // Normal = [0, 0, 1]
  const ipp1 = [-125.0, -125.0, 45.5];
  const dist1 = calculateSpatialDistance(ipp1, axialIop);
  assert.equal(dist1 !== null && Math.abs(dist1 - 45.5) < 1e-5, true);

  // Axial slice with negative Z
  const ipp2 = [-125.0, -125.0, -10.2];
  const dist2 = calculateSpatialDistance(ipp2, axialIop);
  assert.equal(dist2 !== null && Math.abs(dist2 - -10.2) < 1e-5, true);

  // Coronal slice (Normal = [0, 1, 0]) at Y = -35.0 mm
  const coronalIop = [1, 0, 0, 0, 0, -1];
  const ippCoronal = [0, -35.0, 100];
  const distCoronal = calculateSpatialDistance(ippCoronal, coronalIop);
  assert.equal(
    distCoronal !== null && Math.abs(distCoronal - -35.0) < 1e-5,
    true,
  );

  // Sagittal slice (Normal = [-1, 0, 0]) at X = 20.0 mm -> dist = -20.0 mm
  const sagittalIop = [0, 1, 0, 0, 0, -1];
  const ippSagittal = [20.0, 0, 50];
  const distSagittal = calculateSpatialDistance(ippSagittal, sagittalIop);
  assert.equal(
    distSagittal !== null && Math.abs(distSagittal - -20.0) < 1e-5,
    true,
  );

  // Missing or incomplete tags return null
  assert.equal(calculateSpatialDistance(undefined, axialIop), null);
  assert.equal(calculateSpatialDistance(ipp1, undefined), null);
  assert.equal(calculateSpatialDistance([10], axialIop), null);
});

test("getAnatomicalLetter and getAnatomicalName classify LPS directional axes", () => {
  assert.equal(getAnatomicalLetter([1, 0, 0]), "L");
  assert.equal(getAnatomicalName([1, 0, 0]), "Left");

  assert.equal(getAnatomicalLetter([-1, 0, 0]), "R");
  assert.equal(getAnatomicalName([-1, 0, 0]), "Right");

  assert.equal(getAnatomicalLetter([0, 1, 0]), "P");
  assert.equal(getAnatomicalName([0, 1, 0]), "Posterior");

  assert.equal(getAnatomicalLetter([0, -1, 0]), "A");
  assert.equal(getAnatomicalName([0, -1, 0]), "Anterior");

  // Superior/Inferior vs Head/Foot
  assert.equal(getAnatomicalLetter([0, 0, 1]), "S");
  assert.equal(getAnatomicalName([0, 0, 1]), "Superior");
  assert.equal(getAnatomicalLetter([0, 0, 1], { useHeadFoot: true }), "H");
  assert.equal(getAnatomicalName([0, 0, 1], { useHeadFoot: true }), "Head");

  assert.equal(getAnatomicalLetter([0, 0, -1]), "I");
  assert.equal(getAnatomicalName([0, 0, -1]), "Inferior");
  assert.equal(getAnatomicalLetter([0, 0, -1], { useHeadFoot: true }), "F");
  assert.equal(getAnatomicalName([0, 0, -1], { useHeadFoot: true }), "Foot");

  // Oblique vector picks dominant component
  assert.equal(getAnatomicalLetter([0.85, 0.1, -0.2]), "L");
  assert.equal(getAnatomicalLetter([-0.2, 0.9, 0.1]), "P");
});

test("getOrientationLabels determines viewport cardinal labels for clinical views", () => {
  // Standard Axial (Supine):
  // R = [1, 0, 0] (Left) -> Right border = L, Left border = R
  // C = [0, 1, 0] (Posterior) -> Bottom border = P, Top border = A
  const axialIop = [1, 0, 0, 0, 1, 0];
  const axialLabels = getOrientationLabels(axialIop);
  assert.deepEqual(axialLabels, {
    top: "A",
    bottom: "P",
    left: "R",
    right: "L",
    rowOrientation: "L",
    colOrientation: "P",
  });

  // Prone Axial (inverted patient):
  // R = [-1, 0, 0], C = [0, -1, 0]
  const proneIop = [-1, 0, 0, 0, -1, 0];
  const proneLabels = getOrientationLabels(proneIop);
  assert.deepEqual(proneLabels, {
    top: "P",
    bottom: "A",
    left: "L",
    right: "R",
    rowOrientation: "R",
    colOrientation: "A",
  });

  // Standard Coronal:
  // R = [1, 0, 0], C = [0, 0, -1] -> Top = S, Bottom = I, Left = R, Right = L
  const coronalIop = [1, 0, 0, 0, 0, -1];
  const coronalLabels = getOrientationLabels(coronalIop);
  assert.deepEqual(coronalLabels, {
    top: "S",
    bottom: "I",
    left: "R",
    right: "L",
    rowOrientation: "L",
    colOrientation: "I",
  });

  // Coronal with useHeadFoot
  const coronalHfLabels = getOrientationLabels(coronalIop, {
    useHeadFoot: true,
  });
  assert.deepEqual(coronalHfLabels, {
    top: "H",
    bottom: "F",
    left: "R",
    right: "L",
    rowOrientation: "L",
    colOrientation: "F",
  });

  // Standard Sagittal:
  // R = [0, 1, 0], C = [0, 0, -1] -> Top = S, Bottom = I, Left = A, Right = P
  const sagittalIop = [0, 1, 0, 0, 0, -1];
  const sagittalLabels = getOrientationLabels(sagittalIop);
  assert.deepEqual(sagittalLabels, {
    top: "S",
    bottom: "I",
    left: "A",
    right: "P",
    rowOrientation: "P",
    colOrientation: "I",
  });

  // Null/invalid IOP returns null
  assert.equal(getOrientationLabels(undefined), null);
  assert.equal(getOrientationLabels([1, 0, 0]), null);
});

test("getCanonicalFlip calculates RLPA flips correctly", () => {
  const { getCanonicalFlip } = require("./spatial-math.js");

  // Standard Axial (Supine): no flip needed
  assert.deepEqual(getCanonicalFlip([1, 0, 0, 0, 1, 0]), {
    flipX: false,
    flipY: false,
  });

  // Prone Axial (inverted rows and cols): both flip
  assert.deepEqual(getCanonicalFlip([-1, 0, 0, 0, -1, 0]), {
    flipX: true,
    flipY: true,
  });

  // Axial with inverted Y only: flipY true
  assert.deepEqual(getCanonicalFlip([1, 0, 0, 0, -1, 0]), {
    flipX: false,
    flipY: true,
  });

  // Standard Coronal (C = [0, 0, -1]): no flip
  assert.deepEqual(getCanonicalFlip([1, 0, 0, 0, 0, -1]), {
    flipX: false,
    flipY: false,
  });

  // Inverted Coronal (C = [0, 0, 1]): flipY true
  assert.deepEqual(getCanonicalFlip([1, 0, 0, 0, 0, 1]), {
    flipX: false,
    flipY: true,
  });

  // Missing or degenerate IOP: no flip
  assert.deepEqual(getCanonicalFlip(undefined), { flipX: false, flipY: false });
  assert.deepEqual(getCanonicalFlip([1, 0]), { flipX: false, flipY: false });
});

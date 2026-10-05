import test from "node:test";
import assert from "node:assert/strict";
import dicomParser from "dicom-parser";
import {
  buildSyntheticDicom,
  buildAnonymizedSyntheticDicom,
  expectNoPII,
  SYNTHETIC_PII,
  SYNTHETIC_UIDS,
  SYNTHETIC_NESTED,
  SYNTHETIC_PRIVATE,
} from "./synthetic-dicom.ts";

test("the synthetic fixture is a real DICOM the production parser can read", () => {
  const ds = dicomParser.parseDicom(new Uint8Array(buildSyntheticDicom()));
  assert.equal(ds.string("x00100010"), SYNTHETIC_PII.x00100010.value);
  assert.equal(ds.string("x00100020"), SYNTHETIC_PII.x00100020.value);
  assert.equal(ds.string("x00080018"), SYNTHETIC_UIDS.x00080018);
  // Nested sequence with the inner PatientID.
  const seq = ds.elements["x00101002"];
  assert.ok(seq?.items?.length === 1);
  assert.equal(
    seq.items[0].dataSet.string(SYNTHETIC_NESTED.innerTag),
    SYNTHETIC_NESTED.innerValue,
  );
  // Private element present.
  assert.equal(ds.string(SYNTHETIC_PRIVATE.dataTag), SYNTHETIC_PRIVATE.data);
  // Pixel data present and six bytes long.
  assert.equal(ds.elements["x7fe00010"].length, 6);
});

test("options can drop the nested sequence and the private element", () => {
  const ds = dicomParser.parseDicom(
    new Uint8Array(
      buildSyntheticDicom({ withoutNested: true, withoutPrivate: true }),
    ),
  );
  assert.equal(ds.elements["x00101002"], undefined);
  assert.equal(ds.elements[SYNTHETIC_PRIVATE.dataTag], undefined);
});

test("expectNoPII flags every identifying tag when nothing changed (not vacuous)", () => {
  const original = buildSyntheticDicom();
  const violations = expectNoPII(original, original, dicomParser);
  // Every PII tag + nested + private + the three UIDs must be reported.
  const expected =
    Object.keys(SYNTHETIC_PII).length +
    1 /* nested */ +
    1 /* private */ +
    Object.keys(SYNTHETIC_UIDS).length;
  assert.equal(violations.length, expected);
});

test("expectNoPII passes for a correctly anonymized fixture", () => {
  const original = buildSyntheticDicom();
  const anonymized = buildAnonymizedSyntheticDicom();
  assert.deepEqual(expectNoPII(anonymized, original, dicomParser), []);
});

test("the anonymized fixture leaves pixel data untouched", () => {
  const before = dicomParser.parseDicom(new Uint8Array(buildSyntheticDicom()));
  const after = dicomParser.parseDicom(
    new Uint8Array(buildAnonymizedSyntheticDicom()),
  );
  const px = (ds: any) => {
    const el = ds.elements["x7fe00010"];
    return Array.from(
      new Uint8Array(
        ds.byteArray.buffer,
        ds.byteArray.byteOffset + el.dataOffset,
        el.length,
      ),
    );
  };
  assert.deepEqual(px(after), px(before));
});

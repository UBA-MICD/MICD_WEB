/**
 * Tests for collectDicomFiles and collectServerUploadFiles.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDicomFiles,
  collectServerUploadFiles,
  type FolderFile,
} from "./folder-files.ts";

const f = (name: string, webkitRelativePath?: string): FolderFile => ({
  name,
  webkitRelativePath,
});
const names = (files: FolderFile[]): string[] => files.map((x) => x.name);

test("keeps .dcm files and drops non-DICOM files", () => {
  const input = [
    f("a.dcm"),
    f("notes.txt"),
    f("preview.png"),
    f("b.dcm"),
    f("data.json"),
  ];
  assert.deepEqual(names(collectDicomFiles(input)), ["a.dcm", "b.dcm"]);
});

test("extension match is case-insensitive (.DCM, .Dcm)", () => {
  const input = [f("a.DCM"), f("b.Dcm")];
  assert.deepEqual(names(collectDicomFiles(input)).sort(), ["a.DCM", "b.Dcm"]);
});

test("includes extension-less DICOM files (common real-world export)", () => {
  // Many PACS exports name slices with no extension, e.g. IM000001, I10
  const input = [f("IM000001"), f("IM000002"), f("readme.txt")];
  assert.deepEqual(names(collectDicomFiles(input)), ["IM000001", "IM000002"]);
});

test("excludes junk: DICOMDIR, dotfiles, Thumbs.db", () => {
  const input = [
    f("image-1.dcm"),
    f("DICOMDIR"),
    f(".DS_Store"),
    f("Thumbs.db"),
  ];
  assert.deepEqual(names(collectDicomFiles(input)), ["image-1.dcm"]);
});

test("walks through EVERY image — does not drop any DICOM slice", () => {
  const input = Array.from({ length: 50 }, (_, i) => f(`image-${i + 1}.dcm`));
  assert.equal(collectDicomFiles(input).length, 50);
});

test("orders slices numerically, not lexicographically (2 before 10)", () => {
  const input = [
    f("image-10.dcm"),
    f("image-2.dcm"),
    f("image-1.dcm"),
    f("image-100.dcm"),
  ];
  assert.deepEqual(names(collectDicomFiles(input)), [
    "image-1.dcm",
    "image-2.dcm",
    "image-10.dcm",
    "image-100.dcm",
  ]);
});

test("orders by folder path when webkitRelativePath is present (series grouped)", () => {
  const input = [
    f("image-000002.dcm", "study/series-000002/image-000002.dcm"),
    f("image-000001.dcm", "study/series-000002/image-000001.dcm"),
    f("image-000002.dcm", "study/series-000001/image-000002.dcm"),
    f("image-000001.dcm", "study/series-000001/image-000001.dcm"),
  ];
  assert.deepEqual(
    collectDicomFiles(input).map((x) => x.webkitRelativePath),
    [
      "study/series-000001/image-000001.dcm",
      "study/series-000001/image-000002.dcm",
      "study/series-000002/image-000001.dcm",
      "study/series-000002/image-000002.dcm",
    ],
  );
});

test("returns empty array for empty input", () => {
  assert.deepEqual(collectDicomFiles([]), []);
});

test("returns empty array when folder has no DICOM files", () => {
  const input = [f("readme.txt"), f("cover.jpg"), f(".DS_Store")];
  assert.deepEqual(collectDicomFiles(input), []);
});

test("does not mutate the input array", () => {
  const input = [f("image-2.dcm"), f("image-1.dcm")];
  const copy = [...input];
  collectDicomFiles(input);
  assert.deepEqual(input, copy);
});

test("works with real File objects from a folder <input>", () => {
  const input = [
    new File([new Uint8Array([1])], "image-2.dcm"),
    new File([new Uint8Array([1])], "image-1.dcm"),
    new File([new Uint8Array([1])], "notes.txt"),
  ];
  assert.deepEqual(names(collectDicomFiles(input)), [
    "image-1.dcm",
    "image-2.dcm",
  ]);
});

// ── collectServerUploadFiles ──────────────────────────────────────────────────

const file = (name: string): File => new File([new Uint8Array([1])], name);

test("collectServerUploadFiles: .dcm goes to valid", () => {
  const { valid, rejected } = collectServerUploadFiles([file("scan.dcm")]);
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(valid[0].name, "scan.dcm");
});

test("collectServerUploadFiles: .zip goes to valid", () => {
  const { valid, rejected } = collectServerUploadFiles([file("study.zip")]);
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(valid[0].name, "study.zip");
});

test("collectServerUploadFiles: .png goes to rejected", () => {
  const { valid, rejected } = collectServerUploadFiles([file("photo.png")]);
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
});

test("collectServerUploadFiles: mixed input splits correctly", () => {
  const input = [
    file("a.dcm"),
    file("archive.zip"),
    file("readme.txt"),
    file("preview.jpg"),
  ];
  const { valid, rejected } = collectServerUploadFiles(input);
  assert.equal(valid.length, 2);
  assert.equal(rejected.length, 2);
  assert.deepEqual(
    valid.map((x) => x.name),
    ["a.dcm", "archive.zip"],
  );
});

test("collectServerUploadFiles: extension-less files (DICOM candidates) are valid", () => {
  const { valid } = collectServerUploadFiles([file("IM000001")]);
  assert.equal(valid.length, 1);
});

test("collectServerUploadFiles: hidden dotfiles are rejected", () => {
  const { rejected } = collectServerUploadFiles([file(".DS_Store")]);
  assert.equal(rejected.length, 1);
});

test("collectServerUploadFiles: empty input returns empty selections", () => {
  const { valid, rejected } = collectServerUploadFiles([]);
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 0);
});

test("collectServerUploadFiles: .ZIP uppercase is valid", () => {
  const { valid } = collectServerUploadFiles([file("STUDY.ZIP")]);
  assert.equal(valid.length, 1);
});

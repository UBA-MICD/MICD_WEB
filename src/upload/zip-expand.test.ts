/**
 * Tests for extractZipEntries in zip-expand.ts.
 *
 * extractZipEntries receives the unzip implementation as a parameter, so these
 * tests run in Node without needing fflate's CDN import or the DOM.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractZipEntries, type UnzipFn } from "./zip-expand.ts";

const FAKE_BUF = new Uint8Array([1, 2, 3]);

/** Build a mock unzipFn that immediately resolves with the given entries. */
function mockUnzip(entries: Record<string, Uint8Array>): UnzipFn {
  return (_data, cb) => cb(null, entries);
}

/** Build a mock unzipFn that rejects with an error. */
function failingUnzip(msg = "corrupt zip"): UnzipFn {
  return (_data, cb) => cb(new Error(msg), {});
}

test("single .dcm entry is returned", async () => {
  const entries = { "slice001.dcm": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "slice001.dcm");
  assert.strictEqual(result[0].data, FAKE_BUF);
});

test("extension-less DICOM candidate is returned", async () => {
  const entries = { "IM000001": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "IM000001");
});

test(".txt entry is skipped", async () => {
  const entries = { "readme.txt": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test(".png entry is skipped", async () => {
  const entries = { "thumb.png": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test("hidden dotfile is skipped", async () => {
  const entries = { ".DS_Store": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test("path traversal entry is skipped", async () => {
  const entries = { "../../etc/passwd.dcm": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test("empty zip returns empty array", async () => {
  const result = await extractZipEntries(FAKE_BUF, mockUnzip({}));
  assert.equal(result.length, 0);
});

test("multiple entries: only DICOM ones returned", async () => {
  const entries = {
    "slice001.dcm": FAKE_BUF,
    "slice002.dcm": FAKE_BUF,
    "readme.txt": FAKE_BUF,
    "cover.png": FAKE_BUF,
    "IM000003": FAKE_BUF,
  };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 3);
  const names = result.map((e) => e.name);
  assert.ok(names.includes("slice001.dcm"));
  assert.ok(names.includes("slice002.dcm"));
  assert.ok(names.includes("IM000003"));
});

test("basename is extracted from nested path", async () => {
  const entries = { "study/series-01/slice001.dcm": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "slice001.dcm");
});

test("DICOMDIR is skipped (known junk name)", async () => {
  const entries = { DICOMDIR: FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test("Thumbs.db is skipped (known junk name)", async () => {
  const entries = { "Thumbs.db": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 0);
});

test("rejects when unzipFn errors", async () => {
  await assert.rejects(
    () => extractZipEntries(FAKE_BUF, failingUnzip("bad zip")),
    /bad zip/,
  );
});

test(".DCM uppercase extension is accepted", async () => {
  const entries = { "SCAN.DCM": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 1);
});

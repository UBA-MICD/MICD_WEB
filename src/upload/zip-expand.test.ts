/**
 * Tests for extractZipEntries and expandFiles in zip-expand.ts.
 *
 * Both functions accept a unzipFn parameter so tests run in Node without
 * needing fflate's CDN import or the DOM.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractZipEntries,
  expandFiles,
  MAX_CLIENT_ZIP_BYTES,
  type UnzipFn,
} from "./zip-expand.ts";

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

test("directory entry (trailing slash) is skipped", async () => {
  const entries = { "study/series/": FAKE_BUF, "study/series/IM001.dcm": FAKE_BUF };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "IM001.dcm");
});

test("basename collision is disambiguated with parent dir prefix", async () => {
  const buf1 = new Uint8Array([1]);
  const buf2 = new Uint8Array([2]);
  const entries = {
    "series-1/IM000001": buf1,
    "series-2/IM000001": buf2,
  };
  const result = await extractZipEntries(FAKE_BUF, mockUnzip(entries));
  assert.equal(result.length, 2);
  const names = result.map((e) => e.name);
  // One keeps the basename; the other gets a parent prefix.
  assert.ok(names.includes("IM000001"), "first entry keeps original name");
  assert.ok(
    names.some((n) => n !== "IM000001" && n.includes("IM000001")),
    "second entry is disambiguated",
  );
});

test("expandFiles: non-ZIP files pass through unchanged", async () => {
  const dcm = new File([FAKE_BUF], "scan.dcm");
  const { files, corruptZips, tooBigZips } = await expandFiles([dcm], null, mockUnzip({}));
  assert.equal(files.length, 1);
  assert.equal(files[0], dcm);
  assert.equal(corruptZips.length, 0);
  assert.equal(tooBigZips.length, 0);
});

test("expandFiles: ZIP is expanded into individual File objects", async () => {
  const zipFile = new File([FAKE_BUF], "study.zip");
  const entries = { "scan.dcm": FAKE_BUF };
  const { files, corruptZips } = await expandFiles([zipFile], null, mockUnzip(entries));
  assert.equal(corruptZips.length, 0);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "scan.dcm");
});

test("expandFiles: corrupt ZIP is reported in corruptZips, not thrown", async () => {
  const zipFile = new File([FAKE_BUF], "bad.zip");
  const { files, corruptZips } = await expandFiles([zipFile], null, failingUnzip());
  assert.equal(files.length, 0);
  assert.equal(corruptZips.length, 1);
  assert.equal(corruptZips[0], "bad.zip");
});

test("expandFiles: ZIP exceeding MAX_CLIENT_ZIP_BYTES goes to tooBigZips", async () => {
  // Create a File object whose .size reports as oversized without allocating real memory.
  const oversized = new File([new Uint8Array(1)], "huge.zip");
  Object.defineProperty(oversized, "size", { value: MAX_CLIENT_ZIP_BYTES + 1 });
  const { files, corruptZips, tooBigZips } = await expandFiles([oversized], null, mockUnzip({}));
  assert.equal(files.length, 0);
  assert.equal(corruptZips.length, 0);
  assert.equal(tooBigZips.length, 1);
  assert.equal(tooBigZips[0], "huge.zip");
});

test("expandFiles: mixed file list — ZIP expanded, .dcm passed through", async () => {
  const dcm = new File([FAKE_BUF], "extra.dcm");
  const zipFile = new File([FAKE_BUF], "study.zip");
  const entries = { "from-zip.dcm": FAKE_BUF };
  const { files, corruptZips } = await expandFiles([dcm, zipFile], null, mockUnzip(entries));
  assert.equal(corruptZips.length, 0);
  assert.equal(files.length, 2);
  const names = files.map((f) => f.name);
  assert.ok(names.includes("extra.dcm"));
  assert.ok(names.includes("from-zip.dcm"));
});

test("expandFiles: corrupt ZIP does not abort subsequent files", async () => {
  const good = new File([FAKE_BUF], "good.dcm");
  const bad = new File([FAKE_BUF], "bad.zip");
  const { files, corruptZips } = await expandFiles([good, bad], null, failingUnzip());
  assert.equal(corruptZips.length, 1);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "good.dcm");
});

test("expandFiles: statusEl is written and cleared per ZIP", async () => {
  const messages: string[] = [];
  const statusEl = {
    get textContent() { return ""; },
    set textContent(v: string) { messages.push(v); },
  } as unknown as HTMLElement;
  const zipFile = new File([FAKE_BUF], "study.zip");
  await expandFiles([zipFile], statusEl, mockUnzip({ "s.dcm": FAKE_BUF }));
  assert.ok(messages.some((m) => m.includes("Descomprimiendo")), "decompression message shown");
  assert.equal(messages[messages.length - 1], "", "status cleared after ZIP");
});

test("expandFiles: fflate import failure goes to corruptZips, not an unhandled rejection", async () => {
  const zipFile = new File([FAKE_BUF], "study.zip");
  // Simulate import("fflate") throwing by providing a unzipFn that throws synchronously.
  const throwingUnzip: UnzipFn = () => { throw new Error("import failed"); };
  const { files, corruptZips } = await expandFiles([zipFile], null, throwingUnzip);
  assert.equal(files.length, 0);
  assert.equal(corruptZips.length, 1);
});

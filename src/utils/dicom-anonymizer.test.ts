import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymizeDicomBuffer,
  DicomAnonymizationError,
  PII_TAGS,
} from "./dicom-anonymizer.ts";

test("anonymizeDicomBuffer scrubs PII tag byte ranges using a custom parser", () => {
  const buffer = new Uint8Array(16).fill(0xff).buffer;
  const parser = {
    parseDicom: () => ({
      elements: {
        x00100010: { dataOffset: 2, length: 4 },
      },
    }),
  };

  const result = new Uint8Array(
    anonymizeDicomBuffer(buffer, { customParser: parser }),
  );
  assert.deepEqual(Array.from(result.slice(2, 6)), [0x20, 0x20, 0x20, 0x20]);
  assert.equal(result[0], 0xff);
  assert.equal(result[6], 0xff);
});

test("anonymizeDicomBuffer honors a custom replacementByte and tagsToScrub list", () => {
  const buffer = new Uint8Array(8).fill(0xaa).buffer;
  const parser = {
    parseDicom: () => ({
      elements: { customTag: { dataOffset: 0, length: 2 } },
    }),
  };

  const result = new Uint8Array(
    anonymizeDicomBuffer(buffer, {
      customParser: parser,
      tagsToScrub: ["customTag"],
      replacementByte: 0x00,
    }),
  );
  assert.deepEqual(Array.from(result.slice(0, 2)), [0x00, 0x00]);
});

test("anonymizeDicomBuffer fails closed when the dataset has no elements", () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  const parser = { parseDicom: () => ({}) };
  assert.throws(
    () => anonymizeDicomBuffer(buffer, { customParser: parser }),
    DicomAnonymizationError,
  );
});

test("anonymizeDicomBuffer fails closed when parseDicom is missing", () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  assert.throws(
    () => anonymizeDicomBuffer(buffer, { customParser: {} }),
    DicomAnonymizationError,
  );
});

test("anonymizeDicomBuffer skips elements with out-of-range or missing offsets", () => {
  const buffer = new Uint8Array(4).fill(0xff).buffer;
  const parser = {
    parseDicom: () => ({
      elements: {
        a: { dataOffset: 10, length: 4 }, // end > buffer length
        b: { dataOffset: -1, length: 2 }, // negative start
        c: { length: 2 }, // no dataOffset
        d: { dataOffset: 0, length: 0 }, // zero length
      },
    }),
  };
  const result = new Uint8Array(
    anonymizeDicomBuffer(buffer, {
      customParser: parser,
      tagsToScrub: ["a", "b", "c", "d"],
    }),
  );
  assert.deepEqual(Array.from(result), [0xff, 0xff, 0xff, 0xff]);
});

test("anonymizeDicomBuffer fails closed on a throwing parser, keeping the cause", () => {
  const buffer = new Uint8Array([9, 9]).buffer;
  const cause = new Error("malformed DICOM");
  const parser = {
    parseDicom: () => {
      throw cause;
    },
  };
  assert.throws(
    () => anonymizeDicomBuffer(buffer, { customParser: parser }),
    (err: unknown) =>
      err instanceof DicomAnonymizationError && err.cause === cause,
  );
});

test("defaults to the full PII_TAGS list when tagsToScrub is omitted", () => {
  const buffer = new Uint8Array(4).fill(0xff).buffer;
  let seenTags: string[] = [];
  const parser = {
    parseDicom: () => ({
      elements: new Proxy(
        {},
        {
          get(_target, tag: string) {
            seenTags.push(tag);
            return undefined;
          },
        },
      ),
    }),
  };
  anonymizeDicomBuffer(buffer, { customParser: parser });
  assert.deepEqual(seenTags, PII_TAGS);
});

test("getParserInstance falls back to window.dicomParser, then globalThis.dicomParser, then throws", () => {
  const originalWindow = (globalThis as any).window;
  const originalGlobalParser = (globalThis as any).dicomParser;

  try {
    delete (globalThis as any).window;
    delete (globalThis as any).dicomParser;
    // No parser available anywhere and no customParser passed: fails closed
    // rather than handing the un-scrubbed buffer back.
    const buffer = new Uint8Array([7]).buffer;
    assert.throws(() => anonymizeDicomBuffer(buffer), DicomAnonymizationError);

    // globalThis.dicomParser fallback
    (globalThis as any).dicomParser = {
      parseDicom: () => ({ elements: {} }),
    };
    assert.doesNotThrow(() => anonymizeDicomBuffer(buffer));
  } finally {
    if (originalWindow !== undefined)
      (globalThis as any).window = originalWindow;
    if (originalGlobalParser !== undefined) {
      (globalThis as any).dicomParser = originalGlobalParser;
    } else {
      delete (globalThis as any).dicomParser;
    }
  }
});

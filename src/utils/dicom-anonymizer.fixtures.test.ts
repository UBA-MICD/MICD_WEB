// Runs the real anonymizer + real dicom-parser over the PHI fixture set built
// by testing/anonymization/make_phi_samples.py (≥10 real and synthetic DICOMs
// carrying unique sentinel values such as "PHI03-PATNAME"). The fixtures are
// generated, not committed: point MICD_PHI_FIXTURES at the directory, or the
// suite skips. See testing/anonymization/README.md.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import dicomParser from "dicom-parser";
import { anonymizeDicomBuffer, PII_TAGS } from "./dicom-anonymizer.ts";

interface Check {
  keyword: string;
  scope: "in" | "gap";
  grep: string[];
}
interface Entry {
  variant: string;
  checks: Check[];
}

const dir =
  process.env.MICD_PHI_FIXTURES ?? "../testing/anonymization/fixtures";
const manifestPath = join(dir, "manifest.json");
const manifest: Record<string, Entry> | null = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;
const skip = manifest
  ? false
  : `no PHI fixtures at ${dir} (run make phi-samples in testing/)`;

function contains(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

test("PHI fixture set has at least 10 DICOMs", { skip }, () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".dcm"));
  assert.ok(files.length >= 10, `only ${files.length} fixtures`);
});

for (const [name, entry] of Object.entries(manifest ?? {})) {
  test(`anonymizes ${name} (${entry.variant})`, { skip }, (t) => {
    const original = new Uint8Array(readFileSync(join(dir, name)));
    const out = new Uint8Array(
      anonymizeDicomBuffer(original.buffer.slice(0) as ArrayBuffer, {
        customParser: dicomParser,
      }),
    );

    assert.equal(out.length, original.length, "layout must be preserved");

    for (const c of entry.checks.filter((c) => c.scope === "in")) {
      for (const s of c.grep) {
        assert.ok(!contains(out, s), `${c.keyword}: "${s}" still in bytes`);
      }
    }

    // Every changed byte must fall inside a PII element's value — the pixel
    // data and every other tag are untouched.
    const ds = dicomParser.parseDicom(original);
    const ranges = PII_TAGS.map((tag) => ds.elements[tag])
      .filter((el) => el && el.length > 0)
      .map((el) => [el.dataOffset, el.dataOffset + el.length]);
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== original[i]) {
        assert.ok(
          ranges.some(([a, b]) => i >= a && i < b),
          `byte ${i} changed outside any PII element`,
        );
      }
    }

    // Still a parseable DICOM, with the scrubbed name blank.
    const after = dicomParser.parseDicom(out);
    assert.equal((after.string("x00100010") ?? "").trim(), "");

    // Known gaps (sequences, private tags, accession…): reported, not failed.
    const leaks = entry.checks
      .filter((c) => c.scope === "gap" && c.grep.some((s) => contains(out, s)))
      .map((c) => c.keyword);
    if (leaks.length) t.diagnostic(`known gaps still present: ${leaks.join(", ")}`);
  });
}

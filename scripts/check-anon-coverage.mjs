// check-anon-coverage.mjs — fail CI if the anonymization integration module
// drops below the TK-15 coverage bar. node:test has no per-file threshold, so
// we parse the lcov report `test:coverage` already produced.
//
// Run after `npm run test:coverage`:  node scripts/check-anon-coverage.mjs
import { readFileSync } from "node:fs";

const MIN = 80; // percent, lines and branches
const TARGETS = [
  "src/upload/local-anonymizer.ts",
  "src/upload/anonymizer-contract.ts",
];

const lcovPath = "coverage/lcov.info";
let lcov;
try {
  lcov = readFileSync(lcovPath, "utf8");
} catch {
  console.error(
    `check-anon-coverage: ${lcovPath} not found — run test:coverage first`,
  );
  process.exit(1);
}

/** Parse lcov into { file: { lines%, branches% } }. */
const records = {};
let cur = null;
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) {
    cur = {
      file: line.slice(3).replace(/\\/g, "/"),
      LF: 0,
      LH: 0,
      BRF: 0,
      BRH: 0,
    };
  } else if (line.startsWith("end_of_record") && cur) {
    records[cur.file] = cur;
    cur = null;
  } else if (cur) {
    const [k, v] = line.split(":");
    if (["LF", "LH", "BRF", "BRH"].includes(k)) cur[k] = Number(v);
  }
}

const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);

let failed = false;
for (const target of TARGETS) {
  const rec = Object.values(records).find((r) => r.file.endsWith(target));
  if (!rec) {
    console.error(`check-anon-coverage: no coverage recorded for ${target}`);
    failed = true;
    continue;
  }
  const lines = pct(rec.LH, rec.LF);
  const branches = pct(rec.BRH, rec.BRF);
  const ok = lines >= MIN && branches >= MIN;
  const mark = ok ? "ok" : "FAIL";
  console.log(
    `${mark} ${target}  lines ${lines.toFixed(1)}%  branches ${branches.toFixed(1)}%`,
  );
  if (!ok) failed = true;
}

if (failed) {
  console.error(`check-anon-coverage: integration module below ${MIN}%`);
  process.exit(1);
}
console.log(`check-anon-coverage: all targets >= ${MIN}%`);

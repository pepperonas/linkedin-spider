#!/usr/bin/env node
// Measure the test count and keep the README badges honest.
//
//   node scripts/badges.mjs --check   # exit 1 if the READMEs claim a different number
//   node scripts/badges.mjs --write   # measure and rewrite badge + prose in both READMEs
//
// Why a script: a "346 tests passing" badge that nobody updates is worse than
// none — it states a number with confidence that stopped being true. The
// number is taken from vitest's own JSON report, so it cannot be a guess.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const READMES = ['README.md', 'README_EN.md'];
const mode = process.argv.includes('--write') ? 'write' : 'check';

function measure() {
  const out = path.join(os.tmpdir(), `lc-vitest-${process.pid}.json`);
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { stdio: 'ignore' });
  } catch (e) {
    // vitest exits non-zero on failures; the report is still written
  }
  if (!fs.existsSync(out)) throw new Error('vitest wrote no JSON report');
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  return { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests };
}

function claimed(text) {
  const m = text.match(/badge\/tests-(\d+)_passing/);
  return m ? Number(m[1]) : null;
}

const { total, passed, failed } = measure();
if (failed > 0 || passed !== total) {
  console.error(`Suite is not green (${passed}/${total} passed, ${failed} failed) — a "passing" badge would lie. Aborting.`);
  process.exit(2);
}

let drift = false;
for (const file of READMES) {
  let text = fs.readFileSync(file, 'utf8');
  const have = claimed(text);
  if (have === total) { console.log(`${file}: ${total} ✓`); continue; }
  if (mode === 'check') {
    console.error(`${file}: badge says ${have}, suite has ${total}`);
    drift = true;
    continue;
  }
  text = text
    .replace(/badge\/tests-\d+_passing/g, `badge/tests-${total}_passing`)
    .replace(/\*\*\d+ Unit- und Integrationstests\*\*/g, `**${total} Unit- und Integrationstests**`)
    .replace(/\*\*\d+ unit and integration tests\*\*/g, `**${total} unit and integration tests**`);
  fs.writeFileSync(file, text);
  console.log(`${file}: ${have} → ${total} written`);
}
if (drift) {
  console.error('Run `node scripts/badges.mjs --write` and commit.');
  process.exit(1);
}

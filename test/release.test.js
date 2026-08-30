import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
const workflow = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
const popupHtml = fs.readFileSync(path.resolve('popup.html'), 'utf8');

// Every file the shipped extension needs at runtime.
function requiredFiles() {
  const files = new Set(['manifest.json']);
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) files.add(js);
  files.add(manifest.action.default_popup);
  for (const p of Object.values(manifest.action.default_icon || {})) files.add(p);
  for (const p of Object.values(manifest.icons || {})) files.add(p);
  // popup.html pulls its own scripts and stylesheet
  for (const m of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) files.add(m[1]);
  }
  return files;
}

// The `cp ... dist/linkedin-spider/` line in the Build ZIP step.
function shippedFiles() {
  const m = workflow.match(/cp ([^\n]+?) dist\/linkedin-spider\//);
  if (!m) throw new Error('release.yml: no "cp ... dist/linkedin-spider/" line found');
  return new Set(m[1].trim().split(/\s+/));
}

describe('release workflow', () => {
  it('ships every file the manifest and popup reference', () => {
    const missing = [...requiredFiles()].filter((f) => !shippedFiles().has(f)).sort();
    expect(missing).toEqual([]);
  });

  it('does not ship files that no longer exist', () => {
    const gone = [...shippedFiles()].filter((f) => !fs.existsSync(path.resolve(f))).sort();
    expect(gone).toEqual([]);
  });

  it('never ships tests, config or node_modules', () => {
    for (const f of shippedFiles()) {
      expect(f).not.toMatch(/^(test|node_modules)\//);
      expect(f).not.toMatch(/^(package|vitest\.config)/);
    }
  });

  it('runs the test suite before cutting a release', () => {
    expect(workflow).toMatch(/npm run test:ci/);
  });
});

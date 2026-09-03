import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
const workflow = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');

// Every file the shipped extension needs at runtime.
// ⚠️ Each manifest entry point is listed here on purpose. The 2.7.0–2.7.4 ZIPs
// shipped without interceptor.js because the cp list was hand-maintained; the
// first version of THIS guard then missed background.js + options.html the
// same way, because it only knew content scripts and the popup.
function localRefs(html) {
  const out = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) out.push(m[1]);
  }
  return out;
}

function requiredFiles() {
  const files = new Set(['manifest.json']);
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) files.add(js);
  files.add(manifest.action.default_popup);
  for (const p of Object.values(manifest.action.default_icon || {})) files.add(p);
  for (const p of Object.values(manifest.icons || {})) files.add(p);
  if (manifest.background && manifest.background.service_worker) files.add(manifest.background.service_worker);
  if (manifest.options_ui && manifest.options_ui.page) files.add(manifest.options_ui.page);
  if (manifest.options_page) files.add(manifest.options_page);
  // every HTML page pulls its own scripts and stylesheets
  for (const page of [manifest.action.default_popup, manifest.options_ui && manifest.options_ui.page].filter(Boolean)) {
    const html = fs.readFileSync(path.resolve(page), 'utf8');
    for (const ref of localRefs(html)) files.add(ref);
  }
  // a service worker's importScripts() are runtime files too
  if (manifest.background && manifest.background.service_worker) {
    const worker = fs.readFileSync(path.resolve(manifest.background.service_worker), 'utf8');
    for (const m of worker.matchAll(/importScripts\(([^)]*)\)/g)) {
      for (const f of m[1].matchAll(/'([^']+)'|"([^"]+)"/g)) files.add(f[1] || f[2]);
    }
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

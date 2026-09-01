import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const popupHtml = fs.readFileSync(path.resolve('popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.resolve('popup.js'), 'utf8');
const readmeDe = fs.readFileSync(path.resolve('README.md'), 'utf8');
const readmeEn = fs.readFileSync(path.resolve('README_EN.md'), 'utf8');

describe('versioning', () => {
  it('is SemVer', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('manifest and package.json agree', () => {
    // They drifted for five releases before this pin existed.
    expect(pkg.version).toBe(manifest.version);
  });

  it('both READMEs advertise the shipped version', () => {
    for (const readme of [readmeDe, readmeEn]) {
      const badge = readme.match(/img\.shields\.io\/badge\/version-([\d.]+)-/);
      expect(badge).not.toBeNull();
      expect(badge[1]).toBe(manifest.version);
    }
  });

  it('both READMEs document the current release', () => {
    for (const readme of [readmeDe, readmeEn]) {
      expect(readme).toContain('### ' + manifest.version);
    }
  });

  it('the popup shows the version, read from the manifest rather than hard-coded', () => {
    expect(popupHtml).toContain('id="version"');
    expect(popupJs).toMatch(/getManifest\(\)\.version/);
    // A literal version string in popup.js would silently go stale.
    expect(popupJs).not.toMatch(/['"]\d+\.\d+\.\d+['"]/);
  });
});

describe('documentation integrity', () => {
  const readmes = { 'README.md': readmeDe, 'README_EN.md': readmeEn };

  it('references no image that is missing from the repo', () => {
    // A dead <img src> renders as a broken icon on GitHub and nobody notices.
    for (const [name, text] of Object.entries(readmes)) {
      const local = [...text.matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((src) => !/^https?:/.test(src));
      expect(local.length, name + ' references no local image').toBeGreaterThan(0);
      for (const src of local) {
        expect(fs.existsSync(path.resolve(src)), name + ' -> missing ' + src).toBe(true);
      }
    }
  });

  it('gives every screenshot alt text', () => {
    for (const [name, text] of Object.entries(readmes)) {
      for (const tag of text.match(/<img[^>]*>/g) || []) {
        expect(tag, name + ': <img> without alt').toMatch(/alt="[^"]+"/);
      }
    }
  });

  it('lists every test file, in both languages', () => {
    // The Tests section drifts silently as suites are added.
    const files = fs.readdirSync(path.resolve('test')).filter((f) => f.endsWith('.test.js'));
    expect(files.length).toBeGreaterThan(5);
    for (const [name, text] of Object.entries(readmes)) {
      for (const f of files) {
        expect(text, name + ' does not mention test/' + f).toContain('test/' + f);
      }
    }
  });

  it('documents no test file that no longer exists', () => {
    const files = new Set(fs.readdirSync(path.resolve('test')));
    for (const [name, text] of Object.entries(readmes)) {
      for (const m of text.matchAll(/`test\/([\w.-]+\.test\.js)`/g)) {
        expect(files.has(m[1]), name + ' documents a gone file: ' + m[1]).toBe(true);
      }
    }
  });
});

describe('footer contract', () => {
  it('carries the exact links the product promises', () => {
    expect(popupHtml).toContain('href="https://celox.io"');
    expect(popupHtml).toContain('href="https://g.page/r/CXgdRV3QysvxEBM/review"');
    expect(popupHtml).toContain('martin.pfeffer@celox.io');
  });

  it('escapes the ampersands in the donate URL', () => {
    // "&currency_code" would be parsed as the &curren; character reference.
    const href = popupHtml.match(/id="link-donate" href="([^"]+)"/)[1];
    expect(href).not.toMatch(/&(?!amp;)/);
  });
});

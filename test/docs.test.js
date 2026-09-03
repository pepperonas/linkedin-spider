import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Documentation that drifts from the code is worse than none: it teaches the
// wrong thing with authority. These guards keep the READMEs honest about the
// things that can be checked mechanically — structure, keys, permissions,
// links, parity between the two languages. What they cannot check is prose.
const DE = fs.readFileSync(path.resolve('README.md'), 'utf8');
const EN = fs.readFileSync(path.resolve('README_EN.md'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
const READMES = { 'README.md': DE, 'README_EN.md': EN };

const SOURCES = ['lib.js', 'content.js', 'popup.js', 'background.js', 'options.js']
  .map((f) => fs.readFileSync(path.resolve(f), 'utf8')).join('\n');

// GitHub's heading → anchor rule, close enough for headings without emoji.
function anchor(heading) {
  return heading.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function headings(text, level) {
  const re = new RegExp('^' + '#'.repeat(level) + ' (?!\\[)(.+)$', 'gm');
  return [...text.matchAll(re)].map((m) => m[1].trim()).filter((h) => !/^\d+\.\d+\.\d+/.test(h));
}

// The body of one `### ` subsection — a mention elsewhere (changelog, prose)
// is not an explanation.
function section(text, titleRe) {
  const m = text.match(new RegExp('^### (?:' + titleRe + ')\\n([\\s\\S]*?)(?=^##)', 'm'));
  return m ? m[1] : '';
}

function tocLinks(text) {
  const block = text.match(/<!-- toc -->([\s\S]*?)<!-- \/toc -->/);
  if (!block) return null;
  return [...block[1].matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
}

describe('table of contents', () => {
  for (const [name, text] of Object.entries(READMES)) {
    it(`${name} has a TOC that matches its section headings`, () => {
      const links = tocLinks(text);
      expect(links, name + ' has no <!-- toc --> block').not.toBeNull();
      const h2 = headings(text, 2).filter((h) => h !== 'Inhalt' && h !== 'Contents');
      const anchors = h2.map(anchor);
      for (const a of anchors) expect(links, `${name}: heading "${a}" missing from TOC`).toContain(a);
      for (const l of links) expect(anchors, `${name}: TOC link "#${l}" points nowhere`).toContain(l);
    });
  }

  it('uses no emoji in headings — GitHub anchors for those are unpredictable', () => {
    for (const [name, text] of Object.entries(READMES)) {
      for (const h of headings(text, 2).concat(headings(text, 3))) {
        expect(h, `${name}: "${h}"`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      }
    }
  });
});

describe('German and English stay in step', () => {
  it('have the same number of sections and subsections', () => {
    expect(headings(EN, 2).length).toBe(headings(DE, 2).length);
    expect(headings(EN, 3).length).toBe(headings(DE, 3).length);
  });
  it('carry the same diagrams', () => {
    const mermaid = (t) => [...t.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    expect(mermaid(DE).length).toBeGreaterThanOrEqual(2);
    expect(mermaid(EN).length).toBe(mermaid(DE).length);
  });
  it('reference the same images and the same version badge', () => {
    const imgs = (t) => [...t.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s)).sort();
    expect(imgs(EN)).toEqual(imgs(DE));
    const ver = (t) => t.match(/badge\/version-([\d.]+)-/)[1];
    expect(ver(EN)).toBe(ver(DE));
    expect(ver(DE)).toBe(manifest.version);
  });
  it('show the same number of badges', () => {
    const count = (t) => (t.match(/img\.shields\.io/g) || []).length;
    expect(count(EN)).toBe(count(DE));
    expect(count(DE)).toBeGreaterThanOrEqual(30);
  });
});

describe('what the code does is what the docs say', () => {
  const storageKeys = [...new Set([...SOURCES.matchAll(/['"](lc[A-Z][A-Za-z]+)['"]/g)].map((m) => m[1]))].sort();

  it('found the storage keys in the sources', () => {
    expect(storageKeys).toEqual(expect.arrayContaining(['lcLog', 'lcEvents', 'lcOps', 'lcOpsState', 'lcRecipe', 'lcCount']));
  });

  for (const [name, text] of Object.entries(READMES)) {
    it(`${name} documents every chrome.storage key the code uses — in the storage table`, () => {
      const table = section(text, 'Was gespeichert wird|What is stored');
      expect(table.length, name + ' has no storage section').toBeGreaterThan(200);
      for (const key of storageKeys) {
        expect(table, `${name}: storage key "${key}" is not in the storage table`).toContain('| `' + key + '` |');
      }
    });

    it(`${name} explains every permission the manifest asks for — in the permissions table`, () => {
      const table = section(text, 'Berechtigungen|Permissions');
      expect(table.length, name + ' has no permissions section').toBeGreaterThan(200);
      const perms = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];
      for (const p of perms) expect(table, `${name}: permission "${p}" not explained`).toContain('`' + p + '`');
      for (const p of manifest.optional_host_permissions || []) {
        expect(table, `${name}: optional permission "${p}" not explained`).toContain('`' + p + '`');
      }
    });

    it(`${name} states the minimum Chrome version the manifest enforces`, () => {
      expect(manifest.minimum_chrome_version).toMatch(/^\d+$/);
      expect(text).toContain('Chrome ' + manifest.minimum_chrome_version);
    });

    it(`${name} names every runtime file in its architecture table`, () => {
      const runtime = ['interceptor.js', 'lib.js', 'content.js', 'background.js', 'popup.html', 'popup.js',
        'options.html', 'options.js', 'options.css', 'styles.css', 'manifest.json', 'icon.png'];
      const table = text.slice(text.search(/^## (Architektur|Architecture)/m));
      for (const f of runtime) expect(table, `${name}: "${f}" missing from the architecture table`).toContain('`' + f + '`');
    });

    it(`${name} points at no missing local file`, () => {
      const links = [...text.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]).filter((l) => !/^https?:|^mailto:/.test(l));
      for (const l of links) expect(fs.existsSync(path.resolve(l)), `${name}: dead link ${l}`).toBe(true);
    });
  }
});

describe('badges tell the truth where a machine can check', () => {
  it('the weekly-quota badge matches the constant', () => {
    const LC = require('../lib.js');
    for (const text of Object.values(READMES)) {
      expect(text).toMatch(new RegExp('badge/[^"]*-' + LC.WEEKLY_QUOTA + '[^"]*'));
    }
  });
  it('the minimum-Chrome badge matches the manifest', () => {
    for (const text of Object.values(READMES)) {
      expect(text).toContain('Chrome-' + manifest.minimum_chrome_version + '%2B');
    }
  });
  it('never claims a Chrome Web Store listing or test coverage — neither exists', () => {
    // Saying "no store listing" in prose is honest; a badge or a store link
    // would be the lie. So only badge URLs and the store domain are forbidden.
    for (const text of Object.values(READMES)) {
      expect(text).not.toMatch(/chromewebstore\.google\.com|badge\/[^"\s]*(web[_-]?store|coverage)|codecov|coveralls/i);
    }
  });
  it('every shields URL is well-formed', () => {
    for (const [name, text] of Object.entries(READMES)) {
      for (const m of text.matchAll(/https:\/\/img\.shields\.io\/[^"\s)]+/g)) {
        expect(() => new URL(m[0]), `${name}: ${m[0]}`).not.toThrow();
        expect(m[0]).not.toMatch(/\s/);
      }
    }
  });
});

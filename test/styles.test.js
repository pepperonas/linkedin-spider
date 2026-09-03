import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const lib = fs.readFileSync(path.resolve('lib.js'), 'utf8');
const popupHtml = fs.readFileSync(path.resolve('popup.html'), 'utf8');

// --- WCAG relative luminance / contrast, on hex colours -------------------
function rgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex) {
  return rgb(hex).map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The `color:` of one rule in a flat stylesheet.
function colorOf(source, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = source.match(new RegExp('(?:^|[},])\\s*' + esc + '\\s*\\{([^}]*)\\}'));
  if (!block) return null;
  const m = block[1].match(/(?:^|;)\s*(?:color|fill)\s*:\s*(#[0-9a-fA-F]{3,6})/);
  return m ? m[1] : null;
}

const WHITE = '#ffffff';

describe('contrast of popup text on the white popup ground', () => {
  // #8a9199 shipped at 3.19:1 and was only caught by measuring in a browser.
  // These pin the floor so it cannot come back.
  const rules = ['.label', '.panel-title', '.sub', '.stat-label', '.chip', '.hint'];

  for (const sel of rules) {
    it(`${sel} meets the 4.5:1 floor for normal text`, () => {
      const color = colorOf(css, sel);
      expect(color, `no color found for ${sel}`).not.toBeNull();
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('large bold figures meet the 3:1 floor', () => {
    expect(contrast(colorOf(css, '.stat-value'), WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('never reintroduces the tone that failed the audit', () => {
    expect(css).not.toContain('#8a9199');
    expect(lib).not.toContain('#8a9199');
  });
});

describe('contrast on the options page', () => {
  const optionsCss = fs.readFileSync(path.resolve('options.css'), 'utf8');
  // The page ground is #f3f6f8, the cards are white — check each role on its own ground.
  it('help text and card headings meet 4.5:1 on the card', () => {
    for (const sel of ['.opt-help', '.opt-card h2', '.opt-field span', '.opt-stats span']) {
      const color = colorOf(optionsCss, sel);
      expect(color, `no color for ${sel}`).not.toBeNull();
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('the lead paragraph meets 4.5:1 on the page ground', () => {
    const bg = optionsCss.match(/body\.options\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,6})/)[1];
    expect(contrast(colorOf(optionsCss, '.options .lead'), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('the big figures meet 3:1', () => {
    expect(contrast(colorOf(optionsCss, '.opt-stats b'), WHITE)).toBeGreaterThanOrEqual(3);
  });
  it('the popup chip and ops-status tones meet 4.5:1', () => {
    for (const sel of ['.chip-btn', '.ops-status', '.ops-status.pending', '.ops-status.error', '.ops-status.ok']) {
      const color = colorOf(css, sel);
      expect(color, `no color for ${sel}`).not.toBeNull();
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrast inside the exported report', () => {
  // The report ships its own inline stylesheet — same floor applies there.
  // It lives inside JS string concatenation in lib.js — join the literals back
  // together, otherwise every rule but the first reads as missing.
  const reportCss = lib
    .slice(lib.indexOf('<style>'), lib.indexOf('</style>'))
    .replace(/'\s*\+\s*\n?\s*'/g, '');

  it('body copy and axis labels stay legible on the white page', () => {
    for (const sel of ['.sub', '.lc-ax,.lc-tick', '.lc-empty']) {
      const color = colorOf(reportCss, sel);
      expect(color, `no color for ${sel}`).not.toBeNull();
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the unreachable-tab warning', () => {
  // It sits on its own tinted ground, so it has to be measured against that,
  // not against the page white.
  it('is legible on its own background', () => {
    const fg = colorOf(css, '.status.warn');
    const block = css.match(/\.status\.warn\s*\{([^}]*)\}/)[1];
    const bg = block.match(/background:\s*(#[0-9a-fA-F]{3,6})/)[1];
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('does not reuse the "everything is fine" green', () => {
    expect(colorOf(css, '.status.warn')).not.toBe(colorOf(css, '.status.active'));
  });
});

describe('popup layout contract', () => {
  it('keeps the report, backup and restore buttons on one row', () => {
    const row = popupHtml.match(/<div class="btn-row">([\s\S]*?)<\/div>/)[1];
    for (const id of ['report', 'backup', 'restore']) {
      expect(row).toContain('id="' + id + '"');
    }
  });

  it('shows the three figures as a strip, not as three stacked rows', () => {
    // Three full-width rows pushed the footer past Chrome's 600px popup cap.
    expect(popupHtml).toContain('class="stats"');
    expect((popupHtml.match(/class="stat"/g) || []).length).toBe(3);
    expect(popupHtml).not.toContain('counter-row');
  });

  it('carries no styling for markup that no longer exists', () => {
    for (const dead of ['.counter-row', '.counter-label', '.counter-value']) {
      expect(css).not.toContain(dead + ' {');
    }
  });

  it('every element the popup script reaches for exists in the markup', () => {
    const js = fs.readFileSync(path.resolve('popup.js'), 'utf8');
    const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of new Set(ids)) {
      expect(popupHtml, `#${id} is missing from popup.html`).toContain('id="' + id + '"');
    }
  });

  it('respects prefers-reduced-motion for the one animated element', () => {
    expect(css).toMatch(/transition:\s*width/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fill\s*\{\s*transition:\s*none/);
  });
});

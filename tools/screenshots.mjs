/**
 * Reproducible pictures of the extension's own surfaces.
 *
 *     node tools/screenshots.mjs OUT_DIR
 *
 * Writes popup.html, options.html and report.html into OUT_DIR — each wired to a
 * chrome stub that serves INVENTED data — plus the assets they need. Serve the
 * folder (`python3 -m http.server`) and take element screenshots in a real
 * browser; see CLAUDE.md "Screenshots".
 *
 * Nothing here reads a real profile, a real token or a real log: every contact,
 * company and search term below is made up, so no one's name and no session
 * secret can end up in a picture. The version comes from package.json, so the
 * footer in the popup always shows the release the pictures belong to.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node tools/screenshots.mjs OUT_DIR');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const ASSETS = ['lib.js', 'popup.js', 'options.js', 'styles.css', 'options.css', 'icon.png'];
for (const a of ASSETS) copyFileSync(join(ROOT, a), join(OUT, a));

// A fixed "now" keeps the chart, the quota window and the report header identical
// on every run. 2026-09-06 12:00 local — a Sunday afternoon, mid-week quota.
const NOW = new Date('2026-09-06T12:00:00').getTime();
const DAY = 86400000;

// --- invented data ---------------------------------------------------------

const TERMS = [
  ['Kaufmännischer Leiter', 'Berlin', 100],
  ['Hausverwaltung', 'Berlin', 64],
  ['CTO', 'Frankfurt', 41],
  ['Geschäftsführer', 'Hamburg', 33],
  ['Steuerberater', 'München', 28],
];

// Sent requests over the last year, denser in the recent weeks.
const events = [];
for (let d = 364; d >= 0; d--) {
  const n = d > 180 ? (d % 5 === 0 ? 3 : 0) : d > 30 ? (d % 3 === 0 ? 6 : 0) : d % 7 === 6 ? 0 : 9;
  for (let i = 0; i < n; i++) events.push(NOW - d * DAY + i * 900000);
}

const KONTAKTE = [
  ['Andrea Vogt', 'Kaufmännische Leiterin', 'Nordlicht Facility GmbH', 'Berlin', 'Kaufmännischer Leiter'],
  ['Kerem Yildiz', 'Geschäftsführer', 'Yildiz Immobilienverwaltung', 'Berlin', 'Hausverwaltung'],
  ['Sabine Reuter', 'CTO', 'Auripay Systems AG', 'Frankfurt', 'CTO'],
  ['Tobias Lindner', 'Prokurist', 'Hansen & Partner mbB', 'Hamburg', 'Geschäftsführer'],
  ['Miriam Grote', 'Steuerberaterin', 'Kanzlei Grote Wenzel', 'München', 'Steuerberater'],
  ['Paul Ehrhardt', 'Leiter Objektbetreuung', 'Spreekiez Verwaltung eG', 'Berlin', 'Hausverwaltung'],
];
const records = KONTAKTE.map(([name, headline, company, location, term], i) => ({
  ts: new Date(NOW - (i + 1) * 5400000).toISOString(),
  name,
  profileUrl: 'https://www.linkedin.com/in/' + name.toLowerCase().replace(/[^a-z]+/g, '-') + '-demo',
  headline,
  company,
  location,
  degree: '2nd',
  profileId: 'ACoAAA' + String(1000 + i),
  method: i % 3 === 0 ? 'click' : 'api',
  searchQuery: term + ' ' + location,
  pageUrl: 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(term),
}));

const stats = {};
for (const [term, city, n] of TERMS) {
  stats[term + '|' + city] = { term, city, n, first: NOW - 200 * DAY, last: NOW - DAY };
}

const STORE = {
  lcEnabled: true,
  lcCount: events.length,
  lcLog: records,
  lcEvents: events,
  lcRange: '7d',
  lcStats: stats,
  lcTerms: TERMS.map(([t]) => t),
  lcCities: ['Berlin', 'Hamburg', 'Frankfurt', 'München'],
  lcCity: 'Berlin',
  lcPace: { jitter: true, perHour: 20, perDay: 60, stopAtPercent: 90 },
  // A token is only ever a placeholder here — the picture must not carry one.
  lcOps: { baseUrl: 'https://ops.celox.io', token: '' },
  lcOpsState: {},
  lcOpsLast: null,
  lcUpdate: null,
  lcBlock: null,
  lcRecipe: null,
  lcSeen: {},
};

// --- the chrome stub -------------------------------------------------------

const stub = `<script>
// Demo stand-in for the extension APIs — see tools/screenshots.mjs.
(function () {
  var DATA = ${JSON.stringify(STORE)};
  var NOW = ${NOW};
  var _Date = Date;
  // Freeze the clock: the quota window, the chart axis and the report header
  // must read the same on every run.
  window.Date = class extends _Date {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  };
  function pick(keys) {
    if (keys == null) return Object.assign({}, DATA);
    var list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
    var out = {};
    list.forEach(function (k) { if (k in DATA) out[k] = DATA[k]; });
    return out;
  }
  window.chrome = {
    runtime: {
      lastError: null,
      id: 'demo',
      getManifest: function () { return { version: '${VERSION}' }; },
      sendMessage: function (msg, cb) { if (cb) cb({ ok: true }); },
      openOptionsPage: function () {},
      onMessage: { addListener: function () {} },
    },
    storage: {
      local: {
        get: function (keys, cb) { cb(pick(keys)); },
        set: function (obj, cb) { Object.assign(DATA, obj); if (cb) cb(); },
        remove: function (k, cb) { if (cb) cb(); },
      },
    },
    tabs: {
      query: function (q, cb) { cb([{ id: 1, url: 'https://www.linkedin.com/search/results/people/' }]); },
      sendMessage: function (id, msg, cb) {
        if (cb) cb({ active: true, count: DATA.lcCount, healed: true, halted: null, paused: null, blocked: 0 });
      },
    },
    downloads: { download: function () {} },
    permissions: {
      contains: function (p, cb) { cb(true); },
      request: function (p, cb) { cb(true); },
    },
  };
})();
</script>
`;

// Chromium malt seine Scroll-Leiste mit ins Bild; die Bühne auf celox.io zeichnet
// ihren eigenen Rahmen und hätte den Balken sonst mitten drin.
const noScrollbar = '<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>\n';

function withStub(name) {
  const html = readFileSync(join(ROOT, name), 'utf8');
  const marker = '<script src="lib.js">';
  if (!html.includes(marker)) throw new Error(`${name}: kein lib.js-Script gefunden`);
  writeFileSync(join(OUT, name), html.replace('</head>', noScrollbar + '</head>').replace(marker, stub + marker));
  console.log(name);
}
withStub('popup.html');
withStub('options.html');

// The popup is 300 px wide and taller than it is wide. Shown on its own, the
// project stage on celox.io would put a PORTRAIT picture into a phone frame — a
// browser-extension popup in a phone is a lie. So it gets the stage it really
// has: hanging off the toolbar, over the page behind it.
writeFileSync(join(OUT, 'popup-stage.html'), `<!doctype html><meta charset="utf-8">
<title>LinkedIn Spider popup</title>
${noScrollbar}<style>
  html,body{margin:0}
  #stage{width:1000px;height:640px;box-sizing:border-box;position:relative;overflow:hidden;
    background:#eef3f8 radial-gradient(1200px 400px at 78% -8%, #dce9f6, transparent 70%);}
  #bar{height:46px;background:#f6f8fa;border-bottom:1px solid #dbe1e8;display:flex;align-items:center;
    justify-content:flex-end;gap:10px;padding:0 18px}
  #bar .dot{width:26px;height:26px;border-radius:7px;background:#e3e8ee}
  #bar .me{width:26px;height:26px;border-radius:7px;overflow:hidden}
  #bar .me img{width:100%;height:100%;display:block}
  iframe{position:absolute;top:56px;right:24px;width:300px;height:${'${POPUP_H}'}px;border:0;
    border-radius:10px;box-shadow:0 18px 46px -12px rgba(16,32,56,.42);background:#fff}
</style>
<div id="stage">
  <div id="bar"><span class="dot"></span><span class="dot"></span><span class="me"><img src="icon.png" alt=""></span></div>
  <iframe src="popup.html" title="LinkedIn Spider popup"></iframe>
</div>
`.replace('${POPUP_H}', '592'));
console.log('popup-stage.html');

// --- the exported report ---------------------------------------------------
// Rendered by the shipped reportHtml(), so the picture shows what the button
// writes. lib.js is a browser IIFE that hangs itself on `window`.
global.window = global;
await import('file://' + join(ROOT, 'lib.js'));
const LC = global.LC;
const buckets = LC.bucketEvents(events, LC.rangeByKey('30d').key, NOW);
const reportHtml = LC.reportHtml({
  quota: LC.weekQuota(events, NOW),
  buckets,
  records,
  stats,
  rangeLabel: LC.rangeByKey('30d').label,
  generatedAt: new Date(NOW),
  version: VERSION,
});
writeFileSync(join(OUT, 'report.html'), reportHtml.replace('</head>', noScrollbar + '</head>'));
console.log('report.html');

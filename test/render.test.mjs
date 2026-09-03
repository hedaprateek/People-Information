/**
 * Runs the whole of index.html against the real data.xlsx in a DOM shim.
 *
 *   node test/render.test.mjs
 *
 * A syntax check cannot catch a shadowed variable, a renamed helper or a
 * mistyped property — the page parses fine and then throws at runtime. This
 * loads the real spreadsheet, runs the real script, and asserts on what
 * actually ends up in the DOM.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFileSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";

// SheetJS is loaded from a CDN by the page itself; cache a copy for tests.
const CACHE = join(HERE, ".cache");
const LIB = join(CACHE, "xlsx.js");
if (!fs.existsSync(LIB)) {
  fs.mkdirSync(CACHE, { recursive: true });
  console.log("fetching SheetJS for the test (once)...");
  try {
    execFileSync("curl", ["-sSL", "-o", LIB,
      "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"], { stdio: "inherit" });
  } catch (e) {
    console.error("Could not download SheetJS. Fetch it manually into test/.cache/xlsx.js:\n" +
      "  curl -sSL -o test/.cache/xlsx.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js");
    process.exit(2);
  }
}
const XLSX = (await import("file://" + LIB.replace(/\\/g, "/"))).default;

/* ---------------- minimal DOM ---------------- */
class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this.dataset = {};
    this._text = ""; this.className = ""; this.hidden = false; this.id = "";
  }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  scrollIntoView() {}
  focus() {}
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || "").join(""); }
  set href(v) { this.attrs.href = v; } get href() { return this.attrs.href; }
  set title(v) { this.attrs.title = v; } get title() { return this.attrs.title; }
  set placeholder(v) { this.attrs.placeholder = v; } get placeholder() { return this.attrs.placeholder; }
  set src(v) { this.attrs.src = v; }
  set value(v) { this._value = v; } get value() { return this._value || ""; }
  get classList() {
    const self = this;
    return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
  }
  querySelector() { return new El("div"); }
  querySelectorAll() { return []; }
}

const byId = {};
const ids = ["app","main","pSos","pDocs","q","vbar","tiles","tabbar","qClear","brandName","footName","brandDot","footDot",
  "heroEyebrow","langBtn","heroTitle","heroLede","footAddr","footReg","heroStats",
  "navLinks","footLinks","sosCta","banner","searchbar","railFill","navToggle",
  "shareBtn","topBtn","footUpd","crest","scopeTag","stats","nav","navIn","bar","foot",
  // The footer's three columns and the list/grid switch. An id the page uses
  // and the harness does not have reads as null, and chrome() throws on it.
  "footSecHead","footNotesHead","footNotes","vswitch"];
ids.forEach(i => { const e = new El("div"); e.id = i; byId[i] = e; });

const footCol = () => { const c = new El("div"); c.querySelector = () => new El("h5");
  c.querySelectorAll = () => [new El("a"), new El("a")]; return c; };

globalThis.document = {
  documentElement: new El("html"),
  createElement: t => new El(t),
  createElementNS: (_n, t) => new El(t),
  createTextNode: t => ({ textContent: String(t), children: [] }),
  getElementById: id => byId[id] || null,
  querySelector: sel => sel === ".foot-col h5" ? new El("h5") : new El("div"),
  querySelectorAll: sel => sel === ".foot-col" ? [footCol(), footCol()] : [],
  addEventListener() {}
};
globalThis.window = globalThis;
// node defines navigator as a getter-only global
Object.defineProperty(globalThis, "navigator", { value: { language: "en-GB" }, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k){ return this._d[k] ?? null; },
  setItem(k, v){ this._d[k] = String(v); }, removeItem(k){ delete this._d[k]; } };
globalThis.location = { search: "", hash: "", pathname: "/", origin: "https://x", protocol: "https:", href: "https://x/" };
globalThis.history = { pushState(){}, replaceState(){} };
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = fn => fn();
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.XLSX = XLSX;
globalThis.alert = () => {};

const bytes = fs.readFileSync(ROOT + "data.xlsx");
let fetchErr = null;
globalThis.fetch = async () => ({
  ok: true, status: 200,
  headers: { get: n => (/^date$/i.test(n) ? "Tue, 25 Aug 2026 09:00:00 GMT" : null) },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
});

/* ---------------- run the page ---------------- */
const html = fs.readFileSync(ROOT + "index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");

const errors = [];
process.on("unhandledRejection", e => errors.push("unhandledRejection: " + (e && e.message || e)));

try { new Function(script)(); }
catch (e) { errors.push("threw immediately: " + e.message); }

await new Promise(r => setTimeout(r, 300));   // let the fetch chain settle


/* what the spreadsheet says should appear */
const book = XLSX.read(bytes, { type: "buffer" });
const aboutRows = XLSX.utils.sheet_to_json(book.Sheets["About"] || {}, { defval: "", raw: false });
const about = {};
aboutRows.forEach(r => { const k = Object.keys(r); about[String(r[k[0]]).trim().toLowerCase()] = String(r[k[1]]).trim(); });
const expectedName = about["society name"] || about["name"] || "";
const hasConfidential = Object.keys(about).some(k => /^confidential/.test(k));
// Underscore sheets are deliberately never published, so they must NOT appear.
const sheetNames = book.SheetNames.filter(n => n.charAt(0) !== "_" && !/^(about|society|info|details|header)$/i.test(n));
const hiddenSheets = book.SheetNames.filter(n => n.charAt(0) === "_");
// A section is renamed when Hindi is on, so look for the name actually shown.
const usingHindi = String(navigator.language || "").toLowerCase().startsWith("hi");
const shownName = n => (usingHindi && about["hindi: " + n.toLowerCase()]) || n;

/* ---------------- assertions ---------------- */
let fails = 0;
const t = (l, g, e) => { const ok = String(g) === String(e); if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0, 34)}`); };

/* The two dictionaries are plain object literals, so a key defined twice is
   silently won by the later one — no error, no warning, just the wrong word
   on screen. That is how the language button came to read "Other": a
   grouping label reused the key holding "हिं". */
console.log("translation dictionaries");
{
  const src = fs.readFileSync(ROOT + "index.html", "utf8");
  const dicts = [...src.matchAll(/\n    (en|hi):\s*\{([\s\S]*?)\n    \}/g)];
  const keysOf = b => [...b.matchAll(/(?:^|[{,\s])([A-Za-z][A-Za-z0-9]*)\s*:/g)].map(m => m[1]);
  t("both dictionaries found", dicts.length, 2);
  if (dicts.length === 2) {
    for (const [, lang, body] of dicts) {
      const keys = keysOf(body);
      const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
      t(`no key defined twice in ${lang} (${keys.length})`, dupes.join(",") || "none", "none");
    }
    // Both languages must answer the same keys, or one falls through to the
    // raw key name and English leaks into a Hindi page.
    const en = new Set(keysOf(dicts[0][2])), hi = new Set(keysOf(dicts[1][2]));
    const gap = [...en].filter(k => !hi.has(k)).concat([...hi].filter(k => !en.has(k)));
    t("every key exists in both", gap.join(",") || "matched", "matched");
  }
}

t("no runtime errors", errors.join(" | ") || "none", "none");

const main = byId.main;
const rendered = main.textContent;
t("main column rendered something", rendered.length > 0, true);
t("society name from the sheet", byId.brandName.textContent, expectedName);
t("hero title populated", byId.heroTitle.textContent.replace(/\s+/g, " ").trim(), expectedName);
t("every sheet reached the page", sheetNames.filter(n =>
       !(rendered + byId.pSos.textContent + byId.pDocs.textContent).includes(shownName(n))), "");
t("nav has one link per sheet", byId.navLinks.children.length, sheetNames.length);
t("no duplicate section ids", (() => {
       const ids = byId.navLinks.children.map(a => a.dataset.id);
       return ids.length - new Set(ids).size;
     })(), 0);
t("phone numbers became call links", /tel:/.test(JSON.stringify(main)), true);
t("main column has cards", rendered.length > 200, true);
const sosSheets = sheetNames.filter(n => /emerg|sos|urgent|on.?call|helpline|24x7/i.test(n));
t(sosSheets.length ? "emergency panel not empty" : "no urgent sheet, no panel",
  byId.pSos.textContent.length > 0, sosSheets.length > 0);
const docSheets = sheetNames.filter(n => {
  const rows = XLSX.utils.sheet_to_json(book.Sheets[n], { defval: "", raw: false });
  return Object.keys(rows[0] || {}).some(c => /^(file|link|url|path|attachment|download)$/i.test(c.replace(/[^a-z]/gi, "")));
});
t(docSheets.length ? "documents panel not empty" : "no document sheet, no panel",
  byId.pDocs.textContent.length > 0, docSheets.length > 0);
t("society name is not blank", expectedName.length > 0, true);
t("underscore sheets stay hidden", hiddenSheets.filter(n =>
    (rendered + byId.pSos.textContent + byId.pDocs.textContent).includes(n.replace(/^_/, ""))), "");
t(hasConfidential ? "confidentiality banner shown" : "no banner (none in About sheet)",
     byId.banner.textContent.length > 20, hasConfidential);
t("footer updated stamp set", byId.footUpd.textContent.length > 0, true);
t("nav links built", byId.navLinks.children.length > 0, true);
t("search placeholder set", (byId.q.placeholder || "").length > 0, true);

if (errors.length) { console.log("\n  errors:"); errors.forEach(e => console.log("   " + e)); }
console.log(fails ? `\n  ${fails} FAILED` : "\n  page renders cleanly");
process.exit(fails ? 1 : 0);

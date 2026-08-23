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
const ids = ["app","main","pSos","pDocs","q","brandName","footName","brandDot","footDot",
  "heroEyebrow","langBtn","heroTitle","heroLede","footAddr","footReg","heroStats",
  "navLinks","footLinks","sosCta","banner","searchbar","railFill","navToggle",
  "shareBtn","topBtn","footUpd","crest","scopeTag","stats","nav","navIn","bar","foot"];
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

/* ---------------- assertions ---------------- */
let fails = 0;
const t = (l, g, e) => { const ok = String(g) === String(e); if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0, 34)}`); };

t("no runtime errors", errors.join(" | ") || "none", "none");

const main = byId.main;
const rendered = main.textContent;
t("main column rendered something", rendered.length > 0, true);
t("shows the society name", byId.brandName.textContent, "Green Valley Residency");
t("hero title populated", byId.heroTitle.textContent.includes("Green Valley"), true);
t("Committee section present", rendered.includes("Committee"), true);
t("Residents section present", rendered.includes("Residents"), true);
t("Services & Help present", rendered.includes("Services & Help"), true);
t("a resident name rendered", rendered.includes("Anil Kulkarni"), true);
t("a charge badge rendered", rendered.includes("50 / visit"), true);
t("owner block rendered", rendered.includes("Rajesh Menon"), true);
t("emergency went to the sidebar", byId.pSos.textContent.includes("Ambulance"), true);
t("documents went to the sidebar", byId.pDocs.textContent.includes("Bye-Laws"), true);
t("confidentiality banner shown", byId.banner.textContent.length > 20, true);
t("footer updated stamp set", byId.footUpd.textContent.length > 0, true);
t("nav links built", byId.navLinks.children.length > 0, true);
t("search placeholder set", (byId.q.placeholder || "").length > 0, true);

if (errors.length) { console.log("\n  errors:"); errors.forEach(e => console.log("   " + e)); }
console.log(fails ? `\n  ${fails} FAILED` : "\n  page renders cleanly");
process.exit(fails ? 1 : 0);

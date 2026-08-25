/**
 * Searching used to rebuild the page on every keystroke, which changes the
 * document height and makes a phone jump back to the top. These checks pin the
 * behaviour that fixed it: cards are built once and only hidden or shown.
 *
 *   node test/search.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFileSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";
const CACHE = join(HERE, ".cache");
const LIB = join(CACHE, "xlsx.js");
if (!fs.existsSync(LIB)) {
  fs.mkdirSync(CACHE, { recursive: true });
  execFileSync("curl", ["-sSL", "-o", LIB,
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"], { stdio: "inherit" });
}
const XLSX = (await import("file://" + LIB.replace(/\\/g, "/"))).default;

/* ---------------- DOM shim that tracks how often things are created ------- */
let created = 0;
class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this.dataset = {};
    this._text = ""; this.hidden = false; this.id = "";
    this._classes = new Set(); this.open = false;
    created++;
  }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  // className and classList must be the same thing, or a class added by one
  // silently erases classes set by the other.
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() { return [...this._classes].join(" "); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "class") this.className = String(v);
  }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { (this._on = this._on || {})[ev] = fn; }
  scrollIntoView() {} focus() {}
  // _top lets a test place an element above or below the fold.
  getBoundingClientRect() { return { top: this._top || 0, bottom: 0, left: 0, right: 0 }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || "").join(""); }
  set href(v) { this.attrs.href = v; } set title(v) { this.attrs.title = v; }
  set placeholder(v) { this.attrs.placeholder = v; } get placeholder() { return this.attrs.placeholder; }
  set src(v) { this.attrs.src = v; } set alt(v) {} set loading(v) {} set onerror(v) {}
  set value(v) { this._value = v; } get value() { return this._value || ""; }
  get classList() {
    const s = this._classes;
    return {
      add(c) { s.add(c); },
      remove(c) { s.delete(c); },
      contains(c) { return s.has(c); },
      toggle(c) { s.has(c) ? s.delete(c) : s.add(c); return s.has(c); }
    };
  }
  querySelector(sel) {
    // ".cls" matches a class, anything else is treated as a tag name
    const byClass = sel.charAt(0) === ".";
    const want = byClass ? sel.slice(1) : sel.toUpperCase();
    const hit = n => byClass
      ? (n.className || "").split(" ").includes(want)
      : n.tagName === want;
    const walk = n => {
      for (const c of n.children) { if (hit(c)) return c; const d = walk(c); if (d) return d; }
      return null;
    };
    return walk(this);
  }
  querySelectorAll() { return []; }
}
const byId = {};
["app","main","pSos","pDocs","q","brandName","footName","brandDot","footDot","heroEyebrow",
 "langBtn","heroTitle","heroLede","footAddr","footReg","heroStats","navLinks","footLinks",
 "sosCta","banner","searchbar","railFill","navToggle","shareBtn","topBtn","footUpd","crest"]
  .forEach(i => { const e = new El("div"); e.id = i; byId[i] = e; });

globalThis.document = {
  documentElement: new El("html"),
  createElement: t => new El(t),
  createElementNS: (_n, t) => new El(t),
  createTextNode: t => ({ textContent: String(t), children: [] }),
  // Sections get their id at build time, so a fixed lookup table is not
  // enough — anything jumping to a section by id would silently find nothing.
  getElementById(id) {
    if (byId[id]) return byId[id];
    const walk = n => {
      for (const c of n.children || []) {
        if (c.id === id) return c;
        const d = walk(c);
        if (d) return d;
      }
      return null;
    };
    return walk(byId.main) || walk(byId.app) || null;
  },
  querySelector: () => new El("div"),
  querySelectorAll: () => [],
  addEventListener() {}
};
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { language: "en-GB" }, configurable: true });
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k] ?? null;},
  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
globalThis.location = { search:"", hash:"", pathname:"/", origin:"https://x", protocol:"https:", href:"https://x/" };
globalThis.history = { pushState(){}, replaceState(){} };
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = fn => fn();
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.XLSX = XLSX;
globalThis.alert = () => {};

// desktop by default; the accordion test flips this
let narrow = false;
globalThis.matchMedia = q => ({ matches: /max-width:700px/.test(q) ? narrow : false });

/* ---------------- data ---------------- */
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
  [{ Field: "Society Name", Value: "Test Society" }]), "About");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
  Array.from({ length: 12 }, (_, i) => ({
    Name: "Resident " + (i + 1), Block: "A", Flat: "A-" + (101 + i),
    Phone: "+91 98330 400" + String(11 + i).padStart(2, "0"),
    Email: "", Type: i % 4 === 0 ? "Tenant" : "Owner",
    Profession: i === 3 ? "Cardiologist" : "Engineer"
  }))), "Residents");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
  [{ Title: "Bye-Laws", Category: "Governance", File: "materials/x.pdf", Notes: "" },
   { Title: "AGM Minutes", Category: "Governance", File: "materials/y.pdf", Notes: "" }]),
  "Documents");
const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
globalThis.fetch = async () => ({ ok: true, status: 200,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

/* ---------------- run the page ---------------- */
const html = fs.readFileSync(ROOT + "index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
new Function(script)();
await new Promise(r => setTimeout(r, 250));

let fails = 0;
const t = (l, g, e) => { const ok = String(g) === String(e); if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(48)} ${String(g).slice(0, 20)}`); };

const q = byId.q;
const cards = () => {
  const out = [];
  const walk = n => { for (const c of n.children) {
    if ((c.className || "").split(" ").includes("ccard")) out.push(c); else walk(c); } };
  walk(byId.main);
  return out;
};
const visible = () => cards().filter(c => !c.hidden).length;

console.log("filtering does not rebuild");
const all = cards();
t("all rows rendered up front", all.length, 12);
const madeBefore = created;

q.value = "cardiolog";
q._on.input();
t("nothing new was created", created, madeBefore);
t("same card objects reused", cards()[0] === all[0], true);
t("only the match is visible", visible(), 1);

q.value = "";
q._on.input();
t("clearing restores everything", visible(), 12);
t("still no new elements", created, madeBefore);

console.log("\ncounts follow the filter");
q.value = "resident 1";
q._on.input();
const shown = visible();
t("count in the heading matches", byId.main.querySelector(".n").textContent, String(shown));
q.value = "zzzznothing";
q._on.input();
t("no matches hides every card", visible(), 0);
t("and the section itself", byId.main.querySelector(".sec").hidden, true);
q.value = "";
q._on.input();

console.log("\naccordion on a narrow screen");
narrow = true;
globalThis.localStorage.removeItem("dir-open");
new Function(script)();
await new Promise(r => setTimeout(r, 250));
const sec = byId.main.querySelector(".sec");
t("a long section starts folded", sec.classList.contains("closed"), true);
t("header is reachable by keyboard", byId.main.querySelector(".sec-head").getAttribute("tabindex"), "0");
t("header reports its state", byId.main.querySelector(".sec-head").getAttribute("aria-expanded"), "false");

byId.main.querySelector(".sec-head")._on.click();
t("tapping opens it", sec.classList.contains("closed"), false);
t("choice is remembered", globalThis.localStorage.getItem("dir-open").includes("residents"), true);

byId.main.querySelector(".sec-head")._on.click();
t("tapping again folds it", sec.classList.contains("closed"), true);
byId.q.value = "cardiolog";
byId.q._on.input();
t("searching unfolds a section with matches", sec.classList.contains("closed"), false);


console.log("\ndocuments open on demand");
const dp = byId.pDocs.querySelector(".docs");
const dh = byId.pDocs.querySelector("h3");
t("documents panel starts shut", dp.classList.contains("closed"), true);
t("its heading is a control", dh.getAttribute("role"), "button");
t("heading reports its state", dh.getAttribute("aria-expanded"), "false");
t("the count is still readable", byId.pDocs.querySelector(".cap").textContent.length > 0, true);
dh._on.click();
t("tapping opens it", dp.classList.contains("closed"), false);
t("and it says so", dh.getAttribute("aria-expanded"), "true");
dh._on.click();
t("tapping again shuts it", dp.classList.contains("closed"), true);


/* The counts in the hero are the quickest route into a section. On a phone
   most sections start folded, so jumping to one has to unfold it first —
   otherwise the tap lands on a bare heading with nothing under it. */
console.log("\ntapping a count jumps to its section");
narrow = true;
globalThis.localStorage.removeItem("dir-open");
byId.q.value = "";          // a leftover term would unfold everything on build
new Function(script)();
await new Promise(r => setTimeout(r, 250));

const stats = byId.heroStats.children;
t("a stat per section, capped at four", stats.length > 0 && stats.length <= 4, true);
t("each is a link", stats[0].tagName, "A");
t("pointing at its section", stats[0].getAttribute("href").charAt(0), "#");
t("the count is the number of rows", stats[0].querySelector(".num").textContent, "12");

const jumped = [];
const secEl = byId.main.querySelector(".sec");
secEl.scrollIntoView = () => jumped.push(secEl.id);
t("the section it points at is folded", secEl.classList.contains("closed"), true);

const toStat = [].slice.call(stats).filter(s => s.getAttribute("href") === "#" + secEl.id)[0];
t("a stat points at it", !!toStat, true);
toStat._on.click({ preventDefault() {} });
t("tapping unfolds it", secEl.classList.contains("closed"), false);
t("and scrolls to it", jumped.length, 1);
t("the choice is remembered", globalThis.localStorage.getItem("dir-open").includes(secEl.id), true);


/* Folding a section removes everything below its header. If the reader had
   scrolled past that header, the page shortens underneath them and they end up
   somewhere unrelated — so a fold from below the fold pulls the header back. */
console.log("\nfolding does not throw the reader");
narrow = true;
globalThis.localStorage.removeItem("dir-open");
byId.q.value = "";
new Function(script)();
await new Promise(r => setTimeout(r, 250));

const fSec = byId.main.querySelector(".sec");
const fHead = byId.main.querySelector(".sec-head");
const pulled = [];
fSec.scrollIntoView = () => pulled.push(1);

if (fSec.classList.contains("closed")) fHead._on.click();   // start open
t("open to begin with", fSec.classList.contains("closed"), false);

fSec._top = 0;                       // header still on screen
pulled.length = 0;
fHead._on.click();
t("folded", fSec.classList.contains("closed"), true);
t("header on screen: no scroll", pulled.length, 0);

fHead._on.click();                   // open again
fSec._top = -820;                    // scrolled well past the header
pulled.length = 0;
fHead._on.click();
t("folded from below the fold", fSec.classList.contains("closed"), true);
t("the header is pulled back", pulled.length, 1);

// Opening never scrolls — nothing moves out from under the reader.
fSec._top = -820;
pulled.length = 0;
fHead._on.click();
t("opening leaves the scroll alone", pulled.length, 0);


/* Filtering sets .hidden on cards. Any class that declares its own display
   outranks the browser's [hidden] rule, so without an explicit override the
   search runs correctly and nothing disappears — which is exactly how it
   broke once. This checks the stylesheet, which the DOM shim cannot. */
console.log("\nhiding actually hides");
const css = fs.readFileSync(ROOT + "index.html", "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
t("[hidden] is forced", /\[hidden\]\{display:none!important\}/.test(css), true);

// anything that sets its own display and can be filtered must be covered
const risky = [...css.matchAll(/\.(ccard|prow|sec|panel)\{[^}]*display:/g)].map(m => m[1]);
t("classes with their own display are known", risky.length > 0, true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

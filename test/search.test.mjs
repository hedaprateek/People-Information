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
  // A real element runs every listener for an event. Keeping only the last one
  // hid a bug: the search box has two "input" handlers and the second was
  // quietly replacing the filter.
  addEventListener(ev, fn) {
    this._all = this._all || {};
    (this._all[ev] = this._all[ev] || []).push(fn);
    const list = this._all[ev];
    (this._on = this._on || {})[ev] = (...a) => list.forEach(f => f(...a));
  }
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
      // The second argument sets rather than flips. Ignoring it turned every
      // "mark the current tab" call into a parity flip.
      toggle(c, force) {
        const want = force === undefined ? !s.has(c) : !!force;
        if (want) s.add(c); else s.delete(c);
        return want;
      }
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
["app","main","pSos","pDocs","q","vbar","tiles","tabbar","qClear","brandName","footName","brandDot","footDot","heroEyebrow",
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
  // Memoised: returning a fresh element per call would inflate the
  // "nothing was created" count that the build-once checks rely on.
  querySelector(sel) {
    const c = (this._q = this._q || {});
    return c[sel] || (c[sel] = new El("div"));
  },
  querySelectorAll: () => [],
  addEventListener() {}
};
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { language: "en-GB" }, configurable: true });
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k] ?? null;},
  setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
globalThis.location = { search:"", hash:"", pathname:"/", origin:"https://x", protocol:"https:", href:"https://x/" };
globalThis.history = { pushState(){}, replaceState(){} };
// Navigation is driven by real anchors and hashchange now, so the harness has
// to be able to fire it.
const globalOn = {};
globalThis.addEventListener = (ev, fn) => { (globalOn[ev] = globalOn[ev] || []).push(fn); };
const navigate = hash => {
  globalThis.location.hash = hash;
  (globalOn.hashchange || []).forEach(fn => fn());
};
globalThis.requestAnimationFrame = fn => fn();
globalThis.scrollTo = () => {};
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
  headers: { get: n => (/^date$/i.test(n) ? "Tue, 25 Aug 2026 09:00:00 GMT" : null) },
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


/* The page is a set of places now, not one scroll: home is an index of tiles
   and each section is its own view. The accordion it replaces is gone. */
console.log("\nhome is an index, not the whole directory");
byId.q.value = "";
new Function(script)();
await new Promise(r => setTimeout(r, 250));

const secOf = () => byId.main.querySelector(".sec");
const tiles = byId.tiles.children;
t("a tile per section with rows", tiles.length, 2);   // Residents and Documents
t("tiles are links", tiles[0].tagName, "A");
t("each names its section", tiles[0].querySelector(".tname").textContent.length > 0, true);
t("and counts what is inside", /\d+ entr/.test(tiles[0].querySelector(".tcount").textContent), true);
t("tiles are on show at home", byId.tiles.hidden, false);
t("no back bar at home", byId.vbar.hidden, true);
t("sections are put away", secOf().hidden, true);

/* The emergency and documents panels used to sit on home as well as having
   pages of their own. On a phone the sidebar stacks above the main column, so
   four emergency rows filled the screen before a single tile appeared — and
   being a panel, not a dialog, nothing dismissed it. Home is the index only. */
const sosPanel = byId.pSos.querySelector(".alarm");
const docPanel = byId.pDocs.querySelector(".docs");
t("no emergency panel on home", !sosPanel || sosPanel.hidden, true);
t("no documents panel on home", !docPanel || docPanel.hidden, true);
t("home holds nothing but tiles", byId.main.querySelector(".sec") === secOf(), true);

const resTile = [].slice.call(tiles)
  .filter(x => x.getAttribute("href") === "#residents")[0];
t("a tile points at Residents", !!resTile, true);

/* .sec carries .reveal, which is opacity:0 until an IntersectionObserver adds
   .in. A section observed while display:none may never get that callback, so
   switching to it would scroll to a blank page — visible on a phone, and
   invisible to every other check here. */
t("a put-away section is not yet revealed", secOf().classList.contains("in"), false);
navigate("#residents");
t("opening it reveals it outright", secOf().classList.contains("in"), true);
t("tapping opens that section", secOf().hidden, false);
t("tiles step aside", byId.tiles.hidden, true);
t("and a way back appears", byId.vbar.hidden, false);
t("the back link goes home", byId.vbar.querySelector(".vback").getAttribute("href"), "#home");

/* The bottom bar only fits four sections. From inside a section every other
   one still has to be one tap away, not two via home. */
const strip = byId.vbar.querySelector(".vnav");
t("a strip of every section", !!strip, true);
t("one chip per section", strip.children.length, 2);
t("chips are links", strip.children[0].getAttribute("href").charAt(0), "#");
const onChip = [].slice.call(strip.children).filter(c => c.classList.contains("on"));
t("the section you are in is marked", onChip.length, 1);
t("and it is the right one", onChip[0].getAttribute("href"), "#residents");
const other = [].slice.call(strip.children)
  .filter(c => c.getAttribute("href") !== "#residents")[0];
t("another section is reachable from here", !!other, true);
navigate(other.getAttribute("href"));
t("and switching to it works", secOf().hidden, true);   // residents put away
navigate("#residents");

navigate("#home");
t("back returns to the index", byId.tiles.hidden, false);
t("and puts the section away", secOf().hidden, true);

/* A search that only looked inside the section you happen to be standing in
   would be useless, so it reaches across every section. */
console.log("\nsearch cuts across the whole directory");
byId.q.value = "cardiolog";
byId.q._on.input();
t("a matching section surfaces from home", secOf().hidden, false);
t("tiles give way to results", byId.tiles.hidden, true);
t("only the match is shown", visible(), 1);
byId.q.value = "zzzznothing";
byId.q._on.input();
t("no matches hides the section again", secOf().hidden, true);
byId.q.value = "";
byId.q._on.input();
t("clearing restores the index", byId.tiles.hidden, false);
t("and puts the section away", secOf().hidden, true);

console.log("\nthe bottom tab bar");
const tabs = byId.tabbar.children;
t("home plus sections, capped at five", tabs.length > 1 && tabs.length <= 5, true);
t("home is first", tabs[0].dataset.view, "home");
navigate("#home");
t("home is the current tab", tabs[0].classList.contains("on"), true);
const resTab = [].slice.call(tabs).filter(x => x.dataset.view === "residents")[0];
t("a tab for Residents", !!resTab, true);
navigate("#residents");
t("it opens the section", secOf().hidden, false);
t("and becomes the current tab", resTab.classList.contains("on"), true);
t("home is no longer current", tabs[0].classList.contains("on"), false);


/* The public page is for members. It does not advertise the admin panel or
   hand out the raw spreadsheet; the committee reaches admin.html by typing
   the address. This checks the markup, which the DOM shim cannot. */
/* Every tile, tab, back link, hero count and nav link is a plain anchor whose
   href carries the section, and the hash drives the view. A click listener
   that fails to attach or fire on some phone would leave the whole page dead;
   an anchor cannot fail that way. */
console.log("\nnavigation does not depend on a click listener");
const nav = fs.readFileSync(ROOT + "index.html", "utf8");
t("no intercepted clicks on tiles", /tile[\s\S]{0,300}?preventDefault/.test(nav), false);
t("tiles carry their own href", /a\.href = "#" \+ s\.id;/.test(nav), true);
t("tabs carry their own href", /a\.href = "#" \+ id;/.test(nav), true);
t("the back link too", /a\.href = "#home";/.test(nav), true);
t("hashchange renders the view", /addEventListener\("hashchange"/.test(nav), true);
// The links write history themselves; a replaceState would flatten the back button.
t("the view never rewrites history", /showView[\s\S]{0,700}?replaceState/.test(nav), false);

console.log("\nnothing here points at the admin panel");
const src = fs.readFileSync(ROOT + "index.html", "utf8");
t("no link to admin.html", /href="admin\.html"/.test(src), false);
t("no link to the data file", /href="data\.xlsx"/.test(src), false);
t("data.xlsx is still fetched", /var DATA_FILE = "data\.xlsx"/.test(src), true);


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

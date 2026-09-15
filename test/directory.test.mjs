/**
 * The page stopped parsing spreadsheets.
 *
 * It used to download 952 KB of SheetJS from a third-party CDN on a blocking
 * <script>, then parse a 78 KB workbook, before anything appeared — about four
 * seconds on a phone, every visit, to compute something identical for everyone.
 * scripts/make-directory.js does it once and writes a 20 KB directory.json.
 *
 * Three things have to stay true for that to keep working, and each has a way
 * of quietly coming undone:
 *
 *   1. directory.json says what data.xlsx says. It is generated, so it can go
 *      stale — someone commits a workbook and the CI never runs.
 *   2. Nothing hidden leaks into it. The page has no parsing left of its own,
 *      so this file is the last place the underscore rule can be enforced.
 *   3. The page really does not load SheetJS any more, and the service worker
 *      does not precache it. Either would put the megabyte straight back.
 *
 *   node test/directory.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";

const { buildFrom, check } = (await import(
  "file://" + (ROOT + "scripts/make-directory.js").replace(/\\/g, "/"))).default;

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(50)} ${String(g).slice(0, 26)}`);
};

const page = fs.readFileSync(ROOT + "index.html", "utf8");
const sw = fs.readFileSync(ROOT + "sw.js", "utf8");
const published = JSON.parse(fs.readFileSync(ROOT + "directory.json", "utf8"));

/* ---------------------------------------------------------------- shape */
console.log("the published file");
t("it is valid JSON with sections", Array.isArray(published.sections), true);
t("it has some", published.sections.length > 0, true);
t("it knows when it was built", /^\d{4}-\d{2}-\d{2}$/.test(published.built || ""), true);
t("the society is named", (published.meta && published.meta.name || "").length > 0, true);
t("notes, hindi and group came along",
  !!published.notes && !!published.hindi && !!published.group, true);
// Every section needs these, because the page reads them without checking.
t("every section has an id, a title and a map",
  published.sections.every(s => s.id && s.title && s.map), true);

/* ------------------------------------------------------------- currency */
/* Generated files go stale in silence. Rebuilding from the workbook here means
   a data.xlsx committed without a rebuild fails the suite instead of leaving
   the site showing last week's list. */
console.log("\nit matches data.xlsx");
const fresh = buildFrom(new Uint8Array(fs.readFileSync(ROOT + "data.xlsx")));
t("same number of sections", published.sections.length, fresh.sections.length);
t("same sections, in the same order",
  published.sections.map(s => s.title).join("|"),
  fresh.sections.map(s => s.title).join("|"));
t("same rows in each",
  published.sections.map(s => (s.rows || []).length).join(","),
  fresh.sections.map(s => (s.rows || []).length).join(","));
t("same society name", published.meta.name, fresh.meta.name);

/* --------------------------------------------------------------- hiding */
/* The page has no parsing left, so this file is where the underscore rule is
   enforced for good. Anything that reaches it is published. */
console.log("\nnothing hidden reached it");
t("the build's own checks pass on it", check(published).join("; ") || "clean", "clean");
t("no underscored sheet",
  published.sections.some(s => s.title.charAt(0) === "_"), false);
t("no underscored column",
  published.sections.some(s => (s.cols || []).some(c => String(c).charAt(0) === "_")), false);
t("no underscored cell", published.sections.some(s =>
  (s.rows || []).some(r => Object.keys(r).some(k =>
    String(r[k] == null ? "" : r[k]).trim().charAt(0) === "_"))), false);
// The whole workbook must not be in here either — _Private and friends.
const book = fs.readFileSync(ROOT + "data.xlsx");
t("the workbook itself is not embedded", JSON.stringify(published).includes("_Private"), false);

/* ------------------------------------------------------- the megabyte */
console.log("\nSheetJS is gone from the visitor's path");
t("index.html does not load it", /cdn\.sheetjs\.com/.test(page), false);
t("index.html reads the JSON", /var DATA_FILE = "directory\.json"/.test(page), true);
t("and asks for it as JSON", /return r\.json\(\);/.test(page), true);
const shell = (sw.match(/var SHELL_FILES = \[([\s\S]*?)\]/) || ["", ""])[1];
t("the service worker does not precache it", /SHEETJS/.test(shell), false);
t("the worker caches the JSON instead", /c\.match\("directory\.json"\)/.test(sw), true);
// admin.html genuinely reads and writes the workbook, so it keeps SheetJS.
t("the admin panel still has it",
  /cdn\.sheetjs\.com/.test(fs.readFileSync(ROOT + "admin.html", "utf8")), true);

console.log("\nweight");
const size = f => fs.statSync(ROOT + f).size;
const json = size("directory.json"), xlsx = size("data.xlsx");
console.log(`  directory.json ${Math.round(json / 1024)} KB, replacing ` +
  `${Math.round(xlsx / 1024)} KB of workbook and 930 KB of SheetJS`);
t("the JSON is smaller than the workbook it replaces", json < xlsx, true);
// A guard against someone inlining the workbook or the rows exploding.
t("and well under a quarter megabyte", json < 256 * 1024, true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

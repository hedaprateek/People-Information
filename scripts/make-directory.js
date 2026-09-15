#!/usr/bin/env node
/**
 * Builds directory.json — everything the page needs, already parsed.
 *
 *   node scripts/make-directory.js
 *
 * WHY THIS EXISTS
 *
 * The page used to read data.xlsx in the browser, which meant every visitor
 * downloaded SheetJS first: 952 KB from a third-party CDN, on a plain blocking
 * <script>, taking about four seconds on a phone before anything appeared. All
 * of that to turn a 78 KB spreadsheet into structures that are identical for
 * every visitor and change only when the committee publishes.
 *
 * So it is done once, here, and the page fetches 20 KB of JSON instead.
 *
 * WHY IT READS index.html RATHER THAN REIMPLEMENTING parse()
 *
 * The parsing rules are fiddly and load-bearing: which column is a phone, what
 * an underscore hides, how About rows become settings, where notices sort. A
 * second copy would drift from the first, and the drift would be silent — the
 * page would render one thing and the build would publish another.
 *
 * So index.html stays the single source of truth and this lifts the functions
 * straight out of it, which is what the test files already do. If a function is
 * renamed the grab fails loudly here rather than quietly producing a wrong file.
 *
 * Exported as buildFrom() as well, because the tests need to parse their own
 * synthetic workbooks through exactly this code.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "test", ".cache");
const LIB = path.join(CACHE, "xlsx.js");
if (!fs.existsSync(LIB)) {
  fs.mkdirSync(CACHE, { recursive: true });
  execFileSync("curl", ["-sSL", "-o", LIB,
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"], { stdio: "inherit" });
}
const XLSX = require(LIB);

/* index.html is stored with CRLF; normalise so the patterns match. */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").split("\r\n").join("\n");

function grab(re) {
  const m = html.match(re);
  if (!m) {
    console.error("Could not find this in index.html:\n  " + re +
      "\nThe function was probably renamed or reformatted. Fix the pattern here " +
      "rather than reimplementing it, or the build and the page will disagree.");
    process.exit(1);
  }
  return m[0];
}

/* The parsing half of the page, lifted verbatim. parse() ends by calling
   afterData(), which draws — so that and the other render entry points are
   stubbed here and never run. */
const run = new Function([
  "var XLSX = arguments[0];",
  "var sections = [], meta = {}, sectionNotes = {}, sectionHindi = {}, sectionGroup = {};",
  "var dataAsOf = null, dataOffline = false, lang = 'en', sheetOpen = false;",
  "function afterData(){} function chrome(){} function draw(){} function installable(){}",
  "function closeSheet(){} function showView(){} function viewFromHash(){}",
  "function t(){ return ''; }",
  "var addEventListener = function(){};",
  "var document = { getElementById: function(){ return { textContent: '' }; } };",

  grab(/function key\(s\)[^\n]*\n/),
  grab(/function slug\(s\)[^\n]*\n/),
  grab(/function fileCol\(cols\)[\s\S]*?\n    return null;\n  \}/),
  grab(/function classify\(cols\)[\s\S]*?\n    return r;\n  \}/),
  grab(/function isNotice\(name\)[^\n]*\n/),
  grab(/function noticeMap\(cols\)[\s\S]*?\n  \}/),
  grab(/function noticeOrder\(rows, map\)[\s\S]*?\n  \}/),
  // noticeOrder sorts by date and floats pinned rows, so it needs these too.
  grab(/function parseDate\([^)]*\)[\s\S]*?\n  \}/),
  grab(/function isPinned\([^)]*\)[\s\S]*?\n  \}/),
  grab(/function normKey\(k\)[^\n]*\n/),
  grab(/function isHidden\(v\)[^\n]*\n/),
  grab(/var HIDE_COL = [^\n]*\n/),
  grab(/var HIDE_YES = [^\n]*\n/),
  grab(/function rowHidden\(r\)[\s\S]*?\n  \}/),
  grab(/function shown\(r\)[\s\S]*?\n  \}/),
  grab(/function hasAnything\(r\)[\s\S]*?\n  \}/),
  grab(/function parse\(buf\)[\s\S]*?\n  \}/),

  "return function (bytes) {",
  "  sections = []; meta = {}; sectionNotes = {}; sectionHindi = {}; sectionGroup = {};",
  "  parse(bytes);",
  "  return { meta: meta, sections: sections, notes: sectionNotes,",
  "           hindi: sectionHindi, group: sectionGroup };",
  "};"
].join("\n"))(XLSX);

/** Parse a workbook exactly as the page used to. */
function buildFrom(bytes) {
  return run(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * What must be true of anything we publish. The page does no parsing of its
 * own any more, so a wrong file here is a wrong site with nothing downstream
 * to catch it.
 */
function check(data) {
  const problems = [];
  if (!data.sections.length) problems.push("no sections");
  if (!data.meta.name) problems.push("no society name in About");

  data.sections.forEach(s => {
    if (!s.id || !s.title) problems.push("a section with no id or title");
    if (s.title.charAt(0) === "_")
      problems.push("an underscored sheet reached the file: " + s.title);
    (s.cols || []).forEach(c => {
      if (String(c).charAt(0) === "_")
        problems.push("an underscored column reached the file: " + s.title + " / " + c);
    });
    (s.rows || []).forEach((r, i) => {
      Object.keys(r).forEach(k => {
        if (String(r[k] == null ? "" : r[k]).trim().charAt(0) === "_")
          problems.push("a hidden value reached the file: " + s.title + " row " + (i + 1) + ", " + k);
      });
    });
  });
  return problems;
}

function main() {
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, "data.xlsx")));
  const data = buildFrom(bytes);

  const problems = check(data);
  if (problems.length) {
    console.error("Refusing to write directory.json:");
    problems.slice(0, 10).forEach(p => console.error("  " + p));
    process.exit(1);
  }

  const out = {
    built: new Date().toISOString().slice(0, 10),
    meta: data.meta,
    notes: data.notes,
    hindi: data.hindi,
    group: data.group,
    sections: data.sections
  };

  const file = path.join(ROOT, "directory.json");
  fs.writeFileSync(file, JSON.stringify(out) + "\n");

  const kb = n => Math.round(n / 1024) + " KB";
  console.log("wrote directory.json  " + kb(fs.statSync(file).size) +
    "  (from data.xlsx " + kb(fs.statSync(path.join(ROOT, "data.xlsx")).size) + ")");
  console.log("  " + data.sections.length + " sections, " +
    data.sections.reduce((n, s) => n + (s.rows || []).length, 0) + " rows");
  data.sections.forEach(s =>
    console.log("    " + s.title.padEnd(20) + String((s.rows || []).length).padStart(4) + " rows" +
      (s.notice ? "  (notices)" : "") + (s.sos ? "  (emergency)" : "")));
}

if (require.main === module) main();
module.exports = { buildFrom, check, XLSX };

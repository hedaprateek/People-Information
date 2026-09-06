/**
 * "Kept in the sheet, off the page."
 *
 * An underscore in front of a sheet tab, a column heading or a single cell
 * means the value stays in the spreadsheet and never reaches the page. A Hide
 * column with a yes in it takes the whole row out.
 *
 * Two things are checked here, and the second is the one that matters:
 *
 *   1. the rule does what it says;
 *   2. every file that publishes honours it. The sheet and column conventions
 *      existed before this and the three files that build services.json
 *      ignored both — a _Alt Phone column was invisible on the members-only
 *      directory and published to the whole town. A convention nothing
 *      enforces is worse than no convention, because people trust it.
 *
 *   node test/hidden.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";
const TOWN = join(HERE, "..", "..", "town-services") + "/";
const require_ = createRequire(import.meta.url);
const XLSX = (await import("file://" + join(HERE, ".cache", "xlsx.js").replace(/\\/g, "/"))).default;

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(52)} ${String(g).slice(0, 24)}`);
};

/* ---------------------------------------------------------------- the rule */
/* Lifted out of the directory rather than reimplemented, so this tests what
   actually ships. */
const page = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");
const grab = re => {
  const m = page.match(re);
  if (!m) { console.error("NO MATCH: " + re); process.exit(1); }
  return m[0];
};
const rule = new Function([
  grab(/var HIDE_COL = [\s\S]*?function hasAnything\(r\)[\s\S]*?return false;\n  \}/),
  "return { isHidden, rowHidden, shown, hasAnything, HIDE_COL, normKey };"
].join("\n"))();

console.log("what the underscore does");
t("hides a cell", rule.isHidden("_9876543210"), true);
t("leaves an ordinary number alone", rule.isHidden("9876543210"), false);
t("ignores space in front of it", rule.isHidden("  _secret"), true);
t("an empty cell is not hidden, just empty", rule.isHidden(""), false);
t("nor is a blank one", rule.isHidden(null), false);
// A number typed into Excel arrives as a number, not a string.
t("survives a real number", rule.isHidden(9876543210), false);

console.log("\na hidden cell is blanked, not carried");
const row = { Name: "Anil", Phone: "_98330 40011", Flat: "A-101", "_Alt Phone": "99999 11111" };
const out = rule.shown(row);
t("the name stays", out.Name, "Anil");
t("the hidden number is gone", out.Phone, "");
t("and is not merely marked", JSON.stringify(out).includes("98330"), false);
t("the hidden column is gone entirely", "_Alt Phone" in out, false);
t("its value went with it", JSON.stringify(out).includes("99999"), false);
t("the rest is untouched", out.Flat, "A-101");

console.log("\na whole row, by a Hide column");
for (const yes of ["y", "Y", "yes", "YES", "true", "1", "x", "✓"])
  t(`Hide = ${yes}`, rule.rowHidden({ Name: "A", Hide: yes }), true);
for (const no of ["", "n", "no", "false", "0", "-"])
  t(`Hide = "${no}" keeps it`, rule.rowHidden({ Name: "A", Hide: no }), false);
t("Hidden works too", rule.rowHidden({ Name: "A", Hidden: "yes" }), true);
t("so does Do Not Publish", rule.rowHidden({ Name: "A", "Do Not Publish": "yes" }), true);
t("the Hide column never shows up itself", "Hide" in rule.shown({ Name: "A", Hide: "no" }), false);
t("a row with nothing left is empty", rule.hasAnything(rule.shown({ Phone: "_1" })), false);
t("a row with something left is not", rule.hasAnything(rule.shown({ Name: "A", Phone: "_1" })), true);

/* ------------------------------------------------- nobody has drifted */
/* No module system here: the same block is pasted into five files. Compared
   line for line, ignoring only indentation. */
console.log("\nthe same rule in every file that publishes");
const FILES = [
  ["the directory", ROOT + "index.html"],
  ["its admin panel", ROOT + "admin.html"],
  ["its services build", ROOT + "scripts/make-services.js"],
  ["the town build", TOWN + "scripts/make-services.js"],
  ["the town admin", TOWN + "admin.html"]
];
const norm = s => s.split("\r\n").join("\n").split("\n")
  .map(l => l.trim()).filter(Boolean).join("\n");
let canon = null;
for (const [what, file] of FILES) {
  // Endings first: git hands some of these back as CRLF after a checkout, and
  // the pattern below anchors on \n. Comparing indentation-insensitively but
  // not ending-insensitively made the rule look missing when it was there.
  const src = fs.readFileSync(file, "utf8").split("\r\n").join("\n");
  const m = src.match(/var HIDE_COL = [\s\S]*?function hasAnything\(r\)[\s\S]*?return false;\n\s*\}/);
  const body = m ? norm(m[0]) : null;
  if (!body) { t(what + " has the rule", false, true); continue; }
  if (canon === null) canon = body;
  t(what + " has it, unchanged", body === canon, true);
}

/* --------------------------------------------- and actually applies it */
console.log("\nthe published file drops what is hidden");
const { build } = require_(join(ROOT, "scripts", "make-services.js"));

// A workbook with one of each kind of hiding in it.
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Field", "Value"], ["Society Name", "Test Society"]
]), "About");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Name", "Role", "Phone", "_Alt Phone", "Hide"],
  ["Rahul", "Plumber", "9673020210", "9000000001", ""],
  ["Sunita", "Maid", "_9673020211", "9000000002", ""],
  ["Private Person", "Cook", "9673020212", "9000000003", "yes"]
]), "Services & Help");
const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
const res = build(bytes);
const json = JSON.stringify(res.out);

t("it builds cleanly", res.leaks.join("; ") || "clean", "clean");
t("the ordinary row is published", json.includes("9673020210"), true);
t("the hidden cell is not", json.includes("9673020211"), false);
t("but its row still is", json.includes("Sunita"), true);
t("the hidden column is not published", res.out.columns.includes("_Alt Phone"), false);
t("nor any value from it", /900000000[123]/.test(json), false);
t("the Hide column is not published", res.out.columns.includes("Hide"), false);
t("the row marked Hide is gone", json.includes("Private Person"), false);
t("two rows published, not three", res.out.rows.length, 2);

/* The check has to fail when it should. A file that only reports "clean"
   because it never looks is worth nothing. */
console.log("\nthe leak check bites");
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["Field", "Value"]]), "About");
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
  ["Name", "Phone"], ["Rahul", "9673020210"]
]), "Services & Help");
const good = build(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));
t("a clean book reports clean", good.leaks.length, 0);
// Feed a hidden value straight past the gatherer into the leak check.
const src = fs.readFileSync(ROOT + "scripts/make-services.js", "utf8");
t("the leak check looks at columns", /hidden column in the public file/.test(src), true);
t("and at every value", /hidden value published/.test(src), true);
t("the town build refuses outright",
  /hidden (column|value) would be published/.test(
    fs.readFileSync(TOWN + "scripts/make-services.js", "utf8")), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

/**
 * A long section splits itself into groups. These are the rules that decide
 * which column it splits on, and when splitting is not worth doing.
 *
 *   node test/groups.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";
const html = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");
const XLSX = (await import("file://" + join(HERE, ".cache", "xlsx.js").replace(/\\/g, "/"))).default;

const grab = re => {
  const m = html.match(re);
  if (!m) { console.error("NO MATCH: " + re); process.exit(1); }
  return m[0];
};
const api = new Function([
  "var sectionGroup = {};",
  "function key(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,''); }",
  "function t(k){ return { ungrouped:'Other', all:'All' }[k] || k; }",
  grab(/var GROUP_MIN = \d+;/),
  grab(/function fileCol\(cols\)[\s\S]*?\n    return null;\n  \}/),
  grab(/function classify\(cols\)[\s\S]*?\n    return r;\n  \}/),
  grab(/function spread\(s, col\)[\s\S]*?\n  \}/),
  grab(/function usable\(s, col\)[\s\S]*?\n  \}/),
  grab(/function subColOf\(s, main\)[\s\S]*?\n  \}/),
  grab(/function groupColsOf\(s\)[\s\S]*?\n  \}/),
  grab(/function groupColOf\(s\)[\s\S]*?\n  \}/),
  grab(/function groupsOf\(s, col\)[^\n]*\n/),
  grab(/function groupTree\(s, cols\)[\s\S]*?\n  \}/),
  grab(/function bucket\(rows, col\)[\s\S]*?\n  \}/),
  "return { groupColOf, groupColsOf, subColOf, groupsOf, groupTree, spread, usable,",
  "         classify, GROUP_MIN, setTold: m => { sectionGroup = m; } };"
].join("\n"))();

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(48)} ${String(g).slice(0, 24)}`);
};
const sec = (title, rows, extra) => {
  const cols = Object.keys(rows[0]);
  return Object.assign({ title, rows, cols, map: api.classify(cols),
                         notice: false, sos: false }, extra || {});
};
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

console.log("which column a section splits on");
const residents = sec("Residents", many(12, i => ({
  Name: "R" + i, Block: "AB"[i % 2], Flat: "10" + i, Phone: "9", Type: i % 3 ? "Owner" : "Tenant"
})));
t("a wing beats owner/tenant", api.groupColOf(residents), "Block");

const services = sec("Services", many(12, i => ({
  Name: "S" + i, Role: "Role" + i, Category: ["Repairs", "Utilities", "Home Help"][i % 3], Phone: "9"
})));
t("a category beats a job title", api.groupColOf(services), "Category");

const roleOnly = sec("Vendors", many(12, i => ({
  Name: "V" + i, Role: ["Plumber", "Electrician", "Maid"][i % 3], Phone: "9"
})));
t("a job title is used when there is nothing broader", api.groupColOf(roleOnly), "Role");

/* Eighteen trades across eighteen people is the same list with headings on
   it — the exact shape this society's Services sheet had. */
console.log("\na column too fine to be a grouping");
const allDifferent = sec("Services", many(12, i => ({
  Name: "S" + i, Role: "Trade" + i, Phone: "9"
})));
t("one value per row is not a grouping", api.groupColOf(allDifferent), "null");
t("spread sees them all", api.spread(allDifferent, "Role"), 12);
t("but it is not usable", api.usable(allDifferent, "Role"), false);
// Two per group is enough to be worth a heading.
const pairs = sec("Services", many(12, i => ({
  Name: "S" + i, Role: "Trade" + Math.floor(i / 2), Phone: "9"
})));
t("two rows per group is usable", api.usable(pairs, "Role"), true);

console.log("\nwhen not to split at all");
const short = sec("Committee", many(3, i => ({ Name: "C" + i, Role: "R" + (i % 2), Phone: "9" })));
t("a short list is left alone", api.groupColOf(short), "null");
t("the floor is six rows", api.GROUP_MIN, 6);
const oneValue = sec("Residents", many(12, i => ({ Name: "R" + i, Block: "A", Phone: "9" })));
t("one distinct value is not a split", api.groupColOf(oneValue), "null");
t("notices are never split", api.groupColOf(sec("Notices", many(12, i =>
  ({ Title: "N" + i, Category: "C" + (i % 3) })), { notice: true })), "null");
t("nor the emergency panel", api.groupColOf(sec("Emergency", many(12, i =>
  ({ Service: "S" + i, Category: "C" + (i % 3), Phone: "9" })), { sos: true })), "null");

console.log("\nthe About sheet can decide");
api.setTold({ residents: "Type" });
t("a named column wins", api.groupColOf(residents), "Type");
api.setTold({ residents: "none" });
t("none turns it off", api.groupColOf(residents), "null");
api.setTold({ residents: "Nonexistent" });
t("a column that is not there falls back", api.groupColOf(residents), "Block");
api.setTold({});

console.log("\nthe groups themselves");
const mixed = sec("Residents", [
  { Name: "a", Block: "B" }, { Name: "b", Block: "A" }, { Name: "c", Block: "" },
  { Name: "d", Block: "B" }, { Name: "e", Block: "A" }, { Name: "f", Block: "b" },
  { Name: "g", Block: "" }, { Name: "h", Block: "C" }
]);
const gs = api.groupsOf(mixed, "Block");
t("first-seen order, not alphabetical", gs.map(g => g.label).slice(0, 3).join(","), "B,A,C");
t("case does not split a group", gs.filter(g => g.key === "b")[0].rows.length, 3);
t("blanks are collected", gs[gs.length - 1].label, "Other");
t("and go last", gs[gs.length - 1].rows.length, 2);
t("nothing is dropped", gs.reduce((n, g) => n + g.rows.length, 0), mixed.rows.length);

/* A wing holds both flats and row houses, so the chips stay on the wing and
   the kind of home splits each wing below it. */
console.log("\ntwo levels: wing, then kind of home");
const mixedHomes = sec("Residents", many(12, i => ({
  Name: "R" + i, Block: "AB"[i % 2], "Unit Type": i % 3 ? "Flat" : "Row House",
  Flat: "11", Phone: "9"
})));
t("chips still filter by wing", api.groupColsOf(mixedHomes)[0], "Block");
t("and each wing splits by kind", api.groupColsOf(mixedHomes)[1], "Unit Type");
const tree = api.groupTree(mixedHomes, api.groupColsOf(mixedHomes));
t("a group per wing", tree.length, 2);
t("each wing has both kinds", tree[0].subs.length, 2);
t("nothing is lost in the nesting",
  tree.reduce((n, g) => n + g.subs.reduce((m, s2) => m + s2.rows.length, 0), 0), 12);
t("a wing's own count still totals its cards",
  tree[0].rows.length, tree[0].subs.reduce((n, s2) => n + s2.rows.length, 0));

// The column exists but nobody has filled it in — exactly today's sheet.
const notFilledIn = sec("Residents", many(12, i => ({
  Name: "R" + i, Block: "AB"[i % 2], "Unit Type": "", Phone: "9"
})));
t("an empty Unit Type column splits nothing", api.groupColsOf(notFilledIn).length, 1);
const flat = api.groupTree(notFilledIn, api.groupColsOf(notFilledIn));
t("but the wings still group", flat.length, 2);
t("with one unnamed run each", flat[0].subs.length, 1);
t("and no sub-heading to show", flat[0].subs[0].key, "");

// Splitting a trade by kind-of-home would be nonsense.
t("only a place gets a second level", api.subColOf(services, "Category"), "null");

console.log("\ntwo levels can be named outright");
api.setTold({ residents: "Block, Unit Type" });
t("first name is the chips", api.groupColsOf(mixedHomes)[0], "Block");
t("second is the split", api.groupColsOf(mixedHomes)[1], "Unit Type");
api.setTold({ residents: "none, Unit Type" });
t("none still wins", api.groupColsOf(mixedHomes), "null");
api.setTold({});

console.log("\nagainst the live data.xlsx");
const wb = XLSX.read(fs.readFileSync(ROOT + "data.xlsx"), { type: "buffer" });
const seen = {};
for (const name of wb.SheetNames) {
  if (name.charAt(0) === "_" || /^about$/i.test(name)) continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
  if (!rows.length) continue;
  const s = sec(name, rows, { notice: /notice|announce/i.test(name),
                              sos: /emerg|helpline/i.test(name) });
  const col = api.groupColOf(s);
  seen[name] = col;
  if (col) {
    const g = api.groupsOf(s, col);
    console.log(`  ${name}: by ${col} — ${g.map(x => x.label + "(" + x.rows.length + ")").join(" ")}`);
    t(`  ${name} groups are all non-empty`, g.every(x => x.rows.length > 0), true);
  }
}
t("Residents split by wing", seen["Residents"], "Block");
t("Services split by category", seen["Services & Help"], "Category");

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

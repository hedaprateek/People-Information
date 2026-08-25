/**
 * A notice board is only useful in date order, and the dates arrive in
 * whatever form Excel and the person typing produced. These checks cover the
 * parsing, the ordering, and what counts as new.
 *
 *   node test/notices.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const html = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");
const grab = re => {
  const m = html.match(re);
  if (!m) { console.error("NO MATCH: " + re); process.exit(1); }
  return m[0];
};

const N = grab(/var MONTHS = [\s\S]*?\n  function noticeOrder\(rows, map\)[\s\S]*?\n  \}/);
const api = new Function([
  "var lang = 'en';",
  grab(/function fileCol\(cols\)[\s\S]*?\n    return null;\n  \}/),
  N,
  "return { parseDate, isFresh, fmtDate, isNotice, noticeMap, isPinned, noticeOrder, NEW_DAYS };"
].join("\n"))();

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0, 26)}`);
};
const iso = d => (d ? d.toISOString().slice(0, 10) : String(d));

/* India writes 25/08/2026. JavaScript's own Date() reads that as a US date or
   fails outright, which is why these are parsed by hand. */
console.log("dates, as people actually type them");
for (const [input, want] of [
  ["2026-08-25",      "2026-08-25"],   // ISO
  ["25/08/2026",      "2026-08-25"],   // day-first, the Indian convention
  ["25-08-2026",      "2026-08-25"],
  ["25.08.2026",      "2026-08-25"],
  ["05/03/2026",      "2026-03-05"],   // ambiguous: day-first wins
  ["25 Aug 2026",     "2026-08-25"],
  ["25th August 2026","2026-08-25"],
  ["Aug 25, 2026",    "2026-08-25"],
  ["August 25 2026",  "2026-08-25"],
  ["25/08/26",        "2026-08-25"],   // two-digit year
  ["46259",           "2026-08-25"],   // raw Excel serial (days since 1899-12-30)
  ["45351",           "2024-02-29"],   // a leap day, via the same route
  ["",                "null"],
  ["   ",             "null"],
  ["not a date",      "null"],
  ["31/02/2026",      "null"],         // never existed
  ["25/13/2026",      "null"]
]) t(JSON.stringify(input), iso(api.parseDate(input)), want);

// A sheet saved with US settings still has to work.
t("08/25/2026 can only be month-first", iso(api.parseDate("08/25/2026")), "2026-08-25");
t("a real Date passes through", iso(api.parseDate(new Date("2026-08-25"))), "2026-08-25");

console.log("\nwhat counts as new");
const now = new Date("2026-08-25T00:00:00Z");
t("today", api.isFresh(api.parseDate("25/08/2026"), now), true);
t("13 days ago", api.isFresh(api.parseDate("12/08/2026"), now), true);
t("15 days ago", api.isFresh(api.parseDate("10/08/2026"), now), false);
t("last year", api.isFresh(api.parseDate("25/08/2025"), now), false);
t("dated next week", api.isFresh(api.parseDate("01/09/2026"), now), true);
t("no date is never new", api.isFresh(null, now), false);
t("the window is two weeks", api.NEW_DAYS, 14);

console.log("\nwhich sheets are a notice board");
for (const n of ["Notices", "Notice Board", "Announcements", "Circulars", "Bulletin"])
  t(`"${n}"`, api.isNotice(n), true);
for (const n of ["Residents", "Committee", "Documents", "Services & Help"])
  t(`"${n}" is not`, api.isNotice(n), false);

console.log("\ncolumns");
const cols = ["Date", "Title", "Details", "Category", "Pinned", "File"];
const map = api.noticeMap(cols);
t("date found", map.date, "Date");
t("title found", map.title, "Title");
t("body found", map.body.join(","), "Details");
t("pin found", map.pin, "Pinned");
t("attachment found", map.file, "File");
t("category left as a tag", map.rest.join(","), "Category");

// A one-column sheet must still produce a headline, not a stray paragraph.
const bare = api.noticeMap(["Notice"]);
t("a lone Notice column is the headline", bare.title, "Notice");
t("and leaves no body", bare.body.length, 0);
const noTitle = api.noticeMap(["Date", "Message"]);
t("body is promoted when there is no title", noTitle.title, "Message");

console.log("\npinned flags");
for (const v of ["yes", "Yes", "Y", "TRUE", "1", "pinned"])
  t(`"${v}" pins`, api.isPinned({ P: v }, { pin: "P" }), true);
for (const v of ["", "no", "n", "false", "0"])
  t(`"${v}" does not`, api.isPinned({ P: v }, { pin: "P" }), false);

console.log("\norder on the page");
const rows = [
  { Date:"01/08/2026", Title:"Oldest" },
  { Date:"20/08/2026", Title:"Newest" },
  { Date:"10/08/2026", Title:"Middle" },
  { Date:"05/08/2026", Title:"AGM",    Pinned:"yes" },
  { Date:"garbage",    Title:"Undated" }
];
const m2 = api.noticeMap(["Date", "Title", "Pinned"]);
const order = api.noticeOrder(rows, m2).map(r => r.Title);
t("pinned leads regardless of date", order[0], "AGM");
t("then newest first", order.slice(1, 4).join(","), "Newest,Middle,Oldest");
// An unreadable date must not sort as 1 January 1970 and land on top.
t("an unreadable date sinks to the bottom", order[4], "Undated");
t("nothing is dropped", order.length, rows.length);

// Two notices on one day keep the order they were typed in.
const sameDay = api.noticeOrder([
  { Date:"20/08/2026", Title:"First" },
  { Date:"20/08/2026", Title:"Second" }
], m2).map(r => r.Title);
t("same day keeps sheet order", sameDay.join(","), "First,Second");

console.log("\nthe page wires it up");
t("notices sit at the bottom", /sections\.sort\(function \(a, b\) \{ return \(a\.notice \? 1 : 0\) - \(b\.notice \? 1 : 0\); \}\)/.test(html), true);
t("an attachment does not divert it to the sidebar",
  /if \(s\.map\.file && !s\.notice\)/.test(html), true);
t("notices stay open on a phone", /!s\.notice && s\.rows\.length > 6/.test(html), true);
t("cards are rendered as notices", /s\.notice \? noticeCard\(row, s\.map\)/.test(html), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

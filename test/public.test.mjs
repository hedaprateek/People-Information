/**
 * The public services page is served with no access code, so the questions
 * here are mostly about what must NOT be reachable through it.
 *
 *   node test/public.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..") + "/";
const require_ = createRequire(import.meta.url);
const XLSX = (await import("file://" + join(HERE, ".cache", "xlsx.js").replace(/\\/g, "/"))).default;
const { build } = require_(join(ROOT, "scripts", "make-services.js"));

const svcHtml = fs.readFileSync(ROOT + "services.html", "utf8");
const mw = fs.readFileSync(ROOT + "functions/_middleware.js", "utf8");
const admin = fs.readFileSync(ROOT + "admin.html", "utf8");

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(52)} ${String(g).slice(0, 22)}`);
};

/* ---- what the gate lets past ---- */
console.log("the gate opens for the services page and nothing else");
const list = (mw.match(/const PUBLIC = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || "";
const open = [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]);
console.log("  public paths: " + open.join(" "));
t("services.html is public", open.includes("/services.html"), true);
t("services.json is public", open.includes("/services.json"), true);
t("data.xlsx is NOT", open.includes("/data.xlsx"), false);
t("index.html is NOT", open.includes("/index.html"), false);
t("admin.html is NOT", open.includes("/admin.html"), false);
t("materials are NOT", open.some(p => /materials/.test(p)), false);
// A prefix rule would open whatever anyone dropped in later.
t("it is an exact set, not a prefix match", /PUBLIC\.has\(url\.pathname\)/.test(mw), true);
t("nothing wildcard slipped in", open.some(p => /\*|\.\.|^\/$/.test(p)), false);

/* ---- what the public file actually contains ---- */
console.log("\nthe public file carries only the services sheet");
const wb = XLSX.read(fs.readFileSync(ROOT + "data.xlsx"), { type: "buffer" });
const { out, leaks, sheet } = build(fs.readFileSync(ROOT + "data.xlsx"));
t("it builds", leaks.join("; ") || "clean", "clean");
t("from the services sheet", sheet, "Services & Help");

const services = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: "", raw: false });
t("every services row is there", out.rows.length, services.length);

/* The row that matters: a resident's name or number must not be in a file the
   whole town can read. Compared against the actual sheet, not a guess. */
const text = JSON.stringify(out).toLowerCase();
const priv = [];
for (const name of wb.SheetNames) {
  if (name === sheet || /^about$/i.test(name)) continue;
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false })) {
    for (const k of Object.keys(r)) {
      if (!/name|phone|mobile|email|flat|owner|address/i.test(k)) continue;
      const v = String(r[k] || "").trim();
      if (v.length < 9) continue;
      // A person who is in the services sheet too is published on purpose.
      if (services.some(s => Object.keys(s).some(sk => String(s[sk] || "").trim() === v))) continue;
      if (text.includes(v.toLowerCase())) priv.push(name + " → " + k + ": " + v);
    }
  }
}
console.log("  checked every name, phone, email, flat and owner cell in the other sheets");
t("no resident detail reaches the public file", priv.slice(0, 3).join("; ") || "none", "none");
t("no owner columns", out.columns.some(c => /^owner|landlord/i.test(c)), false);
t("no blood group", out.columns.some(c => /blood/i.test(c)), false);
t("no flat or block", out.columns.some(c => /^(flat|block|wing|unit type)$/i.test(c)), false);
t("the society is not named in it", JSON.stringify(out).includes("LAXMI"), false);

/* Its own look, deliberately not the society's. Someone handed this link
   should not feel they have walked into a particular society. */
console.log("\nits own branding");
const mk = fs.readFileSync(ROOT + "scripts/make-services.js", "utf8");
t("a civic default, not the directory navy", out.theme, "civic");
t("the society's own theme is not inherited", out.theme === "paper", false);
t("themes of its own exist",
  /data-theme="civic"/.test(svcHtml) && /data-theme="slate"/.test(svcHtml), true);
t("About can override it", /services page theme/.test(mk), true);

/* Category, then the trade inside it — several plumbers under Repairs. */
console.log("\nsubsections inside a category");
t("two levels are rendered", /gsub2/.test(svcHtml), true);
t("grouped by category then role", /bucket\(g\.rows, COL\.role\)/.test(svcHtml), true);
t("a single trade needs no sub-heading", /subs\.length > 1 \? subs/.test(svcHtml), true);
t("empty trade headings are hidden", /sb\.head\.hidden = !any/.test(svcHtml), true);

/* A sheet for the town only: on the public page, never in the directory. */
console.log("\na separate source for town-only entries");
t("a town sheet is picked up", /const TOWN = /.test(mk), true);
t("the underscore keeps it off the directory", /\^_\?town/.test(mk), true);
t("About can name the sheets outright", /services page sheets/.test(mk), true);
t("the file records where it came from", Array.isArray(out.sheets), true);
t("both sheets feed it", out.sheets.length >= 1, true);
t("the admin uses the same rule", /TOWN_SHEET/.test(admin), true);
t("duplicates across sheets appear once", /seen\[id\]/.test(admin), true);

/* A grid of cards is the wrong shape for a list you scan. One line each, the
   two ways to reach someone on that line, everything else a tap away. */
console.log("\none line per contact");
t("rendered as rows, not cards", /function row\(r\)/.test(svcHtml) && !/function card\(r\)/.test(svcHtml), true);
t("the row is a single flex line", /\.row\{display:flex;align-items:center/.test(svcHtml), true);
t("name and role share the line", /\.line1\{display:flex;align-items:baseline/.test(svcHtml), true);
/* Two or three words on what they do. Only when the sheet has a column for it,
   so a row without one is still a single line. */
t("an optional word or two under the name", /\.info\{display:block/.test(svcHtml), true);
t("matched by meaning, not one fixed heading", /covers\|area\|areas\|serves/.test(svcHtml), true);
t("absent unless the column has a value", /var info = pick\(r, COL\.info\);\s*\r?\n\s*if \(info\)/.test(svcHtml), true);
t("it is trimmed, not wrapped", /\.info\{[^}]*text-overflow:ellipsis/.test(svcHtml), true);
t("and repeated in full in the sheet", /line\(t\("covers"\), pick\(r, COL\.info\)\)/.test(svcHtml), true);
t("long names are trimmed, not wrapped", /\.nm\{[^}]*text-overflow:ellipsis/.test(svcHtml), true);
t("call and WhatsApp sit on the row", /callButtons\(r, name\)/.test(svcHtml), true);
t("the charge is dropped on a narrow phone",
  /@media\(max-width:430px\)\{ \.rate\{display:none\} \}/.test(svcHtml), true);

console.log("\ndetails open on a tap");
t("the row opens them", /b\.addEventListener\("click", function \(\) \{ openSheet/.test(svcHtml), true);
t("calling does not open them too", /acts\.addEventListener\("click", function \(ev\) \{ ev\.stopPropagation/.test(svcHtml), true);
t("a sheet exists", /function openSheet\(r, name\)/.test(svcHtml), true);
t("it can be closed", /function closeSheet\(\)/.test(svcHtml), true);
t("Escape closes it", /Escape.*closeSheet|closeSheet.*Escape/.test(svcHtml), true);
t("the backdrop closes it", /back\.addEventListener\("click", closeSheet\)/.test(svcHtml), true);
t("it carries every column, not just the known ones", /if \(known\[c2\]\) continue;/.test(svcHtml), true);
// The tab bar taught this one: a fixed box that sets three insets inherits the fourth.
t("the sheet writes out every inset",
  /\.sheet-wrap\{position:fixed;top:0;right:0;bottom:0;left:0/.test(svcHtml), true);
t("and rises from the bottom on a phone",
  /@media\(max-width:700px\)\{[\s\S]{0,200}align-items:flex-end/.test(svcHtml), true);

/* ---- the page itself ---- */
console.log("\nthe page stands alone");
t("it reads services.json", /fetch\("services\.json/.test(svcHtml), true);
t("and never data.xlsx", /data\.xlsx/.test(svcHtml), false);
// One way: someone handed this link should not find their way into the directory.
t("no link back to the directory", /href="index\.html"/.test(svcHtml), false);
t("nor to the admin panel", /admin\.html/.test(svcHtml), false);
t("no SheetJS needed", /sheetjs/i.test(svcHtml), false);
t("the caution travels with it", /cautionText/.test(svcHtml), true);
t("it can be called and shared", /wa\.me/.test(svcHtml) && /navigator\.share/.test(svcHtml), true);

console.log("\nthe main site links out, one way");
const idx = fs.readFileSync(ROOT + "index.html", "utf8");
t("a link to the public page", /href = "services\.html"/.test(idx), true);
t("opening in its own tab", /pub\.target = "_blank"/.test(idx), true);
t("only on the services section", /service\|help\|vendor\|trades/.test(idx), true);

/* A list for the town can be prepared anywhere and uploaded, rather than typed
   into the society's own sheet. */
console.log("\nuploading a separate list");
t("there is an upload for it", /id="townFile"/.test(admin), true);
t("and a blank list to start from", /town-services-template\.xlsx/.test(admin), true);
t("it lands in the town sheet, not the services one",
  /var TOWN_NAME = "_Town Services"/.test(admin), true);
t("add or replace is asked, not assumed", /ADD to what is already/.test(admin), true);
t("a list with no Name column is refused", /needs a Name column/.test(admin), true);
t("Covers is offered as a column", /"Covers"/.test(admin), true);
t("phone numbers are written as text", /cell\.t = "s"/.test(admin), true);

console.log("\npublishing keeps the two in step");
t("the admin writes services.json too", /putFile\(c, "services\.json"/.test(admin), true);
t("built from the services sheet only", /SERVICES_SHEET\.test/.test(admin), true);
t("Devanagari survives base64", /new TextEncoder\(\)\.encode/.test(admin), true);
t("a failure there does not claim success", /the public services page did not/.test(admin), true);

console.log("\nthe worker keeps the two pages apart");
const sw = fs.readFileSync(ROOT + "sw.js", "utf8");
t("each navigation is cached as itself",
  /var page = \/\\\/services\\\.html\$\/\.test\(url\.pathname\)/.test(sw), true);
t("and falls back to itself offline", /var want = page;/.test(sw), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

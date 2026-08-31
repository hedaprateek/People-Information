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

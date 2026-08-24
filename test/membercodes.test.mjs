/**
 * The admin panel and scripts/make-member-codes.js must pick out the same
 * people and shape the same message, or a code handed over by WhatsApp will
 * not match the one pasted into SITE_PASSWORDS.
 *
 *   node test/membercodes.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const XLSX = (await import("file://" + join(HERE, ".cache", "xlsx.js").replace(/\\/g, "/"))).default;

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0, 26)}`);
};

/* lift the admin panel's helpers out of admin.html */
const html = fs.readFileSync(join(ROOT, "admin.html"), "utf8");
const grab = re => { const m = html.match(re); if (!m) throw new Error("missing " + re); return m[0]; };
const admin = new Function([
  grab(/var MC_ALPHA = "[^"]+";/),
  grab(/function mcCode\(prefix, taken\)[\s\S]*?\n  \}/),
  grab(/function mcPick\(row, rx\)[\s\S]*?\n  \}/),
  grab(/function mcWa\(v\)[\s\S]*?\n  \}/),
  "return { mcCode, mcPick, mcWa, MC_ALPHA };"
].join("\n"))();

/* and the script's */
const scriptSrc = fs.readFileSync(join(ROOT, "scripts", "make-member-codes.js"), "utf8");
const script = new Function([
  'const cc = "91";',   // the script takes this from --cc, default 91
  scriptSrc.match(/const ALPHABET = "[^"]+";/)[0],
  scriptSrc.match(/function waNumber\(v\)[\s\S]*?\n\}/)[0],
  "const pick = " + scriptSrc.match(/const pick = \(row, rx\) => \{[\s\S]*?\n\};/)[0].replace("const pick = ", ""),
  "return { waNumber, pick, ALPHABET };"
].join("\n"))();

console.log("the two implementations agree");
t("same code alphabet", admin.MC_ALPHA, script.ALPHABET);
t("alphabet excludes I O 0 1", /[IO01]/.test(admin.MC_ALPHA), false);

for (const [num, expect] of [
  ["+91 98330 40011", "919833040011"],
  ["9833040011", "919833040011"],
  ["09833040011", "919833040011"],
  ["", ""],
  ["1912", ""],
  ["+91 (98330) 40011", "919833040011"]
]) t(`phone ${JSON.stringify(num)}`, admin.mcWa(num) === script.waNumber(num) &&
      admin.mcWa(num) === expect, true);

const row = { Name: "Anil Kulkarni", Block: "A", Flat: "A-101",
              Phone: "+91 98330 40011", Email: "anil@example.com", Type: "Owner" };
t("same name picked", admin.mcPick(row, /^name$|full name|member|resident/),
  script.pick(row, /^name$|full name|member|resident/));
t("same phone picked", admin.mcPick(row, /phone|mobile|contact|cell/),
  script.pick(row, /phone|mobile|contact|cell/));
t("same email picked", admin.mcPick(row, /mail/), script.pick(row, /mail/));

/* the block-doubling rule, which was wrong once already */
console.log("\nflat labels");
const flatOf = (block, unit) => {
  const already = block && unit && unit.toUpperCase().indexOf(block.toUpperCase()) === 0;
  return !unit ? block : (block && !already) ? block + "-" + unit : unit;
};
for (const [b, u, e] of [["A", "A-101", "A-101"], ["A", "101", "A-101"],
                         ["B", "B-201", "B-201"], ["", "C-304", "C-304"], ["A", "", "A"]])
  t(`block ${JSON.stringify(b)} + flat ${JSON.stringify(u)}`, flatOf(b, u), e);

/* codes must be unique across a realistic run */
console.log("\ncode generation");
const taken = {};
const codes = Array.from({ length: 500 }, () => admin.mcCode("LVN", taken));
t("500 codes all unique", new Set(codes).size, 500);
t("shape is PREFIX-XXXXXX", /^LVN-[A-Z2-9]{6}$/.test(codes[0]), true);

/* against the real spreadsheet */
console.log("\nagainst the live data.xlsx");
const wb = XLSX.read(fs.readFileSync(join(ROOT, "data.xlsx")), { type: "buffer" });
const seen = {};
let people = 0, reachable = 0;
for (const name of ["Residents", "Committee"]) {
  if (!wb.Sheets[name]) continue;
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false })) {
    const who = admin.mcPick(r, /^name$|full name|member|resident/);
    if (!who) continue;
    people++;
    if (admin.mcWa(admin.mcPick(r, /phone|mobile|contact|cell/)) || admin.mcPick(r, /mail/)) reachable++;
    admin.mcCode("LVN", seen);
  }
}
t("people found", people > 0, true);
t("a code for each, all unique", Object.keys(seen).length, people);
console.log(`  (${reachable} of ${people} reachable by WhatsApp or email)`);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

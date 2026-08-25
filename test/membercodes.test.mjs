/**
 * The admin panel is the only thing that issues codes, so these are the rules
 * that decide whether a code handed to a resident matches the one pasted into
 * SITE_PASSWORDS.
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

/* lift the panel's helpers straight out of admin.html */
const html = fs.readFileSync(join(ROOT, "admin.html"), "utf8");
const grab = re => { const m = html.match(re); if (!m) throw new Error("missing " + re); return m[0]; };
const admin = new Function([
  grab(/var MC_ALPHA = "[^"]+";/),
  grab(/function mcCode\(prefix, taken\)[\s\S]*?\n  \}/),
  grab(/function mcPick\(row, rx, skip\)[\s\S]*?\n  \}/),
  grab(/function mcWa\(v\)[\s\S]*?\n  \}/),
  grab(/var MC_UTYPE = [^\n]+/),
  grab(/function mcKey\(p\)[\s\S]*?\n  \}/),
  grab(/function mcWhere\(p\)[\s\S]*?\n  \}/),
  "return { mcCode, mcPick, mcWa, mcKey, mcWhere, MC_ALPHA, MC_UTYPE };"
].join("\n"))();

console.log("codes");
t("alphabet excludes I O 0 1", /[IO01]/.test(admin.MC_ALPHA), false);
const taken = {};
const codes = Array.from({ length: 500 }, () => admin.mcCode("LVN", taken));
t("500 codes all unique", new Set(codes).size, 500);
t("shape is PREFIX-XXXXXX", /^LVN-[A-Z2-9]{6}$/.test(codes[0]), true);
t("no prefix still works", /^[A-Z2-9]{6}$/.test(admin.mcCode("", {})), true);

console.log("\nphone numbers for WhatsApp");
for (const [num, expect] of [
  ["+91 98330 40011", "919833040011"],
  ["9833040011", "919833040011"],
  ["09833040011", "919833040011"],
  ["+91 (98330) 40011", "919833040011"],
  ["", ""],
  ["1912", ""],            // a short helpline is not a mobile
  ["102", ""]
]) t(JSON.stringify(num), admin.mcWa(num), expect);

console.log("\ncolumns are matched by meaning");
const row = { Name: "Anil Kulkarni", Block: "A", Flat: "A-101",
              "Mobile No": "+91 98330 40011", "E-mail": "anil@example.com" };
t("name", admin.mcPick(row, /^name$|full name|member|resident/), "Anil Kulkarni");
t("phone under an odd heading", admin.mcPick(row, /phone|mobile|contact|cell/), "+91 98330 40011");
t("email under an odd heading", admin.mcPick(row, /mail/), "anil@example.com");
t("missing column is empty", admin.mcPick(row, /nothing/), "");

console.log("\nflat labels");
const flatOf = (block, unit) => {
  const already = block && unit && unit.toUpperCase().indexOf(block.toUpperCase()) === 0;
  return !unit ? block : (block && !already) ? block + "-" + unit : unit;
};
for (const [b, u, e] of [["A", "A-101", "A-101"], ["A", "101", "A-101"],
                         ["B", "B-201", "B-201"], ["", "C-304", "C-304"], ["A", "", "A"]])
  t(`block ${JSON.stringify(b)} + flat ${JSON.stringify(u)}`, flatOf(b, u), e);

console.log("\nagainst the live data.xlsx");
const wb = XLSX.read(fs.readFileSync(join(ROOT, "data.xlsx")), { type: "buffer" });
const seen = {};
let people = 0, reachable = 0;
for (const name of ["Residents", "Committee"]) {
  if (!wb.Sheets[name]) continue;
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false })) {
    if (!admin.mcPick(r, /^name$|full name|member|resident/)) continue;
    people++;
    if (admin.mcWa(admin.mcPick(r, /phone|mobile|contact|cell/)) || admin.mcPick(r, /mail/)) reachable++;
    admin.mcCode("LVN", seen);
  }
}
t("people found", people > 0, true);
t("one unique code each", Object.keys(seen).length, people);
console.log(`  (${reachable} of ${people} reachable by WhatsApp or email)`);

/* Re-running Generate used to mint a fresh code for everyone, silently voiding
   every slip already handed out. It must now recognise people already on the
   roll and only issue to newcomers. */
console.log("\nregenerating keeps codes already issued");
t("same person matches across a re-run",
  admin.mcKey({ name: "Anil Kulkarni", flat: "A-101" }) ===
  admin.mcKey({ name: " anil  kulkarni ", flat: "A-101" }), true);
t("same name, different flat is a different person",
  admin.mcKey({ name: "Anil Kulkarni", flat: "A-101" }) ===
  admin.mcKey({ name: "Anil Kulkarni", flat: "B-202" }), false);

// the merge, exactly as $("mcGen") does it
const regen = (roll, rows) => {
  const held = {}, taken = {};
  roll.forEach(p => { held[admin.mcKey(p)] = p; taken[p.code] = 1; });
  return rows.map(r => {
    const was = held[admin.mcKey(r)];
    return { ...r, code: was ? was.code : admin.mcCode("LVN", taken) };
  });
};
const first = regen([], [{ name: "Anil", flat: "A-101" }, { name: "Bina", flat: "A-102" }]);
const after = regen(first, [{ name: "Anil", flat: "A-101" }, { name: "Bina", flat: "A-102" },
                            { name: "Chetan", flat: "A-103" }]);
t("existing residents keep their codes",
  after[0].code === first[0].code && after[1].code === first[1].code, true);
t("the newcomer gets a fresh one", after[2].code !== first[0].code, true);
t("everyone still has a code", after.every(p => /^LVN-[A-Z2-9]{6}$/.test(p.code)), true);

const moved = regen(after, [{ name: "Anil", flat: "A-101" }, { name: "Chetan", flat: "A-103" }]);
t("someone dropped from the sheet loses their code",
  moved.some(p => p.code === after[1].code), false);
t("and the others are untouched",
  moved[0].code === after[0].code && moved[1].code === after[2].code, true);

/* A flat and a row house can share a wing and a number. If the panel treats
   them as one household they get one code between them — and revoking one
   revokes the other. */
console.log("\nflat B-11 and row house B-11");
const fB11 = { name: "Narendra Heda", flat: "B-11", utype: "Flat" };
const rB11 = { name: "Narendra Heda", flat: "B-11", utype: "Row House" };
t("they are not the same household", admin.mcKey(fB11) === admin.mcKey(rB11), false);
const both = regen([], [fB11, rB11]);
t("each gets its own code", both[0].code !== both[1].code, true);
const again = regen(both, [fB11, rB11]);
t("and keeps it on a re-run",
  again[0].code === both[0].code && again[1].code === both[1].code, true);

t("the slip says which home", admin.mcWhere(fB11), "B-11 (Flat)");
t("and so does the other", admin.mcWhere(rB11), "B-11 (Row House)");
t("no unit type, no brackets", admin.mcWhere({ flat: "A-101" }), "A-101");
t("no flat at all is blank", admin.mcWhere({ name: "X" }), "");

// "Unit Type" matches /unit/ in the address rule and /resident/ in the name
// rule. Left unguarded, the flat reads as "Row House".
console.log("\nUnit Type is not an address");
const rhRow = { Name: "Narendra Heda", "Unit Type": "Row House", Block: "B", Flat: "11" };
t("the flat is the number, not the kind",
  admin.mcPick(rhRow, /flat|unit|door|house/, admin.MC_UTYPE), "11");
t("the name is still the name",
  admin.mcPick(rhRow, /^name$|full name|member|resident/, admin.MC_UTYPE), "Narendra Heda");
t("and the kind is picked up on its own", admin.mcPick(rhRow, admin.MC_UTYPE), "Row House");
for (const h of ["Unit Type", "Property Type", "House Type", "Residence Type", "Unit Kind"])
  t(`"${h}" recognised`, admin.MC_UTYPE.test(h.toLowerCase()), true);
for (const h of ["Flat", "Type", "Vehicle Type", "Block"])
  t(`"${h}" is not a unit type`, admin.MC_UTYPE.test(h.toLowerCase()), false);

console.log("\nthe roll survives a reload");
t("codes are written to localStorage", /localStorage\.setItem\(MC_ROLL/.test(html), true);
t("and read back on load", /mcRestore\(\)/.test(html), true);
t("there is a way to erase them", html.includes('id="mcForget"'), true);
// The repo is public. A code written into the workbook would be readable by anyone.
t("the roll never reaches the workbook", /MC_ROLL[\s\S]{0,400}toWorkbook/.test(html), false);

console.log("\nthe admin page only offers what it should");
for (const gone of ["accSecret", "genSecret", "addCodes", "addMails", "ACCESS_FILE", "accessId"])
  t(`no leftover "${gone}"`, html.includes('"' + gone + '"'), false);
t("theme selector present", html.includes('id="themeSel"'), true);
t("slip printing present", html.includes('id="mcSlips"'), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

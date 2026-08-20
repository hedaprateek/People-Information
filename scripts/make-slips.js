#!/usr/bin/env node
/**
 * Turns access-codes.csv into a printable A4 sheet of tear-off slips —
 * one per flat, each with the flat number, its access code, and a QR that
 * opens the directory.
 *
 *   node scripts/make-codes.js A:101-108 B:201-208     # if not done yet
 *   node scripts/make-slips.js https://your-site.pages.dev --society "Green Valley Residency"
 *
 * Then open code-slips.html and press Print.
 *
 * The QR carries only the site address, never the code. A slip left on a desk
 * or photographed in a lift should not hand over access on its own — the code
 * still has to be typed.
 */

const fs = require("fs");
const path = require("path");
const qrcode = require("./vendor/qrcode.js");

/* ---------------- arguments ---------------- */
const args = process.argv.slice(2);
let url = "", csvPath = "access-codes.csv", out = "code-slips.html";
let society = "Society Directory";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--society") { society = args[++i] || society; continue; }
  if (a === "--csv")     { csvPath = args[++i] || csvPath; continue; }
  if (a === "--out")     { out = args[++i] || out; continue; }
  if (!url) url = a;
}

if (!url) {
  console.error("Give the address residents will visit:\n\n" +
    '  node scripts/make-slips.js https://your-site.pages.dev --society "Green Valley Residency"\n');
  process.exit(1);
}
url = url.replace(/\/+$/, "") + "/";

if (!fs.existsSync(csvPath)) {
  console.error(`No ${csvPath} here. Generate the codes first:\n\n` +
    "  node scripts/make-codes.js A:101-108 B:201-208 C:301-306\n");
  process.exit(1);
}

/* ---------------- read the codes ---------------- */
const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
const head = lines.shift().split(",").map(s => s.trim().toLowerCase());
const iFlat = head.indexOf("flat");
const iCode = head.findIndex(h => h.replace(/[^a-z]/g, "") === "accesscode");
if (iFlat < 0 || iCode < 0) {
  console.error(`${csvPath} needs "Flat" and "Access Code" columns.`);
  process.exit(1);
}

const slips = lines.map(l => {
  const cells = l.split(",");
  return { flat: (cells[iFlat] || "").trim(), code: (cells[iCode] || "").trim() };
}).filter(s => s.code);

if (!slips.length) { console.error(`No rows in ${csvPath}.`); process.exit(1); }

/* ---------------- one QR, reused ---------------- */
// Every slip points at the same address, so the matrix is built once.
const qr = qrcode(0, "M");
qr.addData(url);
qr.make();
const n = qr.getModuleCount();

let d = "";
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
}
const QR_SVG =
  `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true">` +
  `<rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/>` +
  `<path d="${d}" fill="#0A1628"/></svg>`;

/* ---------------- the page ---------------- */
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const cards = slips.map(s => `
    <div class="slip">
      <div class="soc">${esc(society)}</div>
      <div class="flat"><span>Flat</span> ${esc(s.flat)}</div>
      <div class="mid">
        <div class="codewrap">
          <div class="lbl">Your access code</div>
          <div class="code">${esc(s.code)}</div>
        </div>
        ${QR_SVG}
      </div>
      <div class="how">
        Scan the code or go to <b>${esc(url.replace(/^https?:\/\//, ""))}</b>,
        then type the access code above.
      </div>
      <div class="warn">Issued to this flat. Please do not pass it on.</div>
    </div>`).join("");

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(society)} — access code slips</title>
<style>
  @page { size: A4; margin: 9mm; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#0A1628;background:#eef1f6}

  .bar{padding:16px 20px;background:#0A1628;color:#fff;display:flex;gap:14px;
       align-items:center;flex-wrap:wrap}
  .bar h1{font-size:17px;font-weight:600}
  .bar p{font-size:13px;color:#8CA0B8;flex:1;min-width:220px}
  .bar button{font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:none;
    border-radius:8px;padding:10px 18px;background:#0EA5C8;color:#0A1628}

  .sheet{display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:210mm;margin:14px auto;
    background:#fff;padding:9mm}
  .slip{border:1px dashed #b6c0cf;padding:6mm 6mm 5mm;height:64mm;display:flex;
    flex-direction:column;break-inside:avoid;page-break-inside:avoid}
  .soc{font-size:9pt;letter-spacing:.08em;text-transform:uppercase;color:#5A6B82}
  .flat{font-size:19pt;font-weight:700;letter-spacing:-.02em;margin-top:1mm}
  .flat span{font-size:10pt;font-weight:500;color:#5A6B82;letter-spacing:0}
  .mid{display:flex;align-items:center;gap:4mm;margin-top:auto}
  .codewrap{flex:1;min-width:0}
  .lbl{font-size:8pt;letter-spacing:.09em;text-transform:uppercase;color:#5A6B82;margin-bottom:1mm}
  .code{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:17pt;
    font-weight:700;letter-spacing:.06em;word-break:break-all;line-height:1.15}
  .qr{width:26mm;height:26mm;flex:none}
  .how{font-size:8.5pt;color:#3F4C60;margin-top:3mm;line-height:1.4}
  .how b{font-weight:600}
  .warn{font-size:7.5pt;color:#8a6a1f;margin-top:1.5mm}

  @media print{
    body{background:#fff}
    .bar{display:none}
    .sheet{margin:0;padding:0;max-width:none}
    .slip{border-color:#ccc}
  }
</style></head>
<body>
  <div class="bar">
    <h1>${esc(society)} — ${slips.length} access slips</h1>
    <p>Print on A4, cut along the dashed lines, and hand one to each flat.
       Keep the spare copies somewhere safe — anyone holding a slip can read the directory.</p>
    <button onclick="window.print()">Print</button>
  </div>
  <div class="sheet">${cards}
  </div>
</body></html>`;

fs.writeFileSync(out, html);

const perPage = 8;
console.log(`Wrote ${out} — ${slips.length} slips, about ${Math.ceil(slips.length / perPage)} A4 page(s).`);
console.log(`QR points at ${url} (the code itself is printed, not encoded).`);
console.log(`\nOpen ${path.resolve(out)} and press Print.`);
console.log("Keep this file off the repository — it contains every access code.");

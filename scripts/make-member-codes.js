#!/usr/bin/env node
/**
 * Gives every person in the spreadsheet their own access code, and builds a
 * page for handing them out by WhatsApp, email or on paper.
 *
 *   node scripts/make-member-codes.js
 *   node scripts/make-member-codes.js --sheet Residents --sheet Committee
 *   node scripts/make-member-codes.js --site https://people-information.hedaprateek.workers.dev
 *
 * Writes three gitignored files:
 *   member-codes.txt   the SITE_PASSWORDS value to paste into Cloudflare
 *   member-codes.csv   name, flat, email, phone, code — your record of who has what
 *   member-codes.html  one card per person: copy the message, or send by WhatsApp/email
 *
 * Needs nothing beyond SITE_PASSWORDS — no KV, no email provider, no access.json.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "test", ".cache");
const LIB = path.join(CACHE, "xlsx.js");
if (!fs.existsSync(LIB)) {
  fs.mkdirSync(CACHE, { recursive: true });
  console.log("fetching SheetJS (once)…");
  execFileSync("curl", ["-sSL", "-o", LIB,
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"], { stdio: "inherit" });
}
const X = require(LIB);

/* ---------------- arguments ---------------- */
const args = process.argv.slice(2);
let site = "", prefix = "LVN", cc = "91", data = path.join(ROOT, "data.xlsx");
const sheets = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--sheet")  { sheets.push(args[++i]); continue; }
  if (a === "--site")   { site = args[++i] || ""; continue; }
  if (a === "--prefix") { prefix = args[++i] || prefix; continue; }
  if (a === "--cc")     { cc = String(args[++i] || cc).replace(/\D/g, ""); continue; }
  if (a === "--data")   { data = args[++i] || data; continue; }
}
if (!sheets.length) sheets.push("Residents");
site = (site || "https://people-information.hedaprateek.workers.dev").replace(/\/+$/, "") + "/";

if (!fs.existsSync(data)) { console.error("No " + data); process.exit(1); }
const wb = X.read(fs.readFileSync(data), { type: "buffer" });

/* ---------------- society name, for the message ---------------- */
let society = "our society";
const about = wb.Sheets["About"];
if (about) {
  X.utils.sheet_to_json(about, { defval: "", raw: false }).forEach(r => {
    const k = Object.keys(r);
    if (/society name|^name$/i.test(String(r[k[0]]))) society = String(r[k[1]]).trim() || society;
  });
}

/* ---------------- codes ---------------- */
// No I, O, 0 or 1 — misread off a slip and mistyped on a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const seen = new Set();
function newCode() {
  let c;
  do {
    const b = crypto.randomBytes(6);
    c = prefix + "-";
    for (let i = 0; i < 6; i++) c += ALPHABET[b[i] % ALPHABET.length];
  } while (seen.has(c));
  seen.add(c);
  return c;
}

/** wa.me needs digits with a country code and nothing else. */
function waNumber(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) d = cc + d;                      // bare local number
  else if (d.length === 11 && d.startsWith("0")) d = cc + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : "";
}

const pick = (row, rx) => {
  for (const k of Object.keys(row)) if (rx.test(k.toLowerCase())) {
    const v = String(row[k] || "").trim();
    if (v) return v;
  }
  return "";
};

const people = [];
for (const name of sheets) {
  const ws = wb.Sheets[name];
  if (!ws) { console.error(`(no sheet called "${name}" — skipped)`); continue; }
  X.utils.sheet_to_json(ws, { defval: "", raw: false }).forEach(row => {
    const who = pick(row, /^name$|full name|member|resident/);
    if (!who) return;
    // Many sheets write the block into the flat as well ("A" + "A-101"), so
    // only prefix when the flat does not already carry it.
    const block = pick(row, /^block|wing|tower/);
    const unit = pick(row, /flat|unit|door|house/);
    const already = block && unit &&
      unit.trim().toUpperCase().startsWith(block.trim().toUpperCase());
    const flat = !unit ? block : (block && !already) ? block + "-" + unit : unit;

    people.push({
      sheet: name,
      name: who,
      flat: flat,
      email: pick(row, /mail/),
      phone: pick(row, /phone|mobile|contact|cell/),
      code: newCode()
    });
  });
}
if (!people.length) { console.error("No people found in: " + sheets.join(", ")); process.exit(1); }

/* ---------------- the message each person gets ---------------- */
function message(p) {
  return `${society} — Directory access

Committee contacts, emergency numbers, plumber/electrician/maid contacts with charges, resident list and society documents.

Open: ${site}
Your code: ${p.code}

The code is for ${p.flat || p.name} only. Enter it once — the site remembers you for 30 days. Please do not forward it.

────────

${society} — निर्देशिका

समिति संपर्क, आपातकालीन नंबर, प्लंबर/इलेक्ट्रीशियन/मेड के नंबर और शुल्क, निवासी सूची और दस्तावेज़।

लिंक: ${site}
आपका कोड: ${p.code}

यह कोड केवल आपके लिए है। कृपया किसी और को न दें।`;
}

/* ---------------- outputs ---------------- */
fs.writeFileSync(path.join(ROOT, "member-codes.txt"),
  "Paste this whole line into Cloudflare as SITE_PASSWORDS\n" +
  "(Worker -> Settings -> Variables and Secrets), then Deploy:\n\n" +
  people.map(p => p.code).join(",") + "\n");

fs.writeFileSync(path.join(ROOT, "member-codes.csv"),
  "Sheet,Name,Flat,Email,Phone,Access Code,Sent On\n" +
  people.map(p => [p.sheet, p.name, p.flat, p.email, p.phone, p.code, ""]
    .map(v => /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(",")).join("\n") + "\n");

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const cards = people.map((p, i) => {
  const wa = waNumber(p.phone);
  const body = encodeURIComponent(message(p));
  const actions = [
    wa ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${body}">WhatsApp</a>`
       : `<span class="btn off" title="No usable phone number">No WhatsApp</span>`,
    p.email ? `<a class="btn" href="mailto:${esc(p.email)}?subject=${encodeURIComponent(society + " — Directory access")}&body=${body}">Email</a>`
            : `<span class="btn off" title="No email in the spreadsheet">No email</span>`,
    `<button class="btn ghost" data-i="${i}">Copy message</button>`
  ].join("");
  return `<div class="card" id="c${i}">
    <div class="top"><div>
      <div class="nm">${esc(p.name)}</div>
      <div class="sub">${esc([p.flat, p.sheet].filter(Boolean).join(" · "))}</div>
    </div><div class="code">${esc(p.code)}</div></div>
    <div class="meta">${esc(p.phone || "no phone")} &nbsp;·&nbsp; ${esc(p.email || "no email")}</div>
    <div class="acts">${actions}</div>
  </div>`;
}).join("");

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(society)} — hand out access codes</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0A1628;color:#E8EEF6;font-family:'Inter',system-ui,sans-serif;line-height:1.55}
  .wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:20px;font-weight:650;margin-bottom:4px}
  .lede{color:#8CA0B8;font-size:13.5px;margin-bottom:18px}
  .box{background:#0F1E36;border:1px solid rgba(255,255,255,.10);border-radius:12px;
    padding:14px 16px;margin-bottom:18px}
  .box h2{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#8CA0B8;margin-bottom:8px}
  textarea{width:100%;min-height:64px;font:12.5px ui-monospace,Consolas,monospace;color:#E8EEF6;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px}
  .grid{display:grid;gap:12px;grid-template-columns:1fr}
  @media(min-width:640px){.grid{grid-template-columns:1fr 1fr}}
  .card{background:#0F1E36;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:14px}
  .card.done{border-color:rgba(14,165,200,.5);background:#12253f}
  .top{display:flex;gap:12px;align-items:flex-start}
  .nm{font-weight:650;font-size:15.5px}
  .sub{color:#8CA0B8;font-size:12.5px}
  .code{margin-left:auto;font:700 15px ui-monospace,Consolas,monospace;letter-spacing:.06em;
    color:#E0A81E;background:rgba(224,168,30,.12);border:1px solid rgba(224,168,30,.3);
    padding:4px 9px;border-radius:7px;white-space:nowrap}
  .meta{color:#6C7E96;font-size:12px;margin-top:7px}
  .acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
  .btn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:13px;
    font-weight:600;text-decoration:none;cursor:pointer;border:none;border-radius:8px;
    padding:8px 13px;min-height:36px;color:#0A1628;background:#0EA5C8}
  .btn.wa{background:#25D366}
  .btn.ghost{background:transparent;color:#E8EEF6;border:1px solid rgba(255,255,255,.18)}
  .btn.off{background:rgba(255,255,255,.06);color:#6C7E96;cursor:not-allowed}
  .warn{background:rgba(224,168,30,.10);border:1px solid rgba(224,168,30,.34);color:#F2DFAE;
    border-radius:10px;padding:11px 14px;font-size:13px;margin-bottom:18px}
</style></head>
<body><div class="wrap">
  <h1>${esc(society)} — hand out access codes</h1>
  <p class="lede">${people.length} people. Tick each one off as you send it; the marks are remembered on this device.</p>

  <div class="warn"><b>Step 1.</b> Paste the line below into Cloudflare as <b>SITE_PASSWORDS</b> and deploy.
    Until you do, none of these codes will work.</div>

  <div class="box"><h2>SITE_PASSWORDS</h2>
    <textarea readonly id="all">${esc(people.map(p => p.code).join(","))}</textarea>
    <div class="acts"><button class="btn" id="copyAll">Copy</button></div>
  </div>

  <div class="grid">${cards}</div>
</div>
<script>
  var MSG = ${JSON.stringify(people.map(message))};
  function mark(i){
    var c = document.getElementById("c"+i);
    if (c) c.classList.add("done");
    try {
      var d = JSON.parse(localStorage.getItem("sent") || "[]");
      if (d.indexOf(i) < 0) { d.push(i); localStorage.setItem("sent", JSON.stringify(d)); }
    } catch(e){}
  }
  try { JSON.parse(localStorage.getItem("sent") || "[]").forEach(mark); } catch(e){}

  document.getElementById("copyAll").onclick = function(){
    var t = document.getElementById("all");
    t.select(); navigator.clipboard.writeText(t.value);
    this.textContent = "Copied";
  };
  document.querySelectorAll("[data-i]").forEach(function(b){
    b.onclick = function(){
      var i = +b.dataset.i;
      navigator.clipboard.writeText(MSG[i]).then(function(){
        b.textContent = "Copied"; mark(i);
        setTimeout(function(){ b.textContent = "Copy message"; }, 1500);
      });
    };
  });
  // Opening WhatsApp or the mail client counts as sent.
  document.querySelectorAll("a.btn").forEach(function(a){
    a.onclick = function(){
      var card = a.closest(".card");
      if (card) mark(+card.id.slice(1));
    };
  });
</script>
</body></html>`;

fs.writeFileSync(path.join(ROOT, "member-codes.html"), html);

const withWa = people.filter(p => waNumber(p.phone)).length;
const withMail = people.filter(p => p.email).length;
console.log(`${people.length} codes generated from: ${sheets.join(", ")}\n`);
console.log(`  member-codes.txt   the SITE_PASSWORDS line`);
console.log(`  member-codes.csv   your record of who has which code`);
console.log(`  member-codes.html  open this to send them\n`);
console.log(`  can WhatsApp: ${withWa}/${people.length}   can email: ${withMail}/${people.length}`);
console.log(`  site in the message: ${site}\n`);
console.log("All three files are gitignored — they contain every code.");

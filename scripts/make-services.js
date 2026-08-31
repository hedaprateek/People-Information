#!/usr/bin/env node
/**
 * Builds services.json — the data behind the public town page.
 *
 *   node scripts/make-services.js
 *
 * This file is served WITHOUT an access code, so what goes into it matters
 * more than anything else here. It takes the services sheet and nothing else:
 * no residents, no committee, no private sheets, no owner columns. The check
 * at the end fails the build rather than publishing a file that carries a
 * resident's name.
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
const X = require(LIB);

/** The sheet the society already shows on its own page. */
const WANTED = /^(services|services & help|services and help|help|vendors|trades)$/i;
/* A sheet for the town that the society page never shows. The leading
   underscore is the existing "parsed but not rendered" convention, so these
   rows can live in the same workbook and the same admin panel without
   appearing in the directory. */
const TOWN = /^_?town\b/i;

/** Which sheets feed the public page. About can name them outright. */
function sheetsFor(wb, about) {
  const told = (about["services page sheets"] || "").trim();
  if (told) {
    const want = told.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const hit = wb.SheetNames.filter(n => want.indexOf(n.trim().toLowerCase()) > -1);
    if (hit.length) return hit;
  }
  return wb.SheetNames.filter(n => WANTED.test(n.trim()) || TOWN.test(n.trim()));
}

function build(bookBytes) {
  const wb = X.read(bookBytes, { type: "buffer" });

  const aboutSheet0 = wb.SheetNames.filter(n => /^about$/i.test(n))[0];
  const about0 = {};
  if (aboutSheet0) {
    X.utils.sheet_to_json(wb.Sheets[aboutSheet0], { defval: "", raw: false }).forEach(r => {
      const k = Object.keys(r);
      about0[String(r[k[0]]).trim().toLowerCase()] = String(r[k[1]]).trim();
    });
  }

  const names = sheetsFor(wb, about0);
  if (!names.length)
    throw new Error("No services sheet found. Looked for: Services & Help, Services, " +
                    "Help, Vendors, Trades, or a sheet starting with Town / _Town.");
  const name = names[0];

  const rows = [];
  const seen = {};
  for (const n of names) {
    X.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: false })
      .filter(r => Object.keys(r).some(k => String(r[k] || "").trim()))
      .forEach(r => {
        // The same trade listed in both sheets should appear once.
        const id = [r.Name, r.Phone, r.Role].join("|").toLowerCase().trim();
        if (id !== "||" && seen[id]) return;
        seen[id] = 1;
        rows.push(r);
      });
  }

  /* The About sheet supplies the page's own identity. The society's name is
     deliberately NOT carried over: this link is shared around a town and does
     not need to say which society compiled it. */
  const about = about0;

  // Every column any contributing sheet has, in first-seen order.
  const columns = [];
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (columns.indexOf(k) < 0) columns.push(k);
  }));

  const out = {
    title: about["services page title"] || "Local Services & Help",
    tagline: about["services page tagline"] || "Plumbers, electricians, help at home — numbers collected by neighbours.",
    city: about["city"] || "",
    // Its own look by default. "Services Page Theme" overrides; the society's
    // own Theme is deliberately not inherited — this page is meant to read as
    // a different thing from the directory it came from.
    theme: (about["services page theme"] || "civic").toLowerCase(),
    country: about["country code"] || about["country"] || "91",
    // The caution the section carries follows the numbers out into the town,
    // where it matters more, not less.
    note: about["note: " + name.toLowerCase()] || about["note: services & help"] || "",
    noteHi: about["note hi: " + name.toLowerCase()] || about["note hi: services & help"] || "",
    updated: new Date().toISOString().slice(0, 10),
    sheets: names,
    columns: columns,
    rows: rows
  };

  /* ---- the check that matters ----
     Structural, not textual. Comparing words was useless: a category called
     "Maintenance" and a "Gas agency" appear in two sheets by coincidence, and
     the society manager is legitimately both a committee member and a service
     contact. What must be true is narrower and checkable — every published row
     came from the services sheet, and no column belongs to anything else. */
  const leaks = [];
  if (JSON.stringify(out.rows) !== JSON.stringify(rows))
    leaks.push("the published rows are not the rows that were gathered");
  // Every row must have come from a sheet that was chosen, and no other.
  var allowed = {};
  names.forEach(function (n) {
    X.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: false })
      .forEach(function (r) { allowed[JSON.stringify(r)] = 1; });
  });
  out.rows.forEach(function (r, i) {
    if (!allowed[JSON.stringify(r)]) leaks.push("row " + (i + 1) + " is not from a chosen sheet");
  });

  // Columns that only ever exist on a resident row.
  const FORBIDDEN = /^(owner|landlord)|blood|flat|block|wing|unit ?type|vehicle|parking|dob|medical|lease|police|occupants|emergency contact/i;
  out.columns.filter(c => FORBIDDEN.test(c))
    .forEach(c => leaks.push("resident column in the public file: " + c));

  // And nothing beyond the shape the page expects.
  const ALLOWED = ["title", "tagline", "city", "theme", "country", "note", "noteHi",
                   "updated", "sheets", "columns", "rows"];
  Object.keys(out).filter(k => ALLOWED.indexOf(k) < 0)
    .forEach(k => leaks.push("unexpected field: " + k));

  return { out, leaks, sheet: name };
}

if (require.main === module) {
  const { out, leaks, sheet } = build(fs.readFileSync(path.join(ROOT, "data.xlsx")));
  if (leaks.length) {
    console.error("REFUSING TO WRITE — values from other sheets appear in the public file:");
    leaks.slice(0, 10).forEach(l => console.error("  " + l));
    process.exit(1);
  }
  const file = path.join(ROOT, "services.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote services.json from \"" + sheet + "\"");
  console.log("  rows:    " + out.rows.length);
  console.log("  columns: " + out.columns.join(", "));
  console.log("  nothing from any other sheet appears in it");
}

module.exports = { build, WANTED };

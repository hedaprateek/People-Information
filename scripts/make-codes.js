#!/usr/bin/env node
/**
 * Generates access codes for the password gate, one per flat.
 *
 *   node scripts/make-codes.js A:1-8 B:1-8 C:1-6        # blocks and flat counts
 *   node scripts/make-codes.js --count 80               # just N unassigned codes
 *   node scripts/make-codes.js A:1-8 --prefix GV        # custom prefix
 *
 * Writes access-codes.csv (flat → code) and access-codes.txt (the value to
 * paste into Cloudflare). Both are gitignored — these must never be committed,
 * because anything in this repository is public.
 */

const fs = require("fs");
const crypto = require("crypto");

// No I, O, 0 or 1 — they get misread and mistyped off a printed slip.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LEN = 6;

function code(prefix) {
  let out = "";
  // rejection-free: 32 symbols divides 256 evenly, so no modulo bias
  const bytes = crypto.randomBytes(LEN);
  for (let i = 0; i < LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix ? `${prefix}-${out}` : out;
}

const args = process.argv.slice(2);
let prefix = "GV", count = 0;
const flats = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--prefix") { prefix = args[++i] || ""; continue; }
  if (a === "--count")  { count = parseInt(args[++i], 10) || 0; continue; }

  const m = a.match(/^([A-Za-z0-9]+):(\d+)-(\d+)$/);
  if (m) {
    const [, block, from, to] = m;
    for (let n = +from; n <= +to; n++) flats.push(`${block}-${n}`);
    continue;
  }
  flats.push(a);   // a literal flat label
}

if (!flats.length && !count) {
  console.error("Nothing to do.\n\n" +
    "  node scripts/make-codes.js A:1-8 B:1-8 C:1-6\n" +
    "  node scripts/make-codes.js --count 80\n");
  process.exit(1);
}

const labels = flats.length ? flats : Array.from({ length: count }, (_, i) => `Code ${i + 1}`);

// Uniqueness matters: two flats sharing a code would break traceability.
const seen = new Set();
const rows = labels.map(label => {
  let c;
  do { c = code(prefix); } while (seen.has(c));
  seen.add(c);
  return { label, code: c };
});

const csv = "Flat,Access Code,Issued On,Issued To\n" +
  rows.map(r => `${r.label},${r.code},${new Date().toISOString().slice(0, 10)},`).join("\n") + "\n";
fs.writeFileSync("access-codes.csv", csv);

const list = rows.map(r => r.code).join(",");
fs.writeFileSync("access-codes.txt",
  "Paste this whole line as SITE_PASSWORDS in Cloudflare Pages\n" +
  "(Settings -> Variables and Secrets -> Production AND Preview):\n\n" + list + "\n");

console.log(`Generated ${rows.length} codes.\n`);
console.log("  access-codes.csv  flat -> code, for issuing and for tracing a leak");
console.log("  access-codes.txt  the SITE_PASSWORDS value to paste into Cloudflare\n");
console.log("First few:");
rows.slice(0, 5).forEach(r => console.log(`  ${r.label.padEnd(10)} ${r.code}`));
if (rows.length > 5) console.log(`  … and ${rows.length - 5} more`);
console.log("\nKeep both files off the repository — everything here is public.");

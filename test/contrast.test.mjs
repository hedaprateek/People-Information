import fs from "fs";
/**
 * Warning text is painted on a translucent tint, so its real background is
 * the composite over the card colour — which differs per theme. Pale text
 * picked for the dark palette measured about 1.3:1 on the light one, i.e.
 * invisible. This keeps every one above the 4.5:1 threshold.
 *
 *   node test/contrast.test.mjs
 */

/* Composites each tinted panel over its theme's card colour and reports the
   WCAG contrast ratio of the text on it. 4.5 is the threshold for body text. */

const hex = h => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const rgba = s => {
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
};
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => Math.round(c * fg[3] + bg[i] * (1 - fg[3])));
const lum = c => {
  const f = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const cases = [
  // theme,            surface,   tint,                       text
  ["dark themes",  "#0F1E36", "rgba(242,85,90,.09)",  "#FFC2C5", "section warning"],
  ["dark themes",  "#0F1E36", "rgba(242,85,90,.14)",  "#FFC2C5", "blood badge"],
  ["dark themes",  "#0F1E36", "rgba(242,85,90,.13)",  "#FF9198", "emergency number"],
  ["dark themes",  "#0F1E36", "rgba(224,168,30,.10)", "#F2DFAE", "caution banner"],
  ["paper (light)","#FFFFFF", "rgba(185,28,28,.07)",  "#991B1B", "section warning"],
  ["paper (light)","#FFFFFF", "rgba(185,28,28,.07)",  "#991B1B", "blood badge"],
  ["paper (light)","#FFFFFF", "rgba(185,28,28,.07)",  "#B91C1C", "emergency number"],
  ["paper (light)","#FFFFFF", "rgba(180,83,9,.08)",   "#8A4B0B", "caution banner"],
  // WhatsApp green is fixed by the brand, so only the glyph on it can move.
  ["both themes",  "#25D366", "rgba(0,0,0,0)",        "#06301A", "WhatsApp glyph"]
];

let bad = 0;
let theme = "";
for (const [th, surface, tint, text, what] of cases) {
  if (th !== theme) { console.log("\n" + th); theme = th; }
  const bg = over(rgba(tint), hex(surface));
  const rr = ratio(hex(text), bg);
  const ok = rr >= 4.5;
  if (!ok) bad++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${what.padEnd(20)} ${rr.toFixed(2)}:1`);
}

/* The hero backdrop.

   It sits behind the society's name, the address line and the section
   counts, so it darkens the ground those are read on. Rendered and measured
   rather than reasoned about: two screenshots of the same page, one with the
   backdrop and one without, the clean one deciding which pixels are really
   background, then the same pixels read in the other.

   On the paper theme the muted text it has to share a background with is
   #5B6676, which starts at 5.43:1. Measured at the darkest point the
   backdrop creates anywhere in the hero:

     opacity .075  ->  4.34:1   below the threshold
     opacity .05   ->  4.54:1   over it, barely
     opacity .042  ->  4.63:1   what shipped

   The dark themes have far more room — the art is pale ink on a dark ground,
   and their muted text measures over 6:1 either way — so paper sets the
   ceiling for both. Raising it means measuring again, not guessing. */
console.log("\nthe hero backdrop");
const page = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const paperArt = page.match(/\[data-theme="paper"\] \.hero-art\{opacity:([\d.]+)\}/);
const darkArt = page.match(/\.hero-art\{[^}]*opacity:([\d.]+)/);
const paperPhoto = page.match(/\[data-theme="paper"\] \.hero-photo\{opacity:([\d.]+)\}/);
for (const [what, m, ceiling] of [
  ["drawn, paper", paperArt, 0.042],
  ["drawn, dark themes", darkArt, 0.06],
  ["photograph, paper", paperPhoto, 0.08]
]) {
  const got = m ? parseFloat(m[1]) : NaN;
  const ok = got <= ceiling + 1e-9;
  if (!ok) bad++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${(what + " \u2264 " + ceiling).padEnd(28)} ${got}`);
}
// A backdrop that is not faded out where the title sits is a different thing.
const masked = /mask="url\(#ha-mask\)"/.test(page) &&
  /stop-opacity="0"/.test(page);
if (!masked) bad++;
console.log(`  [${masked ? "PASS" : "FAIL"}] ${"faded out at the top".padEnd(28)} ${masked}`);

console.log(bad ? `\n  ${bad} below 4.5:1` : "\n  every warning is legible on its own background");
process.exit(bad ? 1 : 0);

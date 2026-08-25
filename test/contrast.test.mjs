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
  ["paper (light)","#FFFFFF", "rgba(180,83,9,.08)",   "#8A4B0B", "caution banner"]
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
console.log(bad ? `\n  ${bad} below 4.5:1` : "\n  every warning is legible on its own background");
process.exit(bad ? 1 : 0);

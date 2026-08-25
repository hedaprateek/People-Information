/**
 * Mobile ergonomics that are easy to break and invisible on a desktop browser:
 * thumb-sized tap targets, an action row that fits the narrowest phone, and
 * hover effects that would otherwise stick after a tap.
 *
 *   node test/mobile.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const html = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(50)} ${String(g).slice(0, 24)}`);
};

// the @media(max-width:700px) blocks, which is what a phone actually gets
const phone = [...css.matchAll(/@media\(max-width:700px\)\{([\s\S]*?)\n  \}/g)]
  .map(m => m[1]).join("\n");
t("phone rules found", phone.length > 0, true);

const sizeOf = (block, sel, prop) => {
  const rule = block.match(new RegExp("\\" + sel + "\\{[^}]*}", "g"));
  if (!rule) return null;
  const m = rule.join("").match(new RegExp(prop + ":(\\d+(?:\\.\\d+)?)px"));
  return m ? parseFloat(m[1]) : null;
};

/* Apple and Material both put a comfortable target at 44–48px. The card has
   four of them in a row now (call, WhatsApp, email, share), so they are the
   easiest thing on the page to mis-tap. */
console.log("thumb-sized targets");
const w = sizeOf(phone, ".iact", "width"), h = sizeOf(phone, ".iact", "height");
t("action button width >= 44px", w >= 44, true);
t("action button height >= 44px", h >= 44, true);
t("search field is at least a tap tall", /--tap:44px/.test(css), true);
t("the clear button is a full tap target", /\.qclear\{[^}]*width:var\(--tap\)/.test(css), true);

/* The narrowest phone still sold is 320px. Four buttons plus their gaps must
   fit the width a card actually has there. */
console.log("\nthe action row fits a 320px screen");
const gapM = phone.match(/\.go\{[^}]*gap:(\d+)px/);
const gap = gapM ? parseFloat(gapM[1]) : 6;
const wrapPad = 16, cardPad = 12;
const cardInner = 320 - 2 * wrapPad - 2 * cardPad;
const rowWidth = 4 * w + 3 * gap;
console.log(`  4 x ${w}px + 3 x ${gap}px = ${rowWidth}px, card gives ${cardInner}px`);
t("four buttons fit", rowWidth <= cardInner, true);
t("number gets its own line", /\.cfoot\{[^}]*flex-direction:column/.test(phone), true);

/* A touch browser applies :hover on tap and leaves it there. Anything that
   moves on hover stays moved unless it is undone where there is no pointer. */
console.log("\nhover does not stick on a touch screen");
const noHover = (css.match(/@media\(hover:none\)\{([\s\S]*?)\n  \}/) || [])[1] || "";
t("a hover:none block exists", noHover.length > 0, true);
for (const sel of [".iact.call:hover", ".iact.wa:hover", ".stat:hover", ".nav-cta:hover"])
  t(`${sel} is undone`, noHover.includes(sel), true);
t("transform is cancelled", /transform:none/.test(noHover), true);
t("tapping still gives feedback", /:active/.test(noHover), true);

// Every transform-on-hover in the stylesheet must be listed there.
const hoverMoves = [...css.matchAll(/([^\n{}]+):hover[^{]*\{[^}]*transform:(?!none)/g)]
  .map(m => m[1].trim().split(",").pop().trim());
const missed = hoverMoves.filter(s => !noHover.includes(s + ":hover"));
t("no hover-move left unhandled", missed.join(",") || "none", "none");

/* The hover:none block flattens .ccard's hover background. .ccard.sos and
   .ccard:hover have equal specificity, so the emergency card keeps its red
   only because it is declared later. Move it above and emergency cards go
   grey on touch. */
t("emergency cards are declared after the touch overrides",
  css.indexOf(".ccard.sos{") > css.indexOf("@media(hover:none)"), true);

console.log("\nreaching a section");
// Both the nav and the search bar are sticky; a jump target has to clear both.
t("jump targets reserve room for the sticky chrome",
  /\.sec,\.panel\{scroll-margin-top:calc\(var\(--navh\) \+ \d+px\)\}/.test(css), true);

console.log("\nnotched phones");
t("viewport opts into the full screen", /viewport-fit=cover/.test(html), true);
t("gutters clear the rounded corners", /padding-left:max\(16px,env\(safe-area-inset-left\)\)/.test(css), true);
t("footer clears the home indicator", /env\(safe-area-inset-bottom\)/.test(css), true);

console.log("\nthe search field on a phone keyboard");
const input = html.match(/<input id="q"[\s\S]*?>/)[0];
for (const a of ["autocapitalize=\"off\"", "autocorrect=\"off\"", "spellcheck=\"false\"",
                 "enterkeyhint=\"search\"", "aria-label"])
  t(`carries ${a.split("=")[0]}`, input.includes(a), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

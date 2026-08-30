/**
 * The installable, works-without-a-network half: manifest, icons, and the
 * service worker's rules about what it is allowed to keep.
 *
 *   node test/offline.test.mjs
 *
 * A service worker cannot be run under Node, so this reads the file. The
 * behaviour itself was checked in a real browser with the server switched
 * off — see the commit message.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const html = fs.readFileSync(ROOT + "index.html", "utf8");
const sw = fs.readFileSync(ROOT + "sw.js", "utf8");

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(50)} ${String(g).slice(0, 24)}`);
};

console.log("the manifest");
const mf = JSON.parse(fs.readFileSync(ROOT + "manifest.webmanifest", "utf8"));
t("parses", typeof mf, "object");
t("has a name", mf.name.length > 0, true);
t("has a short name for the home screen", (mf.short_name || "").length <= 12, true);
t("opens without browser chrome", mf.display, "standalone");
t("theme matches the page", mf.theme_color, "#0A1628");

/* The site is at /People-Information/ on GitHub Pages and at / on Cloudflare.
   An absolute start_url or scope would work on one and break the other. */
console.log("\npaths work on both hosts");
t("start_url is relative", mf.start_url.charAt(0), ".");
t("scope is relative", mf.scope.charAt(0), ".");
t("icons are relative", mf.icons.every(i => i.src.charAt(0) !== "/"), true);
const abs = [...sw.matchAll(/"(\/[^"]*)"/g)].map(m => m[1])
  .filter(p => !/^\/__|^\/data|^\/materials/.test(p));
t("the worker precaches nothing absolute", abs.join(",") || "none", "none");
t("registered relatively", /register\("sw\.js"\)/.test(html), true);
t("manifest linked relatively", /href="manifest\.webmanifest"/.test(html), true);

console.log("\nicons exist and are real PNGs");
const png = f => {
  const b = fs.readFileSync(ROOT + f);
  const sig = b.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
  return { sig, w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], type: b[25] };
};
for (const [f, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512],
                         ["icons/apple-touch-icon.png", 180]]) {
  const i = png(f);
  t(`${f} is a PNG`, i.sig, true);
  t(`  ${size}x${size}`, i.w === size && i.h === size, true);
}
t("both manifest icons are on disk",
  mf.icons.every(i => fs.existsSync(ROOT + i.src)), true);
t("a maskable one is offered", mf.icons.some(i => i.purpose === "maskable"), true);
t("iOS has its own icon", /rel="apple-touch-icon"/.test(html), true);

/* The gate must never be answered from a cache: a 401 login page stored as the
   site would lock someone out of their own directory, and a sign-in has to
   reach the server to be a sign-in at all. */
console.log("\nthe gate is never cached");
t("gate paths are recognised", /__\(login\|otp\|email\|status\|logout\)/.test(sw), true);
t("and returned to the network untouched", /if \(isGate\(url\)\) return;/.test(sw), true);
t("only a 200 is ever stored", /res\.status === 200/.test(sw), true);
t("and only GETs", /req\.method !== "GET"/.test(sw), true);

console.log("\nwhat is kept, and how it refreshes");
t("SheetJS is precached, or nothing renders offline",
  sw.includes("cdn.sheetjs.com"), true);
t("the page itself is precached", /"\.\/index\.html"/.test(sw), true);
// The page appends ?v=<time> to defeat CDN caching; the cache is keyed on the
// bare name or it would never once hit.
t("data.xlsx is matched without its cache-buster", /c\.match\("data\.xlsx"\)/.test(sw), true);
t("data.xlsx tries the network first", /isData\(url\)[\s\S]{0,200}fetch\(req\)/.test(sw), true);
t("so does the page, so a deploy is picked up",
  /req\.mode === "navigate"[\s\S]{0,120}fetch\(req\)/.test(sw), true);
t("old caches are cleared on version bump", /caches\["delete"\]\(k\)/.test(sw), true);

console.log("\nregistration is guarded");
t("no service worker, no problem", /"serviceWorker" in navigator/.test(html), true);
t("https or localhost only", /location\.protocol !== "https:"/.test(html), true);
t("a failed registration is swallowed", /register\("sw\.js"\)[\s\S]{0,700}catch/.test(html), true);
t("an update offers a refresh", /skip-waiting/.test(html) && /skip-waiting/.test(sw), true);

console.log("\nthe toast does not repeat the tab bar's mistake");
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const toast = (css.match(/\.toast\{[^}]*}/) || [""])[0];
t("it is fixed", /position:fixed/.test(toast), true);
// A fixed box that sets bottom but inherits a top stretches over the screen.
t("with top pinned to auto", /top:auto/.test(toast), true);
t("and clear of the tab bar on a phone",
  /@media\(max-width:700px\)\{[\s\S]{0,400}\.toast\{bottom:calc\(62px/.test(css), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

/**
 * Exercises the access gate end to end: code login, email one-time codes,
 * revocation, expiry, rate limiting and the ways each half can be misconfigured.
 *
 *   node test/gate.test.mjs
 *
 * Runs the real functions/_middleware.js against a fake KV, a fake Brevo and a
 * fake ASSETS binding — no network, no Cloudflare account.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { onRequest } = await import("file://" + join(HERE, "..", "functions", "_middleware.js").replace(/\\/g, "/"));

const COOKIE = "gate_session";
let fails = 0, sent = [];
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(48)} ${String(g).slice(0, 22).padEnd(22)} expect ${e}`);
};

/* ---------------- fakes ---------------- */
function kv() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v && v.exp > Date.now() ? v.val : null; },
    async put(k, val, o) { m.set(k, { val, exp: Date.now() + ((o && o.expirationTtl) || 600) * 1000 }); },
    async delete(k) { m.delete(k); },
    _expire(k) { const v = m.get(k); if (v) v.exp = 0; },
    _keys() { return [...m.keys()]; }
  };
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("brevo.com")) {
    const body = JSON.parse(opts.body);
    sent.push({ to: body.to[0].email, text: body.textContent });
    return { ok: true, status: 201 };
  }
  return realFetch(url, opts);
};

let servedAsset = 0;
const nextFn = () => { servedAsset++; return new Response("ASSET"); };

function req(path, { method = "GET", cookie = "", form = null } = {}) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (form) {
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  }
  return new Request("https://site.test" + path, init);
}
const run = (env, r) => onRequest({ request: r, env, next: nextFn });
const cookieOf = res => (res.headers.get("Set-Cookie") || "").split(";")[0];

const BASE = {
  SITE_PASSWORDS: "GV-PQSFHY, GV-NJTSTK",
  SESSION_SECRET: "a-long-random-secret",
  ALLOWED_EMAILS: "asha@example.com\nbrijesh@example.com",
  BREVO_API_KEY: "key", MAIL_FROM: "society@example.com"
};
const envWith = extra => ({ ...BASE, OTP: kv(), ...extra });

/* ---------------- unconfigured ---------------- */
console.log("nothing configured");
servedAsset = 0;
let r = await run({ OTP: kv() }, req("/data.xlsx"));
t("falls through to the file", servedAsset, 1);
t("no gate response", r.status, 200);

/* ---------------- code login ---------------- */
console.log("\naccess code");
let env = envWith();
servedAsset = 0;
r = await run(env, req("/data.xlsx"));
t("anonymous data.xlsx blocked", r.status, 401);
t("blocked request never reaches the file", servedAsset, 0);
let html = await r.text();
t("code form offered", html.includes('action="/__login"'), true);
t("email form offered", html.includes('action="/__email"'), true);

r = await run(env, req("/__login", { method: "POST", form: { password: "NOPE", next: "/" } }));
t("wrong code refused", r.status, 401);

r = await run(env, req("/__login", { method: "POST", form: { password: " gv pqsfhy ", next: "/admin.html" } }));
t("sloppy but valid code accepted", r.status, 303);
t("redirects where they were going", r.headers.get("Location"), "/admin.html");
const codeCookie = cookieOf(r);
t("cookie holds no code", codeCookie.includes("PQSFHY"), false);

servedAsset = 0;
r = await run(env, req("/data.xlsx", { cookie: codeCookie }));
t("signed in, file is served", servedAsset, 1);

/* ---------------- email login ---------------- */
console.log("\nemail one-time code");
env = envWith(); sent = [];
r = await run(env, req("/__email", { method: "POST", form: { email: "asha@example.com", next: "/" } }));
t("accepts a listed address", r.status, 401);
t("one email sent", sent.length, 1);
t("sent to the right person", sent[0].to, "asha@example.com");
html = await r.text();
t("now asks for the emailed code", html.includes('action="/__otp"'), true);

const otp = (sent[0].text.match(/\b(\d{6})\b/) || [])[1];
t("email contains a 6-digit code", /^\d{6}$/.test(otp || ""), true);

r = await run(env, req("/__otp", { method: "POST", form: { email: "asha@example.com", otp: "000000", next: "/" } }));
t("wrong OTP refused", r.status, 401);

r = await run(env, req("/__otp", { method: "POST", form: { email: "asha@example.com", otp, next: "/" } }));
t("correct OTP signs in", r.status, 303);
const mailCookie = cookieOf(r);
t("cookie holds no address", mailCookie.includes("asha"), false);

servedAsset = 0;
r = await run(env, req("/", { cookie: mailCookie }));
t("email session serves the site", servedAsset, 1);

r = await run(env, req("/__otp", { method: "POST", form: { email: "asha@example.com", otp, next: "/" } }));
t("OTP cannot be reused", r.status, 401);

/* ---------------- unlisted address ---------------- */
console.log("\nunlisted address");
env = envWith(); sent = [];
r = await run(env, req("/__email", { method: "POST", form: { email: "stranger@example.com", next: "/" } }));
html = await r.text();
t("no email sent", sent.length, 0);
t("reply does not reveal the list", html.includes("is on the members list"), true);
t("cannot sign in with a guess", (await run(env,
  req("/__otp", { method: "POST", form: { email: "stranger@example.com", otp: "123456", next: "/" } }))).status, 401);

/* ---------------- rate limit ---------------- */
console.log("\nrate limiting and guessing");
env = envWith(); sent = [];
await run(env, req("/__email", { method: "POST", form: { email: "asha@example.com", next: "/" } }));
await run(env, req("/__email", { method: "POST", form: { email: "asha@example.com", next: "/" } }));
t("second request within a minute sends nothing", sent.length, 1);

env = envWith(); sent = [];
await run(env, req("/__email", { method: "POST", form: { email: "brijesh@example.com", next: "/" } }));
const good = (sent[0].text.match(/\b(\d{6})\b/) || [])[1];
for (let i = 0; i < 5; i++) {
  await run(env, req("/__otp", { method: "POST", form: { email: "brijesh@example.com", otp: "111111", next: "/" } }));
}
r = await run(env, req("/__otp", { method: "POST", form: { email: "brijesh@example.com", otp: good, next: "/" } }));
t("code burned after repeated guesses", r.status, 401);

/* ---------------- revocation ---------------- */
console.log("\nrevocation");
env = envWith();
r = await run(env, req("/__login", { method: "POST", form: { password: "GV-PQSFHY", next: "/" } }));
const cA = cookieOf(r);
r = await run(env, req("/__login", { method: "POST", form: { password: "GV-NJTSTK", next: "/" } }));
const cB = cookieOf(r);

const lessCode = { ...env, SITE_PASSWORDS: "GV-NJTSTK" };
t("revoked code's session dies", (await run(lessCode, req("/", { cookie: cA }))).status, 401);
servedAsset = 0;
await run(lessCode, req("/", { cookie: cB }));
t("other resident unaffected", servedAsset, 1);

env = envWith(); sent = [];
await run(env, req("/__email", { method: "POST", form: { email: "asha@example.com", next: "/" } }));
const o2 = (sent[0].text.match(/\b(\d{6})\b/) || [])[1];
r = await run(env, req("/__otp", { method: "POST", form: { email: "asha@example.com", otp: o2, next: "/" } }));
const cMail = cookieOf(r);
const lessMail = { ...env, ALLOWED_EMAILS: "brijesh@example.com" };
t("removed address loses its session", (await run(lessMail, req("/", { cookie: cMail }))).status, 401);

/* ---------------- half-configured ---------------- */
console.log("\npartial configuration");
const noMail = { SITE_PASSWORDS: "GV-PQSFHY", SESSION_SECRET: "s" };
html = await (await run(noMail, req("/"))).text();
t("no email settings: email box hidden", html.includes('action="/__email"'), false);
t("no email settings: code box shown", html.includes('action="/__login"'), true);

const noCodes = { SESSION_SECRET: "s", ALLOWED_EMAILS: "asha@example.com",
                  BREVO_API_KEY: "k", MAIL_FROM: "s@example.com", OTP: kv() };
html = await (await run(noCodes, req("/"))).text();
t("no codes: code box hidden", html.includes('action="/__login"'), false);
t("no codes: email box shown", html.includes('action="/__email"'), true);

const noKv = { SESSION_SECRET: "s", ALLOWED_EMAILS: "asha@example.com",
               BREVO_API_KEY: "k", MAIL_FROM: "s@example.com" };
servedAsset = 0;
await run(noKv, req("/"));
t("emails listed but no KV: stays open", servedAsset, 1);

/* ---------------- tampering ---------------- */
console.log("\ntampering");
env = envWith();
const [exp, id, mac] = codeCookie.slice(COOKIE.length + 1).split(".");
t("forged signature", (await run(env, req("/", { cookie: `${COOKIE}=${exp}.${id}.deadbeef` }))).status, 401);
t("extended expiry", (await run(env, req("/", { cookie: `${COOKIE}=${Date.now() + 9e9}.${id}.${mac}` }))).status, 401);
t("no cookie", (await run(env, req("/", { cookie: "" }))).status, 401);
t("open redirect refused", (await run(env, req("/__login", { method: "POST",
   form: { password: "GV-PQSFHY", next: "//evil.com" } }))).headers.get("Location"), "/");


/* A code is checked, then a session cookie is issued to that browser. Nothing
   binds a code to one device, so a household can use one code on several. */
console.log("\nsame code on several devices");
env = envWith();
const devA = await run(env, req("/__login", { method: "POST", form: { password: "GV-PQSFHY", next: "/" } }));
const devB = await run(env, req("/__login", { method: "POST", form: { password: "GV-PQSFHY", next: "/" } }));
const cA2 = cookieOf(devA), cB2 = cookieOf(devB);
t("both devices sign in", devA.status === 303 && devB.status === 303, true);
t("each gets its own cookie", cA2 !== cB2, true);
servedAsset = 0;
await run(env, req("/", { cookie: cA2 }));
await run(env, req("/", { cookie: cB2 }));
t("both sessions work at once", servedAsset, 2);
const gone = { ...env, SITE_PASSWORDS: "GV-NJTSTK" };
t("revoking the code ends device A", (await run(gone, req("/", { cookie: cA2 }))).status, 401);
t("and device B too", (await run(gone, req("/", { cookie: cB2 }))).status, 401);


/* With no SESSION_SECRET the signing key falls back to the code list itself.
   That still cannot be forged, but the key changes whenever the list does —
   so adding one resident signs everybody out. Worth knowing before a deploy. */
console.log("\nno SESSION_SECRET set");
const bare = { SITE_PASSWORDS: "GV-PQSFHY, GV-NJTSTK", OTP: kv() };
r = await run(bare, req("/__login", { method: "POST", form: { password: "GV-PQSFHY", next: "/" } }));
t("the gate still works", r.status, 303);
const bareCookie = cookieOf(r);
servedAsset = 0;
await run(bare, req("/", { cookie: bareCookie }));
t("and the session is accepted", servedAsset, 1);

// add a newcomer's code, nobody removed
const added = { ...bare, SITE_PASSWORDS: "GV-PQSFHY, GV-NJTSTK, GV-NEWONE" };
t("adding a code logs everyone out", (await run(added, req("/", { cookie: bareCookie }))).status, 401);

// the same change with a secret set leaves sessions alone
const kept = { ...bare, SESSION_SECRET: "a-long-random-secret" };
r = await run(kept, req("/__login", { method: "POST", form: { password: "GV-PQSFHY", next: "/" } }));
const keptCookie = cookieOf(r);
servedAsset = 0;
await run({ ...kept, SITE_PASSWORDS: "GV-PQSFHY, GV-NJTSTK, GV-NEWONE" }, req("/", { cookie: keptCookie }));
t("with a secret set, they stay signed in", servedAsset, 1);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

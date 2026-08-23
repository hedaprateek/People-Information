/**
 * The admin panel writes access.json; the Worker reads it. If the two compute
 * an id even slightly differently, every resident is locked out and the cause
 * is invisible. This runs BOTH implementations and compares them, then drives
 * the gate with a generated file.
 *
 *   node test/access.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const { onRequest } = await import("file://" + join(ROOT, "functions", "_middleware.js").replace(/\\/g, "/"));

let fails = 0;
const t = (l, g, e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0, 24).padEnd(24)} expect ${e}`);
};

/* ---- lift the admin panel's own hashing out of admin.html ---- */
const html = fs.readFileSync(join(ROOT, "admin.html"), "utf8");
const grab = re => { const m = html.match(re); if (!m) throw new Error("not found: " + re); return m[0]; };
const adminSrc = [
  grab(/function b64url\(buf\)[\s\S]*?\n  \}/),
  grab(/var ALPHABET = "[^"]+";/),
  grab(/function newCode\(\)[\s\S]*?\n  \}/),
  grab(/function expandFlats\(spec\)[\s\S]*?\n  \}/),
  grab(/function maskEmail\(e\)[\s\S]*?\n  \}/),
  // accessId reads the secret from a DOM field; take the body with the secret injected
  `async function adminId(secret, kind, value) {
     var v = kind === "mail" ? String(value).trim().toLowerCase()
                             : String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
     var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
       { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
     var mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(kind + ":" + v));
     return b64url(mac).slice(0, 32);
   }`,
  "return { adminId, newCode, expandFlats, maskEmail };"
].join("\n");
const admin = new Function(adminSrc)();

/* ---- the Worker's construction, copied from the middleware source ---- */
const mwSrc = fs.readFileSync(join(ROOT, "functions", "_middleware.js"), "utf8");
const workerSrc = [
  mwSrc.match(/async function sign\(secret, msg\)[\s\S]*?\n\}/)[0],
  mwSrc.match(/const norm = s => [^\n]+/)[0],
  mwSrc.match(/const normEmail = s => [^\n]+/)[0],
  mwSrc.match(/async function accessId\(secret, kind, value\)[\s\S]*?\n\}/)[0],
  "return accessId;"
].join("\n");
const workerId = new Function(workerSrc)();

/* ---------------- the two must agree ---------------- */
console.log("admin and worker agree on every id");
const SECRET = "an-access-secret-value";
for (const [kind, value] of [
  ["code", "GV-PQSFHY"], ["code", "gv-pqsfhy"], ["code", " gv pqsfhy "],
  ["code", "AB-234XYZ"], ["mail", "Asha@Example.com"], ["mail", "  asha@example.com "],
  ["mail", "brijesh+flat@example.co.in"]
]) {
  const a = await admin.adminId(SECRET, kind, value);
  const w = await workerId(SECRET, kind, value);
  t(`${kind}: ${JSON.stringify(value)}`, a === w && a.length === 32, true);
}
t("a different secret gives a different id",
  (await admin.adminId("other", "code", "GV-PQSFHY")) !== (await admin.adminId(SECRET, "code", "GV-PQSFHY")), true);
t("code and mail namespaces do not collide",
  (await admin.adminId(SECRET, "code", "ASHA")) !== (await admin.adminId(SECRET, "mail", "ASHA")), true);

/* ---------------- helpers behave ---------------- */
console.log("\nadmin helpers");
t("flat range expands", admin.expandFlats("A:101-103").join(","), "A-101,A-102,A-103");
t("mixed spec", admin.expandFlats("A:101-102, B-205").join(","), "A-101,A-102,B-205");
t("code shape", /^GV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(admin.newCode()), true);
t("codes are unique", new Set(Array.from({ length: 300 }, admin.newCode)).size > 295, true);
t("no confusable characters", /[IO01]/.test(admin.newCode().slice(3)), false);
t("email masked", admin.maskEmail("asha@example.com").includes("asha@example.com"), false);
t("mask keeps a hint", admin.maskEmail("asha@example.com").startsWith("as"), true);

/* ---------------- drive the gate with a generated file ---------------- */
console.log("\ngate reads the published file");

const codes = { "A-101": admin.newCode(), "B-202": admin.newCode() };
const access = { v: 1, updated: "2026-08-23", codes: [], emails: [] };
for (const flat of Object.keys(codes)) {
  access.codes.push({ id: await admin.adminId(SECRET, "code", codes[flat]), flat, revoked: false });
}
access.emails.push({ id: await admin.adminId(SECRET, "mail", "asha@example.com"),
                     hint: admin.maskEmail("asha@example.com"), flat: "A-101", revoked: false });

let served = 0, sentMail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).includes("brevo.com")) { sentMail.push(JSON.parse(o.body)); return { ok: true, status: 201 }; }
  return realFetch(u, o);
};
function kv() {
  const m = new Map();
  return { async get(k){ const v=m.get(k); return v&&v.exp>Date.now()?v.val:null; },
           async put(k,v,o){ m.set(k,{val:v,exp:Date.now()+((o&&o.expirationTtl)||600)*1000}); },
           async delete(k){ m.delete(k); } };
}
const envFor = (acc) => ({
  ACCESS_SECRET: SECRET, SESSION_SECRET: "session-secret", OTP: kv(),
  BREVO_API_KEY: "k", MAIL_FROM: "s@example.com",
  ASSETS: { fetch: async () => new Response(JSON.stringify(acc), { headers: { "content-type": "application/json" } }) }
});
const req = (p, o = {}) => {
  const init = { method: o.method || "GET", headers: {} };
  if (o.cookie) init.headers.Cookie = o.cookie;
  if (o.form) { init.headers["content-type"] = "application/x-www-form-urlencoded";
                init.body = new URLSearchParams(o.form).toString(); }
  return new Request("https://site.test" + p, init);
};
const run = (env, r) => onRequest({ request: r, env, next: () => { served++; return new Response("ASSET"); } });
const cookieOf = res => (res.headers.get("Set-Cookie") || "").split(";")[0];

let env = envFor(access);
served = 0;
let r = await run(env, req("/data.xlsx"));
t("anonymous blocked", r.status, 401);
t("file not served", served, 0);

r = await run(env, req("/__login", { method: "POST", form: { password: codes["A-101"], next: "/" } }));
t("published code signs in", r.status, 303);
const c1 = cookieOf(r);
served = 0; await run(env, req("/", { cookie: c1 }));
t("session serves the site", served, 1);

r = await run(env, req("/__login", { method: "POST", form: { password: "GV-ZZZZZZ", next: "/" } }));
t("unknown code refused", r.status, 401);

// revoke A-101 exactly as the admin panel does
const revoked = JSON.parse(JSON.stringify(access));
revoked.codes.find(c => c.flat === "A-101").revoked = true;
t("revoked flat is out", (await run(envFor(revoked), req("/", { cookie: c1 }))).status, 401);

r = await run(envFor(revoked), req("/__login", { method: "POST", form: { password: codes["B-202"], next: "/" } }));
t("other flat still works", r.status, 303);

// email path against the published list
env = envFor(access); sentMail = [];
await run(env, req("/__email", { method: "POST", form: { email: "asha@example.com", next: "/" } }));
t("listed address is emailed", sentMail.length, 1);
const otp = (sentMail[0].textContent.match(/\b(\d{6})\b/) || [])[1];
r = await run(env, req("/__otp", { method: "POST", form: { email: "asha@example.com", otp, next: "/" } }));
t("emailed code signs in", r.status, 303);
const c2 = cookieOf(r);

const noMail = JSON.parse(JSON.stringify(access));
noMail.emails[0].revoked = true;
t("removed address loses its session", (await run(envFor(noMail), req("/", { cookie: c2 }))).status, 401);

sentMail = [];
await run(envFor(access), req("/__email", { method: "POST", form: { email: "stranger@example.com", next: "/" } }));
t("unlisted address gets nothing", sentMail.length, 0);

// a wrong ACCESS_SECRET must not silently authenticate anyone
const wrongSecret = { ...envFor(access), ACCESS_SECRET: "not-the-secret" };
t("wrong ACCESS_SECRET refuses the code",
  (await run(wrongSecret, req("/__login", { method: "POST", form: { password: codes["B-202"], next: "/" } }))).status, 401);

// and with no file at all the environment lists still work
const legacy = { SITE_PASSWORDS: "LEGACY-CODE", SESSION_SECRET: "s",
                 ASSETS: { fetch: async () => new Response("nope", { status: 404 }) } };
t("environment list still works",
  (await run(legacy, req("/__login", { method: "POST", form: { password: "LEGACY-CODE", next: "/" } }))).status, 303);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);

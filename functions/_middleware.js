/**
 * Password gate for the whole site — runs at Cloudflare's edge BEFORE any file
 * is served, so an unauthenticated request gets nothing: not the page, not
 * data.xlsx, not the PDFs in materials/. A login written in browser JavaScript
 * cannot do that, because the browser has to download the data to render it.
 *
 * TWO WAYS IN
 *   1. An access code issued from the admin panel and printed on a slip.
 *   2. An allowlisted email address, which receives a 6-digit code.
 * Either issues the same session. Residents without working email still get in
 * with their slip, which matters more in a housing society than it sounds.
 *
 * SETUP  (Cloudflare dashboard → project → Settings → Variables and Secrets;
 *         add to BOTH Production and Preview, then redeploy)
 *
 *   SITE_PASSWORDS   access codes, comma or newline separated   (code login)
 *   SESSION_SECRET   any long random string                     (recommended)
 *   SESSION_DAYS     how long a login lasts, default 30         (optional)
 *
 *   ALLOWED_EMAILS   allowed addresses, comma or newline separated (email login)
 *   BREVO_API_KEY    from brevo.com, free tier sends 300/day
 *   MAIL_FROM        a sender address verified in Brevo
 *   MAIL_FROM_NAME   display name, optional
 *
 *   KV namespace bound as OTP — holds the emailed codes for ten minutes.
 *
 * Each half degrades on its own: no codes and the code box disappears, no KV or
 * no Brevo key and the email box disappears. With neither configured the site
 * stays open, so a half-finished setup cannot lock everyone out — including you.
 */

const COOKIE = "gate_session";

const OTP_TTL = 600;      // seconds an emailed code stays valid
const OTP_TRIES = 5;      // wrong guesses before a code is burned
const RESEND_GAP = 60;    // seconds before the same address may ask again

/* ────────────────────────── config ────────────────────────── */

/** Codes compare case- and punctuation-insensitively: "gv-7k2m", "GV 7K2M"
 *  and "GV7K2M" are the same thing on a phone keyboard. */
const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const normEmail = s => String(s).trim().toLowerCase();
const listOf = v => String(v || "").split(/[,;\n\r]+/).map(x => x.trim()).filter(Boolean);

const poolOf = env => listOf(env.SITE_PASSWORDS || env.SITE_PASSWORD);
const emailsOf = env => listOf(env.ALLOWED_EMAILS).map(normEmail).filter(e => e.includes("@"));
const mailReady = env => !!(env.OTP && env.BREVO_API_KEY && env.MAIL_FROM);

/* ────────────────────────── entry ────────────────────────── */

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const pool = poolOf(env);
  const emails = emailsOf(env);


  const haveCodes = pool.length > 0;
  const haveList = emails.length > 0;
  const canMail = mailReady(env) && haveList;

  /* ---- diagnostics ----
     Answers the one question that is otherwise invisible: is this Worker
     running at all, and does it see any configuration? Reports only whether
     each setting is present — never a code, an address or a secret. Placed
     before the fail-open return so it answers even when nothing is set up. */
  if (url.pathname === "/__status") {
    return Response.json({
      worker: true,
      gate: haveCodes || canMail ? "on" : "OFF — nothing configured, site is public",
      codes: pool.length,
      emails: emails.length,
      set: {
        SITE_PASSWORDS: !!env.SITE_PASSWORDS,
        SESSION_SECRET: !!env.SESSION_SECRET,
        ALLOWED_EMAILS: !!env.ALLOWED_EMAILS,
        BREVO_API_KEY: !!env.BREVO_API_KEY,
        MAIL_FROM: !!env.MAIL_FROM,
        OTP_kv_binding: !!env.OTP,
        ASSETS_binding: !!env.ASSETS
      }
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!haveCodes && !canMail) return next();     // nothing configured — stay open

  const SECRET = env.SESSION_SECRET || pool.join("|") || emails.join("|");
  const DAYS = Math.max(1, parseInt(env.SESSION_DAYS || "30", 10) || 30);
  const view = { codes: haveCodes, mail: canMail };

  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
      }
    });
  }

  /* ---- 1. access code ---- */
  if (request.method === "POST" && url.pathname === "/__login") {
    const form = await request.formData();
    const dest = safePath(form.get("next"));
    const supplied = String(form.get("password") || "");
    const hit = await match(supplied, pool);
    if (hit) return signIn(SECRET, DAYS, await idOf(SECRET, "id:" + norm(hit)), dest);

    await sleep(600);
    return page(dest, view, { error: "code" });
  }

  /* ---- 2. request an emailed code ---- */
  if (request.method === "POST" && url.pathname === "/__email") {
    const form = await request.formData();
    const dest = safePath(form.get("next"));
    const addr = normEmail(form.get("email"));
    if (!canMail) return page(dest, view, { error: "code" });

    // Same reply whether or not the address is on the list, so the page cannot
    // be used to discover who lives here.
    const neutral = () => page(dest, view, { sent: true, email: addr });

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      return page(dest, view, { error: "email" });
    }
    const allowed = emails.includes(addr);
    if (!allowed) { await sleep(700); return neutral(); }

    const rk = "snd:" + (await idOf(SECRET, "mail:" + addr));
    if (await env.OTP.get(rk)) return neutral();          // asked too recently

    const code = sixDigits();
    await env.OTP.put(
      "otp:" + (await idOf(SECRET, "mail:" + addr)),
      JSON.stringify({ h: await sign(SECRET, "otp:" + addr + ":" + code), n: 0 }),
      { expirationTtl: OTP_TTL });
    await env.OTP.put(rk, "1", { expirationTtl: RESEND_GAP });

    try { await sendCode(env, addr, code); }
    catch (e) { return page(dest, view, { error: "send" }); }
    return neutral();
  }

  /* ---- 3. verify the emailed code ---- */
  if (request.method === "POST" && url.pathname === "/__otp") {
    const form = await request.formData();
    const dest = safePath(form.get("next"));
    const addr = normEmail(form.get("email"));
    const given = String(form.get("otp") || "").replace(/\D/g, "");
    const listedNow = emails.includes(addr);
    if (!canMail || !listedNow) {
      await sleep(600);
      return page(dest, view, { error: "otp", email: addr, sent: true });
    }

    const key = "otp:" + (await idOf(SECRET, "mail:" + addr));
    const raw = await env.OTP.get(key);
    if (!raw) return page(dest, view, { error: "expired", email: addr, sent: true });

    let rec; try { rec = JSON.parse(raw); } catch (e) { rec = null; }
    if (!rec) return page(dest, view, { error: "expired", email: addr, sent: true });

    if (rec.h === await sign(SECRET, "otp:" + addr + ":" + given)) {
      await env.OTP.delete(key);                       // single use
      return signIn(SECRET, DAYS, await idOf(SECRET, "mail:" + addr), dest);
    }
    rec.n = (rec.n || 0) + 1;
    if (rec.n >= OTP_TRIES) await env.OTP.delete(key);  // burn after guessing
    else await env.OTP.put(key, JSON.stringify(rec), { expirationTtl: OTP_TTL });
    await sleep(600);
    return page(dest, view, { error: "otp", email: addr, sent: true });
  }

  /* ---- already signed in? ---- */
  if (await valid(request, SECRET, pool, emails)) return next();

  return page(url.pathname + url.search, view, {});
}

/* ────────────────────────── session ────────────────────────── */

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Short, non-reversible handle so the cookie never carries a code or an
 *  address, while still identifying which one opened the session. */
async function idOf(secret, subject) {
  return (await sign(secret, subject)).slice(0, 16);
}

async function mint(secret, days, id) {
  const exp = Date.now() + days * 86400000;
  const body = `${exp}.${id}`;
  return `${body}.${await sign(secret, body)}`;
}

function signIn(secret, days, id, dest) {
  return mint(secret, days, id).then(token => new Response(null, {
    status: 303,
    headers: {
      Location: dest,
      "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${days * 86400}` +
                    `; HttpOnly; Secure; SameSite=Lax`
    }
  }));
}

async function valid(request, secret, pool, emails) {
  const raw = (request.headers.get("Cookie") || "")
    .split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return false;

  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 3) return false;
  const [exp, id, mac] = parts;

  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  if (mac !== await sign(secret, `${exp}.${id}`)) return false;

  // Bound to a live code or a listed address: remove either and that session
  // dies, without disturbing anyone else.

  const ids = await Promise.all(
    pool.map(c => idOf(secret, "id:" + norm(c)))
        .concat(emails.map(e => idOf(secret, "mail:" + e))));
  return ids.indexOf(id) !== -1;
}

/** Returns the matching code from the pool, or null. Every candidate is
 *  checked so the work does not depend on which one matched. */
async function match(supplied, pool) {
  const given = norm(supplied);
  if (!given) return null;
  const salt = crypto.randomUUID();
  const target = await sign(salt, given);
  let found = null;
  for (const code of pool) {
    if (await sign(salt, norm(code)) === target) found = found || code;
  }
  return found;
}

function sixDigits() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(100000 + (b[0] % 900000));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Only ever redirect within this site — never to an attacker's URL.
function safePath(v) {
  const s = String(v || "/");
  return /^\/[^/\\]/.test(s) || s === "/" ? s : "/";
}

/* ────────────────────────── email ────────────────────────── */

async function sendCode(env, to, code) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "Society Directory" },
      to: [{ email: to }],
      subject: `${code} is your directory code / आपका कोड`,
      textContent:
        `Your access code is ${code}\n\n` +
        `It works once and expires in 10 minutes.\n` +
        `If you did not ask for this, ignore this email.\n\n` +
        `आपका एक्सेस कोड ${code} है। यह 10 मिनट में समाप्त हो जाएगा।`,
      htmlContent:
        `<div style="font-family:system-ui,sans-serif;max-width:420px">` +
        `<p style="color:#5A6B82;font-size:14px">Your access code</p>` +
        `<p style="font-size:34px;font-weight:700;letter-spacing:.16em;margin:6px 0">${code}</p>` +
        `<p style="color:#5A6B82;font-size:13px">Works once, expires in 10 minutes. ` +
        `If you did not ask for it, ignore this email.</p>` +
        `<p style="color:#5A6B82;font-size:13px">आपका एक्सेस कोड ऊपर दिया गया है। ` +
        `यह 10 मिनट में समाप्त हो जाएगा।</p></div>`
    })
  });
  if (!r.ok) throw new Error("brevo " + r.status);
}

/* ────────────────────────── login page ────────────────────────── */

function page(dest, view, state) {
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const MSG = {
    code:    ["That code is not recognised. Please check with the committee.",
              "यह कोड मान्य नहीं है। कृपया समिति से संपर्क करें।"],
    email:   ["That does not look like an email address.",
              "यह ईमेल पता सही नहीं लगता।"],
    otp:     ["That code is wrong or has expired. Ask for a new one.",
              "कोड ग़लत है या समय समाप्त हो गया। नया कोड मँगाएँ।"],
    expired: ["That code has expired. Ask for a new one.",
              "कोड का समय समाप्त हो गया। नया कोड मँगाएँ।"],
    send:    ["The code could not be emailed just now. Please use your access code slip.",
              "अभी ईमेल नहीं भेजा जा सका। कृपया अपनी कोड पर्ची का उपयोग करें।"]
  };
  const err = state.error && MSG[state.error]
    ? `<div class="err">${esc(MSG[state.error][0])}<br><span class="hi">${esc(MSG[state.error][1])}</span></div>` : "";

  const codeForm = view.codes ? `
  <form method="POST" action="/__login">
    <input type="hidden" name="next" value="${esc(dest)}">
    <label for="p">Access code <span class="hi">एक्सेस कोड</span></label>
    <input id="p" name="password" type="text" autocapitalize="characters"
           autocomplete="one-time-code" spellcheck="false" placeholder="e.g. GV-7K2M"
           ${state.sent ? "" : "autofocus"} required>
    <button type="submit">Open directory · निर्देशिका खोलें</button>
  </form>` : "";

  // Once a code has been emailed, that form leads — it is what the reader is
  // looking at their inbox for.
  const otpForm = state.sent ? `
  <form method="POST" action="/__otp">
    <input type="hidden" name="next" value="${esc(dest)}">
    <input type="hidden" name="email" value="${esc(state.email || "")}">
    <p class="note">If <b>${esc(state.email || "")}</b> is on the members list, a code is on its way.
      <span class="hi">यदि यह पता सूची में है, तो कोड भेज दिया गया है।</span></p>
    <label for="o">6-digit code from your email <span class="hi">ईमेल में आया कोड</span></label>
    <input id="o" name="otp" type="text" inputmode="numeric" pattern="[0-9]*"
           autocomplete="one-time-code" placeholder="000000" maxlength="6" autofocus required>
    <button type="submit">Sign in · साइन इन</button>
  </form>` : "";

  const mailForm = view.mail && !state.sent ? `
  <form method="POST" action="/__email">
    <input type="hidden" name="next" value="${esc(dest)}">
    <label for="e">Email me a code <span class="hi">ईमेल से कोड मँगाएँ</span></label>
    <input id="e" name="email" type="email" inputmode="email" autocomplete="email"
           spellcheck="false" placeholder="you@example.com" required>
    <button type="submit" class="ghost">Send code · कोड भेजें</button>
  </form>` : "";

  const divider = (view.codes && view.mail && !state.sent) ? `<div class="or"><span>or · अथवा</span></div>` : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0A1628">
<title>Society Directory — Members Only</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=Noto+Sans+Devanagari:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100dvh;display:grid;place-items:center;padding:24px;
    background:linear-gradient(150deg,#0A1628,#0F1E36 55%,#152242);
    color:#E8EEF6;font-family:'Inter','Noto Sans Devanagari',system-ui,sans-serif;line-height:1.55}
  .glow{position:fixed;top:-25%;right:-15%;width:620px;height:620px;border-radius:50%;
    background:radial-gradient(circle,rgba(14,165,200,.18),transparent 62%);pointer-events:none}
  .card{position:relative;width:100%;max-width:390px;background:rgba(15,30,54,.75);
    border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:30px 26px;
    backdrop-filter:blur(10px);box-shadow:0 24px 60px -24px rgba(0,0,0,.8)}
  .dot{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;
    font-family:'Space Grotesk';font-weight:700;font-size:20px;color:#0A1628;
    background:linear-gradient(135deg,#0EA5C8,#E0A81E);margin-bottom:18px}
  h1{font-family:'Space Grotesk';font-size:21px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
  h1 .hi{display:block;font-size:14px;font-weight:500;margin-top:3px}
  p{font-size:13.5px;color:#8CA0B8;margin-bottom:18px}
  .hi{font-family:'Noto Sans Devanagari',sans-serif;color:#8CA0B8;font-weight:400}
  label{display:block;font-size:12px;font-weight:600;letter-spacing:.08em;
    text-transform:uppercase;color:#8CA0B8;margin:0 0 7px}
  label .hi{text-transform:none;letter-spacing:0;margin-left:5px;font-size:12px}
  input{width:100%;font:inherit;font-size:16px;color:#E8EEF6;min-height:46px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
    border-radius:10px;padding:11px 14px;transition:.16s}
  input:focus{outline:none;border-color:#0EA5C8;background:rgba(14,165,200,.09)}
  button{width:100%;margin-top:13px;font:inherit;font-size:15px;font-weight:600;
    cursor:pointer;color:#0A1628;background:#0EA5C8;border:none;border-radius:10px;
    min-height:46px;transition:.16s}
  button:hover{background:#22C3E6}
  button.ghost{background:transparent;color:#E8EEF6;border:1px solid rgba(255,255,255,.18)}
  button.ghost:hover{background:rgba(255,255,255,.07);border-color:#0EA5C8}
  .or{display:flex;align-items:center;gap:12px;margin:20px 0 16px;color:#5C6E88;font-size:12px}
  .or::before,.or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.10)}
  .err{background:rgba(242,85,90,.13);border:1px solid rgba(242,85,90,.4);
    color:#FFC2C5;font-size:13px;border-radius:9px;padding:10px 12px;margin-bottom:16px;line-height:1.5}
  .note{background:rgba(14,165,200,.10);border:1px solid rgba(14,165,200,.3);
    color:#BFE6F2;font-size:12.5px;border-radius:9px;padding:10px 12px;margin-bottom:14px;line-height:1.5}
  .note b{color:#fff;word-break:break-all}
  .foot{margin-top:18px;font-size:12px;color:#6C7E96;line-height:1.6}
</style></head>
<body>
<div class="glow"></div>
<div class="card">
  <div class="dot">S</div>
  <h1>Members only <span class="hi">केवल सदस्यों के लिए</span></h1>
  <p>Enter the access code issued to your flat, or ask for one by email.<br>
     <span class="hi">अपने फ्लैट का एक्सेस कोड दर्ज करें, या ईमेल से कोड मँगाएँ।</span></p>
  ${err}${otpForm}${state.sent ? "" : codeForm}${divider}${mailForm}
  <div class="foot">Issued to your flat — please do not pass it on.<br>
    <span class="hi">यह कोड आपके फ्लैट के लिए है — कृपया इसे किसी और को न दें।</span></div>
</div>
</body></html>`;

  return new Response(html, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

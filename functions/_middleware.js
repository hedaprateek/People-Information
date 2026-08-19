/**
 * Password gate for the whole site — a Cloudflare Pages Function.
 *
 * This runs on Cloudflare's edge BEFORE any file is served, so an
 * unauthenticated request gets nothing: not the page, not data.xlsx, not the
 * PDFs in materials/. That is the difference between this and a login screen
 * written in browser JavaScript, which cannot protect a file the browser has
 * to download anyway.
 *
 * SETUP  (Cloudflare dashboard → your Pages project → Settings)
 *   Variables and Secrets → add:
 *     SITE_PASSWORDS   the pool of access codes, comma or newline separated
 *     SESSION_SECRET   any long random string                  (recommended)
 *     SESSION_DAYS     how long a login lasts, default 30      (optional)
 *   SITE_PASSWORD (singular) still works as a one-code pool.
 *   Add them to BOTH Production and Preview, then redeploy.
 *
 * WHY A POOL. Issue one code per flat and a leak is traceable to whoever it
 * was given to, and revoking it costs nothing: delete that code from the list
 * and redeploy. Sessions are bound to the code that created them, so removing
 * a code signs out everyone using it while leaving every other resident alone.
 *
 * If neither variable is set the site stays open, so a misconfiguration cannot
 * lock everyone out — including you.
 */

const COOKIE = "gate_session";

/** Codes are compared case- and punctuation-insensitively so "gv-7k2m",
 *  "GV 7K2M" and "GV7K2M" are the same thing on a phone keyboard. */
function norm(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function poolOf(env) {
  return String(env.SITE_PASSWORDS || env.SITE_PASSWORD || "")
    .split(/[,;\n\r]+/).map(c => c.trim()).filter(Boolean);
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const pool = poolOf(env);
  if (!pool.length) return next();         // not configured yet — stay open

  const SECRET = env.SESSION_SECRET || pool.join("|");
  const DAYS = Math.max(1, parseInt(env.SESSION_DAYS || "30", 10) || 30);

  /* ---- sign out ---- */
  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
      }
    });
  }

  /* ---- sign in ---- */
  if (request.method === "POST" && url.pathname === "/__login") {
    const form = await request.formData();
    const supplied = String(form.get("password") || "");
    const dest = safePath(form.get("next"));

    const hit = await match(supplied, pool);
    if (hit) {
      const id = await idOf(SECRET, hit);
      return new Response(null, {
        status: 303,
        headers: {
          Location: dest,
          "Set-Cookie": `${COOKIE}=${await mint(SECRET, DAYS, id)}; Path=/; Max-Age=${DAYS * 86400}` +
                        `; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }
    // Slow a wrong answer down slightly to blunt scripted guessing.
    await new Promise(r => setTimeout(r, 600));
    return page(dest, true);
  }

  /* ---- already signed in? ---- */
  if (await valid(request, SECRET, pool)) return next();

  /* ---- everything else: ask ---- */
  return page(url.pathname + url.search, false);
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

/** A short, non-reversible handle for a code, so the cookie never carries the
 *  code itself but we can still tell which one opened the session. */
async function idOf(secret, code) {
  return (await sign(secret, "id:" + norm(code))).slice(0, 16);
}

async function mint(secret, days, id) {
  const exp = Date.now() + days * 86400000;
  const body = `${exp}.${id}`;
  return `${body}.${await sign(secret, body)}`;
}

async function valid(request, secret, pool) {
  const raw = (request.headers.get("Cookie") || "")
    .split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return false;

  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 3) return false;
  const [exp, id, mac] = parts;

  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  if (mac !== await sign(secret, `${exp}.${id}`)) return false;

  // Bound to a live code: delete the code from the pool and this session dies,
  // without disturbing anyone holding a different one.
  const ids = await Promise.all(pool.map(c => idOf(secret, c)));
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

// Compare via HMAC so the check does not leak length or prefix through timing.
async function equals(a, b) {
  const salt = crypto.randomUUID();
  const [x, y] = await Promise.all([sign(salt, a), sign(salt, b)]);
  return x === y;
}

// Only ever redirect within this site — never to an attacker's URL.
function safePath(v) {
  const s = String(v || "/");
  return /^\/[^/\\]/.test(s) || s === "/" ? s : "/";
}

/* ────────────────────────── login page ────────────────────────── */

function page(dest, failed) {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0A1628">
<title>Society Directory — Members Only</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100dvh;display:grid;place-items:center;padding:24px;
    background:linear-gradient(150deg,#0A1628,#0F1E36 55%,#152242);
    color:#E8EEF6;font-family:'Inter',system-ui,sans-serif;line-height:1.55}
  .glow{position:fixed;top:-25%;right:-15%;width:620px;height:620px;border-radius:50%;
    background:radial-gradient(circle,rgba(14,165,200,.18),transparent 62%);pointer-events:none}
  .card{position:relative;width:100%;max-width:390px;background:rgba(15,30,54,.75);
    border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:30px 26px;
    backdrop-filter:blur(10px);box-shadow:0 24px 60px -24px rgba(0,0,0,.8)}
  .dot{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;
    font-family:'Space Grotesk';font-weight:700;font-size:20px;color:#0A1628;
    background:linear-gradient(135deg,#0EA5C8,#E0A81E);margin-bottom:18px}
  h1{font-family:'Space Grotesk';font-size:21px;font-weight:700;letter-spacing:-.02em;margin-bottom:7px}
  p{font-size:13.5px;color:#8CA0B8;margin-bottom:20px}
  label{display:block;font-size:12px;font-weight:600;letter-spacing:.08em;
    text-transform:uppercase;color:#8CA0B8;margin-bottom:7px}
  input{width:100%;font:inherit;font-size:16px;color:#E8EEF6;min-height:46px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
    border-radius:10px;padding:11px 14px;transition:.16s}
  input:focus{outline:none;border-color:#0EA5C8;background:rgba(14,165,200,.09)}
  button{width:100%;margin-top:14px;font:inherit;font-size:15px;font-weight:600;
    cursor:pointer;color:#0A1628;background:#0EA5C8;border:none;border-radius:10px;
    min-height:46px;transition:.16s}
  button:hover{background:#22C3E6}
  button:active{transform:scale(.99)}
  .err{background:rgba(242,85,90,.13);border:1px solid rgba(242,85,90,.4);
    color:#FFC2C5;font-size:13px;border-radius:9px;padding:10px 12px;margin-bottom:16px}
  .foot{margin-top:18px;font-size:12px;color:#6C7E96;line-height:1.5}
</style></head>
<body>
<div class="glow"></div>
<div class="card">
  <div class="dot">S</div>
  <h1>Members only</h1>
  <p>This directory is for residents of the society. Please enter the access code issued to your flat.</p>
  ${failed ? '<div class="err">That code is not recognised. Please check with the committee.</div>' : ""}
  <form method="POST" action="/__login">
    <input type="hidden" name="next" value="${escapeHtml(dest)}">
    <label for="p">Access code</label>
    <input id="p" name="password" type="text" inputmode="text" autocapitalize="characters"
           autocomplete="one-time-code" spellcheck="false" placeholder="e.g. GV-7K2M"
           autofocus required>
    <button type="submit">Open directory</button>
  </form>
  <div class="foot">Your code is issued to your flat. Please do not pass it on —
    a shared code can be traced and cancelled.</div>
</div>
</body></html>`;

  return new Response(html, {
    status: failed ? 401 : 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

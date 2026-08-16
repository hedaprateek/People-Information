#!/usr/bin/env node
/*
 * Confirms the anon key can no longer touch your tables directly.
 * Run BEFORE and AFTER supabase/migration.sql:   node verify-lockdown.js
 *
 * Uses only the public anon key, and only sends requests that match no rows
 * (id=eq.999999999), so it can never damage real data.
 *
 * A network error is reported as ERROR, never as "blocked" — otherwise a
 * proxy outage would make a wide-open database look secure.
 */
const { execFileSync } = require("child_process");
const { devNull } = require("os"); // "nul" on Windows, "/dev/null" elsewhere

const URL = "https://axrphdcjvwzpcqmorbgw.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4cnBoZGNqdnd6cGNxbW9yYmd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjkxNTYsImV4cCI6MjEwMjQ0NTE1Nn0.o_PUwx1Y5bbkUPP7SxuDqhpT-04X3jxJmov3RdjKB3k";

const NOROW = "?id=eq.999999999";

// [label, method, path, body, anon SHOULD be able to do it]
const checks = [
  ["read members",       "GET",    "/rest/v1/members?select=*&limit=1",    null, false],
  ["read societies",     "GET",    "/rest/v1/societies?select=*&limit=1",  null, false],
  ["read share_links",   "GET",    "/rest/v1/share_links?select=*&limit=1",null, false],
  ["insert member",      "POST",   "/rest/v1/members",            '{"name":"__probe__"}', false],
  ["update member",      "PATCH",  "/rest/v1/members" + NOROW,    '{"name":"x"}',         false],
  ["delete member",      "DELETE", "/rest/v1/members" + NOROW,    null,                   false],
  ["call get_directory", "POST",   "/rest/v1/rpc/get_directory",  '{"p_token":"bogus"}',  true],
];

// Node's fetch fails behind TLS-intercepting corporate proxies; curl usually
// has the proxy CA in the system store, so fall back to it.
function viaCurl(method, path, body) {
  const args = ["-sS", "-o", devNull, "-w", "%{http_code}", "-X", method,
    URL + path, "-H", "apikey: " + KEY, "-H", "Authorization: Bearer " + KEY,
    "-H", "Content-Type: application/json"];
  if (body) args.push("-d", body);
  return Number(execFileSync("curl", args, { encoding: "utf8" }).trim());
}

async function status(method, path, body) {
  try {
    const r = await fetch(URL + path, {
      method,
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: body || undefined,
    });
    return r.status;
  } catch (e) {
    try { return viaCurl(method, path, body); }
    catch (e2) { return { error: e.message }; }
  }
}

(async () => {
  console.log("\n  Probing with the PUBLIC anon key…\n");
  let failures = 0, errors = 0;

  for (const [label, method, path, body, shouldWork] of checks) {
    const code = await status(method, path, body);

    if (typeof code !== "number") {
      errors++;
      console.log(`  [ERROR] ${label.padEnd(20)} could not reach Supabase: ${code.error}`);
      continue;
    }

    const worked = code >= 200 && code < 300;
    const ok = worked === shouldWork;
    if (!ok) failures++;

    // If the insert got through, the DB is still open — remove what we created.
    let note = "";
    if (worked && label === "insert member") {
      const gone = await status("DELETE", "/rest/v1/members?name=eq.__probe__", null);
      note = (typeof gone === "number" && gone >= 200 && gone < 300)
        ? "  <-- a row was created, and cleaned up"
        : "  <-- a row was created and could NOT be removed; delete '__probe__' by hand";
    }
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label.padEnd(20)} HTTP ${String(code).padEnd(4)}` +
                ` (${shouldWork ? "should be allowed" : "should be blocked"})${note}`);
  }

  if (errors) {
    console.log(`\n  ${errors} check(s) could not run — result is INCONCLUSIVE, not safe.` +
                `\n  Retry on a network without TLS interception, or install curl.\n`);
    process.exit(2);
  }
  console.log(failures === 0
    ? "\n  All good — anon has no direct table access; only the scoped function is reachable.\n"
    : `\n  ${failures} check(s) failed. If you have not run supabase/migration.sql yet,` +
      ` that is expected — run it, then re-run this.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

#!/usr/bin/env bash
# Proves the password gate actually protects the files, not just the page.
#
#   bash scripts/verify-gate.sh https://your-site.pages.dev GV-PQSFHY
#
# The check that matters is #2: an unauthenticated request for data.xlsx must
# NOT return a spreadsheet. A login screen that still serves the data file is
# decoration, not protection.

set -u
SITE="${1:-}"
CODE="${2:-}"
JAR="$(mktemp)"
PASS=0; FAIL=0

if [ -z "$SITE" ]; then
  echo "usage: bash scripts/verify-gate.sh <site-url> [access-code]"; exit 1
fi
SITE="${SITE%/}"

ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
no(){ echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo
echo "Testing $SITE"
echo
echo "── without a session ──────────────────────────────"

code=$(curl -s -o /dev/null -w "%{http_code}" "$SITE/")
[ "$code" = "401" ] && ok "homepage asks for a code (401)" \
                    || no "homepage returned $code — expected 401"

# The important one: is the raw data reachable?
magic=$(curl -s "$SITE/data.xlsx" | head -c 2)
if [ "$magic" = "PK" ]; then
  no "data.xlsx DOWNLOADED WITHOUT LOGIN — the gate is not protecting it"
else
  ok "data.xlsx is not served without a session"
fi

pdf=$(curl -s "$SITE/materials/Society_Bye_Laws_2024.pdf" | head -c 4)
[ "$pdf" = "%PDF" ] && no "a PDF in materials/ downloaded without login" \
                    || ok "materials/ PDFs are not served without a session"

# Match the login form itself, not the words "members only" — the directory's
# own confidentiality banner contains that phrase and would pass falsely.
body=$(curl -s "$SITE/")
echo "$body" | grep -q 'action="/__login"' && ok "the login form is served" \
                                           || no "no login form — this is not the gate"
echo "$body" | grep -qiE "9[0-9]{9}|@example\.com" \
  && no "resident data leaked into the login page" \
  || ok "no directory data in the login response"

echo
echo "── logging in ─────────────────────────────────────"

if [ -z "$CODE" ]; then
  echo "  (skipped — pass an access code as the second argument)"
else
  wrong=$(curl -s -o /dev/null -w "%{http_code}" -c "$JAR" \
          -d "password=DEFINITELY-NOT-A-CODE" -d "next=/" "$SITE/__login")
  [ "$wrong" = "401" ] && ok "a wrong code is rejected (401)" \
                       || no "a wrong code returned $wrong — expected 401"

  login=$(curl -s -o /dev/null -w "%{http_code}" -c "$JAR" \
          -d "password=$CODE" -d "next=/" "$SITE/__login")
  [ "$login" = "303" ] && ok "correct code accepted (303 redirect)" \
                       || no "correct code returned $login — expected 303"

  grep -qi "gate_session" "$JAR" && ok "session cookie was set" \
                                 || no "no session cookie in the response"

  after=$(curl -s -b "$JAR" "$SITE/data.xlsx" | head -c 2)
  [ "$after" = "PK" ] && ok "data.xlsx downloads once signed in" \
                      || no "data.xlsx still not served after login"

  page=$(curl -s -b "$JAR" "$SITE/" | head -c 400)
  echo "$page" | grep -qi "society directory\|<title>" && ok "directory renders when signed in" \
                                                       || no "directory did not render after login"
fi

echo
echo "── the old address ────────────────────────────────"
gh=$(curl -s -o /dev/null -w "%{http_code}" "https://hedaprateek.github.io/People-Information/")
if [ "$gh" = "404" ]; then
  ok "GitHub Pages is switched off"
else
  no "github.io still serves the site ($gh) — it has NO password, turn Pages off"
fi

rm -f "$JAR"
echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1

#!/usr/bin/env bash
# Requests a sign-in email from local Supabase, reads the code from Mailpit and verifies it.
set -euo pipefail
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|MAILPIT_URL|INBUCKET_URL)=')"
MP="${MAILPIT_URL:-$INBUCKET_URL}"
EMAIL="ci-$(date +%s)@test.local"

curl -sf -X POST "$API_URL/auth/v1/otp" -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"create_user\":true}" >/dev/null

for _ in $(seq 1 20); do
  ID=$(curl -s "$MP/api/v1/search?query=to:$EMAIL" | python3 -c 'import sys,json;m=json.load(sys.stdin).get("messages") or [];print(m[0]["ID"] if m else "")')
  [ -n "$ID" ] && break
  sleep 1
done
[ -n "${ID:-}" ] || { echo "No sign-in email arrived"; exit 1; }

CODE=$(curl -s "$MP/api/v1/message/$ID" | python3 -c 'import sys,json,re;h=json.load(sys.stdin)["HTML"];print(re.search(r"code in the app:\s*(?:<strong>)?\s*(\d{6})",h).group(1))')
curl -sf -X POST "$API_URL/auth/v1/verify" -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d "{\"type\":\"email\",\"email\":\"$EMAIL\",\"token\":\"$CODE\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "access_token" in d, d;print("Sign-in email and code verified for", d["user"]["email"])'

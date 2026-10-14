#!/usr/bin/env bash
set -euo pipefail
cd /home/chikewa/pronunciation-studio

TOKEN=$(grep -oP 'https://[^:]+:\K[^@]+(?=@github)' ~/.git-credentials | head -1)
[ -z "$TOKEN" ] && { echo "ERROR: no token"; exit 1; }
echo "token found (len ${#TOKEN})"

echo "=== 1) create public repo via API ==="
HTTP=$(curl -sS -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"name":"pronunciation-studio","description":"Local, privacy-first English pronunciation learning app: record, compare and get sound-by-sound IPA feedback with real AI analysis (OpenPronounce + Praat + librosa), fully offline.","homepage":"https://github.com/chikewa/pronunciation-studio","private":false,"has_issues":true,"has_wiki":false}' \
  -o /tmp/repo_resp.json -w "%{http_code}")
echo "HTTP $HTTP"
cat /tmp/repo_resp.json | python3 -m json.tool 2>/dev/null | head -20 || cat /tmp/repo_resp.json

echo "=== 2) configure git credential for this push ==="
git config --local credential.helper store

echo "=== 3) add remote and push ==="
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/chikewa/pronunciation-studio.git
echo "pushing to origin main..."
git push -u origin HEAD:main 2>&1 | grep -v "^\[WARNING\]"
echo "=== 4) verify remote state ==="
curl -sS https://api.github.com/repos/chikewa/pronunciation-studio \
  -H "Accept: application/vnd.github+json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('full_name:', d.get('full_name')); print('html_url:', d.get('html_url')); print('private:', d.get('private')); print('default_branch:', d.get('default_branch')); print('size_kb:', d.get('size'))"
echo "=== 5) delete old test repo ==="
DELHTTP=$(curl -sS -X DELETE https://api.github.com/repos/chikewa/zzz-perm-test-hermes \
  -H "Authorization: Bearer $TOKEN" \
  -w "%{http_code}" -o /dev/null)
echo "delete zzz-perm-test-hermes -> HTTP $DELHTTP (404=already gone)"
echo "ALL_DONE"

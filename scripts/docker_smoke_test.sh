#!/usr/bin/env bash
# Smoke test for the Docker deployment. Exits non-zero on the first failure.
set -uo pipefail

BASE_API="http://127.0.0.1:8000"
BASE_UI="http://127.0.0.1:8085"

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }

echo "== 1) backend health (up to 30 min: first start downloads ~2.5 GB) =="
ok=0
for i in $(seq 1 180); do
  if curl -sf "$BASE_API/api/health" -o /tmp/dt_health.json; then ok=1; break; fi
  sleep 10
done
[ "$ok" = 1 ] || fail "backend never became healthy"
pass "backend /api/health"
python3 -c "import json; d=json.load(open('/tmp/dt_health.json')); print('    status:', d.get('status'), '| version:', d.get('version')); [print('    model:', m.get('name'), '-> loaded:', m.get('loaded')) for m in d.get('models', [])]"

echo "== 2) models report installed (not just reachable) =="
curl -sf "$BASE_API/api/models" -o /tmp/dt_models.json
python3 - <<'EOF' || fail "models not all installed"
import json
d = json.load(open('/tmp/dt_models.json'))
for m in d:
    print('   ', m.get('name'), '-> loaded:', m.get('loaded'))
# Models that need weights must report installed=True in their notes;
# libraries without weights (librosa, praat) only need to be importable.
need_weights = [m for m in d if m.get('notes') and 'no weights' not in m.get('notes', '')]
bad = [m for m in need_weights if 'installed=True' not in m.get('notes', '')]
assert not bad, f"not installed: {bad}"
EOF
pass "all models installed"

echo "== 3) lessons API through the nginx proxy (single origin) =="
curl -sf "$BASE_UI/api/lessons" -o /tmp/dt_lessons.json
python3 -c "import json; d=json.load(open('/tmp/dt_lessons.json')); print('    lessons:', len(d), '| first:', d[0]['title'])" || fail "nginx /api proxy broken"
pass "nginx proxies /api -> backend"

echo "== 4) frontend HTML served =="
code=$(curl -s -o /tmp/dt_index.html -w "%{http_code}" "$BASE_UI/")
[ "$code" = 200 ] && grep -q "Pronunciation Studio" /tmp/dt_index.html || fail "frontend not served"
pass "frontend index.html"

echo "== 5) reference synthesis (Piper, offline) through the API =="
REF=$(curl -sf -X POST "$BASE_API/api/references/synthesize" \
  -H "Content-Type: application/json" \
  -d '{"text":"The quick brown fox jumps over the lazy dog.","variety":"en_US"}')
echo "$REF" | python3 -c "import sys,json; d=json.load(sys.stdin); print('    ref:', d.get('id'), d.get('source'), d.get('duration_s'), 's')" || fail "synthesize"
RID=$(echo "$REF" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
code=$(curl -s -o /tmp/dt_ref.wav -w "%{http_code}" "$BASE_API/api/references/$RID.wav")
[ "$code" = 200 ] && [ -s /tmp/dt_ref.wav ] || fail "reference wav download"
pass "reference audio (Piper)"

echo "== 6) full pronunciation analysis (real CPU inference) =="
cp /tmp/dt_ref.wav /tmp/dt_up.wav
SAVE=$(curl -sf -X POST "$BASE_API/api/audio/save" \
  -F "file=@/tmp/dt_up.wav;type=audio/wav" -F "filename=smoketest.wav")
RID2=$(echo "$SAVE" | python3 -c "import sys,json; print(json.load(sys.stdin)['recording_id'])")
JOB=$(curl -sf -X POST "$BASE_API/api/pronunciation/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"recording_id\":\"$RID2\",\"expected_text\":\"The quick brown fox jumps over the lazy dog.\",\"exercise_id\":\"docker-smoke\"}")
JID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
st=""
for i in $(seq 1 60); do
  S=$(curl -sf "$BASE_API/api/pronunciation/status/$JID")
  st=$(echo "$S" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [ "$st" = done ] && break
  [ "$st" = error ] && fail "analysis job failed: $(echo $S | head -c 300)"
  sleep 5
done
[ "$st" = done ] || fail "analysis job did not complete (last status: $st)"
curl -sf "$BASE_API/api/pronunciation/status/$JID" -o /tmp/dt_result.json
python3 - <<'EOF' || fail "analysis result invalid"
import json
d = json.load(open('/tmp/dt_result.json'))['result']
print('    score:', d.get('score'), '| confidence:', d.get('score_confidence'))
print('    transcription:', d.get('transcription'))
print('    model:', d.get('model_name'), d.get('model_version'))
assert d.get('score') is not None, 'score missing'
assert d.get('acoustics'), 'acoustics missing'
EOF
pass "real analysis pipeline in container"

echo "== 7) progress recorded =="
curl -sf "$BASE_API/api/progress" | python3 -c "import sys,json; d=json.load(sys.stdin); print('    attempts:', d.get('total_attempts'), '| lessons completed:', d.get('lessons_completed'))"
pass "progress endpoint"

echo ""
echo "ALL_DOCKER_SMOKE_TESTS_PASSED"

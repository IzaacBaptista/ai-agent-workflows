#!/bin/bash
set -e

VERSION=""
DRY_RUN=""
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Parse arguments: position-independent flag handling
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="yes" ;;
    *)         [ -z "$VERSION" ] && VERSION="$arg" ;;
  esac
done

echo "[PREFLIGHT] Starting pre-flight checks in $PROJECT_ROOT" >&2
cd "$PROJECT_ROOT"

if [ -z "$VERSION" ] && [ -f "package.json" ]; then
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
fi
VERSION="${VERSION:-0.0.0}"

TESTS_STATUS="skip"
CLEAN_TREE_STATUS="skip"
CHANGELOG_STATUS="skip"
READY=true

# Detect test command from package.json with fallback
TEST_CMD=""
if [ -f "package.json" ]; then
  if node -e "const d=require('./package.json'); process.exit('test' in (d.scripts||{}) ? 0 : 1)" 2>/dev/null; then
    TEST_CMD="npm run test"
  fi
fi

if [ -z "$DRY_RUN" ]; then
  # Check for uncommitted changes
  if git diff --quiet && git diff --cached --quiet; then
    CLEAN_TREE_STATUS="pass"
    echo "[PREFLIGHT] ✅ No uncommitted changes" >&2
  else
    CLEAN_TREE_STATUS="fail"
    READY=false
    echo "[PREFLIGHT] ❌ Uncommitted changes detected" >&2
    git --no-pager status --short >&2
  fi

  # Run tests
  if [ -n "$TEST_CMD" ]; then
    echo "[PREFLIGHT] Running test suite: $TEST_CMD" >&2
    TEST_LOG=$(mktemp)
    if $TEST_CMD > "$TEST_LOG" 2>&1; then
      TESTS_STATUS="pass"
      echo "[PREFLIGHT] ✅ Tests passing" >&2
    else
      TESTS_STATUS="fail"
      READY=false
      echo "[PREFLIGHT] ❌ Tests failing — see $TEST_LOG" >&2
      tail -20 "$TEST_LOG" >&2 || true
    fi
    rm -f "$TEST_LOG"
  else
    TESTS_STATUS="skip"
    echo "[PREFLIGHT] ⚠️  No test script found in package.json — skipping" >&2
  fi

  # Check changelog
  if [ -f "CHANGELOG.md" ]; then
    if [ -n "$VERSION" ] && grep -Fq "$VERSION" CHANGELOG.md; then
      CHANGELOG_STATUS="pass"
      echo "[PREFLIGHT] ✅ CHANGELOG.md updated for $VERSION" >&2
    else
      CHANGELOG_STATUS="warn"
      echo "[PREFLIGHT] ⚠️  CHANGELOG.md not updated for $VERSION" >&2
    fi
  else
    CHANGELOG_STATUS="warn"
    echo "[PREFLIGHT] ⚠️  CHANGELOG.md not found" >&2
  fi
else
  echo "[PREFLIGHT] DRY RUN — skipping checks" >&2
  TESTS_STATUS="skip"
  CLEAN_TREE_STATUS="skip"
  CHANGELOG_STATUS="skip"
fi

if $READY; then
  echo "[PREFLIGHT] ✅ Ready to release: $VERSION" >&2
else
  echo "[PREFLIGHT] ❌ Not ready to release: fix failures above" >&2
fi

python3 -c "
import json, sys
ready = sys.argv[1] == 'true'
print(json.dumps({
  'version': sys.argv[2],
  'ready': ready,
  'checks': {
    'tests': sys.argv[3],
    'clean_tree': sys.argv[4],
    'changelog': sys.argv[5]
  }
}))
" "$($READY && echo true || echo false)" "$VERSION" "$TESTS_STATUS" "$CLEAN_TREE_STATUS" "$CHANGELOG_STATUS"

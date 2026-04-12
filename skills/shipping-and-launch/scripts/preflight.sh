#!/bin/bash
set -e

VERSION="${1:-}"
DRY_RUN="${2:-}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

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

if [ "$DRY_RUN" != "--dry-run" ]; then
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
  echo "[PREFLIGHT] Running test suite..." >&2
  if npm run test 2>/tmp/preflight-test.log; then
    TESTS_STATUS="pass"
    echo "[PREFLIGHT] ✅ Tests passing" >&2
  else
    TESTS_STATUS="fail"
    READY=false
    echo "[PREFLIGHT] ❌ Tests failing — see /tmp/preflight-test.log" >&2
  fi

  # Check changelog
  if [ -f "CHANGELOG.md" ]; then
    if grep -q "$VERSION" CHANGELOG.md; then
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

READY_JSON="$( [ "$READY" = "true" ] && echo "true" || echo "false" )"
echo "{\"version\": \"$VERSION\", \"ready\": $READY_JSON, \"checks\": {\"tests\": \"$TESTS_STATUS\", \"clean_tree\": \"$CLEAN_TREE_STATUS\", \"changelog\": \"$CHANGELOG_STATUS\"}}"

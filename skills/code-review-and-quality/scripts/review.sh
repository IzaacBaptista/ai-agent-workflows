#!/bin/bash
set -e

TARGET="HEAD"
FIX_FLAG=""
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPORT_FILE=""
LINT_OUTPUT=""
FINDINGS_FILE=""
TMPFILE=""

# Parse arguments: position-independent flag handling
for arg in "$@"; do
  case "$arg" in
    --fix) FIX_FLAG="--fix" ;;
    *)     TARGET="$arg" ;;
  esac
done

cleanup() {
  [ -n "$FINDINGS_FILE" ] && rm -f "$FINDINGS_FILE"
  [ -n "$LINT_OUTPUT" ]   && rm -f "$LINT_OUTPUT"
  [ -n "$TMPFILE" ]       && rm -f "$TMPFILE"
}
trap cleanup EXIT

REPORT_FILE=$(mktemp)
LINT_OUTPUT=$(mktemp)
FINDINGS_FILE=$(mktemp)

echo "Reviewing: $TARGET" >&2
cd "$PROJECT_ROOT"

ERRORS=0
WARNINGS=0

# Detect lint command with fallback
LINT_CMD=""
if [ -f "package.json" ]; then
  if python3 -c "import json; d=json.load(open('package.json')); exit(0 if 'lint' in d.get('scripts',{}) else 1)" 2>/dev/null; then
    LINT_CMD="npm run lint"
  fi
fi

if [ -n "$LINT_CMD" ]; then
  echo "Running lint check: $LINT_CMD" >&2
  if $LINT_CMD > "$LINT_OUTPUT" 2>&1; then
    echo "Lint: no errors" >&2
  else
    ERRORS=$((ERRORS + 1))
    echo "Lint errors found" >&2
  fi
else
  echo "No lint script found in package.json — skipping" >&2
  echo "(no lint command detected)" > "$LINT_OUTPUT"
fi

if [ "$FIX_FLAG" = "--fix" ] && [ -f "node_modules/.bin/eslint" ]; then
  echo "Running eslint --fix..." >&2
  npx eslint --fix src/ >> "$LINT_OUTPUT" 2>&1 || true
fi

# Check for git diff if TARGET is not HEAD
DIFF_STATS=""
if [ "$TARGET" != "HEAD" ] && git rev-parse "$TARGET" > /dev/null 2>&1; then
  DIFF_STATS=$(git --no-pager diff --stat "$TARGET" 2>/dev/null || echo "")
  # Count potential issues from diff
  ADDED_LINES=$(git --no-pager diff "$TARGET" 2>/dev/null | grep '^+' | grep -v '^+++' | wc -l || echo 0)
  if [ "$ADDED_LINES" -gt 300 ]; then
    WARNINGS=$((WARNINGS + 1))
    echo "Warning: Large diff ($ADDED_LINES added lines)" >&2
  fi
fi

TMPFILE=$(mktemp)
cat > "$TMPFILE" << REVIEWEOF
# Code Review Report

**Target:** $TARGET
**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Project:** $PROJECT_ROOT

## Summary

| Severity | Count |
|----------|-------|
| Errors   | $ERRORS |
| Warnings | $WARNINGS |

## Diff Stats

${DIFF_STATS:-N/A}

## Checklist

### Correctness
- [ ] Logic is correct for all identified paths
- [ ] Error cases are handled and not silently swallowed
- [ ] Async operations are properly awaited

### Types & Interfaces
- [ ] All functions have explicit return types
- [ ] No \`any\` types without justification
- [ ] Zod schemas validate external data

### Security
- [ ] No secrets in source code
- [ ] External inputs are validated before use
- [ ] No eval() or dynamic code execution

### Readability
- [ ] Variable and function names are descriptive
- [ ] Complex logic has explanatory comments
- [ ] Functions are ≤ 50 lines

### Tests
- [ ] New behaviour is covered by tests
- [ ] Edge cases are tested
- [ ] Tests are independent and deterministic

## Lint Output

$(cat "$LINT_OUTPUT" 2>/dev/null || echo "No lint output")
REVIEWEOF

mv "$TMPFILE" "$REPORT_FILE"
echo "Review report written to $REPORT_FILE" >&2

python3 -c "
import json, sys
print(json.dumps({
  'target': sys.argv[1],
  'findings': [],
  'summary': {'errors': int(sys.argv[2]), 'warnings': int(sys.argv[3]), 'info': 0},
  'review_report': sys.argv[4]
}))
" "$TARGET" "$ERRORS" "$WARNINGS" "$REPORT_FILE"

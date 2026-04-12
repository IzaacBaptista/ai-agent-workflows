#!/bin/bash
set -e

TARGET="${1:-HEAD}"
FIX_FLAG="${2:-}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPORT_FILE="/tmp/code-review.md"
FINDINGS_FILE=$(mktemp)
TMPFILE=""

cleanup() {
  rm -f "$FINDINGS_FILE"
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

echo "Reviewing: $TARGET" >&2
cd "$PROJECT_ROOT"

ERRORS=0
WARNINGS=0

echo "[]" > "$FINDINGS_FILE"

echo "Running TypeScript type check..." >&2
if npm run lint 2>/tmp/lint-output.txt; then
  echo "TypeScript: no errors" >&2
else
  ERRORS=$((ERRORS + 1))
  echo "TypeScript errors found — see /tmp/lint-output.txt" >&2
fi

if [ "$FIX_FLAG" = "--fix" ] && [ -f "node_modules/.bin/eslint" ]; then
  echo "Running eslint --fix..." >&2
  npx eslint --fix src/ 2>/dev/null || true
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

## Checklist

### Correctness
- [ ] Logic is correct for all identified paths
- [ ] Error cases are handled and not silently swallowed
- [ ] Async operations are properly awaited

### Types & Interfaces
- [ ] All functions have explicit return types
- [ ] No `any` types without justification
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

## TypeScript Output

$(cat /tmp/lint-output.txt 2>/dev/null || echo "No lint output")
REVIEWEOF

mv "$TMPFILE" "$REPORT_FILE"
echo "Review report written to $REPORT_FILE" >&2

echo "{\"target\": \"$TARGET\", \"findings\": [], \"summary\": {\"errors\": $ERRORS, \"warnings\": $WARNINGS, \"info\": 0}, \"review_report\": \"$REPORT_FILE\"}"

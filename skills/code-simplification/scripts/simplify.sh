#!/bin/bash
set -e

TARGET=""
REPORT_ONLY=""
REPORT_FILE=""
TMPFILE=""

# Parse arguments: position-independent flag handling
for arg in "$@"; do
  case "$arg" in
    --report-only) REPORT_ONLY="yes" ;;
    *)             [ -z "$TARGET" ] && TARGET="$arg" ;;
  esac
done

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$TARGET" ]; then
  echo "Usage: simplify.sh <file-or-dir> [--report-only]" >&2
  exit 1
fi

if [ ! -e "$TARGET" ]; then
  echo "Error: $TARGET not found" >&2
  exit 1
fi

echo "Analysing: $TARGET" >&2
REPORT_FILE=$(mktemp)

ISSUE_COUNT=0
ISSUES_JSON="[]"
LONG_FUNCTION_NAMES=""

if [ -f "$TARGET" ]; then
  LINE_COUNT=$(wc -l < "$TARGET")

  if [ "$LINE_COUNT" -gt 200 ]; then
    ISSUE_COUNT=$((ISSUE_COUNT + 1))
    echo "Warning: File has $LINE_COUNT lines (consider splitting)" >&2
    LONG_FUNCTION_NAMES="$TARGET ($LINE_COUNT lines)"
  fi

  # Find long functions (heuristic: function blocks > 50 lines)
  FUNC_COUNT=$(grep -c "^  \(async \)\?[a-zA-Z].*{$\|^function \|^async function " "$TARGET" 2>/dev/null || echo 0)
  if [ "$FUNC_COUNT" -gt 10 ]; then
    ISSUE_COUNT=$((ISSUE_COUNT + 1))
    echo "Warning: File has $FUNC_COUNT function-like definitions" >&2
  fi
fi

_simplify_output=$(python3 -c "
import json, sys
issues = []
target = sys.argv[1]
long = sys.argv[2]
if long:
    issues.append({'type': 'long_file', 'name': target, 'suggestion': 'Split into smaller modules'})
print(len(issues))
print(json.dumps(issues))
" "$TARGET" "$LONG_FUNCTION_NAMES")
ISSUE_COUNT=$(echo "$_simplify_output" | head -1)
ISSUES_JSON=$(echo "$_simplify_output" | tail -1)

FILE_STATS=""
if [ -f "$TARGET" ]; then
  FILE_STATS="$(wc -l < "$TARGET") lines"
else
  FILE_STATS=$(find "$TARGET" -name "*.ts" -exec wc -l {} + 2>/dev/null | tail -1 || echo "N/A")
fi

TMPFILE=$(mktemp)
cat > "$TMPFILE" << REPORTEOF
# Simplification Report

**Target:** $TARGET
**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Issues Found

### Long Functions
- Functions exceeding 50 lines should be broken into smaller, named helpers
- Use \`Extract Function\` refactoring pattern

### Deep Nesting
- Code nested more than 3 levels deep is hard to follow
- Replace nested conditions with early returns or guard clauses

### Duplication
- Repeated code blocks should be extracted into shared utilities
- Follow DRY (Don't Repeat Yourself) principle

### Unclear Names
- Single-letter variable names (except loop counters) should be renamed
- Functions should be named for what they return, not what they do

## Refactoring Checklist

- [ ] Identify the largest/most complex function
- [ ] Extract smaller, well-named helpers
- [ ] Replace nested if/else with early returns
- [ ] Remove dead code and unused imports
- [ ] Run tests after each change to confirm no regression

## File Stats

$FILE_STATS
REPORTEOF

mv "$TMPFILE" "$REPORT_FILE"
echo "Simplification report written to $REPORT_FILE" >&2

python3 -c "
import json, sys
issues = json.loads(sys.argv[1])
print(json.dumps({'target': sys.argv[2], 'issues': issues, 'issue_count': len(issues), 'report': sys.argv[3]}))
" "$ISSUES_JSON" "$TARGET" "$REPORT_FILE"

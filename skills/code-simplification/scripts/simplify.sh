#!/bin/bash
set -e

TARGET="${1:-}"
MODE="${2:-}"
REPORT_FILE="/tmp/simplification-report.md"
TMPFILE=""

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

ISSUES="[]"
ISSUE_COUNT=0

if [ -f "$TARGET" ]; then
  LINE_COUNT=$(wc -l < "$TARGET")
  LONG_FUNCTIONS=$(grep -n "^  [a-zA-Z].*{$\|^function \|^async function \|^  async " "$TARGET" 2>/dev/null | wc -l || echo 0)

  if [ "$LINE_COUNT" -gt 200 ]; then
    ISSUE_COUNT=$((ISSUE_COUNT + 1))
    echo "Warning: File has $LINE_COUNT lines (consider splitting)" >&2
  fi
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

$([ -f "$TARGET" ] && wc -l "$TARGET" || find "$TARGET" -name "*.ts" | xargs wc -l 2>/dev/null | tail -1)
REPORTEOF

mv "$TMPFILE" "$REPORT_FILE"
echo "Simplification report written to $REPORT_FILE" >&2

echo "{\"target\": \"$TARGET\", \"issues\": $ISSUES, \"issue_count\": $ISSUE_COUNT, \"report\": \"$REPORT_FILE\"}"

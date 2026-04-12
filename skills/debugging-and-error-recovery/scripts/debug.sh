#!/bin/bash
set -e

SYMPTOM="${1:-}"
LOG_FILE="${2:-}"
REPORT_FILE="/tmp/debug-report.md"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$SYMPTOM" ]; then
  echo "Usage: debug.sh <error-or-symptom> [log-file]" >&2
  exit 1
fi

echo "Diagnosing: $SYMPTOM" >&2

CATEGORY="unknown"
HYPOTHESIS="Investigate the stack trace and surrounding context"

if echo "$SYMPTOM" | grep -qi "undefined\|null\|cannot read"; then
  CATEGORY="null_reference"
  HYPOTHESIS="Object accessed before initialisation or after an async gap"
elif echo "$SYMPTOM" | grep -qi "ECONNREFUSED\|ETIMEDOUT\|network\|fetch"; then
  CATEGORY="network_error"
  HYPOTHESIS="Service unreachable — check host, port, and firewall rules"
elif echo "$SYMPTOM" | grep -qi "SyntaxError\|unexpected token\|parse"; then
  CATEGORY="parse_error"
  HYPOTHESIS="Malformed input — check JSON/YAML structure or TypeScript types"
elif echo "$SYMPTOM" | grep -qi "timeout\|timed out"; then
  CATEGORY="timeout"
  HYPOTHESIS="Operation exceeded allowed duration — check network latency or increase timeout"
elif echo "$SYMPTOM" | grep -qi "permission\|EACCES\|EPERM"; then
  CATEGORY="permissions"
  HYPOTHESIS="File or process permissions issue — check ownership and chmod"
fi

TMPFILE=$(mktemp)
cat > "$TMPFILE" << REPORTEOF
# Debug Report

**Symptom:** $SYMPTOM
**Category:** $CATEGORY
**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Hypothesis

$HYPOTHESIS

## Investigation Steps

1. Reproduce the error in isolation (minimal repro)
2. Check the full stack trace for the root call site
3. Add defensive null checks or error handling at the identified location
4. Run the test suite to confirm the fix does not regress other behaviour
5. Add a regression test for the fixed scenario

## Log Context

$([ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] && tail -50 "$LOG_FILE" || echo "No log file provided.")

## Fix Checklist

- [ ] Root cause identified
- [ ] Fix applied at root cause (not symptom)
- [ ] Regression test added
- [ ] Full test suite passes
REPORTEOF

mv "$TMPFILE" "$REPORT_FILE"
echo "Debug report written to $REPORT_FILE" >&2

echo "{\"symptom\": \"$SYMPTOM\", \"category\": \"$CATEGORY\", \"hypothesis\": \"$HYPOTHESIS\", \"investigation_steps\": [\"Check call stack\",\"Add null guard\",\"Verify async ordering\"], \"debug_report\": \"$REPORT_FILE\"}"

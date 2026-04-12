#!/bin/bash
set -e

GOAL="${1:-}"
OUTPUT_FILE="${2:-/tmp/plan.md}"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$GOAL" ]; then
  echo "Usage: plan.sh <goal> [output-file]" >&2
  exit 1
fi

echo "Planning: $GOAL" >&2
mkdir -p "$(dirname "$OUTPUT_FILE")"
TMPFILE=$(mktemp)

cat > "$TMPFILE" << PLANEOF
# Plan: $GOAL

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Work Streams

### Stream 1: Foundation
- [ ] Task 1.1 — Define requirements and acceptance criteria (S)
- [ ] Task 1.2 — Identify affected files and dependencies (S)
- [ ] Task 1.3 — Create feature branch (XS)

### Stream 2: Implementation
- [ ] Task 2.1 — Implement core logic (M)
- [ ] Task 2.2 — Integrate with existing system (M)
- [ ] Task 2.3 — Handle error cases (S)

### Stream 3: Quality
- [ ] Task 3.1 — Write unit tests (M)
- [ ] Task 3.2 — Run full test suite and fix failures (S)
- [ ] Task 3.3 — Code review (S)

### Stream 4: Delivery
- [ ] Task 4.1 — Update documentation (S)
- [ ] Task 4.2 — Create pull request (XS)
- [ ] Task 4.3 — Address review feedback (S)

## Effort Key
- XS = < 30 min | S = 30–90 min | M = 90 min–4 h | L = 4–8 h | XL = > 1 day
PLANEOF

mv "$TMPFILE" "$OUTPUT_FILE"
echo "Plan written to $OUTPUT_FILE" >&2

TASK_COUNT=$(grep -c '^\- \[ \]' "$OUTPUT_FILE" || true)
echo "{\"goal\": \"$GOAL\", \"task_count\": $TASK_COUNT, \"plan_file\": \"$OUTPUT_FILE\"}"

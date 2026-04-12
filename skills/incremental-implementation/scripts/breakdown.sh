#!/bin/bash
set -e

INPUT="${1:-}"
STEPS_FILE="${2:-/tmp/impl-steps.json}"

if [ -z "$INPUT" ]; then
  echo "Usage: breakdown.sh <spec-or-feature> [steps-file]" >&2
  exit 1
fi

FEATURE="$INPUT"
if [ -f "$INPUT" ]; then
  FEATURE=$(head -1 "$INPUT" | sed 's/^# Spec: //')
  echo "Read spec from file: $INPUT" >&2
fi

echo "Creating implementation breakdown for: $FEATURE" >&2

cat > "$STEPS_FILE" << STEPSEOF
{
  "feature": "$FEATURE",
  "steps": [
    {"id": 1, "title": "Define types and interfaces", "file": "src/core/types.ts", "done": false},
    {"id": 2, "title": "Implement core logic", "file": "src/core/", "done": false},
    {"id": 3, "title": "Wire up to existing callers", "file": "src/", "done": false},
    {"id": 4, "title": "Write unit tests", "file": "src/test/", "done": false},
    {"id": 5, "title": "Update documentation", "file": "README.md", "done": false}
  ]
}
STEPSEOF

echo "Steps written to $STEPS_FILE" >&2
cat "$STEPS_FILE"

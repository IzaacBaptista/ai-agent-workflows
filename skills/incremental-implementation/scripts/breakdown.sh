#!/bin/bash
set -e

INPUT="${1:-}"
STEPS_FILE="${2:-./impl-steps.json}"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

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

TMPFILE=$(mktemp)
python3 -c "
import json, sys
feature = sys.argv[1]
data = {
  'feature': feature,
  'steps': [
    {'id': 1, 'title': 'Define types and interfaces', 'file': 'src/core/types.ts', 'done': False},
    {'id': 2, 'title': 'Implement core logic', 'file': 'src/core/', 'done': False},
    {'id': 3, 'title': 'Wire up to existing callers', 'file': 'src/', 'done': False},
    {'id': 4, 'title': 'Write unit tests', 'file': 'src/test/', 'done': False},
    {'id': 5, 'title': 'Update documentation', 'file': 'README.md', 'done': False}
  ]
}
print(json.dumps(data, indent=2))
" "$FEATURE" > "$TMPFILE"

mv "$TMPFILE" "$STEPS_FILE"
echo "Steps written to $STEPS_FILE" >&2
cat "$STEPS_FILE"

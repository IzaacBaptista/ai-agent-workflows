#!/bin/bash
set -e

FEATURE="${1:-}"
OUTPUT_DIR="${2:-./specs}"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$FEATURE" ]; then
  echo "Usage: generate-spec.sh <feature-description> [output-dir]" >&2
  exit 1
fi

echo "Generating spec for: $FEATURE" >&2
mkdir -p "$OUTPUT_DIR"

SLUG=$(echo "$FEATURE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-60)
if [ -z "$SLUG" ]; then
  SLUG="spec-$(date -u +"%Y%m%d%H%M%S")"
fi
SPEC_FILE="$OUTPUT_DIR/${SLUG}.md"
TMPFILE=$(mktemp)

cat > "$TMPFILE" << SPECEOF
# Spec: $FEATURE

## Goal

Describe what this feature accomplishes and why it is needed.

## User Stories

- As a **developer**, I want $FEATURE so that I can improve the workflow.
- As an **end user**, I want the feature to work reliably so that I trust the system.

## Acceptance Criteria

- [ ] The feature behaves correctly under normal input
- [ ] Error cases are handled and surfaced to the caller
- [ ] Existing tests continue to pass
- [ ] New tests cover the happy path and at least one error path

## Edge Cases

- Empty or null input
- Network failure or timeout
- Concurrent access / race conditions

## Out of Scope

- UI changes (unless specified)
- Migrations or schema changes (unless specified)
- Performance optimisation beyond baseline

## Notes

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
SPECEOF

mv "$TMPFILE" "$SPEC_FILE"
echo "Spec written to $SPEC_FILE" >&2

python3 -c "
import json, sys
print(json.dumps({
  'spec_path': sys.argv[1],
  'feature': sys.argv[2],
  'sections': ['goal','user_stories','acceptance_criteria','edge_cases','out_of_scope']
}))
" "$SPEC_FILE" "$FEATURE"

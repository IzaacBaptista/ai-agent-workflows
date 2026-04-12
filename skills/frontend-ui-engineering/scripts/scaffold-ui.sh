#!/bin/bash
set -e

COMPONENT=""
TYPE="cli"
OUTPUT_DIR=""
TMPFILE=""

# Parse arguments
COMPONENT="${1:-}"
TYPE="${2:-cli}"
OUTPUT_DIR="${3:-./src/ui}"

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$COMPONENT" ]; then
  echo "Usage: scaffold-ui.sh <component-name> [cli|web] [output-dir]" >&2
  exit 1
fi

# Sanitize COMPONENT to valid PascalCase identifier
COMPONENT_ID=$(echo "$COMPONENT" | sed 's/[^a-zA-Z0-9]/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2); print}' | tr -d ' ')
if [ -z "$COMPONENT_ID" ]; then
  echo "Error: component name '$COMPONENT' produces an empty identifier" >&2
  exit 1
fi

echo "Scaffolding $TYPE component: $COMPONENT_ID" >&2
mkdir -p "$OUTPUT_DIR"

if [ "$TYPE" = "web" ]; then
  EXT="tsx"
else
  EXT="ts"
fi

OUTPUT_FILE="$OUTPUT_DIR/$COMPONENT_ID.$EXT"
TMPFILE=$(mktemp)

if [ "$TYPE" = "web" ]; then
  cat > "$TMPFILE" << WEBEOF
import React from 'react';

interface ${COMPONENT_ID}Props {
  data: unknown;
  loading?: boolean;
  error?: string;
}

/**
 * ${COMPONENT_ID}
 *
 * Renders: TODO — describe what this component displays
 */
export function ${COMPONENT_ID}({ data, loading, error }: ${COMPONENT_ID}Props): React.ReactElement {
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="${COMPONENT_ID}">
      {/* TODO: implement render */}
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
WEBEOF
else
  cat > "$TMPFILE" << CLIEOF
/**
 * ${COMPONENT_ID}
 *
 * CLI renderer for: TODO — describe what this renders
 */

export interface ${COMPONENT_ID}Data {
  // TODO: define the data shape
  label: string;
  value: unknown;
}

/**
 * Render ${COMPONENT_ID} to a terminal string.
 */
export function render${COMPONENT_ID}(data: ${COMPONENT_ID}Data): string {
  const lines: string[] = [];

  lines.push(\`\${data.label}\`);
  lines.push(\`  \${JSON.stringify(data.value)}\`);

  return lines.join('\n');
}

/**
 * Print ${COMPONENT_ID} to stdout.
 */
export function print${COMPONENT_ID}(data: ${COMPONENT_ID}Data): void {
  process.stdout.write(render${COMPONENT_ID}(data) + '\n');
}
CLIEOF
fi

mv "$TMPFILE" "$OUTPUT_FILE"
echo "Component written to $OUTPUT_FILE" >&2

python3 -c "
import json, sys
print(json.dumps({'component': sys.argv[1], 'type': sys.argv[2], 'file': sys.argv[3]}))
" "$COMPONENT_ID" "$TYPE" "$OUTPUT_FILE"

#!/bin/bash
set -e

COMPONENT="${1:-}"
TYPE="${2:-cli}"
OUTPUT_DIR="${3:-./src/ui}"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$COMPONENT" ]; then
  echo "Usage: scaffold-ui.sh <component-name> [cli|web] [output-dir]" >&2
  exit 1
fi

echo "Scaffolding $TYPE component: $COMPONENT" >&2
mkdir -p "$OUTPUT_DIR"

if [ "$TYPE" = "web" ]; then
  EXT="tsx"
else
  EXT="ts"
fi

OUTPUT_FILE="$OUTPUT_DIR/$COMPONENT.$EXT"
TMPFILE=$(mktemp)

if [ "$TYPE" = "web" ]; then
  cat > "$TMPFILE" << WEBEOF
import React from 'react';

interface ${COMPONENT}Props {
  data: unknown;
  loading?: boolean;
  error?: string;
}

/**
 * ${COMPONENT}
 *
 * Renders: TODO — describe what this component displays
 */
export function ${COMPONENT}({ data, loading, error }: ${COMPONENT}Props): React.ReactElement {
  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="${COMPONENT}">
      {/* TODO: implement render */}
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
WEBEOF
else
  cat > "$TMPFILE" << CLIEOF
/**
 * ${COMPONENT}
 *
 * CLI renderer for: TODO — describe what this renders
 */

export interface ${COMPONENT}Data {
  // TODO: define the data shape
  label: string;
  value: unknown;
}

/**
 * Render ${COMPONENT} to a terminal string.
 */
export function render${COMPONENT}(data: ${COMPONENT}Data): string {
  const lines: string[] = [];

  lines.push(\`\${data.label}\`);
  lines.push(\`  \${JSON.stringify(data.value)}\`);

  return lines.join('\n');
}

/**
 * Print ${COMPONENT} to stdout.
 */
export function print${COMPONENT}(data: ${COMPONENT}Data): void {
  process.stdout.write(render${COMPONENT}(data) + '\n');
}
CLIEOF
fi

mv "$TMPFILE" "$OUTPUT_FILE"
echo "Component written to $OUTPUT_FILE" >&2

echo "{\"component\": \"$COMPONENT\", \"type\": \"$TYPE\", \"file\": \"$OUTPUT_FILE\"}"

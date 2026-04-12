#!/bin/bash
set -e

DESCRIPTION="${1:-}"
OUTPUT_FILE="${2:-./api-contract.ts}"
TMPFILE=""

cleanup() {
  [ -n "$TMPFILE" ] && rm -f "$TMPFILE"
}
trap cleanup EXIT

if [ -z "$DESCRIPTION" ]; then
  echo "Usage: design-api.sh <api-description> [output-file]" >&2
  exit 1
fi

echo "Designing API contract for: $DESCRIPTION" >&2
mkdir -p "$(dirname "$OUTPUT_FILE")"

SLUG=$(echo "$DESCRIPTION" | sed 's/[^a-zA-Z0-9 ]//g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2)); print}' | tr -d ' ')
if [ -z "$SLUG" ]; then
  SLUG="Generated$(date -u +"%Y%m%d%H%M%S")"
fi

TMPFILE=$(mktemp)
cat > "$TMPFILE" << CONTRACTEOF
/**
 * API Contract: $DESCRIPTION
 * Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
 *
 * This file defines the public interface contract.
 * Implement against this contract; do not change types to match implementation.
 */

// ---------------------------------------------------------------------------
// Input / Request types
// ---------------------------------------------------------------------------

export interface ${SLUG}Input {
  /** Primary identifier or payload */
  id: string;
  /** Optional configuration overrides */
  options?: ${SLUG}Options;
}

export interface ${SLUG}Options {
  /** Maximum number of retries on transient failure (default: 3) */
  maxRetries?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Output / Response types
// ---------------------------------------------------------------------------

export interface ${SLUG}Result {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data when success is true */
  data?: ${SLUG}Data;
  /** Error details when success is false */
  error?: ${SLUG}Error;
}

export interface ${SLUG}Data {
  /** Primary output value */
  output: unknown;
  /** Metadata about the operation */
  meta: {
    durationMs: number;
    source: string;
  };
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type ${SLUG}ErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ${SLUG}Error {
  code: ${SLUG}ErrorCode;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Function signature
// ---------------------------------------------------------------------------

export type ${SLUG}Fn = (input: ${SLUG}Input) => Promise<${SLUG}Result>;
CONTRACTEOF

mv "$TMPFILE" "$OUTPUT_FILE"
echo "API contract written to $OUTPUT_FILE" >&2

python3 -c "
import json, sys
slug = sys.argv[3]
print(json.dumps({
  'description': sys.argv[1],
  'output_file': sys.argv[2],
  'interfaces': [slug+'Input', slug+'Options', slug+'Result', slug+'Data', slug+'Error', slug+'Fn']
}))
" "$DESCRIPTION" "$OUTPUT_FILE" "$SLUG"

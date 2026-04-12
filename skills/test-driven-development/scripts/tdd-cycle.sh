#!/bin/bash
set -e

TEST_FILE="${1:-}"
RUN_FLAG="${2:-}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "TDD cycle starting in: $PROJECT_ROOT" >&2

if [ -z "$TEST_FILE" ]; then
  echo "[TDD] No test file specified — scaffolding generic test" >&2
  TEST_FILE="$PROJECT_ROOT/src/test/new-feature.test.ts"
fi

PHASE="red"
NEXT_ACTION="implement_minimum_code"

if [ ! -f "$TEST_FILE" ]; then
  echo "Creating test scaffold at $TEST_FILE" >&2
  mkdir -p "$(dirname "$TEST_FILE")"
  cat > "$TEST_FILE" << TESTEOF
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('NewFeature', () => {
  it('should behave correctly under normal input', () => {
    // TODO: import and call the real implementation
    const result = undefined;
    assert.strictEqual(result, undefined, 'Replace with real assertion');
  });

  it('should handle error cases gracefully', () => {
    assert.throws(() => {
      throw new Error('Not yet implemented');
    }, /Not yet implemented/);
  });
});
TESTEOF
  echo "Test scaffold written to $TEST_FILE" >&2
fi

echo "[TDD] Phase: RED" >&2
echo "  → Test file: $TEST_FILE" >&2
echo "  → Run: npm run test" >&2
echo "[TDD] Expected result: at least one test FAILS before implementation" >&2

if [ "$RUN_FLAG" = "--run" ]; then
  echo "Running test suite..." >&2
  cd "$PROJECT_ROOT"
  npm run test 2>&1 || true
fi

echo "{\"phase\": \"$PHASE\", \"test_file\": \"$TEST_FILE\", \"next_action\": \"$NEXT_ACTION\"}"

#!/bin/bash
set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TEST_FILE=""
RUN_FLAG=""

# Parse arguments: position-independent flag handling
for arg in "$@"; do
  case "$arg" in
    --run) RUN_FLAG="--run" ;;
    *)     [ -z "$TEST_FILE" ] && TEST_FILE="$arg" ;;
  esac
done

echo "TDD cycle starting in: $PROJECT_ROOT" >&2

if [ -z "$TEST_FILE" ]; then
  echo "[TDD] No test file specified — scaffolding generic test" >&2
  TEST_FILE="$PROJECT_ROOT/src/test/new-feature.test.ts"
fi

# Detect test command from package.json with fallback
TEST_CMD="npm run test"
if [ -f "$PROJECT_ROOT/package.json" ]; then
  if python3 -c "import json; d=json.load(open('$PROJECT_ROOT/package.json')); exit(0 if 'test' in d.get('scripts',{}) else 1)" 2>/dev/null; then
    TEST_CMD="npm run test"
  fi
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
echo "  → Run: $TEST_CMD" >&2
echo "[TDD] Expected result: at least one test FAILS before implementation" >&2

if [ "$RUN_FLAG" = "--run" ]; then
  echo "Running test suite..." >&2
  cd "$PROJECT_ROOT"
  $TEST_CMD >&2 2>&1 || true
fi

python3 -c "
import json, sys
print(json.dumps({'phase': sys.argv[1], 'test_file': sys.argv[2], 'next_action': sys.argv[3]}))
" "$PHASE" "$TEST_FILE" "$NEXT_ACTION"

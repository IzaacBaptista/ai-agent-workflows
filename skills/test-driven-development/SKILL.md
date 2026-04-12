---
name: test-driven-development
description: Use when writing tests or practicing TDD. Trigger phrases: "write tests", "add test coverage", "test first", "red-green-refactor", "unit test", "integration test".
---

# Test-Driven Development

Guides the agent through a strict red → green → refactor cycle.

## How It Works

1. Write a failing test that describes the desired behaviour
2. Run the test suite to confirm the test fails (red)
3. Write the minimum code to make the test pass (green)
4. Refactor while keeping tests green
5. Repeat for the next behaviour

## Usage

```bash
bash /mnt/skills/user/test-driven-development/scripts/tdd-cycle.sh [test-file] [--run]
```

**Arguments:**
- `test-file` - Path to the test file to create or check (defaults to detecting from context)
- `--run` - Execute the test suite after scaffolding

**Examples:**
```bash
bash /mnt/skills/user/test-driven-development/scripts/tdd-cycle.sh src/test/myFeature.test.ts
bash /mnt/skills/user/test-driven-development/scripts/tdd-cycle.sh src/test/llmClient.test.ts --run
bash /mnt/skills/user/test-driven-development/scripts/tdd-cycle.sh
```

## Output

```
[TDD] Phase: RED
  → Test file: src/test/myFeature.test.ts
  → Run: npm run test
[TDD] Expected result: at least one test FAILS before implementation
```

JSON stdout:
```json
{"phase": "red", "test_file": "src/test/myFeature.test.ts", "next_action": "implement_minimum_code"}
```

## Present Results to User

After running, present:
> 🔴 **TDD — RED phase**
> Test file ready: `{test_file}`
> Run `npm run test` — at least one test must fail before you write production code.
> Once failing, proceed to GREEN phase (minimum implementation).

## Troubleshooting

- **Tests pass immediately**: Your test is not testing new behaviour — revise it
- **Build errors**: Fix TypeScript errors before running tests
- **Test runner not found**: Ensure `npm run test` is configured in package.json

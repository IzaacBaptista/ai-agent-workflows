---
name: code-simplification
description: Use when refactoring, simplifying, or reducing complexity. Trigger phrases: "simplify this", "refactor", "reduce complexity", "clean up", "too complex", "hard to read", "DRY this up".
---

# Code Simplification

Analyses code for unnecessary complexity and produces a refactoring plan with specific improvements.

## How It Works

1. Identify the target file or module
2. Measure complexity: function length, nesting depth, duplication, unclear names
3. Produce a prioritised list of simplifications
4. Apply each simplification while keeping tests green

## Usage

```bash
bash /mnt/skills/user/code-simplification/scripts/simplify.sh <file-or-dir> [--report-only]
```

**Arguments:**
- `file-or-dir` - File or directory to analyse (required)
- `--report-only` - Print the report without applying changes

**Examples:**
```bash
bash /mnt/skills/user/code-simplification/scripts/simplify.sh src/core/workflowRuntime.ts
bash /mnt/skills/user/code-simplification/scripts/simplify.sh src/agents/ --report-only
bash /mnt/skills/user/code-simplification/scripts/simplify.sh src/tools/toolExecutor.ts
```

## Output

```json
{
  "target": "src/core/workflowRuntime.ts",
  "issues": [
    {"type": "long_function", "name": "run", "lines": 220, "suggestion": "Extract into smaller helpers"},
    {"type": "deep_nesting", "name": "executeStep", "depth": 5, "suggestion": "Use early returns"}
  ],
  "report": "/tmp/simplification-report.md"
}
```

## Present Results to User

After running, present:
> 🧹 **Simplification Report**: `{target}`
> Issues found: **{issue_count}**
> Top issue: {first_issue_type} in `{first_issue_name}`
> Full report: `{report}`

## Troubleshooting

- **File not found**: Use a path relative to the project root
- **No issues found**: The file may already be well-structured

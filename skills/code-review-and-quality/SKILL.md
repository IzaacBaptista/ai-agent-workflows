---
name: code-review-and-quality
description: Use when reviewing code, checking quality, or assessing a pull request. Trigger phrases: "review this code", "check quality", "review PR", "is this code good", "lint", "code smell".
---

# Code Review and Quality

Performs a structured code review covering correctness, readability, security, and test coverage.

## How It Works

1. Identify the files or diff to review
2. Check each dimension: correctness, types, error handling, security, readability, tests
3. Produce a structured review with severity-tagged findings
4. Suggest concrete improvements

## Usage

```bash
bash /mnt/skills/user/code-review-and-quality/scripts/review.sh [file-or-diff] [--fix]
```

**Arguments:**
- `file-or-diff` - File path, directory, or `HEAD` for latest git diff (defaults to `HEAD`)
- `--fix` - Attempt to auto-fix lint issues after reporting

**Examples:**
```bash
bash /mnt/skills/user/code-review-and-quality/scripts/review.sh HEAD
bash /mnt/skills/user/code-review-and-quality/scripts/review.sh src/core/llmClient.ts
bash /mnt/skills/user/code-review-and-quality/scripts/review.sh src/ --fix
```

## Output

```json
{
  "target": "HEAD",
  "findings": [
    {"severity": "error", "file": "src/core/llmClient.ts", "line": 42, "message": "Unhandled promise rejection"},
    {"severity": "warning", "file": "src/agents/plannerAgent.ts", "line": 18, "message": "Missing return type annotation"}
  ],
  "summary": {"errors": 1, "warnings": 1, "info": 0},
  "review_report": "/tmp/code-review.md"
}
```

## Present Results to User

After running, present:
> 🔍 **Code Review**: `{target}`
> Errors: **{errors}** | Warnings: **{warnings}**
> Top finding: {first_finding}
> Full report: `{review_report}`

## Troubleshooting

- **git not found**: Ensure the command runs inside a git repository
- **TypeScript errors**: Run `npm run lint` first to surface type errors

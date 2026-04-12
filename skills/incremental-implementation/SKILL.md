---
name: incremental-implementation
description: Use when building or coding a feature after a spec exists. Trigger phrases: "implement the spec", "build this", "write the code", "code it up", "start implementing".
---

# Incremental Implementation

Breaks a spec into small, independently verifiable implementation steps and executes them one at a time.

## How It Works

1. Read the spec or feature description
2. Decompose into atomic implementation steps (each compilable and testable)
3. Output a step-by-step plan with file targets
4. Implement and validate each step before proceeding

## Usage

```bash
bash /mnt/skills/user/incremental-implementation/scripts/breakdown.sh "<spec-or-feature>" [steps-file]
```

**Arguments:**
- `spec-or-feature` - Feature description or path to spec file (required)
- `steps-file` - Output JSON file for steps (defaults to `/tmp/impl-steps.json`)

**Examples:**
```bash
bash /mnt/skills/user/incremental-implementation/scripts/breakdown.sh "specs/add-retry-logic.md"
bash /mnt/skills/user/incremental-implementation/scripts/breakdown.sh "Add caching layer" /tmp/cache-steps.json
bash /mnt/skills/user/incremental-implementation/scripts/breakdown.sh "specs/auth.md" ./impl-plan.json
```

## Output

```json
{
  "feature": "Add retry logic to the LLM client",
  "steps": [
    {"id": 1, "title": "Add retry config type", "file": "src/core/types.ts", "done": false},
    {"id": 2, "title": "Implement retry loop in llmClient", "file": "src/core/llmClient.ts", "done": false},
    {"id": 3, "title": "Add unit tests", "file": "src/test/llmClient.test.ts", "done": false}
  ]
}
```

## Present Results to User

After running, present:
> 📋 **Implementation plan**: {steps_count} steps
> Next step: **{first_step_title}** → `{first_step_file}`
> Follow each step sequentially and run tests after each.

## Troubleshooting

- **Spec file not found**: Provide the correct path or use a description string
- **Steps file already exists**: The script overwrites it safely

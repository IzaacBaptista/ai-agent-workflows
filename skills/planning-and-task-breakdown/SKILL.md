---
name: planning-and-task-breakdown
description: Use when a request needs to be broken into tasks, estimated, or organised before work starts. Trigger phrases: "plan this", "break this down", "what are the steps", "estimate", "roadmap", "how should I approach".
---

# Planning and Task Breakdown

Produces a structured, prioritised task list from a high-level goal or feature request.

## How It Works

1. Parse the goal and identify major work streams
2. Decompose each work stream into concrete, independently actionable tasks
3. Assign dependencies and order
4. Output a prioritised task list with effort estimates

## Usage

```bash
bash /mnt/skills/user/planning-and-task-breakdown/scripts/plan.sh "<goal>" [output-file]
```

**Arguments:**
- `goal` - The high-level goal or feature to plan (required)
- `output-file` - Where to write the plan (defaults to `/tmp/plan.md`)

**Examples:**
```bash
bash /mnt/skills/user/planning-and-task-breakdown/scripts/plan.sh "Add GitHub Actions CI pipeline"
bash /mnt/skills/user/planning-and-task-breakdown/scripts/plan.sh "Migrate database to Postgres" ./docs/migration-plan.md
bash /mnt/skills/user/planning-and-task-breakdown/scripts/plan.sh "Refactor authentication system" /tmp/auth-plan.md
```

## Output

```
/tmp/plan.md created with 5 tasks across 2 work streams.
```

JSON stdout:
```json
{"goal": "Add GitHub Actions CI pipeline", "task_count": 5, "plan_file": "/tmp/plan.md"}
```

## Present Results to User

After running, present:
> 📝 **Plan ready**: `{plan_file}`
> {task_count} tasks identified across {stream_count} work streams.
> Suggested start: **Task 1 — {first_task}**

## Troubleshooting

- **Output directory missing**: Ensure parent directory exists or use `/tmp/`
- **Goal too vague**: Add more context to produce a more specific plan

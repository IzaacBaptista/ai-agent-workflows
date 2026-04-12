---
name: debugging-and-error-recovery
description: Use when there is a bug, test failure, unexpected behaviour, or runtime error. Trigger phrases: "fix this bug", "why is this failing", "debug", "error", "exception", "broken", "not working".
---

# Debugging and Error Recovery

Systematically diagnoses failures and produces a root-cause analysis with a fix plan.

## How It Works

1. Collect the error message, stack trace, and relevant context
2. Identify the failure category (logic, type, network, config, etc.)
3. Reproduce the failure in isolation
4. Propose and apply a targeted fix
5. Verify the fix with the test suite

## Usage

```bash
bash /mnt/skills/user/debugging-and-error-recovery/scripts/debug.sh "<error-or-symptom>" [log-file]
```

**Arguments:**
- `error-or-symptom` - Error message, symptom description, or test name (required)
- `log-file` - Path to log file with additional context (optional)

**Examples:**
```bash
bash /mnt/skills/user/debugging-and-error-recovery/scripts/debug.sh "TypeError: Cannot read properties of undefined"
bash /mnt/skills/user/debugging-and-error-recovery/scripts/debug.sh "test: llmClient timeout" ./runs/latest.log
bash /mnt/skills/user/debugging-and-error-recovery/scripts/debug.sh "ECONNREFUSED 127.0.0.1:3000"
```

## Output

```json
{
  "symptom": "TypeError: Cannot read properties of undefined",
  "category": "null_reference",
  "hypothesis": "Object accessed before initialisation or after async gap",
  "investigation_steps": ["Check call stack", "Add null guard", "Verify async ordering"],
  "debug_report": "/tmp/debug-report.md"
}
```

## Present Results to User

After running, present:
> 🐛 **Debug report**: `{debug_report}`
> Category: **{category}**
> Hypothesis: {hypothesis}
> Next: {first_investigation_step}

## Troubleshooting

- **Log file not found**: Pass the error message directly as the first argument
- **Category unknown**: Add `--verbose` context via the log-file argument

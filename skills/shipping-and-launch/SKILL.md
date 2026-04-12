---
name: shipping-and-launch
description: Use when preparing to release, deploy, or ship. Trigger phrases: "ship this", "release", "deploy", "publish", "launch", "cut a release", "ready to ship", "prepare release".
---

# Shipping and Launch

Runs a pre-flight checklist and produces a release summary before any deployment.

## How It Works

1. Verify all tests pass
2. Check for uncommitted changes
3. Validate version bump and changelog entry
4. Produce a release checklist and summary

## Usage

```bash
bash /mnt/skills/user/shipping-and-launch/scripts/preflight.sh [version] [--dry-run]
```

**Arguments:**
- `version` - Semantic version to release (e.g. `1.2.3`; defaults to reading from package.json)
- `--dry-run` - Print checklist without executing checks

**Examples:**
```bash
bash /mnt/skills/user/shipping-and-launch/scripts/preflight.sh
bash /mnt/skills/user/shipping-and-launch/scripts/preflight.sh 1.3.0
bash /mnt/skills/user/shipping-and-launch/scripts/preflight.sh 2.0.0 --dry-run
```

## Output

```
[PREFLIGHT] ✅ Tests passing
[PREFLIGHT] ✅ No uncommitted changes
[PREFLIGHT] ⚠️  CHANGELOG.md not updated
[PREFLIGHT] Ready to release: 1.3.0
```

JSON stdout:
```json
{"version": "1.3.0", "ready": true, "checks": {"tests": "pass", "clean_tree": "pass", "changelog": "warn"}}
```

## Present Results to User

After running, present:
> 🚀 **Pre-flight complete**: version `{version}`
> Status: **{ready ? "READY TO SHIP" : "NOT READY"}**
> {list any failed or warning checks}

## Troubleshooting

- **Tests failing**: Fix all test failures before shipping
- **Uncommitted changes**: Commit or stash all changes before running preflight
- **No package.json**: Run from the project root directory

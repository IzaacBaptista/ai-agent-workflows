---
name: skill-validation
description: Use when creating or updating a skill to verify it meets all structural and quality requirements. Trigger phrases: "validate this skill", "check my skill", "is this skill valid", "new skill", "skill structure".
---

# Skill Validation

Validates that a skill directory meets all structural and quality requirements before distribution.

## How It Works

1. Locate the skill directory by name
2. Check for required files: `SKILL.md`, `skill.json`, at least one executable script
3. Validate `skill.json` schema (required fields present and correctly typed)
4. Verify frontmatter in `SKILL.md` (name, description fields)
5. Confirm a matching `.zip` exists alongside the skill directory
6. Report pass/fail for each check with actionable remediation steps

## Usage

```bash
bash /mnt/skills/user/skill-validation/scripts/validate-skill.sh <skill-dir> [skills-root]
```

**Arguments:**
- `skill-dir` - Path to the skill directory or skill name (required)
- `skills-root` - Parent directory containing skills (defaults to auto-detected `skills/`)

**Examples:**
```bash
bash /mnt/skills/user/skill-validation/scripts/validate-skill.sh skills/my-new-skill
bash /mnt/skills/user/skill-validation/scripts/validate-skill.sh my-new-skill ./skills
bash /mnt/skills/user/skill-validation/scripts/validate-skill.sh skills/spec-driven-development
```

## Output

```
[VALIDATE] Checking: skills/my-new-skill
[VALIDATE] ✅ SKILL.md present
[VALIDATE] ✅ skill.json present and valid
[VALIDATE] ✅ scripts/my-script.sh present and executable
[VALIDATE] ❌ my-new-skill.zip missing — run: cd skills && zip -r my-new-skill.zip my-new-skill/
[VALIDATE] Result: FAIL (1 issue)
```

JSON stdout:
```json
{
  "skill": "my-new-skill",
  "valid": false,
  "checks": {
    "skill_md": "pass",
    "skill_json": "pass",
    "scripts": "pass",
    "zip": "fail"
  },
  "issues": ["my-new-skill.zip missing — run: cd skills && zip -r my-new-skill.zip my-new-skill/"]
}
```

## Present Results to User

After running, present:
> 🔍 **Skill Validation**: `{skill}`
> Status: **{valid ? "✅ VALID" : "❌ INVALID"}**
> {list any issues with remediation steps}

## Troubleshooting

- **Skill directory not found**: Provide the full path or ensure you're running from the repo root
- **skill.json missing**: Create it following the schema in `AGENTS.md`
- **Script not executable**: Run `chmod +x skills/{skill-name}/scripts/*.sh`
- **Zip missing**: Run `cd skills && zip -r {skill-name}.zip {skill-name}/`

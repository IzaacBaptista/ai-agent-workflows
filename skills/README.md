# Skills

A collection of skills for Claude.ai and Claude Code, organised by category.

## Categories

### Core Skills

Universal skills applicable to any software engineering project.

| Skill | Trigger phrases |
|---|---|
| [`spec-driven-development`](./spec-driven-development/SKILL.md) | "add feature", "implement", "build", "create new" |
| [`planning-and-task-breakdown`](./planning-and-task-breakdown/SKILL.md) | "plan this", "break this down", "what are the steps" |
| [`test-driven-development`](./test-driven-development/SKILL.md) | "write tests", "add test coverage", "test first" |
| [`debugging-and-error-recovery`](./debugging-and-error-recovery/SKILL.md) | "fix this bug", "debug", "error", "broken" |
| [`code-review-and-quality`](./code-review-and-quality/SKILL.md) | "review this code", "check quality", "review PR" |
| [`code-simplification`](./code-simplification/SKILL.md) | "simplify this", "refactor", "clean up" |
| [`api-and-interface-design`](./api-and-interface-design/SKILL.md) | "design the API", "define the types", "API contract" |
| [`shipping-and-launch`](./shipping-and-launch/SKILL.md) | "ship this", "release", "deploy", "publish" |
| [`skill-validation`](./skill-validation/SKILL.md) | "validate this skill", "check my skill", "new skill" |

### Workflow-Specific Skills

Skills more opinionated about the engineering style used in this repository.

| Skill | Trigger phrases |
|---|---|
| [`incremental-implementation`](./incremental-implementation/SKILL.md) | "implement the spec", "build this", "write the code" |
| [`frontend-ui-engineering`](./frontend-ui-engineering/SKILL.md) | "build UI", "add component", "format the display" |

## Skill structure

Each skill directory contains:

```
{skill-name}/
  SKILL.md          # Skill definition and usage instructions
  skill.json        # Machine-readable manifest (category, triggers, required_tools, etc.)
  scripts/
    {script}.sh     # Executable bash script(s)
{skill-name}.zip    # Distribution package
```

## `skill.json` schema

```json
{
  "name": "skill-name",
  "category": "core | workflow-specific",
  "description": "One sentence description.",
  "triggers": ["phrase 1", "phrase 2"],
  "required_tools": ["bash", "git", "node", "python3"],
  "required_commands": ["npm run test"],
  "supports_fix": false,
  "timeout_seconds": 30
}
```

## Installation

**Claude Code:**
```bash
cp -r skills/{skill-name} ~/.claude/skills/
```

**claude.ai:**
Add the `SKILL.md` contents to project knowledge.

## Creating a new skill

1. Create `skills/{skill-name}/SKILL.md` following the template in `AGENTS.md`
2. Create `skills/{skill-name}/skill.json` with the schema above
3. Add executable scripts in `skills/{skill-name}/scripts/`
4. Package: `cd skills && zip -r {skill-name}.zip {skill-name}/`
5. Validate: `bash skills/skill-validation/scripts/validate-skill.sh skills/{skill-name}`

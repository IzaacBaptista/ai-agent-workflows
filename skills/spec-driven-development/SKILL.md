---
name: spec-driven-development
description: Use when starting a new feature, adding functionality, or implementing a requirement. Trigger phrases: "add feature", "implement", "build", "create new", "I want X to work".
---

# Spec-Driven Development

Produces a structured specification document before any implementation begins.

## How It Works

1. Parse the feature request and identify scope
2. Generate a spec with: goal, user stories, acceptance criteria, edge cases, and out-of-scope items
3. Output the spec as a markdown document for review
4. Block implementation until spec is approved

## Usage

```bash
bash /mnt/skills/user/spec-driven-development/scripts/generate-spec.sh "<feature-description>" [output-dir]
```

**Arguments:**
- `feature-description` - Free-text description of the feature (required)
- `output-dir` - Directory to write spec.md (defaults to `./specs`)

**Examples:**
```bash
bash /mnt/skills/user/spec-driven-development/scripts/generate-spec.sh "Add retry logic to the LLM client"
bash /mnt/skills/user/spec-driven-development/scripts/generate-spec.sh "JWT authentication middleware" ./docs/specs
bash /mnt/skills/user/spec-driven-development/scripts/generate-spec.sh "Rate limiting per API key" /tmp/specs
```

## Output

```
specs/
  add-retry-logic-to-the-llm-client.md
```

JSON stdout:
```json
{"spec_path": "specs/add-retry-logic-to-the-llm-client.md", "feature": "Add retry logic to the LLM client", "sections": ["goal","user_stories","acceptance_criteria","edge_cases","out_of_scope"]}
```

## Present Results to User

After running, present:
> ✅ **Spec created**: `{spec_path}`
> Review the spec before proceeding to implementation.
> Key acceptance criteria: {list top 3}

## Troubleshooting

- **Permission denied**: Run `chmod +x` on the script
- **Output dir not found**: The script creates it automatically

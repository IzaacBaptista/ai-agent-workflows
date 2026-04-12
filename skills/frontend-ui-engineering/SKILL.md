---
name: frontend-ui-engineering
description: Use when building UI components, working on the CLI output formatting, or improving user-facing rendering. Trigger phrases: "build UI", "add component", "style this", "improve output", "format the display", "terminal output".
---

# Frontend UI Engineering

Guides structured UI or CLI output development with a component-first approach.

## How It Works

1. Define the component contract (inputs, outputs, states)
2. Design the visual layout (ASCII/terminal or HTML/JSX wireframe)
3. Implement the component in isolation
4. Integrate with parent context
5. Test rendering across edge cases (empty, error, loading states)

## Usage

```bash
bash /mnt/skills/user/frontend-ui-engineering/scripts/scaffold-ui.sh "<component-name>" [type] [output-dir]
```

**Arguments:**
- `component-name` - Name of the component or output format (required)
- `type` - `cli` for terminal output, `web` for HTML/JSX (defaults to `cli`)
- `output-dir` - Where to write the scaffold (defaults to `./src/ui`)

**Examples:**
```bash
bash /mnt/skills/user/frontend-ui-engineering/scripts/scaffold-ui.sh "WorkflowProgressBar" cli
bash /mnt/skills/user/frontend-ui-engineering/scripts/scaffold-ui.sh "IssueCard" cli ./src/formatters
bash /mnt/skills/user/frontend-ui-engineering/scripts/scaffold-ui.sh "Dashboard" web ./src/components
```

## Output

```
src/ui/WorkflowProgressBar.ts created
```

JSON stdout:
```json
{"component": "WorkflowProgressBar", "type": "cli", "file": "src/ui/WorkflowProgressBar.ts"}
```

## Present Results to User

After running, present:
> 🎨 **UI Component scaffolded**: `{file}`
> Type: **{type}**
> Next: implement the render function and test with sample data.

## Troubleshooting

- **Output dir missing**: Created automatically by the script
- **Naming conflict**: Use a unique component name or choose a different output directory

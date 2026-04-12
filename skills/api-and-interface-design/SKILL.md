---
name: api-and-interface-design
description: Use when designing or reviewing APIs, TypeScript interfaces, function signatures, or module contracts. Trigger phrases: "design the API", "what should the interface look like", "define the types", "API contract", "function signature".
---

# API and Interface Design

Produces a typed, documented API contract before any implementation.

## How It Works

1. Identify the consumers and producers of the API
2. Define the data shapes (request/response or input/output types)
3. Specify error states and edge cases
4. Output a TypeScript interface file as the contract

## Usage

```bash
bash /mnt/skills/user/api-and-interface-design/scripts/design-api.sh "<api-description>" [output-file]
```

**Arguments:**
- `api-description` - What the API or interface should do (required)
- `output-file` - TypeScript file to write the contract (defaults to `/tmp/api-contract.ts`)

**Examples:**
```bash
bash /mnt/skills/user/api-and-interface-design/scripts/design-api.sh "LLM client with retry and streaming"
bash /mnt/skills/user/api-and-interface-design/scripts/design-api.sh "Jira issue fetcher" src/core/jiraClient.types.ts
bash /mnt/skills/user/api-and-interface-design/scripts/design-api.sh "Workflow tool executor interface" /tmp/toolExecutor.types.ts
```

## Output

```typescript
// Generated API contract for: LLM client with retry and streaming
export interface LlmClientOptions { ... }
export interface LlmRequest { ... }
export interface LlmResponse { ... }
export type LlmClientError = ...;
```

JSON stdout:
```json
{"description": "LLM client", "output_file": "/tmp/api-contract.ts", "interfaces": ["LlmClientOptions","LlmRequest","LlmResponse"]}
```

## Present Results to User

After running, present:
> 📐 **API Contract**: `{output_file}`
> Interfaces defined: {interfaces}
> Review the contract before implementing — change the types, not the implementation.

## Troubleshooting

- **Output file conflict**: Use a unique path or `/tmp/` for drafts
- **Unclear scope**: Add more context to the description for better type names

# AI Agent Workflows

A local CLI application that runs AI-powered workflows for common engineering tasks: issue analysis, bug diagnosis, and pull request review.

## What it does

This project exposes three structured AI workflows:

| Command | Description |
|---------|-------------|
| `issue` | Analyses a product or engineering issue and produces a structured breakdown including a technical plan, acceptance criteria, test scenarios, risks, and assumptions. |
| `bug`   | Diagnoses a bug report and returns possible causes, investigation steps, fix suggestions, and associated risks. |
| `pr`    | Reviews a pull request description and returns a summary of impacts, risks, code suggestions, and test recommendations. |

Each workflow now runs as a small multi-step pipeline:

1. A triage agent turns the raw input into an investigation brief.
2. The workflow searches the local codebase for related terms.
3. The final agent produces the structured JSON output using the enriched context.

Responses are generated through the OpenAI Responses API and validated with [Zod](https://zod.dev/) before being returned.

## Requirements

- Node.js ≥ 18
- An OpenAI API key

## Installation

```bash
git clone https://github.com/IzaacBaptista/ai-agent-workflows.git
cd ai-agent-workflows
npm install
```

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=your-openai-api-key-here
MODEL=gpt-4o   # optional, defaults to gpt-5
LOG_LEVEL=info
LOG_FULL_PAYLOADS=false
```

### Logging

- `LOG_LEVEL` controls logger verbosity. Supported values: `debug`, `info`, `error`.
- `LOG_FULL_PAYLOADS=true` enables truncated input/output previews in logs for local debugging.
- By default, logs are structured and avoid printing full request and response payloads.

## Running workflows

```bash
npm run dev -- <command> "<input text>"
```

### Issue analysis

```bash
npm run dev -- issue "User cannot login after password reset"
```

### Bug diagnosis

```bash
npm run dev -- bug "500 error when creating order with coupon"
```

### PR review

```bash
npm run dev -- pr "Refactored auth middleware and updated token validation"
```

## Example output

```json
{
  "success": true,
  "data": {
    "summary": "Users are unable to authenticate after resetting their password...",
    "questions": [
      "Is the issue reproducible across all browsers?",
      "Does the problem occur immediately after reset or only after some delay?"
    ],
    "acceptanceCriteria": [
      "Users can log in successfully immediately after a password reset"
    ],
    "technicalPlan": [
      "Investigate token invalidation logic in the auth service",
      "Check session store for stale entries after password change"
    ],
    "testScenarios": [
      "Reset password and attempt login within 30 seconds",
      "Reset password and attempt login after 5 minutes"
    ],
    "risks": [
      "Token cache may not be invalidated atomically"
    ],
    "assumptions": [
      "The issue is backend-related and not a client-side caching problem"
    ]
  }
}
```

## How a workflow runs

All three workflows follow the same execution pattern:

1. Triage agent
   turns the raw issue, bug, or PR into a short investigation brief.
2. Code search
   uses the triage output to search the local `src/` tree for related files and snippets.
3. Final analysis agent
   receives the original input plus the triage and code-search context, then returns validated JSON.
4. Execution memory
   stores run artifacts in an in-memory store for the lifetime of the current process.

## Project structure

```
src/
├── index.ts              # CLI entrypoint
├── agents/               # Final analysis agents and triage agents per workflow
├── core/                 # BaseAgent, LLM client, shared types
├── config/               # Environment variable loading
├── helpers/              # loadPrompt, buildGitHubPRReviewInput, fetchGitHubPR, formatPRReviewComment
├── integrations/
│   └── github/           # postPRComment (GitHub REST API write operations)
├── memory/               # In-memory workflow artifact store
├── tools/                # Structured logging, code search, external API hooks
└── workflows/            # Multi-step workflow orchestration
prompts/                  # Prompt templates for triage and final analysis
```

## HTTP API

The same workflows are also available as an HTTP API built with Express.

### Starting the API server

```bash
npm run dev:api
```

The server starts on **port 3000** by default (override with the `PORT` environment variable).

### Endpoints

#### GET `/health`

```bash
curl http://localhost:3000/health
```

```json
{ "ok": true }
```

#### POST `/issue/analyze`

```bash
curl -X POST http://localhost:3000/issue/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"User cannot login after password reset"}'
```

```json
{
  "success": true,
  "data": { "summary": "...", "technicalPlan": ["..."], ... }
}
```

#### POST `/bug/analyze`

```bash
curl -X POST http://localhost:3000/bug/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"500 error when creating order with coupon"}'
```

```json
{
  "success": true,
  "data": { "diagnosis": "...", "possibleCauses": ["..."], ... }
}
```

#### POST `/pr/review`

```bash
curl -X POST http://localhost:3000/pr/review \
  -H "Content-Type: application/json" \
  -d '{"input":"Refactored auth middleware and updated token validation"}'
```

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... }
}
```

#### POST `/github/pr-review`

Accepts a structured GitHub PR payload and runs the same PR review workflow.

```bash
curl -X POST http://localhost:3000/github/pr-review \
  -H "Content-Type: application/json" \
  -d '{
    "repository":"IzaacBaptista/ai-agent-workflows",
    "prNumber":4,
    "title":"Refactor auth middleware",
    "description":"Updated token validation and request guards",
    "diff":"--- a/src/middleware/auth.ts\n+++ b/src/middleware/auth.ts\n@@ -12,7 +12,7 @@ export function authMiddleware(req, res, next) {\n-  if (!token) return res.status(401).send();\n+  if (!token) return res.status(401).json({ error: \"Unauthorized\" });\n   validateToken(token, next);\n }"
  }'
```

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... }
}
```

#### POST `/github/pr-review/fetch`

Fetches the PR data directly from the GitHub API and runs the review workflow. A `githubToken` is optional but recommended to avoid rate limiting.

```bash
curl -X POST http://localhost:3000/github/pr-review/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "IzaacBaptista/ai-agent-workflows",
    "prNumber": 4,
    "githubToken": "ghp_..."
  }'
```

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... }
}
```

#### POST `/github/pr-review/comment`

Fetches the PR from GitHub, runs the AI review, and posts the result as a comment directly on the pull request. A `githubToken` with write access is required.

```bash
curl -X POST http://localhost:3000/github/pr-review/comment \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "IzaacBaptista/ai-agent-workflows",
    "prNumber": 4,
    "githubToken": "ghp_..."
  }'
```

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": { "commentPosted": true }
}
```

If the review succeeds but posting the comment fails (e.g. invalid token or insufficient permissions), the analysis is still returned with `meta.commentPosted` set to `false`:

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": { "commentPosted": false, "commentError": "Request failed with status code 403" }
}
```

### Error responses

**400 – Invalid request body**

```json
{ "success": false, "error": "Invalid request body" }
```

**500 – Internal server error**

```json
{ "success": false, "error": "Internal server error" }
```

> **Note:** The CLI entrypoint (`npm run dev`) remains fully functional alongside the API.

## Building

```bash
npm run build
```

Compiles TypeScript to `dist/`. To run the compiled API server: `npm run start:api`.

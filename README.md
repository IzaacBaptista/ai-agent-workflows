# AI Agent Workflows

A local CLI application that runs AI-powered workflows for common engineering tasks: issue analysis, bug diagnosis, and pull request review.

## What it does

This project exposes three structured AI workflows:

| Command | Description |
|---------|-------------|
| `issue` | Analyses a product or engineering issue and produces a structured breakdown including a technical plan, acceptance criteria, test scenarios, risks, and assumptions. |
| `bug`   | Diagnoses a bug report and returns possible causes, investigation steps, fix suggestions, and associated risks. |
| `pr`    | Reviews a pull request description and returns a summary of impacts, risks, code suggestions, and test recommendations. |

Each workflow now runs as a multi-agent execution loop:

1. A planner proposes the next actions.
2. A specialist, tool call, or delegated agent executes.
3. A replanner can replace the remaining action queue based on run state and memory.
4. A final analysis agent produces a candidate result.
5. A critic agent can approve the result or redirect the workflow to a specific next action.

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
RUN_STORAGE_DIR=.runs
MAX_PERSISTED_RUNS=200
EXTERNAL_API_BASE_URL=
EXTERNAL_API_TIMEOUT_MS=5000
```

### Logging

- `LOG_LEVEL` controls logger verbosity. Supported values: `debug`, `info`, `error`.
- `LOG_FULL_PAYLOADS=true` enables truncated input/output previews in logs for local debugging.
- By default, logs are structured and avoid printing full request and response payloads.

### Runtime storage

- `RUN_STORAGE_DIR` defines where workflow runs are persisted as JSON.
- `MAX_PERSISTED_RUNS` controls retention for persisted runs; older runs are pruned from disk and memory.
- Run state is loaded back when the process starts.

### External API tool

- `EXTERNAL_API_BASE_URL` is used by the `call_external_api` workflow tool for relative endpoints.
- `EXTERNAL_API_TIMEOUT_MS` controls timeout for those external checks.
- If no external API is configured, the tool returns an explicit `unconfigured` result instead of faking success.

### Command execution tool

- `run_command` is an allowlisted workflow tool for local verification steps.
- `edit_patch` is a first-class runtime action for controlled code edits through `CoderAgent`.
- Supported commands are currently `build`, `test`, and `lint`.
- In this repository, `lint` runs `tsc --noEmit`, so it acts as a fast static typecheck rather than a style linter.
- The runtime captures exit code, timeout status, duration, and truncated stdout/stderr, then stores them in run artifacts for replanning and final analysis.

### Controlled patch execution

- `edit_patch` is used only for localized repository changes with explicit target files.
- `CoderAgent` produces structured patch plans with full replacement file contents for the selected files.
- Patch application is scope-limited to approved project paths such as `src/`, `prompts/`, `docs/`, `evals/`, `scripts/`, and a few root config/docs files.
- Patch execution now runs inside a temporary isolated Git worktree instead of mutating the main workspace directly.
- When a patch requests validation, the runtime captures validation both before and after the patch inside that isolated worktree.
- Patch artifacts include `validationOutcome`, isolated `git_status` / `git_diff`, unexpected changed files, and whether the temporary worktree cleaned up successfully.
- After a patch is applied, the runtime can automatically run the narrowest validation command suggested by the patch (`lint`, `build`, or `test`).
- Critique and replanning can reject a patch when validation regresses, the diff spreads outside the requested files, or cleanup fails.
- Patch results are stored in run artifacts and fed back into working memory, replanning, critique, and final analysis.

### Git context tools

- `git_status` exposes the local working tree status as structured entries.
- `git_diff` exposes the current local diff, including changed files and a truncated diff preview.
- These tools are especially useful in `PRReviewWorkflow`, where the model may need real repository context beyond the user-provided PR summary.

### File reading guardrails

- `read_file` is limited to files inside `src/`.
- Supported extensions are `.ts`, `.js`, `.json`, and `.md`.
- This prevents the workflow runtime from reading arbitrary local files.

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

1. Planning
   creates an initial action queue such as `analyze -> tool_call(search_code) -> tool_call(read_file) -> finalize`.
2. Execution
   runs explicit runtime actions under an execution policy with retries, timeouts, and budgets.
3. Replanning
   revises the remaining action queue after important state changes.
4. Critique
   reviews the candidate result and can redirect into a tool call, delegation, or another focused finalization pass.
5. Persistence
   stores steps, artifacts, replans, and critiques in persisted run records.
6. No-progress fallback
   forces `final_analysis` when repeated tool steps stop adding new information, instead of looping until `maxSteps`.
7. Memory-aware planning
   feeds relevant prior runs and working memory back into planner, replanner, and critic.
8. Controlled command execution
   allows the model to request `run_command` for `build`, `test`, or `lint` when real project evidence is needed.
9. Command-aware decision making
   teaches planner, replanner, and critic to prefer `run_command` in bug and PR scenarios where executable build/test/lint evidence is more useful than additional code search or file reads.
10. Command-memory feedback
   carries prior command outcomes like `build_failed`, `build_passed`, and `test_timed_out` into relevant memory so repeated command loops are avoided when the state has not materially changed.
11. Git-aware PR context
   allows the runtime to inspect `git_status` and `git_diff` so PR review can use the real local change set and modified hunks as evidence.
12. Controlled autonomous patching
   allows the model to request `edit_patch`, apply a localized code change through `CoderAgent`, validate it automatically, and carry the resulting patch evidence forward into replanning and critique.
13. Isolated and reversible patch validation
   evaluates `edit_patch` inside a temporary Git worktree, compares validation before/after, records the isolated diff, and gives the critic enough evidence to reject regressive or overly broad patches.

## Project structure

```
src/
├── index.ts              # CLI entrypoint
├── server.ts             # Express API entrypoint and run inspection endpoints
├── agents/               # Planner, replanner, critic, reviewer, coder, triage/final agents, and agent registry
├── core/                 # BaseAgent, action schemas, LLM client, workflow runtime, and shared types
├── config/               # Environment variable loading
├── evals/                # Eval runner, baseline comparison helpers, and scenario definitions
├── helpers/              # Prompt loading, memory/planning context builders, workflow guidance, and GitHub helpers
├── integrations/
│   └── github/           # postPRComment (GitHub REST API write operations)
├── memory/               # Persisted run store, working memory snapshots, and relevant-memory retrieval
├── test/                 # Runtime, workflow, tool, parser, and HTTP-layer tests
├── tools/                # Structured logging, repository tools, controlled patch application, allowlisted command execution, and tool registry/executor
└── workflows/            # Runtime-driven workflow definitions for issue, bug, and PR review
evals/                    # Committed eval baseline used by the regression gate
scripts/                  # Local CI helpers such as the eval-aware gate script
prompts/                  # Operational JSON-first prompts for planner, replanner, critic, reviewer, triage, and final analysis
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
  "data": { "summary": "...", "technicalPlan": ["..."], ... },
  "meta": {
    "runId": "IssueWorkflow:...",
    "workflowName": "IssueWorkflow",
    "status": "completed",
    "stepCount": 8,
    "critiqueCount": 1,
    "replanCount": 2,
    "toolCallCount": 1,
    "delegationCount": 0,
    "maxDelegationDepthReached": 0,
    "memoryHits": 3,
    "criticRedirectCount": 0
  }
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
  "data": { "summary": "...", "possibleCauses": ["..."], ... },
  "meta": {
    "runId": "BugWorkflow:...",
    "workflowName": "BugWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2,
    "toolCallCount": 1,
    "delegationCount": 0,
    "maxDelegationDepthReached": 0,
    "memoryHits": 3,
    "criticRedirectCount": 0
  }
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
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": {
    "runId": "PRReviewWorkflow:...",
    "workflowName": "PRReviewWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2,
    "toolCallCount": 1,
    "delegationCount": 1,
    "maxDelegationDepthReached": 1,
    "memoryHits": 3,
    "criticRedirectCount": 1
  }
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
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": {
    "runId": "PRReviewWorkflow:...",
    "workflowName": "PRReviewWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2
  }
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
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": {
    "runId": "PRReviewWorkflow:...",
    "workflowName": "PRReviewWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2
  }
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
  "meta": {
    "runId": "PRReviewWorkflow:...",
    "workflowName": "PRReviewWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2,
    "githubComment": { "posted": true }
  }
}
```

If the review succeeds but posting the comment fails, the workflow metadata is still preserved and the GitHub posting result is attached under `meta.githubComment`:

```json
{
  "success": true,
  "data": { "summary": "...", "risks": ["..."], ... },
  "meta": {
    "runId": "PRReviewWorkflow:...",
    "workflowName": "PRReviewWorkflow",
    "status": "completed",
    "stepCount": 9,
    "critiqueCount": 1,
    "replanCount": 2,
    "githubComment": {
      "posted": false,
      "error": "Request failed with status code 403"
    }
  }
}
```

#### GET `/runs`

Lists persisted workflow runs with summary metadata.

#### GET `/runs/:runId`

Returns the full persisted run record, including steps and status.

#### GET `/runs/:runId/artifacts`

Returns persisted artifacts such as plan, replans, critiques, context, tool calls, command results, git status/diff artifacts, and result.

## Testing

Run the full suite with:

```bash
npm run test
```

Run the higher-level runtime eval harness with:

```bash
npm run evals
```

Write a structured JSON report for CI or regression tracking with:

```bash
npm run evals:report
```

List available scenarios or run one scenario only:

```bash
npm run evals -- --list
npm run evals -- --scenario pr-uses-git-context-tools
npm run evals -- --output .eval-reports/custom.json
```

Create or refresh the committed eval baseline from the latest green report with:

```bash
npm run evals:refresh-baseline
```

Compare a candidate report against the committed baseline with:

```bash
npm run evals:compare -- --baseline evals/baseline.json --candidate .eval-reports/latest.json
```

Run the full local CI gate, including lint, tests, eval report generation, and baseline regression detection, with:

```bash
npm run ci:local
```

The eval gate works in two layers:

- `npm run evals:report` already fails if any current scenario or check fails outright.
- `npm run evals:compare` fails if a candidate report regresses any baseline scenario or required check, which makes branch-to-branch behavior regressions visible even when the overall suite still passes.

`evals/baseline.json` should be committed. `.eval-reports/latest.json` remains ephemeral local/CI output.

The eval harness uses isolated `.eval-runs` storage and checks scenario-level behavior such as:

- preferring `run_command(test)` in bug investigation
- applying a localized `edit_patch` and validating it automatically in a bug workflow
- rejecting a regressive isolated patch based on before/after validation and unexpected diff spread
- choosing between `lint`, `build`, and `test` based on workflow context
- using `git_status` and `git_diff` in PR review
- using staged Git diff context when that is the relevant review surface
- suppressing repeated identical tool calls
- forcing finalization on no-progress repository searches
- critic-driven redirection to executable evidence
- planner decisions influenced by relevant memory
- safe failure when planner output violates the supported tool contract

The current suite covers:

- resilient parsing of OpenAI Responses output in `BaseAgent`
- workflow runtime retries, timeouts, and execution metadata
- tool and patch execution for `search_code`, `read_file`, `call_external_api`, `run_command`, `git_status`, `git_diff`, and controlled `edit_patch`
- workflow orchestration, critique-driven revision, and failure paths
- HTTP endpoints and response envelopes through `createApp()`

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

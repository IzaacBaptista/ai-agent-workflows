# Architecture

## Overview

This project is structured as a lightweight multi-agent execution runtime for engineering tasks. Each workflow combines memory-aware planning, explicit runtime actions, model-driven tool usage, adaptive replanning, dynamic delegation, candidate generation, critique, and persisted execution state.

## Layers

### Agents
Agents are split into distinct responsibilities:

- `PlannerAgent` proposes the initial action queue using relevant memory.
- `ReplannerAgent` revises the remaining actions based on current run state and memory.
- Planner and replanner both receive workflow-specific execution guidance, including when to prefer allowlisted `run_command` actions over more repository inspection.
- `CoderAgent` produces structured patch plans for localized repository changes triggered by `edit_patch`.
- Triage agents create investigation briefs from raw input.
- Final analysis agents produce candidate structured responses.
- `CriticAgent` reviews the candidate result and can redirect execution to a specific next action, including executable `run_command` verification or a localized `edit_patch` when build/test proof or a concrete code change is the missing step.
- Critique now also sees isolated patch-validation signals, so it can reject patches that regress validation, spread beyond requested files, or fail cleanup.
- `ReviewerAgent` is an optional delegatable verifier that checks whether conclusions are actually supported by evidence.
- `JiraAnalyzeAgent` is the final analysis agent for the `JiraAnalyzeWorkflow`; it produces a deep implementation plan, acceptance criteria, suggested branch name, and PR title from a formatted Jira issue.
- `PRCreateAgent` is the final analysis agent for the `PRCreateWorkflow`; it produces a full GitHub PR title, description, suggested branch name, and labels from a Jira analysis context.
- `RepoInvestigateAgent` is the final analysis agent for the `RepoInvestigateWorkflow`; it produces relevant files, code patterns, hypotheses, and next steps from repository evidence.

### Workflows
Workflows orchestrate the end-to-end pipeline:

- create a persisted run
- execute a queue of structured runtime actions under policy constraints
- invoke explicit tools
- apply controlled code patches through `edit_patch`
- invoke delegated agents dynamically
- persist artifacts after each step
- replan after important state changes
- critique the candidate result
- force `final_analysis` when repeated actions stop making progress
- return structured output with execution metadata

**Current workflows:**

| Workflow | CLI command | Final agent |
|---|---|---|
| `IssueWorkflow` | `ai issue "<text>"` | `IssueAgent` |
| `BugWorkflow` | `ai bug "<text>"` | `BugAgent` |
| `PRReviewWorkflow` | `ai pr "<text>"` / `ai github pr review <N>` | `PRAgent` |
| `JiraIssueWorkflow` | `ai jira issue <KEY>` | `IssueAgent` (via Jira fetch) |
| `JiraAnalyzeWorkflow` | `ai jira analyze <KEY>` | `JiraAnalyzeAgent` |
| `PRCreateWorkflow` | `ai github pr create <KEY>` | `PRCreateAgent` |
| `RepoInvestigateWorkflow` | `ai repo investigate "<query>"` | `RepoInvestigateAgent` |

### Tools
Tools execute concrete actions:

- structured logging
- local code search
- direct file reads with scope restrictions (configurable via `ai-agent.config.json`, defaulting to `src/` and approved extensions only)
- allowlisted command execution for local verification (`build`, `test`, and `lint`; here `lint` is `tsc --noEmit`)
- controlled patch application for localized code changes in approved project paths
- isolated worktree execution for `edit_patch`, including before/after validation and isolated `git_status` / `git_diff` capture
- Git inspection for local repository context (`git_status`, `git_diff`, and `git_log`)
- external API calls
- tool execution dispatch
- GitHub comment posting for PR review flows

### Integrations

**GitHub:**
- `fetchGitHubPR` — reads PR details and file diffs from the GitHub REST API.
- `postPRComment` — posts an AI-generated review comment to a GitHub PR.
- `createPR` — creates a new GitHub pull request from a structured `PRCreatePlan`.

**Jira:**
- `fetchJiraIssue` — fetches a Jira issue from the REST API v3, including ADF-to-plain-text description conversion.
- `formatJiraIssue` — formats a `JiraIssue` into a human-readable context string used as workflow input.

### Configuration

Per-project configuration is loaded from `ai-agent.config.json` at startup by walking the directory tree upward from the current working directory. The resolved configuration is merged with environment variables at the following precedence:

```
defaults → .env → ai-agent.config.json → CLI flags
```

`ai-agent.config.json` can override: `model`, `runStorageDir`, `jiraBaseUrl`, `githubRepo`, and `allowedPaths`. Credentials always come from environment variables only.

### Memory
Memory has two layers:

- working memory derived from the current run state and artifacts
- persisted run memory loaded from disk and queried for relevant prior runs

Working memory now includes command outcomes, patch results, patch signals, and command signals such as `build_failed`, `build_passed`, and `test_timed_out`. Relevant memory also summarizes prior command and patch patterns so planner, replanner, and critic can avoid re-running the same `build` or `test` when the non-command state has not materially changed and can recognize prior regressive patch attempts.

Each run still contains plan, replans, critiques, artifacts, and step history. Persisted runs are subject to retention limits so older runs are pruned.

### Prompts
Prompts define reusable instructions for planner, replanner, critic, triage, and final-analysis stages.

### Core
Core contains the shared LLM client, response parsing, schema validation, execution runtime, and shared types.

## Workflow Shape

Raw input + relevant memory → Planner → Action loop (analyze/edit_patch/tool_call/delegate) → Replanner → Final agent → Critic → Optional redirect/delegation/edit patch → No-progress fallback when needed → Validated JSON output

For Jira and PR create workflows, there is a pre-processing step before the action loop:

Jira fetch → ADF-to-text conversion → format as workflow input → standard action loop

## Current Workflows

### Issue Workflow

- `IssueTriageAgent` identifies investigation areas, code search terms, and validation checks.
- The runtime may execute `search_code`, `read_file`, `call_external_api`, `run_command`, `git_status`, and `git_diff`, and may apply localized `edit_patch` actions.
- `IssueAgent` produces the structured issue analysis.
- `CriticAgent` validates the candidate output before completion.

### Bug Workflow

- `BugTriageAgent` identifies hypotheses, code search terms, and API checks.
- The runtime may execute `search_code`, `read_file`, `call_external_api`, `run_command`, `git_status`, and `git_diff`, and may apply localized `edit_patch` actions.
- `BugAgent` produces the structured bug diagnosis.
- `CriticAgent` validates the candidate output before completion.

### PR Review Workflow

- `PRTriageAgent` identifies review focus areas, code search terms, and regression checks.
- The runtime may execute `search_code`, `read_file`, `call_external_api`, `run_command`, `git_status`, and `git_diff`, and may apply localized `edit_patch` actions.
- `git_status` and `git_diff` are especially useful here because they provide the real local change set and diff hunks alongside the user-provided PR summary.
- `PRAgent` produces the structured PR review.
- `CriticAgent` validates the candidate output before completion.

### Jira Issue Workflow

- Fetches the Jira issue via the Jira REST API v3 and formats it into a rich context string.
- Delegates to `IssueWorkflow` with the formatted context as input.
- Returns a `WorkflowResult<IssueAnalysis>` with `jiraIssueKey` added to the metadata.

### Jira Analyze Workflow

- Fetches the Jira issue and formats it as context.
- Runs `IssueTriageAgent` for investigation direction.
- Uses the standard tool set (`search_code`, `read_file`, `run_command`, `git_status`, `git_diff`) to gather repository evidence.
- `JiraAnalyzeAgent` produces a deep implementation plan, acceptance criteria, risks, test scenarios, suggested branch name, and PR title.
- `CriticAgent` validates the candidate output.
- Returns `WorkflowResult<JiraAnalysis>` with `jiraIssueKey` in metadata.

### PR Create Workflow

- Runs `JiraAnalyzeWorkflow` to get a full technical context from the Jira issue.
- Runs the `PRCreateWorkflow` agentic loop, which uses `PRTriageAgent` for triage and the git tools to understand the local branch state.
- `PRCreateAgent` produces the PR title, markdown description, suggested branch name, and labels.
- If `GITHUB_TOKEN` and `GITHUB_REPO` are configured, calls `createPR` to open the pull request on GitHub.
- Returns `WorkflowResult<PRCreateResult>` with optional `prUrl` and `prNumber` in the data, and `jiraIssueKey` in metadata.

### Repo Investigate Workflow

- Takes a free-text investigation query.
- `BugTriageAgent` generates initial hypotheses and code search terms.
- The runtime has access to `git_log` in addition to the standard tool set, enabling commit history investigation.
- `RepoInvestigateAgent` produces relevant files, code patterns, hypotheses, and recommended next steps.
- `CriticAgent` validates the candidate output before completion.

## Execution State

Each run contains:

- `runId`, workflow name, status, timing
- execution policy
- full step history
- artifacts such as plan, replans, critiques, tool results, context, and final result
- runtime progress state used to detect redundant actions and force `final_analysis`
- working memory snapshots
- relevant-memory summaries used during planning, replanning, and critique
- tool call records with signatures, cache/suppression info, and results
- patch results with edited files, byte counts, suggested validation commands, before/after validation outcomes, isolated git status/diff, unexpected changed files, and worktree cleanup state
- command execution results with exit code, timeout status, duration, and truncated stdout/stderr
- Git inspection results including working tree entries, changed files, truncated diff previews, and commit log entries
- delegation records with target agent, depth, and output

The API exposes this state through:

- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/artifacts`

Workflow responses also expose execution metadata:

- `runId`
- `workflowName`
- `status`
- `stepCount`
- `critiqueCount`
- `replanCount`
- `toolCallCount`
- `editActionCount`
- `delegationCount`
- `maxDelegationDepthReached`
- `memoryHits`
- `criticRedirectCount`
- `jiraIssueKey` on Jira-sourced workflows
- `githubComment` on PR comment delivery flows

## Execution Policy

The runtime enforces a bounded execution model:

- `maxSteps`
- `maxRetriesPerStep`
- `timeoutMs`
- `maxConsecutiveNoProgress`
- `maxToolCalls`
- `maxRepeatedIdenticalToolCalls`
- `maxEditActionsPerRun`
- `maxFilesPerEditAction`
- `maxDelegationsPerRun`
- `maxDelegationDepth`
- `maxCriticRedirects`

This prevents unbounded replanning loops and provides a controlled fallback path to `final_analysis`.

## Testing

The project includes automated coverage for:

- OpenAI response parsing and schema validation
- runtime retries, timeouts, and metadata generation
- tool and patch execution guardrails, including allowlisted command execution, controlled patching, and Git inspection tools
- workflow orchestration success and failure paths
- HTTP handler behavior via the Express app factory

## Principles

- Separation of concerns
- Structured outputs (JSON)
- Reusable prompts
- Controlled multi-agent orchestration
- Explicit tool execution
- Explicit runtime actions
- Dynamic delegation
- Memory-informed decisions
- Adaptive replanning
- Critique before finalization
- Isolated and reversible patch validation
- Bounded execution with no-progress detection
- Persisted and inspectable execution state
- Fail-fast validation at the workflow boundary
- Portable configuration via `ai-agent.config.json`

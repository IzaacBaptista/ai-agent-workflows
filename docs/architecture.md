# Architecture

## Overview

This project is structured as a lightweight multi-agent execution runtime for engineering tasks. Each workflow combines planning, explicit tool usage, adaptive replanning, candidate generation, critique, and persisted execution state.

## Layers

### Agents
Agents are split into distinct responsibilities:

- `PlannerAgent` proposes the initial action sequence.
- `ReplannerAgent` revises the remaining actions based on current run state.
- Triage agents create investigation briefs from raw input.
- Final analysis agents produce candidate structured responses.
- `CriticAgent` reviews the candidate result and can request a focused revision.

### Workflows
Workflows orchestrate the end-to-end pipeline:

- create a persisted run
- execute planned steps under policy constraints
- invoke explicit tools
- persist artifacts after each step
- replan after important state changes
- critique the candidate result
- return structured output with execution metadata

### Tools
Tools execute concrete actions:

- structured logging
- local code search
- direct file reads
- external API calls
- tool execution dispatch
- GitHub comment posting for PR review flows

### Memory
Memory stores workflow runs with both in-memory caching and JSON persistence on disk. A run contains plan, replans, critiques, artifacts, and step history.

### Prompts
Prompts define reusable instructions for planner, replanner, critic, triage, and final-analysis stages.

### Core
Core contains the shared LLM client, response parsing, schema validation, execution runtime, and shared types.

## Workflow Shape

Raw input → Planner → Action loop (agents/tools) → Replanner → Final agent → Critic → Optional revision → Validated JSON output

## Current Workflows

### Issue Workflow

- `IssueTriageAgent` identifies investigation areas, code search terms, and validation checks.
- The runtime may execute `search_code`, `read_file`, and `call_external_api`.
- `IssueAgent` produces the structured issue analysis.
- `CriticAgent` validates the candidate output before completion.

### Bug Workflow

- `BugTriageAgent` identifies hypotheses, code search terms, and API checks.
- The runtime may execute `search_code`, `read_file`, and `call_external_api`.
- `BugAgent` produces the structured bug diagnosis.
- `CriticAgent` validates the candidate output before completion.

### PR Review Workflow

- `PRTriageAgent` identifies review focus areas, code search terms, and regression checks.
- The runtime may execute `search_code`, `read_file`, and `call_external_api`.
- `PRAgent` produces the structured PR review.
- `CriticAgent` validates the candidate output before completion.

## Execution State

Each run contains:

- `runId`, workflow name, status, timing
- execution policy
- full step history
- artifacts such as plan, replans, critiques, tool results, context, and final result

The API exposes this state through:

- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/artifacts`

## Principles

- Separation of concerns
- Structured outputs (JSON)
- Reusable prompts
- Controlled multi-agent orchestration
- Explicit tool execution
- Adaptive replanning
- Critique before finalization
- Persisted and inspectable execution state
- Fail-fast validation at the workflow boundary

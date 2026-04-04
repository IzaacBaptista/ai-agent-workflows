# Architecture

## Overview

This project is structured around small AI workflow pipelines for engineering tasks. Each workflow combines a triage step, lightweight tool usage, and a final structured analysis step.

## Layers

### Agents
Agents are split into two roles:

- Triage agents create an investigation brief from raw input.
- Final analysis agents produce the validated JSON response.

### Workflows
Workflows orchestrate the end-to-end pipeline:

- run triage
- collect context from tools
- persist execution artifacts in memory
- run final analysis
- return structured output

### Tools
Tools execute concrete actions:

- structured logging
- local code search
- external API calls
- GitHub comment posting for PR review flows

### Memory
Memory stores execution artifacts for the current process, such as workflow input, triage output, and enriched context.

### Prompts
Prompts define reusable instructions for both triage and final analysis stages.

### Core
Core contains the shared LLM client, response parsing, schema validation, and shared types.

## Workflow Shape

Raw input → Triage agent → Tool-assisted context collection → Final agent → Validated JSON output

## Current Workflows

### Issue Workflow

- `IssueTriageAgent` identifies investigation areas, code search terms, and validation checks.
- The workflow searches the local codebase for matching terms.
- `IssueAgent` produces the structured issue analysis.

### Bug Workflow

- `BugTriageAgent` identifies hypotheses, code search terms, and API checks.
- The workflow searches the local codebase for matching terms.
- `BugAgent` produces the structured bug diagnosis.

### PR Review Workflow

- `PRTriageAgent` identifies review focus areas, code search terms, and regression checks.
- The workflow searches the local codebase for matching terms.
- `PRAgent` produces the structured PR review.

## Principles

- Separation of concerns
- Structured outputs (JSON)
- Reusable prompts
- Controlled multi-step orchestration
- Tool-assisted context enrichment
- Fail-fast validation at the workflow boundary

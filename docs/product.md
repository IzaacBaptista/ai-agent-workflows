# Product Vision

## One-line definition

An installable and configurable CLI that applies autonomous agents to investigate, document, and accelerate engineering workflows in any project connected to Jira and GitHub.

## What the product is

This project is not primarily a chatbot for developers.

It is an agentic engineering runtime with a CLI interface.

Its core job is to help engineers work through real technical workflows with autonomy, safety, and traceability.

In practice, it should be able to:

- read a Jira issue
- understand technical context
- inspect the local repository
- use controlled tools
- generate useful documentation
- suggest or execute safe GitHub actions
- review its own reasoning
- record an execution trail

## Product vision

The product should become:

an autonomous engineering CLI, installable in any project, that understands engineering context, integrates with Jira and GitHub, investigates problems, helps document decisions, and executes technical flows safely.

## Product pillars

The product is built around four pillars:

1. Automate complete workflows
2. Use prompt engineering with context and guardrails
3. Create autonomous agents that decide what to do next
4. Increase productivity through real engineering workflows

## V1 focus

The first version should focus on four capabilities.

### 1. Understand real work

- Jira issue
- pull request
- local repository
- execution history

### 2. Investigate with controlled autonomy

- plan
- use tools
- replan
- critique
- finalize

### 3. Produce useful outputs

- issue analysis
- bug diagnosis
- pull request review
- technical documentation
- implementation plans
- risks and test scenarios

### 4. Be usable in any project

- simple installation
- project-level configuration
- Jira and GitHub adapters
- pluggable tools

## Product positioning

Recommended positioning:

AI Engineering CLI for analysis, investigation, documentation, and automation of development workflows.

Simpler wording:

An autonomous engineering copilot via CLI.

## Roadmap

### V1

CLI installable + Jira + GitHub + local repository analysis

Example flows:

- `ai jira issue REL-123`
- `ai jira analyze REL-123`
- `ai github pr review 42`
- `ai github pr create REL-123`
- `ai repo investigate "timeout not cleared"`

### V2

Better UX and more operational context

- friendlier output
- run history
- per-project configuration
- documentation templates

### V3

Friendly frontend

- execution timeline
- artifacts
- runs
- comparisons
- filters

### V4

Read-only database investigation

- schemas
- tables
- relationships
- columns
- safe samples
- limited read-only queries

## Database principles

Future database access should be:

- read-only
- introspection-oriented
- bounded
- safe by default

Safe examples:

- list schemas
- list tables
- describe columns
- show foreign keys
- fetch small samples
- count records with simple filters

Avoid at first:

- free-form SQL
- writes
- updates
- deletes
- unrestricted access

## Non-goals right now

Do not try to build everything at once.

Avoid expanding too early into:

- frontend-first UX
- unrestricted database access
- broad automation marketplace
- multi-surface platform work before CLI is solid

## Decision filter

Before implementing a meaningful feature, refactor, or workflow change, check:

1. Does this strengthen the CLI as an autonomous engineering runtime?
2. Does this improve real workflows such as Jira issue analysis, bug investigation, PR review, or documentation?
3. Does this increase safety, traceability, and portability across projects?
4. Does this help the product work in any project, not just this repository?

If the answer is mostly no, it is probably not a priority right now.

## Documentation roles

- `docs/product.md`: what the product is, who it serves, and what matters most
- `docs/architecture.md`: how the current system is built
- `README.md`: how to install, run, and understand the project quickly

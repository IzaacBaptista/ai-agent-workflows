# Architecture

## Overview

This project is structured to support scalable AI agents that automate engineering workflows.

## Layers

### Agents
Responsible for reasoning and decision making.

### Workflows
Coordinate multiple steps and agents.

### Tools
Execute concrete actions (APIs, logs, search).

### Memory
Store and retrieve contextual information.

### Prompts
Define reusable instructions for agents.

### Core
Shared infrastructure such as LLM client, base agent and types.

## Flow Example

Issue → Agent → Analysis → Workflow → Output → Developer

## Principles

- Separation of concerns
- Structured outputs (JSON)
- Reusable prompts
- Controlled autonomy
- Human-in-the-loop when needed

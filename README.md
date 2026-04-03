# AI Agent Workflows

A local CLI application that runs AI-powered workflows for common engineering tasks: issue analysis, bug diagnosis, and pull request review.

## What it does

This project exposes three structured AI workflows:

| Command | Description |
|---------|-------------|
| `issue` | Analyses a product or engineering issue and produces a structured breakdown including a technical plan, acceptance criteria, test scenarios, risks, and assumptions. |
| `bug`   | Diagnoses a bug report and returns possible causes, investigation steps, fix suggestions, and associated risks. |
| `pr`    | Reviews a pull request description and returns a summary of impacts, risks, code suggestions, and test recommendations. |

Each workflow calls an LLM (OpenAI) using a structured prompt and validates the response with [Zod](https://zod.dev/) before returning it as formatted JSON.

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
```

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

## Project structure

```
src/
├── index.ts              # CLI entrypoint
├── agents/               # IssueAgent, BugAgent, PRAgent
├── core/                 # BaseAgent, LLM client, shared types
├── config/               # Environment variable loading
├── helpers/              # loadPrompt utility
├── memory/               # Simple in-memory key-value store
├── tools/                # Logging, external API, code search
└── workflows/            # runIssueWorkflow, runBugWorkflow, runPRReviewWorkflow
prompts/                  # Markdown prompt templates per workflow
```

## Building

```bash
npm run build
```

Compiles TypeScript to `dist/`.


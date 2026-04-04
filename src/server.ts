import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";
import { buildGitHubPRReviewInput } from "./helpers/buildGitHubPRReviewInput";
import { fetchGitHubPR } from "./helpers/fetchGitHubPR";
import { formatPRReviewComment } from "./helpers/formatPRReviewComment";
import { postPRComment } from "./integrations/github/postPRComment";
import { getAllRunMemories, getRunMemory } from "./memory/simpleMemory";

const app = express();

app.use(express.json());

const inputSchema = z.object({ input: z.string().min(1) });

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Issue analysis
app.post("/issue/analyze", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const data = await runIssueWorkflow(parsed.data.input);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Bug analysis
app.post("/bug/analyze", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const data = await runBugWorkflow(parsed.data.input);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PR review
app.post("/pr/review", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const data = await runPRReviewWorkflow(parsed.data.input);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GitHub PR review
const githubPRReviewSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.number(),
  title: z.string().min(1),
  description: z.string(),
  diff: z.string(),
});

app.post("/github/pr-review", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = githubPRReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const input = buildGitHubPRReviewInput(parsed.data);
    const data = await runPRReviewWorkflow(input);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GitHub PR review with automatic fetching from GitHub API
const githubPRFetchSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.number(),
  githubToken: z.string().optional(),
});

app.post("/github/pr-review/fetch", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = githubPRFetchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const { repository, prNumber, githubToken } = parsed.data;
    const prDetails = await fetchGitHubPR(repository, prNumber, githubToken);
    const input = buildGitHubPRReviewInput(prDetails);
    const data = await runPRReviewWorkflow(input);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GitHub PR review with automatic fetching and comment posted back to GitHub
const githubPRCommentSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.number(),
  githubToken: z.string().min(1),
});

app.post("/github/pr-review/comment", async (req: Request, res: Response, next: NextFunction) => {
  const parsed = githubPRCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid request body" });
    return;
  }
  try {
    const { repository, prNumber, githubToken } = parsed.data;
    const prDetails = await fetchGitHubPR(repository, prNumber, githubToken);
    const input = buildGitHubPRReviewInput(prDetails);
    const result = await runPRReviewWorkflow(input);
    if (!result.success) {
      res.status(500).json(result);
      return;
    }
    let commentPosted = false;
    let commentError: string | undefined;
    try {
      const comment = formatPRReviewComment(result.data);
      await postPRComment(repository, prNumber, comment, githubToken);
      commentPosted = true;
    } catch (err) {
      commentError = err instanceof Error ? err.message : String(err);
      console.error("[github/pr-review/comment] Failed to post comment:", commentError);
    }
    res.json({ success: true, data: result.data, meta: { commentPosted, commentError } });
  } catch (err) {
    next(err);
  }
});

app.get("/runs", (_req: Request, res: Response) => {
  const runs = getAllRunMemories().map((run) => ({
    runId: run.runId,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    stepCount: run.steps.length,
  }));

  res.json({ success: true, data: runs });
});

app.get("/runs/:runId", (req: Request, res: Response) => {
  try {
    const { runId } = req.params as { runId: string };
    const run = getRunMemory(runId);
    res.json({ success: true, data: run });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ success: false, error: message });
  }
});

app.get("/runs/:runId/artifacts", (req: Request, res: Response) => {
  try {
    const { runId } = req.params as { runId: string };
    const run = getRunMemory(runId);
    res.json({ success: true, data: run.artifacts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ success: false, error: message });
  }
});

// Centralized error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[server] Unhandled error:", message);
  res.status(500).json({ success: false, error: "Internal server error" });
});

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

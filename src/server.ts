import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";
import { buildGitHubPRReviewInput } from "./helpers/buildGitHubPRReviewInput";
import { fetchGitHubPR } from "./helpers/fetchGitHubPR";
import { formatPRReviewComment } from "./helpers/formatPRReviewComment";
import { postPRComment } from "./integrations/github/postPRComment";

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
    res.json({ success: true, data });
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
    res.json({ success: true, data });
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
    res.json({ success: true, data });
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
    res.json({ success: true, data });
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
    res.json({ success: true, data });
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
    const comment = formatPRReviewComment(result.data);
    await postPRComment(repository, prNumber, comment, githubToken);
    res.json({ success: true, data: result.data, commented: true });
  } catch (err) {
    next(err);
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

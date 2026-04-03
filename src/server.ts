import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";

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

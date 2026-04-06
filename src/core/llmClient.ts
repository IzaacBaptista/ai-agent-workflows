import axios from "axios";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { env } from "../config/env";

export type LlmProviderErrorKind =
  | "rate_limit"
  | "service_unavailable"
  | "network"
  | "provider_response";

type LlmTransport = (
  url: string,
  body: unknown,
  config: {
    headers: Record<string, string>;
    timeout: number;
  },
) => Promise<{ data: unknown }>;

type SleepFn = (ms: number) => Promise<void>;
interface LlmCircuitState {
  openUntil: number;
  reason: string;
  updatedAt: string;
}

interface LlmCircuitStateStore {
  read(): LlmCircuitState | undefined;
  write(state: LlmCircuitState): void;
  clear(): void;
}

interface LlmRequestGateLease {
  release(): void;
}

interface LlmRequestGate {
  acquire(): Promise<LlmRequestGateLease>;
}

interface LlmRequestGateState {
  ownerId: string;
  pid: number;
  acquiredAt: string;
  expiresAt: number;
}

export class LlmProviderError extends Error {
  readonly kind: LlmProviderErrorKind;
  readonly retryAfterMs?: number;
  readonly statusCode?: number;
  readonly cause?: unknown;

  constructor(
    kind: LlmProviderErrorKind,
    message: string,
    options: {
      retryAfterMs?: number;
      statusCode?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "LlmProviderError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
    this.statusCode = options.statusCode;
    this.cause = options.cause;
  }
}

let llmTransport: LlmTransport = axios.post.bind(axios) as LlmTransport;
let sleepFn: SleepFn = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
let circuitStateStore: LlmCircuitStateStore = createDefaultCircuitStateStore();
let requestGate: LlmRequestGate = createDefaultRequestGate();

export function isLlmProviderError(error: unknown): error is LlmProviderError {
  return error instanceof LlmProviderError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response) || typeof error.response.status !== "number") {
    return undefined;
  }

  return error.response.status;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") {
    return undefined;
  }

  return error.code;
}

function getRetryAfterHeader(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.headers)) {
    return undefined;
  }

  const header = error.response.headers["retry-after"];
  if (typeof header === "string") {
    return header;
  }

  return undefined;
}

function isRequestTimeoutError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "ECONNABORTED") {
    return true;
  }

  if (!isRecord(error) || typeof error.message !== "string") {
    return false;
  }

  return /timeout/i.test(error.message);
}

function parseRetryAfterMs(header: string | undefined): number | undefined {
  if (!header) {
    return undefined;
  }

  const numericSeconds = Number.parseInt(header, 10);
  if (!Number.isNaN(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000;
  }

  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(dateMs - Date.now(), 0);
}

function getLlmStateDirPath(): string {
  return resolve(process.cwd(), env.RUN_STORAGE_DIR, "_system");
}

function getCircuitStateFilePath(): string {
  return resolve(getLlmStateDirPath(), "llm-rate-limit.json");
}

function getRequestGateFilePath(): string {
  return resolve(getLlmStateDirPath(), "llm-request.lock");
}

function createDefaultCircuitStateStore(): LlmCircuitStateStore {
  return {
    read() {
      const filePath = getCircuitStateFilePath();
      if (!existsSync(filePath)) {
        return undefined;
      }

      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as LlmCircuitState;
        if (typeof parsed.openUntil !== "number" || typeof parsed.reason !== "string") {
          return undefined;
        }

        return parsed;
      } catch {
        return undefined;
      }
    },
    write(state) {
      const filePath = getCircuitStateFilePath();
      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf-8");
      renameSync(tempPath, filePath);
    },
    clear() {
      rmSync(getCircuitStateFilePath(), { force: true });
    },
  };
}

function readRequestGateState(filePath: string): LlmRequestGateState | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as LlmRequestGateState;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function createDefaultRequestGate(): LlmRequestGate {
  return {
    async acquire() {
      const filePath = getRequestGateFilePath();
      mkdirSync(dirname(filePath), { recursive: true });

      const ownerId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      while (true) {
        const now = Date.now();

        try {
          const leaseState: LlmRequestGateState = {
            ownerId,
            pid: process.pid,
            acquiredAt: new Date(now).toISOString(),
            expiresAt: now + env.LLM_REQUEST_GATE_STALE_MS,
          };
          writeFileSync(filePath, JSON.stringify(leaseState, null, 2), {
            encoding: "utf-8",
            flag: "wx",
          });

          return {
            release() {
              const current = readRequestGateState(filePath);
              if (current?.ownerId === ownerId) {
                rmSync(filePath, { force: true });
              }
            },
          };
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : undefined;

          if (code !== "EEXIST") {
            throw error;
          }

          const current = readRequestGateState(filePath);
          if (!current || current.expiresAt <= now) {
            rmSync(filePath, { force: true });
            continue;
          }

          await sleepFn(env.LLM_REQUEST_GATE_POLL_MS);
        }
      }
    },
  };
}

function isRetryableLlmError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429 || status === 408) {
    return true;
  }

  if (status != null && status >= 500) {
    return true;
  }

  const code = getErrorCode(error);
  return code === "ECONNABORTED" || code === "ECONNRESET" || code === "ETIMEDOUT";
}

function getRetryDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(getRetryAfterHeader(error));
  if (retryAfterMs != null) {
    return Math.min(retryAfterMs, env.LLM_RETRY_MAX_DELAY_MS);
  }

  return Math.min(
    env.LLM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    env.LLM_RETRY_MAX_DELAY_MS,
  );
}

function getActiveCircuitDelayMs(now = Date.now()): number {
  const currentState = circuitStateStore.read();
  if (!currentState) {
    return 0;
  }

  const remainingMs = currentState.openUntil - now;
  if (remainingMs <= 0) {
    circuitStateStore.clear();
    return 0;
  }

  return remainingMs;
}

export function getLlmPreflightDelayMs(now = Date.now()): number {
  return getActiveCircuitDelayMs(now);
}

function buildRateLimitErrorMessage(retryAfterMs?: number): string {
  if (retryAfterMs == null || retryAfterMs <= 0) {
    return "LLM provider rate limit reached before the workflow could continue.";
  }

  return `LLM provider rate limit reached. Retry after approximately ${Math.ceil(retryAfterMs / 1000)}s.`;
}

export function getLlmPreflightError(now = Date.now()): LlmProviderError | null {
  const retryAfterMs = getActiveCircuitDelayMs(now);
  if (retryAfterMs <= 0) {
    return null;
  }

  return new LlmProviderError("rate_limit", buildRateLimitErrorMessage(retryAfterMs), {
    retryAfterMs,
  });
}

function wrapFinalLlmError(error: unknown, retryAfterMs?: number): Error {
  if (isLlmProviderError(error)) {
    return error;
  }

  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  if (status === 429) {
    return new LlmProviderError("rate_limit", buildRateLimitErrorMessage(retryAfterMs), {
      retryAfterMs,
      statusCode: status,
      cause: error,
    });
  }

  if (status != null && (status === 408 || status >= 500)) {
    return new LlmProviderError(
      "service_unavailable",
      `LLM provider remained temporarily unavailable after retries (status ${status}).`,
      {
        statusCode: status,
        cause: error,
      },
    );
  }

  if (isRequestTimeoutError(error)) {
    return new LlmProviderError(
      "network",
      `LLM request timed out after approximately ${Math.ceil(env.LLM_REQUEST_TIMEOUT_MS / 1000)}s.`,
      {
        cause: error,
      },
    );
  }

  if (code === "ECONNRESET" || code === "ETIMEDOUT") {
    return new LlmProviderError(
      "network",
      "LLM request failed due to a transient provider/network timeout after retries.",
      {
        cause: error,
      },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function recordRateLimitCircuit(delayMs: number, reason: string): void {
  const now = Date.now();
  const currentState = circuitStateStore.read();
  const openUntil = Math.max(currentState?.openUntil ?? 0, now + delayMs);

  circuitStateStore.write({
    openUntil,
    reason,
    updatedAt: new Date(now).toISOString(),
  });
}

export async function callLLM(input: string) {
  const maxAttempts = Math.max(1, env.LLM_MAX_RETRIES + 1);
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    const activeCircuitDelayMs = getActiveCircuitDelayMs();
    if (activeCircuitDelayMs > env.LLM_RETRY_MAX_DELAY_MS) {
      throw new LlmProviderError("rate_limit", buildRateLimitErrorMessage(activeCircuitDelayMs), {
        retryAfterMs: activeCircuitDelayMs,
      });
    }

    if (activeCircuitDelayMs > 0) {
      await sleepFn(activeCircuitDelayMs);
    }

    const gateLease = await requestGate.acquire();
    let retryDelayMs: number | undefined;

    try {
      const rateLimitDelayMs = getActiveCircuitDelayMs();
      if (rateLimitDelayMs > env.LLM_RETRY_MAX_DELAY_MS) {
        throw new LlmProviderError("rate_limit", buildRateLimitErrorMessage(rateLimitDelayMs), {
          retryAfterMs: rateLimitDelayMs,
        });
      }

      if (rateLimitDelayMs > 0) {
        continue;
      }

      attempt += 1;

      try {
        const response = await llmTransport(
          "https://api.openai.com/v1/responses",
          {
            model: env.MODEL,
            input,
          },
          {
            headers: {
              Authorization: `Bearer ${env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: env.LLM_REQUEST_TIMEOUT_MS,
          },
        );

        circuitStateStore.clear();
        return response.data;
      } catch (error) {
        lastError = error;
        const status = getErrorStatus(error);
        retryDelayMs = getRetryDelayMs(error, attempt);

        if (status === 429) {
          recordRateLimitCircuit(retryDelayMs, "provider_rate_limit");
        }

        if (!isRetryableLlmError(error) || attempt >= maxAttempts) {
          throw wrapFinalLlmError(error, status === 429 ? retryDelayMs : undefined);
        }
      }
    } finally {
      gateLease.release();
    }

    if (retryDelayMs != null) {
      await sleepFn(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function setLlmTransportForTesting(transport?: LlmTransport): void {
  llmTransport = transport ?? (axios.post.bind(axios) as LlmTransport);
}

export function setLlmSleepForTesting(sleep?: SleepFn): void {
  sleepFn =
    sleep ??
    (async (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
}

export function setLlmCircuitStateStoreForTesting(store?: LlmCircuitStateStore): void {
  circuitStateStore = store ?? createDefaultCircuitStateStore();
}

export function setLlmRequestGateForTesting(gate?: LlmRequestGate): void {
  requestGate = gate ?? createDefaultRequestGate();
}

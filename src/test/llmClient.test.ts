import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { env } from "../config/env";
import {
  callLLM,
  isLlmProviderError,
  setLlmCircuitStateStoreForTesting,
  setLlmSleepForTesting,
  setLlmTransportForTesting,
} from "../core/llmClient";

function buildAxiosLikeError(
  status: number,
  options: { retryAfter?: string; code?: string; message?: string } = {},
): Error & {
  response: { status: number; headers: Record<string, string> };
  code?: string;
} {
  const error = new Error(options.message ?? `Request failed with status code ${status}`) as Error & {
    response: { status: number; headers: Record<string, string> };
    code?: string;
  };

  error.response = {
    status,
    headers: options.retryAfter ? { "retry-after": options.retryAfter } : {},
  };
  error.code = options.code;
  return error;
}

test("callLLM retries a 429 response and respects Retry-After", async () => {
  const calls: number[] = [];
  const sleeps: number[] = [];
  const originalDateNow = Date.now;
  let now = 1_000_000;
  let circuitState:
    | { openUntil: number; reason: string; updatedAt: string }
    | undefined;

  Date.now = () => now;

  setLlmTransportForTesting(async () => {
    calls.push(Date.now());
    if (calls.length === 1) {
      throw buildAxiosLikeError(429, { retryAfter: "2" });
    }

    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
    now += ms;
  });
  setLlmCircuitStateStoreForTesting({
    read: () => circuitState,
    write: (state) => {
      circuitState = state;
    },
    clear: () => {
      circuitState = undefined;
    },
  });

  try {
    const response = await callLLM("retry on 429");

    assert.deepEqual(response, {
      output_text: JSON.stringify({ ok: true }),
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.equal(circuitState, undefined);
  } finally {
    Date.now = originalDateNow;
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM retries a transient 5xx response with exponential backoff", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  let circuitWrites = 0;

  setLlmTransportForTesting(async () => {
    attempts += 1;
    if (attempts <= 2) {
      throw buildAxiosLikeError(500);
    }

    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
  });
  setLlmCircuitStateStoreForTesting({
    read: () => undefined,
    write: () => {
      circuitWrites += 1;
    },
    clear: () => undefined,
  });

  try {
    const response = await callLLM("retry on 500");

    assert.deepEqual(response, {
      output_text: JSON.stringify({ ok: true }),
    });
    assert.equal(attempts, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.equal(circuitWrites, 0);
  } finally {
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM does not retry non-retryable 4xx responses", async () => {
  let attempts = 0;

  setLlmTransportForTesting(async () => {
    attempts += 1;
    throw buildAxiosLikeError(400, { message: "Request failed with status code 400" });
  });
  setLlmSleepForTesting(async () => undefined);

  try {
    await assert.rejects(() => callLLM("do not retry on 400"), /status code 400/);
    assert.equal(attempts, 1);
  } finally {
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM waits for a short persisted rate-limit cooldown before sending the next request", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const originalDateNow = Date.now;
  let now = 2_000_000;
  let circuitState = {
    openUntil: now + 1500,
    reason: "provider_rate_limit",
    updatedAt: new Date().toISOString(),
  };

  Date.now = () => now;

  setLlmTransportForTesting(async () => {
    attempts += 1;
    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
    now += ms;
  });
  setLlmCircuitStateStoreForTesting({
    read: () => circuitState,
    write: (state) => {
      circuitState = state;
    },
    clear: () => {
      circuitState = undefined as unknown as typeof circuitState;
    },
  });

  try {
    const response = await callLLM("wait through persisted cooldown");

    assert.deepEqual(response, {
      output_text: JSON.stringify({ ok: true }),
    });
    assert.equal(attempts, 1);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 0);
  } finally {
    Date.now = originalDateNow;
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM fails fast when a persisted rate-limit cooldown is too long", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const circuitState = {
    openUntil: Date.now() + 20_000,
    reason: "provider_rate_limit",
    updatedAt: new Date().toISOString(),
  };

  setLlmTransportForTesting(async () => {
    attempts += 1;
    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
  });
  setLlmCircuitStateStoreForTesting({
    read: () => circuitState,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    await assert.rejects(
      () => callLLM("fail fast on persisted cooldown"),
      /rate limit reached\. Retry after approximately 20s\./i,
    );
    assert.equal(attempts, 0);
    assert.deepEqual(sleeps, []);
  } finally {
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM wraps a final 429 with an actionable provider error", async () => {
  let attempts = 0;
  const sleeps: number[] = [];

  setLlmTransportForTesting(async () => {
    attempts += 1;
    throw buildAxiosLikeError(429, { retryAfter: "3" });
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
  });
  setLlmCircuitStateStoreForTesting({
    read: () => undefined,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    await assert.rejects(
      async () => {
        try {
          await callLLM("exhaust rate-limit retries");
        } catch (error) {
          assert.equal(isLlmProviderError(error), true);
          assert.match(
            error instanceof Error ? error.message : String(error),
            /rate limit reached\. Retry after approximately 3s\./i,
          );
          throw error;
        }
      },
      /rate limit reached\. Retry after approximately 3s\./i,
    );
    assert.equal(attempts, 3);
    assert.deepEqual(sleeps, [3000, 3000]);
  } finally {
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
  }
});

test("callLLM waits for a busy local request gate before calling the provider", async () => {
  const tempRunDir = mkdtempSync(join(tmpdir(), "ai-agent-workflows-llm-gate-"));
  const originalRunStorageDir = env.RUN_STORAGE_DIR;
  const originalGatePollMs = env.LLM_REQUEST_GATE_POLL_MS;
  const lockPath = join(tempRunDir, "_system", "llm-request.lock");
  const sleeps: number[] = [];
  let attempts = 0;

  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(
    lockPath,
    JSON.stringify({
      ownerId: "other-process",
      pid: 999,
      acquiredAt: new Date().toISOString(),
      expiresAt: Date.now() + 5_000,
    }),
    "utf-8",
  );

  env.RUN_STORAGE_DIR = tempRunDir;
  env.LLM_REQUEST_GATE_POLL_MS = 25;

  setLlmTransportForTesting(async () => {
    attempts += 1;
    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
    if (sleeps.length === 1) {
      rmSync(lockPath, { force: true });
    }
  });
  setLlmCircuitStateStoreForTesting({
    read: () => undefined,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    const response = await callLLM("wait for busy request gate");

    assert.deepEqual(response, {
      output_text: JSON.stringify({ ok: true }),
    });
    assert.equal(attempts, 1);
    assert.deepEqual(sleeps, [25]);
  } finally {
    env.RUN_STORAGE_DIR = originalRunStorageDir;
    env.LLM_REQUEST_GATE_POLL_MS = originalGatePollMs;
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
    rmSync(tempRunDir, { recursive: true, force: true });
  }
});

test("callLLM clears a stale local request gate before calling the provider", async () => {
  const tempRunDir = mkdtempSync(join(tmpdir(), "ai-agent-workflows-llm-gate-"));
  const originalRunStorageDir = env.RUN_STORAGE_DIR;
  const originalGatePollMs = env.LLM_REQUEST_GATE_POLL_MS;
  const lockPath = join(tempRunDir, "_system", "llm-request.lock");
  const sleeps: number[] = [];
  let attempts = 0;

  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(
    lockPath,
    JSON.stringify({
      ownerId: "stale-process",
      pid: 111,
      acquiredAt: new Date(Date.now() - 20_000).toISOString(),
      expiresAt: Date.now() - 1_000,
    }),
    "utf-8",
  );

  env.RUN_STORAGE_DIR = tempRunDir;
  env.LLM_REQUEST_GATE_POLL_MS = 25;

  setLlmTransportForTesting(async () => {
    attempts += 1;
    return {
      data: {
        output_text: JSON.stringify({ ok: true }),
      },
    };
  });
  setLlmSleepForTesting(async (ms) => {
    sleeps.push(ms);
  });
  setLlmCircuitStateStoreForTesting({
    read: () => undefined,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    const response = await callLLM("clear stale request gate");

    assert.deepEqual(response, {
      output_text: JSON.stringify({ ok: true }),
    });
    assert.equal(attempts, 1);
    assert.deepEqual(sleeps, []);
  } finally {
    env.RUN_STORAGE_DIR = originalRunStorageDir;
    env.LLM_REQUEST_GATE_POLL_MS = originalGatePollMs;
    setLlmTransportForTesting();
    setLlmSleepForTesting();
    setLlmCircuitStateStoreForTesting();
    rmSync(tempRunDir, { recursive: true, force: true });
  }
});

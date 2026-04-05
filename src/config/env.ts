import * as dotenv from "dotenv";

dotenv.config();

export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  MODEL: process.env.MODEL || "gpt-5",
  LLM_MAX_RETRIES: Number(process.env.LLM_MAX_RETRIES || "2"),
  LLM_RETRY_BASE_DELAY_MS: Number(process.env.LLM_RETRY_BASE_DELAY_MS || "1000"),
  LLM_RETRY_MAX_DELAY_MS: Number(process.env.LLM_RETRY_MAX_DELAY_MS || "8000"),
  LLM_REQUEST_GATE_POLL_MS: Number(process.env.LLM_REQUEST_GATE_POLL_MS || "250"),
  LLM_REQUEST_GATE_STALE_MS: Number(process.env.LLM_REQUEST_GATE_STALE_MS || "120000"),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  LOG_FULL_PAYLOADS: process.env.LOG_FULL_PAYLOADS === "true",
  RUN_STORAGE_DIR: process.env.RUN_STORAGE_DIR || ".runs",
  MAX_PERSISTED_RUNS: Number(process.env.MAX_PERSISTED_RUNS || "200"),
  EXTERNAL_API_BASE_URL: process.env.EXTERNAL_API_BASE_URL || "",
  EXTERNAL_API_TIMEOUT_MS: Number(process.env.EXTERNAL_API_TIMEOUT_MS || "5000"),
};

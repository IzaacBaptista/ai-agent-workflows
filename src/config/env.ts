import * as dotenv from "dotenv";

dotenv.config();

export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  MODEL: process.env.MODEL || "gpt-5",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  LOG_FULL_PAYLOADS: process.env.LOG_FULL_PAYLOADS === "true",
  RUN_STORAGE_DIR: process.env.RUN_STORAGE_DIR || ".runs"
};

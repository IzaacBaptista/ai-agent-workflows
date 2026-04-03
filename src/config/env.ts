import * as dotenv from "dotenv";

dotenv.config();

export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  MODEL: process.env.MODEL || "gpt-5"
};

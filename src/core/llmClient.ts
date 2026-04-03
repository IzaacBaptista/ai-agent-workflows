import axios from "axios";
import { env } from "../config/env";

export async function callLLM(input: string) {
  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: env.MODEL,
      input
    },
    {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

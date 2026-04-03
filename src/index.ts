import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function runAgent() {
  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: "gpt-5",
      input: "Transform this issue into a technical plan: User cannot login after password reset"
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log(response.data);
}

runAgent();

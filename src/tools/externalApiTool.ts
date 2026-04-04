import axios from "axios";
import { env } from "../config/env";

export interface ApiResponse {
  status: number;
  data: unknown;
  source: "http" | "unconfigured";
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildRequestUrl(endpoint: string): string | null {
  if (isAbsoluteUrl(endpoint)) {
    return endpoint;
  }

  if (!env.EXTERNAL_API_BASE_URL) {
    return null;
  }

  const baseUrl = env.EXTERNAL_API_BASE_URL.endsWith("/")
    ? env.EXTERNAL_API_BASE_URL
    : `${env.EXTERNAL_API_BASE_URL}/`;

  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  return new URL(normalizedEndpoint, baseUrl).toString();
}

function normalizeResponseData(data: unknown): unknown {
  if (data == null || typeof data !== "object") {
    return data;
  }

  try {
    const serialized = JSON.stringify(data);
    if (serialized.length <= 4000) {
      return data;
    }

    return {
      preview: `${serialized.slice(0, 4000)}...`,
      truncated: true,
    };
  } catch {
    return "[unserializable response]";
  }
}

export async function callExternalApi(endpoint: string): Promise<ApiResponse> {
  const requestUrl = buildRequestUrl(endpoint);

  if (!requestUrl) {
    return {
      status: 0,
      source: "unconfigured",
      data: {
        message: "External API base URL is not configured",
        endpoint,
      },
    };
  }

  const response = await axios.get(requestUrl, {
    timeout: env.EXTERNAL_API_TIMEOUT_MS,
    validateStatus: () => true,
    headers: {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
  });

  return {
    status: response.status,
    source: "http",
    data: normalizeResponseData(response.data),
  };
}

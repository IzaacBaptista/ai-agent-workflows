export interface ApiResponse {
  endpoint: string;
  status: number;
  data: Record<string, unknown>;
}

export async function callExternalApi(endpoint: string): Promise<ApiResponse> {
  // Mock implementation — replace with real HTTP calls
  return {
    endpoint,
    status: 200,
    data: {
      message: `Mock response from ${endpoint}`,
      timestamp: new Date().toISOString()
    }
  };
}

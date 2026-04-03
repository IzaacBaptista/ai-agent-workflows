export interface ApiResponse {
  status: number;
  data: unknown;
}

export async function callExternalApi(endpoint: string): Promise<ApiResponse> {
  return {
    status: 200,
    data: { message: `Mock response from endpoint: ${endpoint}` }
  };
}

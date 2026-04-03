export function logAgentExecution(agentName: string, input: string, output: unknown): void {
  console.log("===== AGENT EXECUTION LOG =====");
  console.log(`Agent: ${agentName}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("Input:", input);
  console.log("Output:", JSON.stringify(output, null, 2));
  console.log("================================");
}

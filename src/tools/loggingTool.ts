export function logAgentExecution(agentName: string, input: string, output: any): void {
  console.log("===== AGENT EXECUTION LOG =====");
  console.log(`Agent:     ${agentName}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("Input:");
  console.log(input);
  console.log("Output:");
  console.log(JSON.stringify(output, null, 2));
  console.log("================================");
}

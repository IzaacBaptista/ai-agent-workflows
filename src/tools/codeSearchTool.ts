export interface CodeSearchResult {
  file: string;
  line: number;
  snippet: string;
}

export function searchCode(term: string): CodeSearchResult[] {
  return [
    { file: "src/example.ts", line: 42, snippet: `// Mock result for: ${term}` }
  ];
}

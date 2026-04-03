export interface CodeSearchResult {
  file: string;
  line: number;
  snippet: string;
}

export function searchCode(term: string): CodeSearchResult[] {
  // Mock implementation — replace with real code search integration
  return [
    {
      file: "src/services/authService.ts",
      line: 42,
      snippet: `// Mock result for term: "${term}"\nconst result = await db.find({ query: term });`
    },
    {
      file: "src/utils/helpers.ts",
      line: 17,
      snippet: `// Mock result for term: "${term}"\nexport function ${term}Helper() {}`
    }
  ];
}

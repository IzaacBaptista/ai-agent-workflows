import { PRReview } from "../core/types";

function formatSection(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return ["", `### ${heading}`, ...items.map((item) => `- ${item}`)];
}

export function formatPRReviewComment(review: PRReview): string {
  return [
    "## 🤖 AI PR Review",
    "",
    "### Summary",
    review.summary,
    ...formatSection("Impacts", review.impacts),
    ...formatSection("Risks", review.risks),
    ...formatSection("Suggestions", review.suggestions),
    ...formatSection("Test Recommendations", review.testRecommendations),
  ].join("\n");
}

/**
 * @fileoverview Gemini-powered visualizer webapp generation.
 *
 * Prompts Gemini 2.5 Pro to create a single-file React/HTML/Tailwind
 * dashboard that visually summarizes research findings. The generated
 * artifact includes Tailwind CSS and Recharts via CDN for rich visuals,
 * safe to serve inside a sandboxed Dynamic Worker iframe.
 */

import { GoogleGenAI } from "@google/genai";

/**
 * Generate a single-file HTML visualizer webapp from research markdown.
 *
 * @param env       Worker environment bindings
 * @param topic     Research topic
 * @param markdown  Full research markdown content
 * @returns         Complete HTML string for the visualizer
 */
export async function generateVisualizerWebapp(
  env: Env,
  topic: string,
  markdown: string,
): Promise<string> {
  const geminiApiKey = await env.GEMINI_API_KEY.get();
  const cloudflareAccountId = await env.CLOUDFLARE_ACCOUNT_ID.get();

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!cloudflareAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  }

  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
    },
  });

  // Truncate markdown if extremely long to fit in context window
  const truncatedMarkdown =
    markdown.length > 80_000 ? markdown.slice(0, 80_000) + "\n\n[...truncated]" : markdown;

  const prompt = `You are a data visualization engineer. Given the following research report on "${topic}", create a SINGLE self-contained HTML file that acts as an interactive research dashboard.

REQUIREMENTS:
1. Include Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
2. Include Recharts via UMD CDN: <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>, <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>, <script src="https://unpkg.com/recharts@2/umd/Recharts.min.js"></script>
3. Use a DARK THEME: background #09090b (zinc-950), text #fafafa, cards with zinc-900 backgrounds, emerald-500 accents.
4. Include at least 3 visual sections:
   - A hero section with the topic title, key stats, and executive summary
   - A timeline or flowchart showing the key phases/milestones from the research
   - At least 2 Recharts charts (bar chart, pie chart, area chart, or line chart) visualizing quantitative findings from the research
5. Add smooth CSS animations and hover effects on cards.
6. Make it fully responsive (mobile-friendly).
7. Extract REAL data points and findings from the research — do NOT use placeholder data.
8. All JavaScript should be inline in <script> tags with type="text/babel" if using JSX, or use plain createElement calls.
9. The HTML must be completely self-contained — no external dependencies beyond the CDN links above.

RESEARCH REPORT:
${truncatedMarkdown}

OUTPUT ONLY the complete HTML file content, starting with <!DOCTYPE html> and ending with </html>. No markdown fences, no explanations.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
  });

  let html = response.text ?? "";

  // Strip any accidental markdown fences that the model might wrap around the HTML
  html = html.replace(/^```html?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  // Validate we got something that looks like HTML
  if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
    throw new Error("Gemini did not return valid HTML for the visualizer");
  }

  return html;
}

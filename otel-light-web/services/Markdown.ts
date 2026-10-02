import DOMPurify from "dompurify";
import { marked } from "marked";

// Renders markdown coming from untrusted sources (telemetry / LLM output).
// marked does not sanitize, so the HTML is passed through DOMPurify before it
// is injected with v-html.
export function renderMarkdown(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }) as string);
}

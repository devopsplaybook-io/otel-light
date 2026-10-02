import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../services/Markdown";

describe("renderMarkdown", () => {
  it("returns an empty string for empty, null or undefined input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null as unknown as string)).toBe("");
    expect(renderMarkdown(undefined as unknown as string)).toBe("");
  });

  it("strips script tags and their content", () => {
    const html = renderMarkdown('hello <script>alert("xss")</script> world');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
    expect(html).toContain("hello");
    expect(html).toContain("world");
  });

  it("strips inline event handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert");
  });

  it("neutralizes javascript: URLs", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  it("strips event handlers on other tags", () => {
    const html = renderMarkdown('<svg onload="alert(1)"></svg>');
    expect(html).not.toContain("onload");
    expect(html).not.toContain("alert");
  });

  it("keeps rendering normal markdown", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("# Heading")).toContain("<h1");
    const list = renderMarkdown("- one\n- two");
    expect(list).toContain("<ul>");
    expect(list).toContain("<li>one</li>");
    expect(list).toContain("<li>two</li>");
    const link = renderMarkdown("[docs](https://example.com)");
    expect(link).toContain('<a href="https://example.com">docs</a>');
  });

  it("renders telemetry-like content with mixed safe and unsafe markup", () => {
    const html = renderMarkdown(
      '## Analysis\n\n- **Service** `api-gateway`\n- <img src=x onerror="steal()">',
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>Service</strong>");
    expect(html).not.toContain("onerror");
  });
});

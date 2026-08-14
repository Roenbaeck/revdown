import { renderCommentMarkdown } from "./comment";

describe("comment Markdown renderer", () => {
  it("renders safe Markdown without document source-mapping metadata", async () => {
    const body =
      "**Review** [docs](https://example.com) $x^2$ <script>alert(1)</script>";
    const first = renderCommentMarkdown(body);
    const second = renderCommentMarkdown(body);
    expect(second).toBe(first);

    const html = await first;
    expect(html).toContain("<strong>Review</strong>");
    expect(html).toContain('data-rd-href="https://example.com"');
    expect(html).toContain("katex");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("data-rd-source-start");
  });

  it("renders standalone LaTeX display delimiters", async () => {
    const html = await renderCommentMarkdown(
      "Before\n\\[\nE = mc^2\n\\]\nAfter",
    );

    expect(html).toContain("katex-display");
    expect(html).not.toContain("\\[");
  });
});

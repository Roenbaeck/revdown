import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildLargeMarkdownFixture,
  LARGE_MARKDOWN_EXPECTED_BLOCKS,
} from "../../../tests/fixtures/large-markdown";
import { fingerprintText } from "../fingerprints";
import { buildBoundaryMap, parseMarkdownDocument } from "./model";

const INITIAL_READABILITY_BUDGET_MS = 2_000;
const isCi = Boolean(process.env.CI);

describe("Markdown source model", () => {
  it("maps escaped text, entities, CRLF, and UTF-16 offsets", () => {
    expect(buildBoundaryMap("\\*", "*", 7)).toEqual([7, 9]);
    expect(buildBoundaryMap("&amp;", "&", 4)).toEqual([4, 9]);
    expect(buildBoundaryMap("a\r\nb", "a\nb", 10)).toEqual([10, 11, 13, 14]);
    expect(buildBoundaryMap("😀", "😀", 3)).toEqual([3, 4, 5]);
  });

  it("renders GFM, safe math, lazy-highlighted code, and source-backed blocks", async () => {
    const source = [
      "# Title",
      "",
      "A *formatted* [link](https://example.com) and $x^2$.",
      "",
      "| A | B |",
      "| - | - |",
      "| one | two |",
      "",
      "```ts",
      "// This comment remains readable in dark mode.",
      "const value = 1;",
      "```",
    ].join("\n");
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    expect(model.html).toContain("katex");
    expect(model.html).toContain("rd-highlighted-code");
    expect(model.html).toContain("--shiki-dark:#8B949E");
    expect(model.html).toContain("data-rd-block-id");
    expect(model.html).toContain('data-rd-href="https://example.com"');
    expect(
      [...model.blocks.values()].some((block) => block.kind === "tableCell"),
    ).toBe(true);
    expect(
      [...model.blocks.values()].find((block) => block.kind === "code")
        ?.codeMap,
    ).toBeDefined();
  });

  it("does not execute or retain raw HTML and strips unsafe URL schemes", async () => {
    const source =
      '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n<img src=x onerror="alert(2)">';
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    expect(model.html).not.toContain("<script");
    expect(model.html).not.toContain("javascript:");
    expect(model.html).not.toContain("onerror");
  });

  it("renders the Markdown conformance fixture including footnotes and tasks", async () => {
    const source = await readFile(
      resolve("tests/fixtures/markdown-kitchen-sink.md"),
      "utf8",
    );
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    expect(model.html).toContain("<table>");
    expect(model.html).toContain("<blockquote>");
    expect(model.html).toContain('type="checkbox"');
    expect(model.html).toContain("data-footnotes");
    expect(model.html).toContain('href="#user-content-fn-');
    expect(model.html).not.toContain('data-rd-href="#user-content-fn-');
    expect(model.html).toContain("katex-display");
    expect(model.html).toContain("--shiki-dark:");
    expect(
      [...model.blocks.values()].filter((block) => block.kind === "heading"),
    ).toHaveLength(6);
  });

  describe.skipIf(isCi)("local performance budgets", () => {
    it("keeps a 1 MiB document within the initial readability budget", async () => {
      const heading = "# Large fixture\n\n";
      const source =
        heading +
        "A source-backed paragraph with Unicode 😀 and stable mapping. ".repeat(
          18_000,
        );
      const started = performance.now();
      const model = await parseMarkdownDocument(
        source,
        await fingerprintText(source),
      );
      expect(model.html).toContain("source-backed paragraph");
      expect(performance.now() - started).toBeLessThan(
        INITIAL_READABILITY_BUDGET_MS,
      );
    });

    it("renders a generated novel without degrading with its block count", async () => {
      const source = buildLargeMarkdownFixture();
      const started = performance.now();
      const model = await parseMarkdownDocument(
        source,
        await fingerprintText(source),
      );
      expect(model.blocks.size).toBe(LARGE_MARKDOWN_EXPECTED_BLOCKS);
      expect(performance.now() - started).toBeLessThan(
        INITIAL_READABILITY_BUDGET_MS,
      );
    });
  });
});

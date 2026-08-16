import { parseMarkdownDocument } from "./model";
import { searchMarkdownDocument } from "./search";

const fingerprint = {
  sha256: "a".repeat(64),
  normalizedSha256: "b".repeat(64),
};

describe("rendered document search", () => {
  it("finds case-insensitive phrases across inline Markdown", async () => {
    const source = "Alpha **Beta** gamma";
    const model = await parseMarkdownDocument(source, fingerprint);

    const results = searchMarkdownDocument(model, "alpha beta");

    expect(results).toMatchObject({ total: 1, limited: false });
    expect(results.matches[0]).toMatchObject({
      blockId: `paragraph:0:${source.length}`,
      renderedRange: { start: 0, end: 10 },
    });
    expect(
      source.slice(
        results.matches[0]?.sourceRange.start,
        results.matches[0]?.sourceRange.end,
      ),
    ).toBe("Alpha **Beta**");
  });

  it("uses UTF-16 offsets and treats metacharacters literally", async () => {
    const source = "A 😀 café and [brackets].";
    const model = await parseMarkdownDocument(source, fingerprint);

    const unicode = searchMarkdownDocument(model, "CAFÉ");
    const literal = searchMarkdownDocument(model, "[brackets]");

    expect(
      source.slice(
        unicode.matches[0]?.sourceRange.start,
        unicode.matches[0]?.sourceRange.end,
      ),
    ).toBe("café");
    expect(literal).toMatchObject({ total: 1, limited: false });
  });

  it("counts results beyond the materialized navigation limit", async () => {
    const model = await parseMarkdownDocument("one one one", fingerprint);

    const results = searchMarkdownDocument(model, "one", 2);

    expect(results.matches).toHaveLength(2);
    expect(results.total).toBe(3);
    expect(results.limited).toBe(true);
  });
});

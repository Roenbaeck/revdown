import { fingerprintText } from "../fingerprints";
import { parseMarkdownDocument } from "../markdown/model";
import type { Anchor } from "../schema/sidecar";
import { confirmAnchorCandidate, matchAllAnchors, matchAnchor } from "./match";

async function anchorFor(
  source: string,
  text: string,
): Promise<{
  anchor: Anchor;
  model: Awaited<ReturnType<typeof parseMarkdownDocument>>;
}> {
  const fingerprint = await fingerprintText(source);
  const model = await parseMarkdownDocument(source, fingerprint);
  const start = source.indexOf(text);
  const block = [...model.blocks.values()].find(
    (candidate) =>
      start >= candidate.start && start + text.length <= candidate.end,
  )!;
  return {
    model,
    anchor: {
      documentSha256: fingerprint.sha256,
      documentNormalizedSha256: fingerprint.normalizedSha256,
      sourceRange: { start, end: start + text.length },
      sourceText: text,
      textQuote: { exact: text, prefix: "Before ", suffix: " after" },
      block: {
        start: block.start,
        end: block.end,
        sourceSha256: block.sourceSha256,
      },
      headingPath: block.headingPath,
      lineHint: { start: block.lineStart, end: block.lineEnd },
    },
  };
}

describe("conservative anchor matching", () => {
  it("classifies an unchanged verified range as exact", async () => {
    const { anchor, model } = await anchorFor(
      "# A\n\nBefore target text after",
      "target text",
    );
    expect(matchAnchor(anchor, model).state).toBe("exact");
  });

  it("relocates a unique exact target after an insertion", async () => {
    const { anchor } = await anchorFor(
      "# A\n\nBefore target text after",
      "target text",
    );
    const changed = "New introduction.\n\n# A\n\nBefore target text after";
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );
    const result = matchAnchor(anchor, model);
    expect(result.state).toBe("relocated");
    expect(
      changed.slice(
        result.candidate!.sourceRange.start,
        result.candidate!.sourceRange.end,
      ),
    ).toBe("target text");
    expect(
      confirmAnchorCandidate(anchor, result.candidate!, model).textQuote,
    ).toEqual({
      exact: "target text",
      prefix: "Before ",
      suffix: " after",
    });
  });

  it("leaves repeated targets ambiguous", async () => {
    const { anchor } = await anchorFor(
      "# A\n\nBefore repeated phrase after",
      "repeated phrase",
    );
    const changed = "# B\n\nrepeated phrase\n\nrepeated phrase";
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );
    expect(matchAnchor(anchor, model).state).toBe("ambiguous");
  });

  it("does not promote a misleading near-match outside the heading", async () => {
    const { anchor } = await anchorFor(
      "# Correct\n\nunique safety constraint applies here",
      "unique safety constraint applies here",
    );
    const changed = "# Elsewhere\n\nunique unsafe constraint applies here";
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );
    expect(matchAnchor(anchor, model).state).toBe("unmatched");
  });

  it("never matches rendered quote evidence inside an invisible link destination", async () => {
    const { anchor } = await anchorFor(
      "# A\n\nBefore secret target after",
      "secret target",
    );
    const changed =
      '# A\n\n[Visible label](https://example.com "secret target")';
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );

    expect(matchAnchor(anchor, model).state).toBe("unmatched");

    const image = '# A\n\n![Visible alt](image.png "secret target")';
    const imageModel = await parseMarkdownDocument(
      image,
      await fingerprintText(image),
    );
    expect(matchAnchor(anchor, imageModel).state).toBe("unmatched");
  });

  it("relocates formatted rendered text and confirms rendered context", async () => {
    const { anchor } = await anchorFor(
      "# A\n\nBefore important target after",
      "important target",
    );
    const changed = "# A\n\nBefore important *target* after";
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );
    const result = matchAnchor(anchor, model);

    expect(result.state).toBe("relocated");
    expect(result.candidate).toBeDefined();
    const candidate = result.candidate!;
    expect(
      changed.slice(candidate.sourceRange.start, candidate.sourceRange.end),
    ).toBe("important *target*");
    const confirmed = confirmAnchorCandidate(anchor, candidate, model);
    expect(confirmed.textQuote).toEqual({
      exact: "important target",
      prefix: "Before ",
      suffix: " after",
    });
  });

  it("relocates rendered entities through their source boundary maps", async () => {
    const { anchor } = await anchorFor(
      "# A\n\nBefore Fish & chips after",
      "Fish & chips",
    );
    const changed = "# A\n\nBefore Fish &amp; chips after";
    const model = await parseMarkdownDocument(
      changed,
      await fingerprintText(changed),
    );
    const result = matchAnchor(anchor, model);

    expect(result.state).toBe("relocated");
    expect(
      changed.slice(
        result.candidate!.sourceRange.start,
        result.candidate!.sourceRange.end,
      ),
    ).toBe("Fish &amp; chips");
  });

  it("relocates visible text across link and inline-code markup", async () => {
    const { anchor: linkAnchor } = await anchorFor(
      "# A\n\nBefore Open docs after",
      "Open docs",
    );
    const linked = "# A\n\nBefore [Open *docs*](https://example.com) after";
    const linkedModel = await parseMarkdownDocument(
      linked,
      await fingerprintText(linked),
    );
    const linkResult = matchAnchor(linkAnchor, linkedModel);
    expect(linkResult.state).toBe("relocated");
    expect(
      linked.slice(
        linkResult.candidate!.sourceRange.start,
        linkResult.candidate!.sourceRange.end,
      ),
    ).toBe("[Open *docs*](https://example.com)");

    const { anchor: codeAnchor } = await anchorFor(
      "# A\n\nBefore code value after",
      "code value",
    );
    const coded = "# A\n\nBefore `code value` after";
    const codedModel = await parseMarkdownDocument(
      coded,
      await fingerprintText(coded),
    );
    expect(matchAnchor(codeAnchor, codedModel).state).toBe("relocated");
  });

  it("does not trust syntax-only ranges or inconsistent stored blocks", async () => {
    const source = "# A\n\nBefore **target** after";
    const fingerprint = await fingerprintText(source);
    const model = await parseMarkdownDocument(source, fingerprint);
    const block = model.blocksInSourceOrder.find(
      (candidate) => candidate.kind === "paragraph",
    )!;
    const syntaxStart = source.indexOf("**");
    const syntaxAnchor: Anchor = {
      documentSha256: fingerprint.sha256,
      documentNormalizedSha256: fingerprint.normalizedSha256,
      sourceRange: { start: syntaxStart, end: syntaxStart + 2 },
      sourceText: "**",
      textQuote: { exact: "**", prefix: "", suffix: "" },
      block: {
        start: block.start,
        end: block.end,
        sourceSha256: block.sourceSha256,
      },
      headingPath: block.headingPath,
      lineHint: { start: block.lineStart, end: block.lineEnd },
    };
    expect(matchAnchor(syntaxAnchor, model).state).toBe("unmatched");

    const { anchor } = await anchorFor(source, "target");
    const inconsistent = {
      ...anchor,
      block: { ...anchor.block, end: anchor.block.end + 1 },
    };
    expect(matchAnchor(inconsistent, model).state).not.toBe("exact");
  });

  it.skipIf(Boolean(process.env.CI))(
    "matches 1,000 unchanged comments without freezing",
    async () => {
      const source = Array.from(
        { length: 1_000 },
        (_, index) => `Paragraph ${index}: unique target ${index}.`,
      ).join("\n\n");
      const fingerprint = await fingerprintText(source);
      const model = await parseMarkdownDocument(source, fingerprint);
      const paragraphBlocks = model.blocksInSourceOrder.filter(
        (block) => block.kind === "paragraph",
      );
      const anchors = paragraphBlocks.map((block, index) => {
        const sourceText = `unique target ${index}`;
        const start = source.indexOf(sourceText, block.start);
        return {
          id: `comment-${index}`,
          anchor: {
            documentSha256: fingerprint.sha256,
            documentNormalizedSha256: fingerprint.normalizedSha256,
            sourceRange: { start, end: start + sourceText.length },
            sourceText,
            textQuote: { exact: sourceText, prefix: "", suffix: "" },
            block: {
              start: block.start,
              end: block.end,
              sourceSha256: block.sourceSha256,
            },
            headingPath: block.headingPath,
            lineHint: { start: block.lineStart, end: block.lineEnd },
          } satisfies Anchor,
        };
      });
      const started = performance.now();
      const matches = matchAllAnchors(anchors, model);
      expect(
        [...matches.values()].every((match) => match.state === "exact"),
      ).toBe(true);
      expect(performance.now() - started).toBeLessThan(2_000);
    },
  );
});

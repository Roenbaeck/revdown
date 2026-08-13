import { fingerprintText } from "../fingerprints";
import { parseMarkdownDocument } from "../markdown/model";
import type { Anchor } from "../schema/sidecar";
import { matchAnchor } from "./match";

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
});

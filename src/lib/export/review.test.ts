import type { AnchorMatch } from "../anchors/match";
import { createReviewComment } from "../comments/model";
import { createEmptySidecar } from "../schema/sidecar";
import { generateReviewMarkdown } from "./review";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("review export", () => {
  it("is self-describing, filters resolved comments, and safely fences Markdown", () => {
    const base = createEmptySidecar({
      filename: "unicode.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const anchor = {
      documentSha256: HASH_A,
      documentNormalizedSha256: HASH_B,
      sourceRange: { start: 4, end: 14 },
      sourceText: "**café 😀**",
      textQuote: { exact: "café 😀", prefix: "A ", suffix: " value" },
      block: { start: 0, end: 20, sourceSha256: HASH_A },
      headingPath: ["Résumé"],
      lineHint: { start: 2, end: 2 },
    };
    const open = createReviewComment({
      anchor,
      body: "Preserve this fence: ```ts\nvalue\n```",
      id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
      now: "2026-08-13T10:01:00.000Z",
    });
    const resolved = {
      ...open,
      id: "1b970d64-0e9a-4694-bf88-ed3d28fdc68d",
      status: "resolved" as const,
    };
    const sidecar = { ...base, comments: [open, resolved] };
    const match: AnchorMatch = {
      state: "ambiguous",
      confidence: 0.7,
      candidates: [],
    };
    const output = generateReviewMarkdown(sidecar, new Map([[open.id, match]]));
    expect(output).toContain("Never guess an ambiguous or unmatched target");
    expect(output).toContain("Anchor state: ambiguous");
    expect(output).toContain("**café 😀**");
    expect(output).toContain("````markdown");
    expect(output).not.toContain(resolved.id);
    expect(
      generateReviewMarkdown(sidecar, new Map(), { includeResolved: true }),
    ).toContain(resolved.id);
  });
});

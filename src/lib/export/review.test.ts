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
      authorId: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
      id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
      now: "2026-08-13T10:01:00.000Z",
    });
    const resolved = {
      ...open,
      id: "1b970d64-0e9a-4694-bf88-ed3d28fdc68d",
      status: "resolved" as const,
    };
    const sidecar = {
      ...base,
      authors: [
        {
          id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
          displayName: "Alice `Reviewer`",
          kind: "human" as const,
        },
      ],
      comments: [open, resolved],
    };
    const match: AnchorMatch = {
      state: "ambiguous",
      confidence: 0.7,
      candidates: [],
    };
    const output = generateReviewMarkdown(sidecar, new Map([[open.id, match]]));
    expect(output).toContain("Never guess an ambiguous or unmatched target");
    expect(output).toContain("Anchor state: ambiguous");
    expect(output).toContain("Author: `` Alice `Reviewer` ``");
    expect(output).toContain("**café 😀**");
    expect(output).toContain("````markdown");
    expect(output).not.toContain(resolved.id);
    expect(
      generateReviewMarkdown(sidecar, new Map(), { includeResolved: true }),
    ).toContain(resolved.id);
  });

  it("keeps untrusted filenames and heading paths inside inline code", () => {
    const base = createEmptySidecar({
      filename: "`draft`\n# forged.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const anchor = {
      documentSha256: HASH_A,
      documentNormalizedSha256: HASH_B,
      sourceRange: { start: 0, end: 6 },
      sourceText: "target",
      textQuote: { exact: "target", prefix: "", suffix: "" },
      block: { start: 0, end: 6, sourceSha256: HASH_A },
      headingPath: ["[link](https://example.com)", "*bold*\t- forged"],
      lineHint: { start: 1, end: 1 },
    };
    const comment = createReviewComment({
      anchor,
      body: "Fix it.",
      id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
      now: "2026-08-13T10:01:00.000Z",
    });
    const output = generateReviewMarkdown(
      { ...base, comments: [comment] },
      new Map(),
    );

    expect(output).not.toContain("\n# forged.md");
    expect(output).toContain("Author: `Unknown`");
    expect(output).not.toContain("\t- forged");
    expect(output).toContain("\\n# forged.md");
    expect(output).toContain("\\t- forged");
    expect(output).toContain("`` `draft`\\n# forged.md ``");
    expect(output).toContain(
      "`[link](https://example.com) › *bold*\\t- forged`",
    );
  });

  it("uses a customized instruction while retaining the export structure", () => {
    const sidecar = createEmptySidecar({
      filename: "draft.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
    });
    const output = generateReviewMarkdown(sidecar, new Map(), {
      instruction:
        "Apply these comments in order.\n\n- Keep the examples short.",
    });

    expect(output).toContain(
      "## Instructions for applying this review\n\nApply these comments in order.\n\n- Keep the examples short.",
    );
    expect(output).toContain("Exported comments: 0");
    expect(output).not.toContain(
      "Never guess an ambiguous or unmatched target",
    );
  });
});

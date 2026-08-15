import { matchAllAnchors } from "../anchors/match";
import { createReviewComment } from "../comments/model";
import { fingerprintText } from "../fingerprints";
import { parseMarkdownDocument } from "../markdown/model";
import { createAnchor, type MappedSelection } from "../markdown/selection";
import { createEmptySidecar } from "../schema/sidecar";
import { buildAgentReviewSnapshot } from "./reviewSnapshot";

describe("agent review snapshot", () => {
  it("publishes current source context without exposing a local path", async () => {
    const source = "# Context\n\nBefore selected text after.\n";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const start = source.indexOf("selected text");
    const block = model.blocksInSourceOrder.find(
      (candidate) => candidate.kind === "paragraph",
    )!;
    const mapped: MappedSelection = {
      block,
      sourceRange: { start, end: start + "selected text".length },
      sourceText: "selected text",
      renderedText: "selected text",
      prefix: "Before ",
      suffix: " after.",
    };
    const comment = createReviewComment({
      body: "Make this more specific.",
      anchor: createAnchor(model, mapped),
      now: "2026-08-15T10:00:00.000Z",
      id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
    });
    const sidecar = {
      ...createEmptySidecar({
        filename: "review.md",
        sha256: model.fingerprint.sha256,
        normalizedSha256: model.fingerprint.normalizedSha256,
        now: "2026-08-15T10:00:00.000Z",
      }),
      comments: [comment],
    };
    const matches = matchAllAnchors(
      sidecar.comments.map(({ id, anchor }) => ({ id, anchor })),
      model,
    );

    const snapshot = buildAgentReviewSnapshot({
      filename: "review.md",
      sourceSize: new TextEncoder().encode(source).byteLength,
      model,
      sidecar,
      sidecarRevision: "a".repeat(64),
      sidecarIssue: null,
      sourceChanged: false,
      matches,
    });

    expect(snapshot.comments[0]).toMatchObject({
      id: comment.id,
      updatedAt: comment.updatedAt,
      anchorState: "exact",
      target: "selected text",
      feedback: "Make this more specific.",
      currentAnchor: {
        sourceRange: mapped.sourceRange,
        sourceText: "selected text",
        headingPath: ["Context"],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("/Users/");
  });

  it("carries source-change and sidecar validation state", async () => {
    const source = "# Draft\n";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const snapshot = buildAgentReviewSnapshot({
      filename: "draft.md",
      sourceSize: source.length,
      model,
      sidecar: null,
      sidecarRevision: null,
      sidecarIssue: "Unsupported sidecar.",
      sourceChanged: true,
      matches: new Map(),
    });

    expect(snapshot).toMatchObject({
      filename: "draft.md",
      sourceChanged: true,
      sidecarIssue: "Unsupported sidecar.",
      comments: [],
    });
  });
});

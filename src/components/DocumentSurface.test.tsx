import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorMatch } from "../lib/anchors/match";
import type { MarkdownDocumentModel } from "../lib/markdown/model";
import type { ReviewComment } from "../lib/schema/sidecar";
import type { NativeService } from "../services/native";
import { DocumentSurface } from "./DocumentSurface";

const model: MarkdownDocumentModel = {
  source: "target",
  fingerprint: {
    sha256: "a".repeat(64),
    normalizedSha256: "b".repeat(64),
  },
  html: '<p data-rd-block-id="paragraph:0:6"><span class="rd-source-text" data-rd-source-start="0" data-rd-source-end="6">target</span></p>',
  blocks: new Map(),
  blocksInSourceOrder: [],
};
const comment: ReviewComment = {
  id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
  status: "open",
  body: "Clarify this.",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
  anchor: {
    documentSha256: "a".repeat(64),
    documentNormalizedSha256: "b".repeat(64),
    sourceRange: { start: 0, end: 6 },
    sourceText: "target",
    textQuote: { exact: "target", prefix: "", suffix: "" },
    block: { start: 0, end: 6, sourceSha256: "a".repeat(64) },
    headingPath: [],
    lineHint: { start: 1, end: 1 },
  },
};
const match: AnchorMatch = {
  state: "exact",
  confidence: 1,
  candidate: {
    sourceRange: { start: 0, end: 6 },
    renderedRange: { start: 0, end: 6 },
    blockId: "paragraph:0:6",
    score: 1,
    evidence: [],
  },
  candidates: [],
};
const native = {
  readLocalImage: () => Promise.resolve(null),
  openExternal: () => Promise.resolve(),
} as unknown as NativeService;

describe("document anchor accessibility", () => {
  it("makes an anchor keyboard-focusable and opens its comment with Enter", () => {
    const onSelectComment = vi.fn();
    render(
      <DocumentSurface
        model={model}
        comments={[comment]}
        matches={new Map([[comment.id, match]])}
        selectedCommentId={null}
        native={native}
        sessionId="session"
        onSelection={() => undefined}
        onSelectComment={onSelectComment}
        onMessage={() => undefined}
      />,
    );

    const anchor = screen.getByRole("button", {
      name: "open review comment, exact anchor: target",
    });
    expect(anchor).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(anchor, { key: "Enter" });
    expect(onSelectComment).toHaveBeenCalledWith(comment.id);
  });
});

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

function modelForSource(
  source: string,
  rendered = source,
  sourceMap?: readonly number[],
): MarkdownDocumentModel {
  const blockId = `paragraph:0:${source.length}`;
  const mapAttribute = sourceMap
    ? ` data-rd-source-map="${sourceMap.join(",")}"`
    : "";
  return {
    ...model,
    source,
    html: `<p data-rd-block-id="${blockId}"><span class="rd-source-text" data-rd-source-start="0" data-rd-source-end="${source.length}"${mapAttribute}>${rendered}</span></p>`,
  };
}

function commentForRange(
  id: string,
  source: string,
  exact: string,
): ReviewComment {
  const start = source.indexOf(exact);
  return {
    ...comment,
    id,
    anchor: {
      ...comment.anchor,
      sourceRange: { start, end: start + exact.length },
      sourceText: exact,
      textQuote: { exact, prefix: "", suffix: "" },
      block: {
        ...comment.anchor.block,
        start: 0,
        end: source.length,
      },
    },
  };
}

function matchForComment(
  reviewComment: ReviewComment,
  blockId: string,
): AnchorMatch {
  return {
    ...match,
    candidate: {
      ...match.candidate!,
      sourceRange: reviewComment.anchor.sourceRange,
      renderedRange: reviewComment.anchor.sourceRange,
      blockId,
    },
    candidates: [],
  };
}

function surfaceProps(
  surfaceModel: MarkdownDocumentModel,
  comments: readonly ReviewComment[],
  matches: ReadonlyMap<string, AnchorMatch>,
  onSelectComment: (id: string) => void,
  selectedCommentId: string | null = null,
) {
  return {
    model: surfaceModel,
    comments,
    matches,
    selectedCommentId,
    native,
    sessionId: "session",
    onSelection: () => undefined,
    onSelectComment,
    onMessage: () => undefined,
  } satisfies React.ComponentProps<typeof DocumentSurface>;
}

describe("document anchor accessibility", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

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

  it("highlights and activates distinct exact ranges within one mapped span", () => {
    const source = "Done:\n    symlink/reparse and sidecar.";
    const rendered = "Done:\nsymlink/reparse and sidecar.";
    const sourceMap = Array.from({ length: rendered.length + 1 }, (_, index) =>
      index < 6 ? index : index + 4,
    );
    const surfaceModel = modelForSource(source, rendered, sourceMap);
    const blockId = `paragraph:0:${source.length}`;
    const symlink = commentForRange("comment-symlink", source, "symlink");
    const sidecar = commentForRange("comment-sidecar", source, "sidecar");
    const matches = new Map([
      [symlink.id, matchForComment(symlink, blockId)],
      [sidecar.id, matchForComment(sidecar, blockId)],
    ]);
    const onSelectComment = vi.fn();
    const { container, rerender } = render(
      <DocumentSurface
        {...surfaceProps(
          surfaceModel,
          [symlink, sidecar],
          matches,
          onSelectComment,
        )}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLElement>(".rd-anchor")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["symlink", "sidecar"]);
    const sidecarAnchor = screen.getByRole("button", {
      name: "open review comment, exact anchor: sidecar",
    });
    fireEvent.click(sidecarAnchor);
    expect(onSelectComment).toHaveBeenCalledWith(sidecar.id);

    rerender(
      <DocumentSurface
        {...surfaceProps(
          surfaceModel,
          [sidecar],
          new Map([[sidecar.id, matches.get(sidecar.id)!]]),
          onSelectComment,
        )}
      />,
    );
    expect(container.querySelectorAll(".rd-anchor")).toHaveLength(1);
    expect(container.querySelector(".rd-anchor")).toHaveTextContent("sidecar");
    expect(
      screen.queryByRole("button", {
        name: "open review comment, exact anchor: symlink",
      }),
    ).not.toBeInTheDocument();
  });

  it("partitions overlapping comments and cycles activation on their shared text", () => {
    const source = "abcdef";
    const surfaceModel = modelForSource(source);
    const first = commentForRange("comment-first", source, "bcd");
    const second = commentForRange("comment-second", source, "de");
    const blockId = `paragraph:0:${source.length}`;
    const matches = new Map([
      [first.id, matchForComment(first, blockId)],
      [second.id, matchForComment(second, blockId)],
    ]);
    const onSelectComment = vi.fn();
    const { container, rerender } = render(
      <DocumentSurface
        {...surfaceProps(
          surfaceModel,
          [first, second],
          matches,
          onSelectComment,
        )}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLElement>(".rd-anchor")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["bc", "d", "e"]);
    let shared = container.querySelector<HTMLElement>(".rd-anchor-multiple");
    expect(shared).toHaveTextContent("d");
    expect(shared).toHaveAttribute("data-rd-anchor-count", "2");
    fireEvent.click(shared!);
    expect(onSelectComment).toHaveBeenLastCalledWith(first.id);

    rerender(
      <DocumentSurface
        {...surfaceProps(
          surfaceModel,
          [first, second],
          matches,
          onSelectComment,
          first.id,
        )}
      />,
    );
    shared = container.querySelector<HTMLElement>(".rd-anchor-multiple");
    fireEvent.click(shared!);
    expect(onSelectComment).toHaveBeenLastCalledWith(second.id);
    expect(
      [...container.querySelectorAll<HTMLElement>(".rd-anchor-selected")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["bc", "d"]);
  });
});

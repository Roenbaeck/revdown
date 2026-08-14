import { useEffect, useRef } from "react";
import type { AnchorMatch } from "../lib/anchors/match";
import type { MarkdownDocumentModel } from "../lib/markdown/model";
import type { ReviewComment } from "../lib/schema/sidecar";
import type { NativeService } from "../services/native";

type DocumentSurfaceProps = {
  model: MarkdownDocumentModel;
  comments: readonly ReviewComment[];
  matches: ReadonlyMap<string, AnchorMatch>;
  selectedCommentId: string | null;
  native: NativeService;
  sessionId: string;
  onSelection: () => void;
  onSelectComment: (id: string) => void;
  onMessage: (message: string) => void;
};

function overlaps(
  start: number,
  end: number,
  targetStart: number,
  targetEnd: number,
): boolean {
  return start < targetEnd && end > targetStart;
}

type PositionedSourceSpan = {
  element: HTMLElement;
  sourceMap: readonly number[];
  start: number;
  end: number;
  blockId: string | undefined;
};

type SpanDecoration = {
  comment: ReviewComment;
  match: AnchorMatch;
  startOffset: number;
  endOffset: number;
};

type DecoratedFragment = {
  element: HTMLElement;
  decorations: readonly SpanDecoration[];
};

const ANCHOR_CLASSES = [
  "rd-anchor",
  "rd-anchor-exact",
  "rd-anchor-relocated",
  "rd-anchor-ambiguous",
  "rd-anchor-selected",
  "rd-anchor-multiple",
] as const;

function clearAnchorDecoration(element: HTMLElement): void {
  element.classList.remove(...ANCHOR_CLASSES);
  delete element.dataset.rdCommentIds;
  delete element.dataset.rdAnchorCount;
  if (element.dataset.rdAnchorControl === "true") {
    delete element.dataset.rdAnchorControl;
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-label");
  }
}

function sourceMapForElement(element: HTMLElement): number[] | undefined {
  const textLength = element.textContent?.length ?? 0;
  const start = Number(element.dataset.rdSourceStart);
  const end = Number(element.dataset.rdSourceEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;

  const serialized = element.dataset.rdSourceMap;
  const sourceMap = serialized
    ? serialized.split(",").map(Number)
    : Array.from({ length: textLength + 1 }, (_, index) => start + index);
  if (
    sourceMap.length !== textLength + 1 ||
    sourceMap.some((entry) => !Number.isFinite(entry)) ||
    sourceMap.some(
      (entry, index) => index > 0 && entry < (sourceMap[index - 1] ?? entry),
    ) ||
    sourceMap[0] !== start ||
    sourceMap.at(-1) !== end
  ) {
    return undefined;
  }
  return sourceMap;
}

function renderedOffsetsForSourceRange(
  sourceMap: readonly number[],
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const firstBoundary = sourceMap[0];
  const lastBoundary = sourceMap.at(-1);
  if (
    firstBoundary === undefined ||
    lastBoundary === undefined ||
    firstBoundary >= end ||
    lastBoundary <= start
  ) {
    return undefined;
  }

  let low = 0;
  let high = sourceMap.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sourceMap[middle] ?? Number.POSITIVE_INFINITY) <= start)
      low = middle + 1;
    else high = middle;
  }
  const renderedStart = Math.max(0, low - 1);

  low = 0;
  high = sourceMap.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sourceMap[middle] ?? Number.POSITIVE_INFINITY) < end) low = middle + 1;
    else high = middle;
  }
  const renderedEnd = Math.min(sourceMap.length - 1, low);
  return renderedEnd > renderedStart
    ? { start: renderedStart, end: renderedEnd }
    : undefined;
}

function writeSourceMap(
  element: HTMLElement,
  sourceMap: readonly number[],
): void {
  const start = sourceMap[0];
  const end = sourceMap.at(-1);
  if (start === undefined || end === undefined) return;
  element.dataset.rdSourceStart = String(start);
  element.dataset.rdSourceEnd = String(end);
  const direct = sourceMap.every((entry, index) => entry === start + index);
  if (direct) delete element.dataset.rdSourceMap;
  else element.dataset.rdSourceMap = sourceMap.join(",");
}

function splitSourceSpan(
  span: PositionedSourceSpan,
  decorations: readonly SpanDecoration[],
): DecoratedFragment[] {
  const text = span.element.textContent ?? "";
  const boundaries = [
    ...new Set([
      0,
      text.length,
      ...decorations.flatMap((decoration) => [
        decoration.startOffset,
        decoration.endOffset,
      ]),
    ]),
  ].sort((left, right) => left - right);

  if (boundaries.length === 2) {
    return [{ element: span.element, decorations }];
  }

  const fragments: DecoratedFragment[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const startOffset = boundaries[index - 1];
    const endOffset = boundaries[index];
    if (startOffset === undefined || endOffset === undefined) continue;
    if (endOffset <= startOffset) continue;
    const clone = span.element.cloneNode(false);
    if (!(clone instanceof HTMLElement)) continue;
    clone.textContent = text.slice(startOffset, endOffset);
    writeSourceMap(clone, span.sourceMap.slice(startOffset, endOffset + 1));
    fragments.push({
      element: clone,
      decorations: decorations.filter((decoration) =>
        overlaps(
          startOffset,
          endOffset,
          decoration.startOffset,
          decoration.endOffset,
        ),
      ),
    });
  }
  span.element.replaceWith(...fragments.map((fragment) => fragment.element));
  return fragments;
}

function activateCommentId(
  element: HTMLElement,
  selectedCommentId: string | null,
): string | undefined {
  const ids = element.dataset.rdCommentIds?.split(",").filter(Boolean) ?? [];
  if (ids.length < 2 || !selectedCommentId) return ids[0];
  const selectedIndex = ids.indexOf(selectedCommentId);
  return selectedIndex >= 0 ? ids[(selectedIndex + 1) % ids.length] : ids[0];
}

export function DocumentSurface(props: DocumentSurfaceProps) {
  const surfaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const spans = [
      ...surface.querySelectorAll<HTMLElement>("[data-rd-source-start]"),
    ];
    for (const span of spans) clearAnchorDecoration(span);
    const positionedSpans: PositionedSourceSpan[] = spans
      .flatMap((element) => {
        const sourceMap = sourceMapForElement(element);
        const start = sourceMap?.[0];
        const end = sourceMap?.at(-1);
        if (sourceMap === undefined || start === undefined || end === undefined)
          return [];
        return [
          {
            element,
            sourceMap,
            start,
            end,
            blockId:
              element.closest<HTMLElement>("[data-rd-block-id]")?.dataset
                .rdBlockId,
          },
        ];
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const decorationsBySpan = new Map<HTMLElement, SpanDecoration[]>();
    for (const comment of props.comments) {
      const match = props.matches.get(comment.id);
      const candidate = match?.candidate;
      if (!match || !candidate) continue;
      let low = 0;
      let high = positionedSpans.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (
          (positionedSpans[middle]?.start ?? Number.POSITIVE_INFINITY) <
          candidate.sourceRange.start
        )
          low = middle + 1;
        else high = middle;
      }
      for (
        let index = Math.max(0, low - 1);
        index < positionedSpans.length;
        index += 1
      ) {
        const span = positionedSpans[index];
        if (!span || span.start >= candidate.sourceRange.end) break;
        if (span.blockId !== candidate.blockId) continue;
        if (
          !overlaps(
            span.start,
            span.end,
            candidate.sourceRange.start,
            candidate.sourceRange.end,
          )
        )
          continue;
        const offsets = renderedOffsetsForSourceRange(
          span.sourceMap,
          candidate.sourceRange.start,
          candidate.sourceRange.end,
        );
        if (!offsets) continue;
        const decorations = decorationsBySpan.get(span.element) ?? [];
        decorations.push({
          comment,
          match,
          startOffset: offsets.start,
          endOffset: offsets.end,
        });
        decorationsBySpan.set(span.element, decorations);
      }
    }

    const accessibleAnchors = new Map<HTMLElement, SpanDecoration[]>();
    const commentsWithControls = new Set<string>();
    for (const span of positionedSpans) {
      const decorations = decorationsBySpan.get(span.element);
      if (!decorations) continue;
      for (const fragment of splitSourceSpan(span, decorations)) {
        if (fragment.decorations.length === 0) continue;
        const ids = [
          ...new Set(
            fragment.decorations.map((decoration) => decoration.comment.id),
          ),
        ];
        fragment.element.classList.add("rd-anchor");
        for (const decoration of fragment.decorations) {
          fragment.element.classList.add(`rd-anchor-${decoration.match.state}`);
        }
        if (ids.includes(props.selectedCommentId ?? "")) {
          fragment.element.classList.add("rd-anchor-selected");
        }
        if (ids.length > 1) {
          fragment.element.classList.add("rd-anchor-multiple");
          fragment.element.dataset.rdAnchorCount = String(ids.length);
        }
        fragment.element.dataset.rdCommentIds = ids.join(",");
        if (ids.some((id) => !commentsWithControls.has(id))) {
          accessibleAnchors.set(fragment.element, [...fragment.decorations]);
          ids.forEach((id) => commentsWithControls.add(id));
        }
      }
    }
    for (const [element, entries] of accessibleAnchors) {
      element.dataset.rdAnchorControl = "true";
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.setAttribute(
        "aria-label",
        entries
          .map(
            ({ comment, match }) =>
              `${comment.status} review comment, ${match.state} anchor: ${comment.anchor.textQuote.exact}`,
          )
          .join("; "),
      );
    }
  }, [
    props.comments,
    props.matches,
    props.selectedCommentId,
    props.model.html,
  ]);

  useEffect(() => {
    if (!props.selectedCommentId) return;
    const selected = surfaceRef.current?.querySelector<HTMLElement>(
      `[data-rd-comment-ids~="${CSS.escape(props.selectedCommentId)}"], [data-rd-comment-ids*="${CSS.escape(props.selectedCommentId)}"]`,
    );
    selected?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [props.selectedCommentId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let active = true;
    for (const image of surface.querySelectorAll<HTMLImageElement>(
      'img[data-rd-image-state="local-pending"]',
    )) {
      const source = image.dataset.rdImageSrc;
      if (!source) continue;
      let localPath: string;
      try {
        localPath = decodeURIComponent(source.split(/[?#]/u, 1)[0] ?? source);
      } catch {
        image.dataset.rdImageState = "blocked";
        continue;
      }
      void props.native
        .readLocalImage(props.sessionId, localPath)
        .then((dataUrl) => {
          if (!active) return;
          if (dataUrl) {
            image.src = dataUrl;
            image.dataset.rdImageState = "loaded";
          } else {
            image.dataset.rdImageState = "unsupported";
          }
        })
        .catch(() => {
          image.dataset.rdImageState = "blocked";
        });
    }
    return () => {
      active = false;
    };
  }, [props.model.html, props.native, props.sessionId]);

  return (
    <article
      ref={surfaceRef}
      id="document-surface"
      className="documentSurface markdownBody"
      aria-label="Rendered Markdown document"
      tabIndex={0}
      onMouseUp={props.onSelection}
      onKeyUp={(event) => {
        if (event.key === "Shift" || event.key.startsWith("Arrow"))
          props.onSelection();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const anchor = (event.target as Element).closest<HTMLElement>(
          '[data-rd-anchor-control="true"]',
        );
        const id = anchor
          ? activateCommentId(anchor, props.selectedCommentId)
          : undefined;
        if (id) {
          event.preventDefault();
          props.onSelectComment(id);
        }
      }}
      onClick={(event) => {
        const target = event.target as Element;
        const link = target.closest<HTMLElement>("a[data-rd-href]");
        if (link?.dataset.rdHref) {
          event.preventDefault();
          void props.native.openExternal(link.dataset.rdHref).catch(() => {
            props.onMessage("Revdown blocked or could not open that link.");
          });
          return;
        }
        const anchor = target.closest<HTMLElement>("[data-rd-comment-ids]");
        const id = anchor
          ? activateCommentId(anchor, props.selectedCommentId)
          : undefined;
        if (id) props.onSelectComment(id);
      }}
      // The HTML comes only from the sanitized, raw-HTML-disabled Markdown pipeline.
      dangerouslySetInnerHTML={{ __html: props.model.html }}
    />
  );
}

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

export function DocumentSurface(props: DocumentSurfaceProps) {
  const surfaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const spans = [
      ...surface.querySelectorAll<HTMLElement>("[data-rd-source-start]"),
    ];
    const positionedSpans = spans
      .map((element) => ({
        element,
        start: Number(element.dataset.rdSourceStart),
        end: Number(element.dataset.rdSourceEnd),
      }))
      .filter(
        (span) => Number.isFinite(span.start) && Number.isFinite(span.end),
      )
      .sort((a, b) => a.start - b.start || a.end - b.end);
    for (const span of spans) {
      span.classList.remove(
        "rd-anchor",
        "rd-anchor-exact",
        "rd-anchor-relocated",
        "rd-anchor-ambiguous",
        "rd-anchor-selected",
      );
      delete span.dataset.rdCommentIds;
      if (span.dataset.rdAnchorControl === "true") {
        delete span.dataset.rdAnchorControl;
        span.removeAttribute("role");
        span.removeAttribute("tabindex");
        span.removeAttribute("aria-label");
      }
    }
    const accessibleAnchors = new Map<
      HTMLElement,
      { comment: ReviewComment; match: AnchorMatch }[]
    >();
    for (const comment of props.comments) {
      const match = props.matches.get(comment.id);
      const candidate = match?.candidate;
      if (!match || !candidate) continue;
      let firstMatchedSpan: HTMLElement | undefined;
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
        if (
          !overlaps(
            span.start,
            span.end,
            candidate.sourceRange.start,
            candidate.sourceRange.end,
          )
        )
          continue;
        firstMatchedSpan ??= span.element;
        span.element.classList.add("rd-anchor", `rd-anchor-${match.state}`);
        const ids =
          span.element.dataset.rdCommentIds?.split(",").filter(Boolean) ?? [];
        span.element.dataset.rdCommentIds = [
          ...new Set([...ids, comment.id]),
        ].join(",");
        if (comment.id === props.selectedCommentId)
          span.element.classList.add("rd-anchor-selected");
      }
      if (firstMatchedSpan) {
        const entries = accessibleAnchors.get(firstMatchedSpan) ?? [];
        entries.push({ comment, match });
        accessibleAnchors.set(firstMatchedSpan, entries);
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
        const id = anchor?.dataset.rdCommentIds?.split(",")[0];
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
        const id = anchor?.dataset.rdCommentIds?.split(",")[0];
        if (id) props.onSelectComment(id);
      }}
      // The HTML comes only from the sanitized, raw-HTML-disabled Markdown pipeline.
      dangerouslySetInnerHTML={{ __html: props.model.html }}
    />
  );
}

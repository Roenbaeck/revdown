import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { AnchorMatch } from "../lib/anchors/match";
import type { MarkdownDocumentModel } from "../lib/markdown/model";
import type { ReviewComment } from "../lib/schema/sidecar";
import type { ResolvedTheme } from "../lib/settings/reader";

type DocumentMinimapProps = {
  model: MarkdownDocumentModel;
  comments: readonly ReviewComment[];
  matches: ReadonlyMap<string, AnchorMatch>;
  selectedCommentId: string | null;
  theme: ResolvedTheme;
  scrollContainerRef: RefObject<HTMLElement>;
  onClose: () => void;
};

type Viewport = { top: number; height: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function DocumentMinimap(props: DocumentMinimapProps) {
  const trackRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 1 });
  const markers = useMemo(
    () =>
      props.comments.flatMap((comment) => {
        const candidate = props.matches.get(comment.id)?.candidate;
        return candidate
          ? [
              {
                id: comment.id,
                status: comment.status,
                start: candidate.sourceRange.start,
              },
            ]
          : [];
      }),
    [props.comments, props.matches],
  );

  useEffect(() => {
    const container = props.scrollContainerRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const total = Math.max(container.scrollHeight, 1);
      setViewport({
        top: clamp(container.scrollTop / total, 0, 1),
        height: clamp(container.clientHeight / total, 0.025, 1),
      });
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(container);
    const surface = container.querySelector("#document-surface");
    if (surface) resizeObserver.observe(surface);
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    update();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener("scroll", scheduleUpdate);
    };
  }, [props.scrollContainerRef]);

  useEffect(() => {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!track || !canvas) return;
    const draw = () => {
      const { width, height } = track.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const dark = props.theme === "dark";
      const sepia = props.theme === "sepia";
      context.fillStyle = dark ? "#202a28" : sepia ? "#fbf3df" : "#f6f3eb";
      context.fillRect(0, 0, width, height);
      const sourceLength = Math.max(props.model.source.length, 1);
      for (const block of props.model.blocks.values()) {
        const y = (block.start / sourceLength) * height;
        const blockHeight = clamp(
          ((block.end - block.start) / sourceLength) * height,
          0.65,
          block.kind === "code" ? 4 : 2,
        );
        const inset =
          block.kind === "heading"
            ? 5 + ((block.headingLevel ?? 1) - 1) * 3
            : block.kind === "code"
              ? 12
              : 9;
        const contentWidth = clamp(
          block.renderedText.length * 0.42,
          width * 0.2,
          width - inset - 5,
        );
        context.fillStyle =
          block.kind === "heading"
            ? dark
              ? "rgba(210, 226, 226, 0.72)"
              : "rgba(23, 59, 76, 0.72)"
            : block.kind === "code"
              ? dark
                ? "rgba(104, 169, 195, 0.48)"
                : "rgba(50, 114, 147, 0.44)"
              : dark
                ? "rgba(198, 207, 201, 0.34)"
                : "rgba(84, 91, 83, 0.28)";
        context.fillRect(inset, y, contentWidth, blockHeight);
      }
      for (const marker of markers) {
        const y = (marker.start / sourceLength) * height;
        const selected = marker.id === props.selectedCommentId;
        context.fillStyle =
          marker.status === "resolved" ? "#327293" : "#c48e0a";
        context.fillRect(
          selected ? 0 : 3,
          y - 1,
          width - (selected ? 0 : 6),
          3,
        );
        if (selected) {
          context.strokeStyle = "#173b4c";
          context.strokeRect(0.5, y - 2.5, width - 1, 6);
        }
      }
    };
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(track);
    draw();
    return () => resizeObserver.disconnect();
  }, [markers, props.model, props.selectedCommentId, props.theme]);

  const navigateToPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const container = props.scrollContainerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;
    const bounds = track.getBoundingClientRect();
    const fraction = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    const maximum = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    container.scrollTo({ top: fraction * maximum });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const container = props.scrollContainerRef.current;
    if (!container) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      container.scrollTo({
        top: event.key === "Home" ? 0 : container.scrollHeight,
        behavior: "smooth",
      });
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      container.scrollBy({
        top: (event.key === "ArrowUp" ? -1 : 1) * container.clientHeight * 0.8,
        behavior: "smooth",
      });
    }
  };

  return (
    <aside className="minimapPanel" aria-label="Document minimap panel">
      <div className="minimapHeading">
        <span>Map</span>
        <button type="button" onClick={props.onClose} aria-label="Hide minimap">
          ›
        </button>
      </div>
      <button
        ref={trackRef}
        className="minimapTrack"
        type="button"
        aria-label={`Document minimap with ${markers.length} comment ${markers.length === 1 ? "marker" : "markers"}`}
        title="Click or drag to navigate"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          navigateToPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            navigateToPointer(event);
        }}
        onKeyDown={handleKeyDown}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        <span
          className="minimapViewport"
          aria-hidden="true"
          style={{
            top: `${viewport.top * 100}%`,
            height: `${viewport.height * 100}%`,
          }}
        />
      </button>
      <div className="minimapLegend" aria-hidden="true">
        <span className="openMarker" />
        <span>Open</span>
        <span className="resolvedMarker" />
        <span>Done</span>
      </div>
    </aside>
  );
}

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { MarkdownDocumentModel } from "../lib/markdown/model";

type DocumentOutlineProps = {
  model: MarkdownDocumentModel;
  scrollContainerRef: RefObject<HTMLElement>;
  onClose: () => void;
};

export function DocumentOutline(props: DocumentOutlineProps) {
  const headings = useMemo(
    () =>
      [...props.model.blocks.values()]
        .filter((block) => block.kind === "heading")
        .sort((a, b) => a.start - b.start),
    [props.model],
  );
  const [activeId, setActiveId] = useState(headings[0]?.id ?? null);

  useEffect(() => {
    const container = props.scrollContainerRef.current;
    if (!container || headings.length === 0) return;
    let frame = 0;
    let positions: { id: string; top: number }[] = [];

    const measure = () => {
      const containerTop = container.getBoundingClientRect().top;
      positions = headings.flatMap((heading) => {
        const target = container.querySelector<HTMLElement>(
          `[data-rd-block-id="${CSS.escape(heading.id)}"]`,
        );
        return target
          ? [
              {
                id: heading.id,
                top:
                  target.getBoundingClientRect().top -
                  containerTop +
                  container.scrollTop,
              },
            ]
          : [];
      });
    };
    const update = () => {
      frame = 0;
      const threshold = container.scrollTop + 96;
      let low = 0;
      let high = positions.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((positions[middle]?.top ?? Number.POSITIVE_INFINITY) <= threshold)
          low = middle + 1;
        else high = middle;
      }
      setActiveId(
        positions[Math.max(0, low - 1)]?.id ?? headings[0]?.id ?? null,
      );
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(() => {
      measure();
      scheduleUpdate();
    });
    measure();
    update();
    resizeObserver.observe(container);
    const surface = container.querySelector("#document-surface");
    if (surface) resizeObserver.observe(surface);
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener("scroll", scheduleUpdate);
    };
  }, [headings, props.scrollContainerRef]);

  const navigate = (id: string) => {
    const target = props.scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-rd-block-id="${CSS.escape(id)}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (target) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    setActiveId(id);
  };

  return (
    <aside className="outlinePanel" aria-label="Document outline">
      <div className="navigationPanelHeading">
        <div>
          <span className="eyebrow">Navigate</span>
          <h2>Outline</h2>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Hide outline">
          ‹
        </button>
      </div>
      {headings.length === 0 ? (
        <p className="navigationEmpty">This document has no headings.</p>
      ) : (
        <nav className="outlineList" aria-label="Markdown headings">
          {headings.map((heading) => (
            <button
              type="button"
              key={heading.id}
              className={heading.id === activeId ? "outlineItemActive" : ""}
              aria-current={heading.id === activeId ? "location" : undefined}
              title={heading.renderedText}
              style={{
                paddingInlineStart: `${0.65 + ((heading.headingLevel ?? 1) - 1) * 0.65}rem`,
              }}
              onClick={() => navigate(heading.id)}
            >
              {heading.renderedText || "Untitled heading"}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}

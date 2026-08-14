import { useEffect, useRef, useState } from "react";
import { renderCommentMarkdown } from "../lib/markdown/comment";

export function CommentBody({
  body,
  onOpenExternal,
}: {
  body: string;
  onOpenExternal: (url: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof window.IntersectionObserver === "undefined",
  );
  const [rendered, setRendered] = useState<{
    body: string;
    html: string;
  } | null>(null);

  useEffect(() => {
    if (visible || typeof window.IntersectionObserver === "undefined") return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void renderCommentMarkdown(body).then((html) => {
      if (active) {
        setRendered({ body, html });
      }
    });
    return () => {
      active = false;
    };
  }, [body, visible]);
  const html = rendered?.body === body ? rendered.html : null;
  return (
    <div
      ref={containerRef}
      className="commentMarkdown markdownBody"
      onClick={(event) => {
        const link = (event.target as Element).closest<HTMLElement>(
          "a[data-rd-href]",
        );
        if (link?.dataset.rdHref) {
          event.preventDefault();
          onOpenExternal(link.dataset.rdHref);
        }
      }}
      {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}
    >
      {html ? null : <p>{body}</p>}
    </div>
  );
}

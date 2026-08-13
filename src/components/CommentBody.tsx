import { useEffect, useState } from "react";
import { fingerprintText } from "../lib/fingerprints";
import { parseMarkdownDocument } from "../lib/markdown/model";

export function CommentBody({
  body,
  onOpenExternal,
}: {
  body: string;
  onOpenExternal: (url: string) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fingerprintText(body)
      .then((fingerprint) => parseMarkdownDocument(body, fingerprint))
      .then((model) => {
        if (active) setHtml(model.html);
      });
    return () => {
      active = false;
    };
  }, [body]);
  if (html === null) return <p>{body}</p>;
  return (
    <div
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

import type { Root as HastRoot } from "hast";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { normalizeTexDisplayMathForParsing } from "./texMath";

const MAX_CACHED_COMMENTS = 256;
const cache = new Map<string, Promise<string>>();

function secureLinksAndImages(root: HastRoot): void {
  visit(root, "element", (element) => {
    if (element.tagName === "a") {
      const href = element.properties.href;
      if (typeof href === "string" && !href.startsWith("#")) {
        element.properties["data-rd-href"] = href;
        element.properties.href = "#";
        element.properties.rel = ["noopener", "noreferrer"];
      }
    }
    if (element.tagName === "img") {
      element.properties.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
      element.properties["data-rd-image-state"] = "blocked";
    }
  });
}

async function render(body: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeSanitize);
  const initialMdast = processor.parse(body);
  const parsingBody = normalizeTexDisplayMathForParsing(body, initialMdast);
  const mdast =
    parsingBody === body ? initialMdast : processor.parse(parsingBody);
  const safeHast = await processor.run(mdast);
  const withMath = (await unified().use(rehypeKatex).run(safeHast)) as HastRoot;
  secureLinksAndImages(withMath);
  return String(unified().use(rehypeStringify).stringify(withMath));
}

export function renderCommentMarkdown(body: string): Promise<string> {
  const cached = cache.get(body);
  if (cached) return cached;
  const rendered = render(body);
  cache.set(body, rendered);
  if (cache.size > MAX_CACHED_COMMENTS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  return rendered;
}

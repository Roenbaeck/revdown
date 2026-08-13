import type { Element, ElementContent, Root as HastRoot } from "hast";
import type {
  Code,
  InlineCode,
  Nodes as MdastNode,
  Root as MdastRoot,
} from "mdast";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { DocumentFingerprint } from "../fingerprints";
import { sha256Hex, encodeUtf8 } from "../fingerprints";
import { highlightCode, type HighlightToken } from "./highlight";

export type SupportedBlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "tableCell"
  | "math";

export type SourceBlock = {
  id: string;
  kind: SupportedBlockKind;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
  sourceSha256: string;
  renderedText: string;
  headingLevel?: number;
  codeLanguage?: string;
  codeMap?: number[];
};

export type MarkdownDocumentModel = {
  source: string;
  fingerprint: DocumentFingerprint;
  html: string;
  blocks: ReadonlyMap<string, SourceBlock>;
};

type Positioned = {
  type: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
};

type InlineRecord = {
  kind: "emphasis" | "strong" | "delete" | "link" | "inlineCode" | "inlineMath";
  start: number;
  end: number;
};

type PendingBlock = Omit<SourceBlock, "sourceSha256">;

function offsets(node: Positioned): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

function plainText(node: MdastNode): string {
  if (
    node.type === "text" ||
    node.type === "inlineCode" ||
    node.type === "inlineMath"
  ) {
    return node.value;
  }
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "";
  if ("children" in node)
    return node.children.map((child) => plainText(child)).join("");
  if ("value" in node && typeof node.value === "string") return node.value;
  return "";
}

function blockKind(node: MdastNode): SupportedBlockKind | undefined {
  if (node.type === "paragraph") return "paragraph";
  if (node.type === "heading") return "heading";
  if (node.type === "code") return "code";
  if (node.type === "tableCell") return "tableCell";
  if (node.type === "math") return "math";
  return undefined;
}

function inlineKind(node: MdastNode): InlineRecord["kind"] | undefined {
  if (
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "delete" ||
    node.type === "link" ||
    node.type === "inlineCode" ||
    node.type === "inlineMath"
  ) {
    return node.type;
  }
  return undefined;
}

function collectSourceRecords(
  source: string,
  root: MdastRoot,
): {
  blocks: PendingBlock[];
  inlines: InlineRecord[];
} {
  const blocks: PendingBlock[] = [];
  const inlines: InlineRecord[] = [];
  const headingPath: string[] = [];

  visit(root, (node) => {
    const typedNode = node;
    if (typedNode.type === "heading") {
      headingPath.length = typedNode.depth - 1;
      headingPath[typedNode.depth - 1] = plainText(typedNode);
    }

    const range = offsets(typedNode as Positioned);
    const kind = blockKind(typedNode);
    if (kind && range) {
      const id = `${kind}:${range.start}:${range.end}`;
      const code = typedNode.type === "code" ? typedNode : undefined;
      const codeMap = code
        ? buildCodeBoundaryMap(source, code, range.start, range.end)
        : undefined;
      blocks.push({
        id,
        kind,
        start: range.start,
        end: range.end,
        lineStart: typedNode.position?.start.line ?? 1,
        lineEnd: typedNode.position?.end.line ?? 1,
        headingPath: [...headingPath],
        renderedText: plainText(typedNode),
        ...(typedNode.type === "heading"
          ? { headingLevel: typedNode.depth }
          : {}),
        ...(code?.lang ? { codeLanguage: code.lang } : {}),
        ...(codeMap ? { codeMap } : {}),
      });
    }

    const nestedKind = inlineKind(typedNode);
    if (nestedKind && range) inlines.push({ kind: nestedKind, ...range });
  });

  return { blocks, inlines };
}

function decodeEntity(entity: string): string | undefined {
  if (/^&#x[0-9a-f]+;$/iu.test(entity)) {
    return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
  }
  if (/^&#\d+;$/u.test(entity)) {
    return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
  }
  const named: Readonly<Record<string, string>> = {
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": "\u00a0",
    "&quot;": '"',
  };
  return named[entity];
}

export function buildBoundaryMap(
  raw: string,
  visible: string,
  absoluteStart: number,
): number[] | undefined {
  if (raw === visible) {
    return Array.from(
      { length: visible.length + 1 },
      (_, index) => absoluteStart + index,
    );
  }

  let decoded = "";
  const boundaries = [absoluteStart];
  let index = 0;
  while (index < raw.length) {
    const current = raw[index];
    if (
      current === "\\" &&
      index + 1 < raw.length &&
      /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/u.test(raw[index + 1] ?? "")
    ) {
      decoded += raw[index + 1];
      boundaries[boundaries.length - 1] = absoluteStart + index;
      boundaries.push(absoluteStart + index + 2);
      index += 2;
      continue;
    }
    if (current === "&") {
      const candidate = /^&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/iu.exec(
        raw.slice(index),
      )?.[0];
      const entityValue = candidate ? decodeEntity(candidate) : undefined;
      if (candidate && entityValue) {
        decoded += entityValue;
        for (let unit = 0; unit < entityValue.length; unit += 1) {
          if (unit === 0)
            boundaries[boundaries.length - 1] = absoluteStart + index;
          boundaries.push(absoluteStart + index + candidate.length);
        }
        index += candidate.length;
        continue;
      }
    }
    if (current === "\r") {
      const width = raw[index + 1] === "\n" ? 2 : 1;
      decoded += "\n";
      boundaries[boundaries.length - 1] = absoluteStart + index;
      boundaries.push(absoluteStart + index + width);
      index += width;
      continue;
    }
    decoded += current;
    boundaries.push(absoluteStart + index + 1);
    index += 1;
  }
  if (decoded === visible && boundaries.length === visible.length + 1)
    return boundaries;

  const exactIndex = raw.indexOf(visible);
  if (exactIndex >= 0 && exactIndex === raw.lastIndexOf(visible)) {
    return Array.from(
      { length: visible.length + 1 },
      (_, visibleIndex) => absoluteStart + exactIndex + visibleIndex,
    );
  }
  return undefined;
}

function buildCodeBoundaryMap(
  source: string,
  node: Code,
  start: number,
  end: number,
): number[] | undefined {
  const raw = source.slice(start, end);
  const fence = /^\s*(`{3,}|~{3,})[^\r\n]*(?:\r\n|\r|\n)/u.exec(raw)?.[0];
  if (fence) {
    const contentStart = start + fence.length;
    const closingLine = /(?:\r\n|\r|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*$/u.exec(raw);
    const contentEnd =
      closingLine?.index === undefined ? end : start + closingLine.index;
    return buildBoundaryMap(
      source.slice(contentStart, contentEnd),
      node.value,
      contentStart,
    );
  }
  return buildBoundaryMap(raw, node.value, start);
}

function classNames(element: Element): string[] {
  const value = element.properties.className;
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? value.split(/\s+/u) : [];
}

type PositionedElement = {
  element: Element;
  start: number;
  end: number;
};

type ElementIndex = {
  byPosition: ReadonlyMap<string, readonly Element[]>;
  listItems: readonly PositionedElement[];
};

function positionKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function indexElements(root: HastRoot): ElementIndex {
  const byPosition = new Map<string, Element[]>();
  const listItems: PositionedElement[] = [];
  visit(root, "element", (element) => {
    const range = offsets(element as Positioned);
    if (!range) return;
    const key = positionKey(range.start, range.end);
    const candidates = byPosition.get(key);
    if (candidates) candidates.push(element);
    else byPosition.set(key, [element]);
    if (element.tagName === "li") listItems.push({ element, ...range });
  });
  return { byPosition, listItems };
}

function findIndexedElement(
  index: ElementIndex,
  start: number,
  end: number,
  predicate: (element: Element) => boolean,
): Element | undefined {
  return index.byPosition.get(positionKey(start, end))?.find(predicate);
}

function lowerBoundByStart(blocks: readonly PendingBlock[], start: number) {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((blocks[middle]?.start ?? Number.POSITIVE_INFINITY) < start)
      low = middle + 1;
    else high = middle;
  }
  return low;
}

function indexTightListParagraphs(
  blocks: readonly PendingBlock[],
  listItems: readonly PositionedElement[],
): ReadonlyMap<string, Element> {
  const paragraphs = blocks
    .filter((block) => block.kind === "paragraph")
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const matches = new Map<string, { element: Element; width: number }>();
  for (const listItem of listItems) {
    const width = listItem.end - listItem.start;
    for (
      let index = lowerBoundByStart(paragraphs, listItem.start);
      index < paragraphs.length;
      index += 1
    ) {
      const paragraph = paragraphs[index];
      if (!paragraph || paragraph.start > listItem.end) break;
      if (paragraph.end > listItem.end) continue;
      const previous = matches.get(paragraph.id);
      if (!previous || width < previous.width) {
        matches.set(paragraph.id, { element: listItem.element, width });
      }
    }
  }
  return new Map(
    [...matches].map(([blockId, match]) => [blockId, match.element]),
  );
}

function restoreSourceMetadata(
  root: HastRoot,
  blocks: PendingBlock[],
  inlines: InlineRecord[],
): void {
  const index = indexElements(root);
  const tightListParagraphs = indexTightListParagraphs(blocks, index.listItems);
  for (const block of blocks) {
    let element = findIndexedElement(
      index,
      block.start,
      block.end,
      (candidate) => {
        if (block.kind === "code") return candidate.tagName === "code";
        if (block.kind === "math") {
          const classes = classNames(candidate);
          return (
            (candidate.tagName === "code" &&
              (classes.includes("math-display") ||
                classes.includes("language-math"))) ||
            classes.includes("katex-display")
          );
        }
        if (block.kind === "tableCell")
          return candidate.tagName === "td" || candidate.tagName === "th";
        return true;
      },
    );
    // Tight Markdown lists flatten their paragraph wrapper into the `li`.
    // Use the smallest enclosing list item while retaining paragraph offsets.
    if (!element && block.kind === "paragraph") {
      element = tightListParagraphs.get(block.id);
    }
    if (element) {
      element.properties["data-rd-block-id"] = block.id;
      element.properties["data-rd-block-kind"] = block.kind;
      element.properties["data-rd-block-start"] = String(block.start);
      element.properties["data-rd-block-end"] = String(block.end);
    }
  }

  for (const inline of inlines) {
    const element = findIndexedElement(
      index,
      inline.start,
      inline.end,
      (candidate) => {
        if (inline.kind === "emphasis") return candidate.tagName === "em";
        if (inline.kind === "strong") return candidate.tagName === "strong";
        if (inline.kind === "delete") return candidate.tagName === "del";
        if (inline.kind === "link") return candidate.tagName === "a";
        if (inline.kind === "inlineCode") return candidate.tagName === "code";
        const classes = classNames(candidate);
        return (
          (candidate.tagName === "code" &&
            (classes.includes("math-inline") ||
              classes.includes("language-math"))) ||
          classes.includes("katex")
        );
      },
    );
    if (!element) continue;
    element.properties["data-rd-inline-start"] = String(inline.start);
    element.properties["data-rd-inline-end"] = String(inline.end);
    element.properties["data-rd-inline-kind"] = inline.kind;
    if (inline.kind === "inlineMath") {
      element.properties["data-rd-math-start"] = String(inline.start);
      element.properties["data-rd-math-end"] = String(inline.end);
    }
  }
}

function restoreRenderedMathMetadata(
  root: HastRoot,
  blocks: PendingBlock[],
  inlines: InlineRecord[],
): void {
  const inlineElements: Element[] = [];
  const displayElements: Element[] = [];

  function collect(parent: HastRoot | Element, insideDisplay = false): void {
    for (const child of parent.children) {
      if (child.type !== "element") continue;
      const classes = classNames(child);
      const isDisplay = classes.includes("katex-display");
      if (isDisplay) displayElements.push(child);
      if (!insideDisplay && !isDisplay && classes.includes("katex")) {
        inlineElements.push(child);
      }
      collect(child, insideDisplay || isDisplay);
    }
  }
  collect(root);

  const inlineMath = inlines
    .filter((record) => record.kind === "inlineMath")
    .sort((a, b) => a.start - b.start);
  inlineMath.forEach((record, index) => {
    const element = inlineElements[index];
    if (!element) return;
    element.properties["data-rd-inline-start"] = String(record.start);
    element.properties["data-rd-inline-end"] = String(record.end);
    element.properties["data-rd-inline-kind"] = record.kind;
    element.properties["data-rd-math-start"] = String(record.start);
    element.properties["data-rd-math-end"] = String(record.end);
  });

  const displayMath = blocks
    .filter((block) => block.kind === "math")
    .sort((a, b) => a.start - b.start);
  displayMath.forEach((block, index) => {
    const element = displayElements[index];
    if (!element) return;
    element.properties["data-rd-block-id"] = block.id;
    element.properties["data-rd-block-kind"] = block.kind;
    element.properties["data-rd-block-start"] = String(block.start);
    element.properties["data-rd-block-end"] = String(block.end);
    element.properties["data-rd-math-start"] = String(block.start);
    element.properties["data-rd-math-end"] = String(block.end);
  });
}

function mappedSpan(
  value: string,
  boundaries: number[] | undefined,
  style?: string,
): Element {
  const properties: Element["properties"] = {
    className: ["rd-source-text"],
    ...(style ? { style } : {}),
  };
  if (boundaries) {
    properties["data-rd-source-start"] = String(boundaries[0]);
    properties["data-rd-source-end"] = String(boundaries.at(-1));
    const isDirect = boundaries.every(
      (entry, index) => entry === (boundaries[0] ?? 0) + index,
    );
    if (!isDirect) properties["data-rd-source-map"] = boundaries.join(",");
  } else {
    properties["data-rd-source-unmappable"] = "true";
  }
  return {
    type: "element",
    tagName: "span",
    properties,
    children: [{ type: "text", value }],
  };
}

function codeTokenStyle(token: HighlightToken): string | undefined {
  const declarations: string[] = [];
  if (token.color && /^#[0-9a-f]{3,8}$/iu.test(token.color))
    declarations.push(`color:${token.color}`);
  if (token.fontStyle !== undefined) {
    if ((token.fontStyle & 1) !== 0) declarations.push("font-style:italic");
    if ((token.fontStyle & 2) !== 0) declarations.push("font-weight:700");
    if ((token.fontStyle & 4) !== 0)
      declarations.push("text-decoration:underline");
  }
  return declarations.length > 0 ? declarations.join(";") : undefined;
}

async function renderHighlightedCode(
  root: HastRoot,
  blocks: PendingBlock[],
): Promise<void> {
  const elementsByBlockId = new Map<string, Element>();
  visit(root, "element", (element) => {
    const blockId = element.properties["data-rd-block-id"];
    if (typeof blockId === "string") elementsByBlockId.set(blockId, element);
  });
  const codeBlocks = blocks.filter((block) => block.kind === "code");
  await Promise.all(
    codeBlocks.map(async (block) => {
      const element = elementsByBlockId.get(block.id);
      if (!element) return;
      const lines = await highlightCode(block.renderedText, block.codeLanguage);
      const children: ElementContent[] = [];
      let visibleOffset = 0;
      lines.forEach((line, lineIndex) => {
        for (const token of line) {
          const end = visibleOffset + token.content.length;
          const boundarySlice = block.codeMap?.slice(visibleOffset, end + 1);
          children.push(
            mappedSpan(token.content, boundarySlice, codeTokenStyle(token)),
          );
          visibleOffset = end;
        }
        if (lineIndex < lines.length - 1) {
          const boundarySlice = block.codeMap?.slice(
            visibleOffset,
            visibleOffset + 2,
          );
          children.push(mappedSpan("\n", boundarySlice));
          visibleOffset += 1;
        }
      });
      element.children = children;
      element.properties.className = [
        ...classNames(element),
        "rd-highlighted-code",
      ];
    }),
  );
}

function decorateTextNodes(root: HastRoot, source: string): void {
  function recurse(
    parent: HastRoot | Element,
    inheritedInline?: { start: number; end: number },
  ): void {
    const parentClasses = parent.type === "element" ? classNames(parent) : [];
    if (
      parentClasses.includes("katex") ||
      parentClasses.includes("rd-highlighted-code")
    )
      return;

    const inline =
      parent.type === "element" &&
      parent.properties["data-rd-inline-start"] !== undefined
        ? {
            start: Number(parent.properties["data-rd-inline-start"]),
            end: Number(parent.properties["data-rd-inline-end"]),
          }
        : inheritedInline;

    parent.children = parent.children.map((child) => {
      if (child.type === "text") {
        const start = child.position?.start.offset ?? inline?.start;
        const end = child.position?.end.offset ?? inline?.end;
        if (
          start === undefined ||
          end === undefined ||
          child.value.length === 0
        )
          return child;
        return mappedSpan(
          child.value,
          buildBoundaryMap(source.slice(start, end), child.value, start),
        );
      }
      if (child.type === "element") recurse(child, inline);
      return child;
    });
  }
  recurse(root);
}

function secureLinksAndImages(root: HastRoot): void {
  visit(root, "element", (element) => {
    if (element.tagName === "a") {
      const href = element.properties.href;
      if (typeof href === "string") {
        element.properties["data-rd-href"] = href;
        element.properties.href = "#";
        element.properties.rel = ["noopener", "noreferrer"];
      }
    }
    if (element.tagName === "img") {
      const src = element.properties.src;
      if (typeof src !== "string") return;
      element.properties["data-rd-image-src"] = src;
      element.properties.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
      element.properties["data-rd-image-state"] = /^https?:/iu.test(src)
        ? "remote-blocked"
        : "local-pending";
    }
  });
}

export async function parseMarkdownDocument(
  source: string,
  fingerprint: DocumentFingerprint,
): Promise<MarkdownDocumentModel> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeSanitize);
  const mdast = processor.parse(source);
  const records = collectSourceRecords(source, mdast);
  const safeHast = await processor.run(mdast);
  restoreSourceMetadata(safeHast, records.blocks, records.inlines);
  const withMath = (await unified().use(rehypeKatex).run(safeHast)) as HastRoot;
  restoreRenderedMathMetadata(withMath, records.blocks, records.inlines);
  await renderHighlightedCode(withMath, records.blocks);
  decorateTextNodes(withMath, source);
  secureLinksAndImages(withMath);

  const blocksWithHashes = await Promise.all(
    records.blocks.map(
      async (block): Promise<SourceBlock> => ({
        ...block,
        sourceSha256: await sha256Hex(
          encodeUtf8(source.slice(block.start, block.end)),
        ),
      }),
    ),
  );
  const blocks = new Map(blocksWithHashes.map((block) => [block.id, block]));
  const html = String(unified().use(rehypeStringify).stringify(withMath));
  return { source, fingerprint, html, blocks };
}

export function isInlineCodeNode(node: MdastNode): node is InlineCode {
  return node.type === "inlineCode";
}

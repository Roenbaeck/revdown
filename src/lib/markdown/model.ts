import type {
  Element,
  ElementContent,
  Root as HastRoot,
  RootContent,
  Text as HastText,
} from "hast";
import type {
  Code,
  InlineCode,
  Nodes as MdastNode,
  Root as MdastRoot,
} from "mdast";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference";
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
import { normalizeTexDisplayMathForParsing } from "./texMath";

export type SupportedBlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "tableCell"
  | "math";

export type RenderedSourceSpan = {
  renderedStart: number;
  renderedEnd: number;
  sourceMap: readonly number[];
};

export type RenderedInlineRange = {
  renderedStart: number;
  renderedEnd: number;
  sourceStart: number;
  sourceEnd: number;
};

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
  renderedSpans: readonly RenderedSourceSpan[];
  renderedInlineRanges: readonly RenderedInlineRange[];
  headingLevel?: number;
  codeLanguage?: string;
  codeMap?: number[];
};

export type MarkdownDocumentModel = {
  source: string;
  fingerprint: DocumentFingerprint;
  html: string;
  blocks: ReadonlyMap<string, SourceBlock>;
  blocksInSourceOrder: readonly SourceBlock[];
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

type RenderedMapping = {
  text: string;
  spans: RenderedSourceSpan[];
  inlineRanges: RenderedInlineRange[];
};

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
  if (node.type === "html") return "";
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

function renderedMapping(source: string, node: MdastNode): RenderedMapping {
  const range = offsets(node as Positioned);
  let mapping: RenderedMapping;
  if (
    node.type === "text" ||
    node.type === "inlineCode" ||
    node.type === "inlineMath" ||
    node.type === "code" ||
    node.type === "math" ||
    node.type === "image" ||
    node.type === "break"
  ) {
    const text = plainText(node);
    const sourceMap =
      range && text
        ? node.type === "code"
          ? buildCodeBoundaryMap(source, node, range.start, range.end)
          : node.type === "inlineCode"
            ? buildInlineCodeBoundaryMap(
                source,
                node.value,
                range.start,
                range.end,
              )
            : buildBoundaryMap(
                source.slice(range.start, range.end),
                text,
                range.start,
              )
        : undefined;
    mapping = {
      text,
      spans: sourceMap
        ? [{ renderedStart: 0, renderedEnd: text.length, sourceMap }]
        : [],
      inlineRanges: [],
    };
  } else if ("children" in node) {
    let text = "";
    const spans: RenderedSourceSpan[] = [];
    const inlineRanges: RenderedInlineRange[] = [];
    for (const child of node.children) {
      const childMapping = renderedMapping(source, child);
      const offset = text.length;
      text += childMapping.text;
      spans.push(
        ...childMapping.spans.map((span) => ({
          ...span,
          renderedStart: span.renderedStart + offset,
          renderedEnd: span.renderedEnd + offset,
        })),
      );
      inlineRanges.push(
        ...childMapping.inlineRanges.map((inline) => ({
          ...inline,
          renderedStart: inline.renderedStart + offset,
          renderedEnd: inline.renderedEnd + offset,
        })),
      );
    }
    mapping = { text, spans, inlineRanges };
  } else {
    mapping = { text: "", spans: [], inlineRanges: [] };
  }

  if (range && inlineKind(node) && mapping.text) {
    mapping.inlineRanges.push({
      renderedStart: 0,
      renderedEnd: mapping.text.length,
      sourceStart: range.start,
      sourceEnd: range.end,
    });
  }
  return mapping;
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
      const rendered = renderedMapping(source, typedNode);
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
        renderedText: rendered.text,
        renderedSpans: rendered.spans,
        renderedInlineRanges: rendered.inlineRanges,
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

type DecodedSourceUnit = {
  value: string;
  start: number;
  end: number;
};

type BoundaryMapOptions = {
  normalizeWhitespace?: boolean;
};

function decodeEntity(entity: string): string | undefined {
  if (/^&#x[0-9a-f]+;$/iu.test(entity)) {
    return decodeNumericCharacterReference(entity.slice(3, -1), 16);
  }
  if (/^&#\d+;$/u.test(entity)) {
    return decodeNumericCharacterReference(entity.slice(2, -1), 10);
  }
  const named = decodeNamedCharacterReference(entity.slice(1, -1));
  return named || undefined;
}

function appendDecodedUnits(
  units: DecodedSourceUnit[],
  value: string,
  start: number,
  end: number,
): void {
  for (const unit of value.split("")) {
    units.push({ value: unit, start, end });
  }
}

function decodeSourceUnits(
  raw: string,
  absoluteStart: number,
): DecodedSourceUnit[] {
  const units: DecodedSourceUnit[] = [];
  let index = 0;
  while (index < raw.length) {
    const current = raw[index];
    if (
      current === "\\" &&
      index + 1 < raw.length &&
      /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/u.test(raw[index + 1] ?? "")
    ) {
      appendDecodedUnits(
        units,
        raw[index + 1] ?? "",
        absoluteStart + index,
        absoluteStart + index + 2,
      );
      index += 2;
      continue;
    }
    if (current === "&") {
      const candidate = /^&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/iu.exec(
        raw.slice(index),
      )?.[0];
      const entityValue = candidate ? decodeEntity(candidate) : undefined;
      if (candidate && entityValue) {
        appendDecodedUnits(
          units,
          entityValue,
          absoluteStart + index,
          absoluteStart + index + candidate.length,
        );
        index += candidate.length;
        continue;
      }
    }
    if (current === "\r") {
      const width = raw[index + 1] === "\n" ? 2 : 1;
      appendDecodedUnits(
        units,
        "\n",
        absoluteStart + index,
        absoluteStart + index + width,
      );
      index += width;
      continue;
    }
    appendDecodedUnits(
      units,
      current ?? "",
      absoluteStart + index,
      absoluteStart + index + 1,
    );
    index += 1;
  }
  return units;
}

function isWhitespaceUnit(value: string): boolean {
  return value === " " || value === "\t" || value === "\n";
}

function sourceUnitMatches(
  source: string,
  visible: string,
  options: BoundaryMapOptions,
): boolean {
  return (
    source === visible ||
    (options.normalizeWhitespace === true &&
      isWhitespaceUnit(source) &&
      isWhitespaceUnit(visible))
  );
}

function alignSourceUnits(
  units: readonly DecodedSourceUnit[],
  visible: string,
  options: BoundaryMapOptions,
): number[] | undefined {
  if (!visible) return undefined;
  const visibleUnits = visible.split("");
  const forward: number[] = [];
  let sourceIndex = 0;
  for (const visibleUnit of visibleUnits) {
    while (
      sourceIndex < units.length &&
      !sourceUnitMatches(units[sourceIndex]?.value ?? "", visibleUnit, options)
    ) {
      sourceIndex += 1;
    }
    if (sourceIndex >= units.length) return undefined;
    forward.push(sourceIndex);
    sourceIndex += 1;
  }

  const backward = new Array<number>(visibleUnits.length);
  sourceIndex = units.length - 1;
  for (
    let visibleIndex = visibleUnits.length - 1;
    visibleIndex >= 0;
    visibleIndex -= 1
  ) {
    while (
      sourceIndex >= 0 &&
      !sourceUnitMatches(
        units[sourceIndex]?.value ?? "",
        visibleUnits[visibleIndex] ?? "",
        options,
      )
    ) {
      sourceIndex -= 1;
    }
    if (sourceIndex < 0) return undefined;
    backward[visibleIndex] = sourceIndex;
    sourceIndex -= 1;
  }
  if (forward.some((entry, index) => entry !== backward[index])) {
    return undefined;
  }

  const first = units[forward[0] ?? -1];
  const last = units[forward.at(-1) ?? -1];
  if (!first || !last) return undefined;
  const boundaries = [first.start];
  for (let index = 1; index < forward.length; index += 1) {
    const previous = units[forward[index - 1] ?? -1];
    const current = units[forward[index] ?? -1];
    if (!previous || !current) return undefined;
    boundaries.push(Math.max(previous.end, current.start));
  }
  boundaries.push(last.end);
  return boundaries;
}

export function buildBoundaryMap(
  raw: string,
  visible: string,
  absoluteStart: number,
  options: BoundaryMapOptions = {},
): number[] | undefined {
  if (raw === visible) {
    return Array.from(
      { length: visible.length + 1 },
      (_, index) => absoluteStart + index,
    );
  }

  return alignSourceUnits(
    decodeSourceUnits(raw, absoluteStart),
    visible,
    options,
  );
}

function buildInlineCodeBoundaryMap(
  source: string,
  visible: string,
  start: number,
  end: number,
): number[] | undefined {
  const raw = source.slice(start, end);
  let delimiterWidth = 0;
  while (raw[delimiterWidth] === "`") delimiterWidth += 1;
  const closingStart = raw.length - delimiterWidth;
  if (
    delimiterWidth > 0 &&
    raw.slice(closingStart) === "`".repeat(delimiterWidth)
  ) {
    return buildBoundaryMap(
      raw.slice(delimiterWidth, closingStart),
      visible,
      start + delimiterWidth,
      { normalizeWhitespace: true },
    );
  }
  return buildBoundaryMap(raw, visible, start, {
    normalizeWhitespace: true,
  });
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

function directlyMappedSpan(
  value: string,
  start: number,
  end: number,
): Element {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["rd-source-text"],
      "data-rd-source-start": String(start),
      "data-rd-source-end": String(end),
    },
    children: [{ type: "text", value }],
  };
}

function codeTokenStyle(token: HighlightToken): string | undefined {
  const declarations: string[] = [];
  if (token.color && /^#[0-9a-f]{3,8}$/iu.test(token.color))
    declarations.push(`--shiki-light:${token.color}`);
  if (token.darkColor && /^#[0-9a-f]{3,8}$/iu.test(token.darkColor))
    declarations.push(`--shiki-dark:${token.darkColor}`);
  if (token.backgroundColor && /^#[0-9a-f]{3,8}$/iu.test(token.backgroundColor))
    declarations.push(`--shiki-light-bg:${token.backgroundColor}`);
  if (
    token.darkBackgroundColor &&
    /^#[0-9a-f]{3,8}$/iu.test(token.darkBackgroundColor)
  )
    declarations.push(`--shiki-dark-bg:${token.darkBackgroundColor}`);
  if (token.color || token.darkColor)
    declarations.push("color:var(--shiki-token-color,var(--shiki-light))");
  if (token.backgroundColor || token.darkBackgroundColor)
    declarations.push(
      "background-color:var(--shiki-token-background,var(--shiki-light-bg))",
    );
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
  function mappedTextChildren(
    value: string,
    start: number,
    end: number,
    inlineKind?: string,
  ): ElementContent[] {
    const raw = source.slice(start, end);
    const boundaryMap = (candidate: string) =>
      inlineKind === "inlineCode"
        ? buildInlineCodeBoundaryMap(source, candidate, start, end)
        : buildBoundaryMap(raw, candidate, start);
    if (raw === value) return [directlyMappedSpan(value, start, end)];
    const boundaries = boundaryMap(value);
    if (boundaries) return [mappedSpan(value, boundaries)];

    // Some rehype transforms append presentation-only whitespace to an
    // authored text node (footnote backlinks are one example). Keep the
    // authored portion mapped and leave only that generated boundary outside
    // the source map.
    let visibleStart = 0;
    let visibleEnd = value.length;
    while (
      visibleStart < visibleEnd &&
      isWhitespaceUnit(value[visibleStart] ?? "")
    )
      visibleStart += 1;
    while (
      visibleEnd > visibleStart &&
      isWhitespaceUnit(value[visibleEnd - 1] ?? "")
    )
      visibleEnd -= 1;
    const authored = value.slice(visibleStart, visibleEnd);
    const authoredBoundaries = authored ? boundaryMap(authored) : undefined;
    if (!authoredBoundaries) return [mappedSpan(value, undefined)];

    const children: ElementContent[] = [];
    if (visibleStart > 0) {
      children.push({ type: "text", value: value.slice(0, visibleStart) });
    }
    children.push(mappedSpan(authored, authoredBoundaries));
    if (visibleEnd < value.length) {
      children.push({ type: "text", value: value.slice(visibleEnd) });
    }
    return children;
  }

  function decorateText(
    child: HastText,
    inline?: { start: number; end: number; kind?: string },
  ): ElementContent[] | undefined {
    const start = child.position?.start.offset ?? inline?.start;
    const end = child.position?.end.offset ?? inline?.end;
    if (start === undefined || end === undefined || child.value.length === 0) {
      return undefined;
    }
    return mappedTextChildren(child.value, start, end, inline?.kind);
  }

  function recurse(
    parent: HastRoot | Element,
    inheritedInline?: { start: number; end: number; kind?: string },
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
            kind: String(parent.properties["data-rd-inline-kind"] ?? ""),
          }
        : inheritedInline;

    if (parent.type === "root") {
      parent.children = parent.children.flatMap((child): RootContent[] => {
        if (child.type === "text")
          return decorateText(child, inline) ?? [child];
        if (child.type === "element") recurse(child, inline);
        return [child];
      });
      return;
    }
    parent.children = parent.children.flatMap((child): ElementContent[] => {
      if (child.type === "text") return decorateText(child, inline) ?? [child];
      if (child.type === "element") recurse(child, inline);
      return [child];
    });
  }
  recurse(root);
}

function secureLinksAndImages(root: HastRoot): void {
  visit(root, "element", (element) => {
    if (element.tagName === "a") {
      const href = element.properties.href;
      if (typeof href === "string") {
        if (href.startsWith("#")) return;
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
  const initialMdast = processor.parse(source);
  const parsingSource = normalizeTexDisplayMathForParsing(source, initialMdast);
  const mdast =
    parsingSource === source ? initialMdast : processor.parse(parsingSource);
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
  const blocksInSourceOrder = blocksWithHashes.sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const blocks = new Map(blocksInSourceOrder.map((block) => [block.id, block]));
  const html = String(unified().use(rehypeStringify).stringify(withMath));
  return { source, fingerprint, html, blocks, blocksInSourceOrder };
}

export function isInlineCodeNode(node: MdastNode): node is InlineCode {
  return node.type === "inlineCode";
}

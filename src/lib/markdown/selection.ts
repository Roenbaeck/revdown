import type { Anchor } from "../schema/sidecar";
import type { MarkdownDocumentModel, SourceBlock } from "./model";

export type MappedSelection = {
  block: SourceBlock;
  sourceRange: { start: number; end: number };
  sourceText: string;
  renderedText: string;
  prefix: string;
  suffix: string;
};

export type SelectionMappingResult =
  | { kind: "mapped"; selection: MappedSelection }
  | { kind: "unsupported"; message: string };

function closestElement(node: Node, selector: string): HTMLElement | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return element?.closest<HTMLElement>(selector) ?? null;
}

function textOffsetWithin(
  container: Element,
  node: Node,
  offset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

function sourcePoint(node: Node, offset: number): number | undefined {
  const span = closestElement(node, "[data-rd-source-start]");
  if (!span) return undefined;
  const displayOffset = textOffsetWithin(span, node, offset);
  const serializedMap = span.dataset.rdSourceMap;
  if (serializedMap) {
    const boundaries = serializedMap.split(",").map(Number);
    return boundaries[displayOffset];
  }
  const start = Number(span.dataset.rdSourceStart);
  const end = Number(span.dataset.rdSourceEnd);
  const value = start + displayOffset;
  return Number.isFinite(value) && value <= end ? value : undefined;
}

function rangeContainsElementContents(
  range: Range,
  element: Element,
  block: Element,
): boolean {
  const selectionStart = textOffsetWithin(
    block,
    range.startContainer,
    range.startOffset,
  );
  const selectionEnd = textOffsetWithin(
    block,
    range.endContainer,
    range.endOffset,
  );
  const elementStart = textOffsetWithin(block, element, 0);
  const elementEnd = textOffsetWithin(
    block,
    element,
    element.childNodes.length,
  );
  return selectionStart <= elementStart && selectionEnd >= elementEnd;
}

function selectionContext(
  range: Range,
  blockElement: Element,
): { prefix: string; suffix: string } {
  const start = textOffsetWithin(
    blockElement,
    range.startContainer,
    range.startOffset,
  );
  const end = textOffsetWithin(
    blockElement,
    range.endContainer,
    range.endOffset,
  );
  const text = blockElement.textContent ?? "";
  return {
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(end, end + 40),
  };
}

export function mapDomSelection(
  domSelection: Selection | null,
  surface: HTMLElement,
  model: MarkdownDocumentModel,
): SelectionMappingResult {
  if (
    !domSelection ||
    domSelection.rangeCount !== 1 ||
    domSelection.isCollapsed
  ) {
    return {
      kind: "unsupported",
      message: "Select some rendered text before adding a comment.",
    };
  }
  const range = domSelection.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) {
    return {
      kind: "unsupported",
      message: "The selection is outside the document.",
    };
  }

  const startBlock = closestElement(range.startContainer, "[data-rd-block-id]");
  const endBlock = closestElement(range.endContainer, "[data-rd-block-id]");
  if (!startBlock || !endBlock || startBlock !== endBlock) {
    return {
      kind: "unsupported",
      message:
        "Comments must target text within one paragraph, heading, table cell, or code block.",
    };
  }
  const block = model.blocks.get(startBlock.dataset.rdBlockId ?? "");
  if (!block)
    return {
      kind: "unsupported",
      message: "This rendered block has no reliable source mapping.",
    };

  const startMath = closestElement(
    range.startContainer,
    "[data-rd-math-start]",
  );
  const endMath = closestElement(range.endContainer, "[data-rd-math-start]");
  let sourceStart: number | undefined;
  let sourceEnd: number | undefined;
  if (startMath || endMath) {
    if (!startMath || startMath !== endMath) {
      return {
        kind: "unsupported",
        message:
          "Select the complete math expression on its own to comment on math.",
      };
    }
    sourceStart = Number(startMath.dataset.rdMathStart);
    sourceEnd = Number(startMath.dataset.rdMathEnd);
  } else {
    sourceStart = sourcePoint(range.startContainer, range.startOffset);
    sourceEnd = sourcePoint(range.endContainer, range.endOffset);
  }

  if (
    sourceStart === undefined ||
    sourceEnd === undefined ||
    sourceEnd <= sourceStart
  ) {
    return {
      kind: "unsupported",
      message:
        "That selection crosses content that cannot be mapped precisely to Markdown source.",
    };
  }

  for (const inline of startBlock.querySelectorAll<HTMLElement>(
    "[data-rd-inline-start]",
  )) {
    if (rangeContainsElementContents(range, inline, startBlock)) {
      sourceStart = Math.min(sourceStart, Number(inline.dataset.rdInlineStart));
      sourceEnd = Math.max(sourceEnd, Number(inline.dataset.rdInlineEnd));
    }
  }

  if (sourceStart < block.start || sourceEnd > block.end) {
    return {
      kind: "unsupported",
      message: "The mapped selection falls outside its source block.",
    };
  }
  const renderedText = range.toString();
  if (!renderedText.trim()) {
    return {
      kind: "unsupported",
      message: "A comment target cannot contain only whitespace.",
    };
  }
  const context = selectionContext(range, startBlock);
  return {
    kind: "mapped",
    selection: {
      block,
      sourceRange: { start: sourceStart, end: sourceEnd },
      sourceText: model.source.slice(sourceStart, sourceEnd),
      renderedText,
      ...context,
    },
  };
}

export function createAnchor(
  model: MarkdownDocumentModel,
  mapped: MappedSelection,
): Anchor {
  return {
    documentSha256: model.fingerprint.sha256,
    documentNormalizedSha256: model.fingerprint.normalizedSha256,
    sourceRange: mapped.sourceRange,
    sourceText: mapped.sourceText,
    textQuote: {
      exact: mapped.renderedText,
      prefix: mapped.prefix,
      suffix: mapped.suffix,
    },
    block: {
      start: mapped.block.start,
      end: mapped.block.end,
      sourceSha256: mapped.block.sourceSha256,
    },
    headingPath: mapped.block.headingPath,
    lineHint: {
      start: mapped.block.lineStart,
      end: mapped.block.lineEnd,
    },
  };
}

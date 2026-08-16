import type { MarkdownDocumentModel, SourceBlock } from "./model";

export const MAX_DOCUMENT_SEARCH_MATCHES = 50_000;

export type DocumentSearchMatch = {
  id: string;
  blockId: string;
  sourceRange: { start: number; end: number };
  renderedRange: { start: number; end: number };
};

export type DocumentSearchResults = {
  matches: readonly DocumentSearchMatch[];
  total: number;
  limited: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function renderedRangeToSourceRange(
  block: SourceBlock,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const first = block.renderedSpans.find(
    (span) => start >= span.renderedStart && start < span.renderedEnd,
  );
  const last = block.renderedSpans.find(
    (span) => end > span.renderedStart && end <= span.renderedEnd,
  );
  if (!first || !last) return undefined;

  const mappedStart = first.sourceMap[start - first.renderedStart];
  const mappedEnd = last.sourceMap[end - last.renderedStart];
  if (mappedStart === undefined || mappedEnd === undefined) return undefined;

  let sourceStart = mappedStart;
  let sourceEnd = mappedEnd;
  for (const inline of block.renderedInlineRanges) {
    if (inline.renderedStart >= start && inline.renderedEnd <= end) {
      sourceStart = Math.min(sourceStart, inline.sourceStart);
      sourceEnd = Math.max(sourceEnd, inline.sourceEnd);
    }
  }
  return sourceEnd > sourceStart
    ? { start: sourceStart, end: sourceEnd }
    : undefined;
}

export function searchMarkdownDocument(
  model: MarkdownDocumentModel,
  query: string,
  limit = MAX_DOCUMENT_SEARCH_MATCHES,
): DocumentSearchResults {
  if (!query || limit < 1) return { matches: [], total: 0, limited: false };

  const pattern = new RegExp(escapeRegExp(query), "giu");
  const matches: DocumentSearchMatch[] = [];
  let total = 0;

  for (const block of model.blocksInSourceOrder) {
    pattern.lastIndex = 0;
    for (const result of block.renderedText.matchAll(pattern)) {
      const start = result.index;
      const value = result[0];
      if (start === undefined || !value) continue;
      const end = start + value.length;
      const sourceRange = renderedRangeToSourceRange(block, start, end);
      if (!sourceRange) continue;

      total += 1;
      if (matches.length < limit) {
        matches.push({
          id: `${block.id}:${start}:${end}`,
          blockId: block.id,
          sourceRange,
          renderedRange: { start, end },
        });
      }
    }
  }

  return { matches, total, limited: total > matches.length };
}

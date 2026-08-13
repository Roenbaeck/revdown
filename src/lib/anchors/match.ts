import type { Anchor } from "../schema/sidecar";
import type { MarkdownDocumentModel, SourceBlock } from "../markdown/model";

export type AnchorState = "exact" | "relocated" | "ambiguous" | "unmatched";

export type AnchorCandidate = {
  sourceRange: { start: number; end: number };
  blockId: string;
  score: number;
  evidence: string[];
};

export type AnchorMatch = {
  state: AnchorState;
  confidence: number;
  candidate?: AnchorCandidate;
  candidates: AnchorCandidate[];
};

function blockForRange(
  model: MarkdownDocumentModel,
  start: number,
  end: number,
): SourceBlock | undefined {
  return [...model.blocks.values()].find(
    (block) => start >= block.start && end <= block.end,
  );
}

function allOccurrences(value: string, needle: string): number[] {
  if (!needle) return [];
  const results: number[] = [];
  let offset = 0;
  while (offset <= value.length - needle.length) {
    const found = value.indexOf(needle, offset);
    if (found < 0) break;
    results.push(found);
    offset = found + Math.max(1, needle.length);
  }
  return results;
}

function sameHeading(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && a.every((segment, index) => segment === b[index])
  );
}

function contextScore(
  source: string,
  start: number,
  end: number,
  anchor: Anchor,
): number {
  let score = 0;
  const prefix = anchor.textQuote.prefix.slice(-24);
  const suffix = anchor.textQuote.suffix.slice(0, 24);
  if (
    prefix &&
    source.slice(Math.max(0, start - prefix.length), start).endsWith(prefix)
  )
    score += 0.07;
  if (suffix && source.slice(end, end + suffix.length).startsWith(suffix))
    score += 0.07;
  return score;
}

function scoreExactCandidate(
  model: MarkdownDocumentModel,
  anchor: Anchor,
  start: number,
  end: number,
  globallyUnique: boolean,
): AnchorCandidate | undefined {
  const block = blockForRange(model, start, end);
  if (!block) return undefined;
  if (globallyUnique) {
    return {
      sourceRange: { start, end },
      blockId: block.id,
      score: 0.96,
      evidence: ["unique exact source text"],
    };
  }

  let score = 0.56;
  const evidence = ["exact source text"];
  if (block.sourceSha256 === anchor.block.sourceSha256) {
    score += 0.2;
    evidence.push("same block fingerprint");
  }
  if (sameHeading(block.headingPath, anchor.headingPath)) {
    score += 0.12;
    evidence.push("same heading path");
  }
  if (start >= anchor.block.start && end <= anchor.block.end) {
    score += 0.08;
    evidence.push("inside original block range");
  }
  const context = contextScore(model.source, start, end, anchor);
  if (context > 0) evidence.push("matching quote context");
  score += context;
  return {
    sourceRange: { start, end },
    blockId: block.id,
    score: Math.min(score, 0.99),
    evidence,
  };
}

function normalizeForComparison(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution =
        previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

function fuzzyCandidates(
  model: MarkdownDocumentModel,
  anchor: Anchor,
): AnchorCandidate[] {
  const target = normalizeForComparison(anchor.sourceText);
  if (target.length < 16 || target.length > 500) return [];
  const targetWords = anchor.sourceText.trim().split(/\s+/u).length;
  const candidates: AnchorCandidate[] = [];
  for (const block of model.blocks.values()) {
    if (!sameHeading(block.headingPath, anchor.headingPath)) continue;
    const raw = model.source.slice(block.start, block.end);
    const tokens = [...raw.matchAll(/\S+/gu)];
    for (let startToken = 0; startToken < tokens.length; startToken += 1) {
      for (const delta of [-1, 0, 1]) {
        const endToken = startToken + targetWords + delta;
        if (endToken <= startToken || endToken > tokens.length) continue;
        const start = tokens[startToken]?.index;
        const last = tokens[endToken - 1];
        if (start === undefined || !last?.[0] || last.index === undefined)
          continue;
        const end = last.index + last[0].length;
        const similarity = levenshteinSimilarity(
          target,
          normalizeForComparison(raw.slice(start, end)),
        );
        if (similarity >= 0.9) {
          candidates.push({
            sourceRange: { start: block.start + start, end: block.start + end },
            blockId: block.id,
            score: similarity * 0.96,
            evidence: ["near-exact text in the same heading"],
          });
        }
      }
    }
  }
  return candidates;
}

function classifyCandidates(candidates: AnchorCandidate[]): AnchorMatch {
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || a.sourceRange.start - b.sourceRange.start,
  );
  const best = sorted[0];
  if (!best) return { state: "unmatched", confidence: 0, candidates: [] };
  const runnerUp = sorted[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  if (best.score >= 0.82 && (!runnerUp || margin >= 0.12)) {
    return {
      state: "relocated",
      confidence: best.score,
      candidate: best,
      candidates: sorted,
    };
  }
  return { state: "ambiguous", confidence: best.score, candidates: sorted };
}

export function matchAnchor(
  anchor: Anchor,
  model: MarkdownDocumentModel,
): AnchorMatch {
  const { start, end } = anchor.sourceRange;
  const fingerprintsMatch =
    anchor.documentSha256 === model.fingerprint.sha256 ||
    anchor.documentNormalizedSha256 === model.fingerprint.normalizedSha256;
  if (
    fingerprintsMatch &&
    model.source.slice(start, end) === anchor.sourceText
  ) {
    const block = blockForRange(model, start, end);
    const candidate = block
      ? {
          sourceRange: { start, end },
          blockId: block.id,
          score: 1,
          evidence: ["document fingerprint and stored source range"],
        }
      : undefined;
    return {
      state: "exact",
      confidence: 1,
      ...(candidate ? { candidate } : {}),
      candidates: candidate ? [candidate] : [],
    };
  }

  const sourceOccurrences = allOccurrences(model.source, anchor.sourceText);
  const exactCandidates = sourceOccurrences
    .map((candidateStart) =>
      scoreExactCandidate(
        model,
        anchor,
        candidateStart,
        candidateStart + anchor.sourceText.length,
        sourceOccurrences.length === 1,
      ),
    )
    .filter(
      (candidate): candidate is AnchorCandidate => candidate !== undefined,
    );
  if (exactCandidates.length > 0) return classifyCandidates(exactCandidates);

  const renderedOccurrences = allOccurrences(
    model.source,
    anchor.textQuote.exact,
  );
  const renderedCandidates = renderedOccurrences
    .map((candidateStart) =>
      scoreExactCandidate(
        model,
        anchor,
        candidateStart,
        candidateStart + anchor.textQuote.exact.length,
        renderedOccurrences.length === 1,
      ),
    )
    .filter(
      (candidate): candidate is AnchorCandidate => candidate !== undefined,
    )
    .map((candidate) => ({
      ...candidate,
      score: Math.min(candidate.score, 0.9),
      evidence: ["exact rendered quote", ...candidate.evidence.slice(1)],
    }));
  if (renderedCandidates.length > 0)
    return classifyCandidates(renderedCandidates);

  return classifyCandidates(fuzzyCandidates(model, anchor));
}

export function matchAllAnchors(
  anchors: readonly { id: string; anchor: Anchor }[],
  model: MarkdownDocumentModel,
): ReadonlyMap<string, AnchorMatch> {
  return new Map(
    anchors.map(({ id, anchor }) => [id, matchAnchor(anchor, model)]),
  );
}

export function confirmAnchorMatch(
  anchor: Anchor,
  match: AnchorMatch,
  model: MarkdownDocumentModel,
): Anchor {
  const candidate = match.candidate;
  if (!candidate || (match.state !== "relocated" && match.state !== "exact"))
    return anchor;
  const block = model.blocks.get(candidate.blockId);
  if (!block) return anchor;
  const { start, end } = candidate.sourceRange;
  return {
    ...anchor,
    documentSha256: model.fingerprint.sha256,
    documentNormalizedSha256: model.fingerprint.normalizedSha256,
    sourceRange: { start, end },
    sourceText: model.source.slice(start, end),
    textQuote: {
      ...anchor.textQuote,
      prefix: model.source.slice(Math.max(block.start, start - 40), start),
      suffix: model.source.slice(end, Math.min(block.end, end + 40)),
    },
    block: {
      start: block.start,
      end: block.end,
      sourceSha256: block.sourceSha256,
    },
    headingPath: block.headingPath,
    lineHint: { start: block.lineStart, end: block.lineEnd },
  };
}

export function confirmAnchorCandidate(
  anchor: Anchor,
  candidate: AnchorCandidate,
  model: MarkdownDocumentModel,
): Anchor {
  return confirmAnchorMatch(
    anchor,
    {
      state: "relocated",
      confidence: candidate.score,
      candidate,
      candidates: [candidate],
    },
    model,
  );
}

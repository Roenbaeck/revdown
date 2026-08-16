import type { AnchorMatch } from "../anchors/match";
import { authorIndex, commentAuthor } from "../authors/model";
import type { MarkdownDocumentModel } from "../markdown/model";
import type { SidecarV1 } from "../schema/sidecar";

export type AgentSourceRange = {
  start: number;
  end: number;
};

export type AgentAnchorContext = {
  sourceRange: AgentSourceRange;
  sourceText: string;
  contextBefore: string;
  contextAfter: string;
  headingPath: string[];
  confidence: number;
  evidence: string[];
};

export type AgentReviewComment = {
  id: string;
  updatedAt: string;
  status: "open" | "resolved";
  feedback: string;
  author: {
    id: string | null;
    displayName: string;
    kind: "human" | "agent" | "unknown";
  };
  anchorState: "exact" | "relocated" | "ambiguous" | "unmatched";
  confidence: number;
  target: string;
  storedAnchor: {
    sourceRange: AgentSourceRange;
    sourceText: string;
    renderedText: string;
    prefix: string;
    suffix: string;
    headingPath: string[];
    lineHint: { start: number; end: number };
  };
  currentAnchor?: AgentAnchorContext;
  candidates: AgentAnchorContext[];
};

export type AgentReviewSnapshot = {
  schemaVersion: 1;
  filename: string;
  sourceSha256: string;
  normalizedSourceSha256: string;
  sourceSize: number;
  sidecarRevision: string | null;
  sidecarIssue: string | null;
  sourceChanged: boolean;
  comments: AgentReviewComment[];
};

const CONTEXT_UNITS = 600;
const MAX_CANDIDATES = 5;

function contextForRange(
  model: MarkdownDocumentModel,
  sourceRange: AgentSourceRange,
  confidence: number,
  evidence: readonly string[],
  blockId: string,
): AgentAnchorContext {
  const block = model.blocks.get(blockId);
  return {
    sourceRange,
    sourceText: model.source.slice(sourceRange.start, sourceRange.end),
    contextBefore: model.source.slice(
      Math.max(0, sourceRange.start - CONTEXT_UNITS),
      sourceRange.start,
    ),
    contextAfter: model.source.slice(
      sourceRange.end,
      sourceRange.end + CONTEXT_UNITS,
    ),
    headingPath: block?.headingPath ?? [],
    confidence,
    evidence: [...evidence],
  };
}

export function buildAgentReviewSnapshot(input: {
  filename: string;
  sourceSize: number;
  model: MarkdownDocumentModel;
  sidecar: SidecarV1 | null;
  sidecarRevision: string | null;
  sidecarIssue: string | null;
  sourceChanged: boolean;
  matches: ReadonlyMap<string, AnchorMatch>;
}): AgentReviewSnapshot {
  const authors = authorIndex(input.sidecar?.authors);
  return {
    schemaVersion: 1,
    filename: input.filename,
    sourceSha256: input.model.fingerprint.sha256,
    normalizedSourceSha256: input.model.fingerprint.normalizedSha256,
    sourceSize: input.sourceSize,
    sidecarRevision: input.sidecarRevision,
    sidecarIssue: input.sidecarIssue,
    sourceChanged: input.sourceChanged,
    comments: (input.sidecar?.comments ?? []).map((comment) => {
      const author = commentAuthor(comment, authors);
      const match = input.matches.get(comment.id) ?? {
        state: "unmatched" as const,
        confidence: 0,
        candidates: [],
      };
      const currentAnchor = match.candidate
        ? contextForRange(
            input.model,
            match.candidate.sourceRange,
            match.candidate.score,
            match.candidate.evidence,
            match.candidate.blockId,
          )
        : undefined;
      return {
        id: comment.id,
        updatedAt: comment.updatedAt,
        status: comment.status,
        feedback: comment.body,
        author: {
          id: author.id,
          displayName: author.displayName,
          kind: author.kind,
        },
        anchorState: match.state,
        confidence: match.confidence,
        target: comment.anchor.textQuote.exact,
        storedAnchor: {
          sourceRange: comment.anchor.sourceRange,
          sourceText: comment.anchor.sourceText,
          renderedText: comment.anchor.textQuote.exact,
          prefix: comment.anchor.textQuote.prefix,
          suffix: comment.anchor.textQuote.suffix,
          headingPath: comment.anchor.headingPath,
          lineHint: {
            start: comment.anchor.lineHint.start,
            end: comment.anchor.lineHint.end,
          },
        },
        ...(currentAnchor ? { currentAnchor } : {}),
        candidates: match.candidates
          .slice(0, MAX_CANDIDATES)
          .map((candidate) =>
            contextForRange(
              input.model,
              candidate.sourceRange,
              candidate.score,
              candidate.evidence,
              candidate.blockId,
            ),
          ),
      };
    }),
  };
}

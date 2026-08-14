import type { AnchorMatch } from "../anchors/match";
import type { ReviewComment, SidecarV1 } from "../schema/sidecar";
import { defaultExportInstruction } from "../settings/export";

export type ReviewExportOptions = {
  includeResolved?: boolean;
  instruction?: string;
};

function fenced(value: string, language = "text"): string {
  const runs = [...value.matchAll(/`+/gu)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}

function inlineCode(value: string): string {
  const escapedControls = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint > 31 && codePoint !== 127) return character;
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    })
    .join("");
  const runs = [...escapedControls.matchAll(/`+/gu)].map(
    (match) => match[0].length,
  );
  const delimiter = "`".repeat(
    Math.max(1, ...runs.map((length) => length + 1)),
  );
  const needsPadding =
    escapedControls.startsWith("`") ||
    escapedControls.endsWith("`") ||
    escapedControls.startsWith(" ") ||
    escapedControls.endsWith(" ");
  const content = needsPadding ? ` ${escapedControls} ` : escapedControls;
  return `${delimiter}${content}${delimiter}`;
}

function commentSection(
  comment: ReviewComment,
  match: AnchorMatch | undefined,
  index: number,
): string {
  const anchorState = match?.state ?? "unmatched";
  const heading =
    comment.anchor.headingPath.length > 0
      ? comment.anchor.headingPath.join(" › ")
      : "(document root)";
  const lines = [
    `## Comment ${index + 1}: ${comment.id}`,
    "",
    `- Review state: ${comment.status}`,
    `- Anchor state: ${anchorState}`,
    `- Heading context: ${inlineCode(heading)}`,
    `- Original line hint: ${comment.anchor.lineHint.start}–${comment.anchor.lineHint.end}`,
  ];
  if (match?.candidate) {
    lines.push(
      `- Current UTF-16 source range: ${match.candidate.sourceRange.start}–${match.candidate.sourceRange.end}`,
    );
  }
  if (anchorState === "ambiguous" || anchorState === "unmatched") {
    lines.push(
      "- Action: Do not guess this target; report it as unresolved if the evidence is insufficient.",
    );
  }
  lines.push(
    "",
    "### Exact rendered target",
    "",
    fenced(comment.anchor.textQuote.exact),
  );
  if (comment.anchor.textQuote.prefix || comment.anchor.textQuote.suffix) {
    lines.push(
      "",
      "### Nearby rendered context",
      "",
      `Prefix: ${fenced(comment.anchor.textQuote.prefix)}`,
      "",
      `Suffix: ${fenced(comment.anchor.textQuote.suffix)}`,
    );
  }
  if (comment.anchor.sourceText !== comment.anchor.textQuote.exact) {
    lines.push(
      "",
      "### Raw Markdown source",
      "",
      fenced(comment.anchor.sourceText, "markdown"),
    );
  }
  lines.push("", "### Feedback", "", fenced(comment.body, "markdown"));
  return lines.join("\n");
}

export function generateReviewMarkdown(
  sidecar: SidecarV1,
  matches: ReadonlyMap<string, AnchorMatch>,
  options: ReviewExportOptions = {},
): string {
  const comments = sidecar.comments.filter(
    (comment) => options.includeResolved === true || comment.status === "open",
  );
  const customInstruction = options.instruction?.trim();
  const instruction = customInstruction?.length
    ? customInstruction
    : defaultExportInstruction;
  const sections = [
    "# Revdown review",
    "",
    `Target file: ${inlineCode(sidecar.source.filename)}`,
    "",
    `Observed SHA-256: ${inlineCode(sidecar.source.lastObservedSha256)}`,
    `Observed normalized SHA-256: ${inlineCode(sidecar.source.lastObservedNormalizedSha256)}`,
    "",
    "## Instructions for applying this review",
    "",
    instruction,
    "",
    `Exported comments: ${comments.length}`,
  ];
  if (comments.length === 0)
    sections.push(
      "",
      "There are no comments matching the selected export filter.",
    );
  comments.forEach((comment, index) => {
    sections.push("", commentSection(comment, matches.get(comment.id), index));
  });
  return `${sections.join("\n")}\n`;
}

import type { Root as MdastRoot } from "mdast";
import { visit } from "unist-util-visit";

type DisplayDelimiter = {
  kind: "open" | "close";
  offset: number;
};

function isLineWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\r";
}

function isStandaloneDelimiter(source: string, offset: number): boolean {
  let lineStart = offset;
  while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart -= 1;
  for (let index = lineStart; index < offset; index += 1) {
    if (!isLineWhitespace(source[index] ?? "")) return false;
  }

  let lineEnd = offset + 2;
  while (lineEnd < source.length && source[lineEnd] !== "\n") {
    if (!isLineWhitespace(source[lineEnd] ?? "")) return false;
    lineEnd += 1;
  }
  return true;
}

/**
 * Converts standalone LaTeX display delimiters to remark-math delimiters in a
 * same-length parsing copy. The original source and all UTF-16 offsets remain
 * unchanged. Only mdast text ranges are considered, so code and raw HTML are
 * never reinterpreted as math.
 */
export function normalizeTexDisplayMathForParsing(
  source: string,
  root: MdastRoot,
): string {
  const delimiters: DisplayDelimiter[] = [];
  visit(root, "text", (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    for (let offset = start; offset + 1 < end; offset += 1) {
      if (source[offset] !== "\\") continue;
      const bracket = source[offset + 1];
      if (
        (bracket === "[" || bracket === "]") &&
        isStandaloneDelimiter(source, offset)
      ) {
        delimiters.push({
          kind: bracket === "[" ? "open" : "close",
          offset,
        });
        offset += 1;
      }
    }
  });

  delimiters.sort((left, right) => left.offset - right.offset);
  const pairedOffsets: number[] = [];
  let openOffset: number | undefined;
  for (const delimiter of delimiters) {
    if (delimiter.kind === "open") {
      openOffset ??= delimiter.offset;
      continue;
    }
    if (openOffset === undefined) continue;
    pairedOffsets.push(openOffset, delimiter.offset);
    openOffset = undefined;
  }
  if (pairedOffsets.length === 0) return source;

  // split("") intentionally uses UTF-16 code units, matching mdast offsets.
  const parsingUnits = source.split("");
  for (const offset of pairedOffsets) {
    parsingUnits[offset] = "$";
    parsingUnits[offset + 1] = "$";
  }
  return parsingUnits.join("");
}

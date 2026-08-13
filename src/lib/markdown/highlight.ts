import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

export type HighlightToken = {
  content: string;
  color?: string;
  fontStyle?: number;
};

const languageAliases: Readonly<Record<string, string>> = {
  bash: "bash",
  css: "css",
  html: "html",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  yaml: "yaml",
  yml: "yaml",
};

let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import("@shikijs/themes/github-light")],
    langs: [
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/html"),
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/markdown"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/rust"),
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/yaml"),
    ],
  });
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  requestedLanguage?: string,
): Promise<HighlightToken[][]> {
  const language = requestedLanguage
    ? languageAliases[requestedLanguage.toLowerCase()]
    : undefined;
  if (!language) {
    return code.split("\n").map((line) => [{ content: line }]);
  }

  const highlighter = await getHighlighter();
  const result = highlighter.codeToTokens(code, {
    lang: language,
    theme: "github-light",
  });
  return result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      ...(token.color ? { color: token.color } : {}),
      ...(token.fontStyle === undefined ? {} : { fontStyle: token.fontStyle }),
    })),
  );
}

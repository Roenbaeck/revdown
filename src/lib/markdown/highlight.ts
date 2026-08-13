import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

export type HighlightToken = {
  content: string;
  color?: string;
  darkColor?: string;
  fontStyle?: number;
};

type LanguageLoader = () => Promise<unknown>;

const languageAliases: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  csharp: "csharp",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  jsx: "jsx",
  kotlin: "kotlin",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  php: "php",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const languageLoaders: Readonly<Record<string, LanguageLoader>> = {
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  lua: () => import("@shikijs/langs/lua"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  sql: () => import("@shikijs/langs/sql"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

let highlighterPromise: Promise<HighlighterCore> | undefined;
const languagePromises = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ],
    langs: [],
  });
  return highlighterPromise;
}

async function loadLanguage(language: string): Promise<HighlighterCore> {
  const highlighter = await getHighlighter();
  const loader = languageLoaders[language];
  if (!loader) return highlighter;
  let pending = languagePromises.get(language);
  if (!pending) {
    pending = loader().then(async (module) => {
      await highlighter.loadLanguage(
        module as Parameters<HighlighterCore["loadLanguage"]>[0],
      );
    });
    languagePromises.set(language, pending);
  }
  await pending;
  return highlighter;
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

  const highlighter = await loadLanguage(language);
  const lines = highlighter.codeToTokensWithThemes(code, {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
  });
  return lines.map((line) =>
    line.map((token) => {
      const light = token.variants.light;
      const dark = token.variants.dark;
      return {
        content: token.content,
        ...(light?.color ? { color: light.color } : {}),
        ...(dark?.color ? { darkColor: dark.color } : {}),
        ...(light?.fontStyle === undefined
          ? {}
          : { fontStyle: light.fontStyle }),
      };
    }),
  );
}

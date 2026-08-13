export type ThemePreference = "system" | "light" | "sepia" | "dark";
export type ResolvedTheme = "light" | "sepia" | "dark";
export type ReaderFont = "serif" | "sans";
export type ReaderSize = "small" | "medium" | "large" | "extra-large";
export type ReaderSpacing = "compact" | "comfortable" | "relaxed";
export type ReaderWidth = "narrow" | "medium" | "wide";

export type ReaderSettings = {
  theme: ThemePreference;
  font: ReaderFont;
  size: ReaderSize;
  spacing: ReaderSpacing;
  width: ReaderWidth;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "revdown.reader-settings.v1";

export const defaultReaderSettings: ReaderSettings = {
  theme: "system",
  font: "serif",
  size: "medium",
  spacing: "comfortable",
  width: "medium",
};

const values = {
  theme: new Set<ThemePreference>(["system", "light", "sepia", "dark"]),
  font: new Set<ReaderFont>(["serif", "sans"]),
  size: new Set<ReaderSize>(["small", "medium", "large", "extra-large"]),
  spacing: new Set<ReaderSpacing>(["compact", "comfortable", "relaxed"]),
  width: new Set<ReaderWidth>(["narrow", "medium", "wide"]),
};

function setting<K extends keyof ReaderSettings>(
  source: Record<string, unknown>,
  key: K,
): ReaderSettings[K] {
  const candidate = source[key];
  return typeof candidate === "string" && values[key].has(candidate as never)
    ? (candidate as ReaderSettings[K])
    : defaultReaderSettings[key];
}

export function loadReaderSettings(storage: StorageLike): ReaderSettings {
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (!serialized) return defaultReaderSettings;
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultReaderSettings;
    const source = parsed as Record<string, unknown>;
    return {
      theme: setting(source, "theme"),
      font: setting(source, "font"),
      size: setting(source, "size"),
      spacing: setting(source, "spacing"),
      width: setting(source, "width"),
    };
  } catch {
    return defaultReaderSettings;
  }
}

export function saveReaderSettings(
  storage: StorageLike,
  settings: ReaderSettings,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Reader preferences are optional; storage failures must not block review.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function themeWindowAppearance(theme: ResolvedTheme): {
  theme: "light" | "dark";
  backgroundColor: string;
} {
  if (theme === "dark") {
    return { theme: "dark", backgroundColor: "#17201f" };
  }
  if (theme === "sepia") {
    return { theme: "light", backgroundColor: "#e9dfca" };
  }
  return { theme: "light", backgroundColor: "#f3f0e9" };
}

export function applyReaderSettings(
  root: HTMLElement,
  settings: ReaderSettings,
  theme: ResolvedTheme,
): void {
  root.dataset.theme = theme;
  root.dataset.themePreference = settings.theme;
  root.dataset.readerFont = settings.font;
  root.dataset.readerSize = settings.size;
  root.dataset.readerSpacing = settings.spacing;
  root.dataset.readerWidth = settings.width;
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

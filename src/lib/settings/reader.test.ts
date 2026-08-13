import {
  applyReaderSettings,
  defaultReaderSettings,
  loadReaderSettings,
  resolveTheme,
  saveReaderSettings,
  themeWindowAppearance,
} from "./reader";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
}

describe("reader settings", () => {
  it("round-trips supported preferences and rejects invalid values", () => {
    const storage = memoryStorage();
    const settings = {
      theme: "sepia" as const,
      font: "sans" as const,
      size: "large" as const,
      spacing: "relaxed" as const,
      width: "wide" as const,
    };
    saveReaderSettings(storage, settings);
    expect(loadReaderSettings(storage)).toEqual(settings);
    expect(
      loadReaderSettings(
        memoryStorage('{"theme":"neon","font":false,"size":"large"}'),
      ),
    ).toEqual({ ...defaultReaderSettings, size: "large" });
  });

  it("resolves system themes and applies stable data attributes", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("sepia", true)).toBe("sepia");
    expect(themeWindowAppearance("dark")).toEqual({
      theme: "dark",
      backgroundColor: "#17201f",
    });
    applyReaderSettings(
      document.documentElement,
      defaultReaderSettings,
      "light",
    );
    expect(document.documentElement.dataset.readerFont).toBe("serif");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

import { loadReadingPosition, saveReadingPosition } from "./readingPosition";

describe("reading positions", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips and clamps document-specific scroll progress", () => {
    saveReadingPosition(window.localStorage, "document-a", 0.42, 1);
    saveReadingPosition(window.localStorage, "document-b", 2, 2);

    expect(loadReadingPosition(window.localStorage, "document-a")).toBe(0.42);
    expect(loadReadingPosition(window.localStorage, "document-b")).toBe(1);
    expect(loadReadingPosition(window.localStorage, "missing")).toBe(0);
  });

  it("ignores malformed persisted data", () => {
    window.localStorage.setItem(
      "revdown.reading-positions.v1",
      JSON.stringify({
        invalid: { position: "half", updatedAt: 1 },
        valid: { position: 0.75, updatedAt: 2 },
      }),
    );

    expect(loadReadingPosition(window.localStorage, "invalid")).toBe(0);
    expect(loadReadingPosition(window.localStorage, "valid")).toBe(0.75);
  });

  it("bounds the retained history", () => {
    for (let index = 0; index < 30; index += 1) {
      saveReadingPosition(
        window.localStorage,
        `document-${index}`,
        index / 30,
        index,
      );
    }

    expect(loadReadingPosition(window.localStorage, "document-5")).toBe(0);
    expect(loadReadingPosition(window.localStorage, "document-29")).toBe(
      29 / 30,
    );
  });
});

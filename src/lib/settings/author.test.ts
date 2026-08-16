import {
  DEFAULT_AUTHOR_NAME,
  loadAuthorProfile,
  saveAuthorProfile,
} from "./author";

const AUTHOR_ID = "8d79a898-a0cc-4f9d-9f12-6397cd52bbca";

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

describe("author profile settings", () => {
  it("creates and persists a stable local human identity", () => {
    const storage = memoryStorage();
    const created = loadAuthorProfile(storage, () => AUTHOR_ID);
    expect(created).toEqual({
      id: AUTHOR_ID,
      displayName: DEFAULT_AUTHOR_NAME,
      kind: "human",
    });

    const renamed = { ...created, displayName: "Alice" };
    saveAuthorProfile(storage, renamed);
    expect(loadAuthorProfile(storage, vi.fn())).toEqual(renamed);
  });

  it("replaces malformed or agent identities instead of trusting them", () => {
    expect(
      loadAuthorProfile(
        memoryStorage(
          JSON.stringify({
            id: AUTHOR_ID,
            displayName: "Claude Code",
            kind: "agent",
          }),
        ),
        () => AUTHOR_ID,
      ),
    ).toEqual({
      id: AUTHOR_ID,
      displayName: DEFAULT_AUTHOR_NAME,
      kind: "human",
    });
  });
});

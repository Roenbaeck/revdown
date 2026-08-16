import { createEmptySidecar } from "../schema/sidecar";
import { authorIndex, commentAuthor, upsertAuthor } from "./model";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ALICE_ID = "8d79a898-a0cc-4f9d-9f12-6397cd52bbca";

describe("comment authors", () => {
  it("registers and updates a stable profile without duplicating it", () => {
    const sidecar = createEmptySidecar({
      filename: "draft.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-16T10:00:00.000Z",
    });
    const registered = upsertAuthor(
      sidecar,
      { id: ALICE_ID, displayName: "Alice", kind: "human" },
      "2026-08-16T10:01:00.000Z",
    );
    const renamed = upsertAuthor(
      registered,
      { id: ALICE_ID, displayName: "Alice Smith", kind: "human" },
      "2026-08-16T10:02:00.000Z",
    );

    expect(renamed.authors).toEqual([
      { id: ALICE_ID, displayName: "Alice Smith", kind: "human" },
    ]);
    expect(renamed.updatedAt).toBe("2026-08-16T10:02:00.000Z");
  });

  it("does not guess the author of an unattributed or dangling comment", () => {
    const authors = authorIndex([
      { id: ALICE_ID, displayName: "Alice", kind: "human" },
    ]);
    const base = {
      id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
      status: "open" as const,
      body: "Clarify this.",
      createdAt: "2026-08-16T10:00:00.000Z",
      updatedAt: "2026-08-16T10:00:00.000Z",
      anchor: {
        documentSha256: HASH_A,
        documentNormalizedSha256: HASH_B,
        sourceRange: { start: 0, end: 6 },
        sourceText: "target",
        textQuote: { exact: "target", prefix: "", suffix: "" },
        block: { start: 0, end: 6, sourceSha256: HASH_A },
        headingPath: [],
        lineHint: { start: 1, end: 1 },
      },
    };

    expect(commentAuthor(base, authors).displayName).toBe("Unknown");
    expect(
      commentAuthor(
        {
          ...base,
          authorId: "1b970d64-0e9a-4694-bf88-ed3d28fdc68d",
        },
        authors,
      ).displayName,
    ).toBe("Unknown");
  });
});

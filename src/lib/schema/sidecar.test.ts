import {
  createEmptySidecar,
  parseSidecarJson,
  serializeSidecar,
} from "./sidecar";
import { createReviewComment } from "../comments/model";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("sidecar schema", () => {
  it("serializes deterministically with a trailing newline", () => {
    const sidecar = createEmptySidecar({
      filename: "document.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const serialized = serializeSidecar(sidecar);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(parseSidecarJson(serialized)).toEqual({ kind: "valid", sidecar });
  });

  it("preserves unknown properties in a supported schema", () => {
    const sidecar = createEmptySidecar({
      filename: "document.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const parsed = parseSidecarJson(
      JSON.stringify({ ...sidecar, futureMetadata: { value: 3 } }),
    );
    expect(parsed.kind).toBe("valid");
    if (parsed.kind === "valid") {
      expect(parsed.sidecar.futureMetadata).toEqual({ value: 3 });
    }
  });

  it("keeps legacy sidecars valid and round-trips author profiles", () => {
    const current = createEmptySidecar({
      filename: "document.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const legacy = { ...current };
    delete legacy.authors;
    const legacyResult = parseSidecarJson(JSON.stringify(legacy));
    expect(legacyResult.kind).toBe("valid");
    if (legacyResult.kind === "valid") {
      expect(legacyResult.sidecar.authors).toBeUndefined();
    }

    const attributed = {
      ...current,
      authors: [
        {
          id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
          displayName: "Alice",
          kind: "human" as const,
        },
      ],
      comments: [
        createReviewComment({
          id: "5a5ea9e9-7983-48e7-9377-fac74a69f061",
          authorId: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
          body: "Clarify this.",
          now: "2026-08-13T10:01:00.000Z",
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
        }),
      ],
    };
    expect(parseSidecarJson(serializeSidecar(attributed))).toEqual({
      kind: "valid",
      sidecar: attributed,
    });
  });

  it("rejects duplicate author profile IDs", () => {
    const sidecar = createEmptySidecar({
      filename: "document.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const author = {
      id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
      displayName: "Alice",
      kind: "human",
    };
    expect(
      parseSidecarJson(
        JSON.stringify({ ...sidecar, authors: [author, author] }),
      ).kind,
    ).toBe("invalid");
  });

  it("keeps unsupported versions read-only", () => {
    expect(parseSidecarJson('{"schemaVersion":2}')).toEqual({
      kind: "unsupported",
      schemaVersion: 2,
    });
  });

  it("rejects source paths and malformed input", () => {
    const sidecar = createEmptySidecar({
      filename: "document.md",
      sha256: HASH_A,
      normalizedSha256: HASH_B,
      now: "2026-08-13T10:00:00.000Z",
    });
    const parsed = parseSidecarJson(
      JSON.stringify({
        ...sidecar,
        source: { ...sidecar.source, filename: "/private/document.md" },
      }),
    );
    expect(parsed.kind).toBe("invalid");
    expect(parseSidecarJson("not json").kind).toBe("invalid");
  });
});

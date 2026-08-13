import {
  createEmptySidecar,
  parseSidecarJson,
  serializeSidecar,
} from "./sidecar";

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

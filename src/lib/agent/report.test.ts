import { parseMcpReportBatch } from "./report";

const validBatch = {
  sourceSha256: "a".repeat(64),
  sidecarRevision: "b".repeat(64),
  results: [
    {
      commentId: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
      commentUpdatedAt: "2026-08-15T10:00:00.000Z",
      outcome: "applied",
      note: "Updated the paragraph.",
    },
  ],
};

describe("MCP agent result reports", () => {
  it("accepts a bounded, revision-specific result batch", () => {
    expect(parseMcpReportBatch(validBatch)).toEqual(validBatch);
  });

  it("rejects unknown outcomes and unexpected properties", () => {
    expect(
      parseMcpReportBatch({
        ...validBatch,
        results: [{ ...validBatch.results[0], outcome: "resolved" }],
      }),
    ).toBeNull();
    expect(
      parseMcpReportBatch({ ...validBatch, sourcePath: "/private.md" }),
    ).toBeNull();
  });
});

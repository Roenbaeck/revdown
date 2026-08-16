import type { AppState } from "./state";
import { appReducer, initialState, reviewMutationsAllowed } from "./state";

const documentB = {
  sessionId: "B",
  documentId: "document-B",
  filename: "b.md",
  content: "B",
  revision: {
    sha256: "b".repeat(64),
    normalizedSha256: "b".repeat(64),
    size: 1,
    modifiedMs: 0,
  },
};

describe("app reducer document sessions", () => {
  it("ignores save results from a document that is no longer active", () => {
    const state: AppState = {
      ...initialState,
      phase: "ready",
      document: documentB,
      sidecarRevision: "revision-B",
      saveStatus: "idle",
    };

    expect(
      appReducer(state, {
        type: "save_succeeded",
        sessionId: "A",
        revision: "revision-A",
      }),
    ).toBe(state);
    expect(
      appReducer(state, {
        type: "save_failed",
        sessionId: "A",
        status: "conflict",
        message: "A conflict",
      }),
    ).toBe(state);
    expect(appReducer(state, { type: "save_started", sessionId: "A" })).toBe(
      state,
    );
  });

  it("uses source drift as part of the shared mutation guard", () => {
    expect(
      reviewMutationsAllowed({ sidecarIssue: null, sourceChanged: false }),
    ).toBe(true);
    expect(
      reviewMutationsAllowed({ sidecarIssue: null, sourceChanged: true }),
    ).toBe(false);
    expect(
      reviewMutationsAllowed({
        sidecarIssue: "Unsupported sidecar",
        sourceChanged: false,
      }),
    ).toBe(false);
  });
});

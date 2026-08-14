import { SidecarSaveCoordinator } from "./saveQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("sidecar save coordinator", () => {
  it("keeps revisions and completions scoped to their document session", async () => {
    const coordinator = new SidecarSaveCoordinator();
    const delayedA = deferred<{ revision: string }>();
    const expectedRevisions: [string, string | null][] = [];
    const events: string[] = [];
    const save = (
      sessionId: string,
      _contents: string,
      expectedRevision: string | null,
    ) => {
      expectedRevisions.push([sessionId, expectedRevision]);
      return sessionId === "A"
        ? delayedA.promise
        : Promise.resolve({ revision: "revision-B-1" });
    };
    const callbacks = {
      onStarted: (sessionId: string) => events.push(`started:${sessionId}`),
      onSucceeded: (sessionId: string, revision: string) =>
        events.push(`saved:${sessionId}:${revision}`),
      onFailed: (sessionId: string) => events.push(`failed:${sessionId}`),
    };

    const pendingA = coordinator.enqueue({
      sessionId: "A",
      contents: "A1",
      initialRevision: "revision-A-0",
      save,
      ...callbacks,
    });
    await Promise.resolve();
    coordinator.setRevision("A", "stale-reload-revision");
    const pendingB = coordinator.enqueue({
      sessionId: "B",
      contents: "B1",
      initialRevision: "revision-B-0",
      save,
      ...callbacks,
    });
    await pendingB;

    expect(expectedRevisions).toEqual([
      ["A", "revision-A-0"],
      ["B", "revision-B-0"],
    ]);
    expect(events).toContain("saved:B:revision-B-1");

    delayedA.resolve({ revision: "revision-A-1" });
    await pendingA;
    expect(events.at(-1)).toBe("saved:A:revision-A-1");

    await coordinator.enqueue({
      sessionId: "A",
      contents: "A2",
      initialRevision: "wrong-revision",
      save: (sessionId, _contents, expectedRevision) => {
        expectedRevisions.push([sessionId, expectedRevision]);
        return Promise.resolve({ revision: "revision-A-2" });
      },
      ...callbacks,
    });
    expect(expectedRevisions.at(-1)).toEqual(["A", "revision-A-1"]);

    await coordinator.enqueue({
      sessionId: "B",
      contents: "B2",
      initialRevision: "wrong-revision",
      save,
      ...callbacks,
    });
    expect(expectedRevisions.at(-1)).toEqual(["B", "revision-B-1"]);
  });
});

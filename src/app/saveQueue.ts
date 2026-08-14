import type { SaveResult } from "../services/native";

type SessionSaveState = {
  revision: string | null;
  queue: Promise<void>;
  pending: number;
};

export type EnqueueSidecarSave = {
  sessionId: string;
  contents: string;
  initialRevision: string | null;
  save: (
    sessionId: string,
    contents: string,
    expectedRevision: string | null,
  ) => Promise<SaveResult>;
  onStarted: (sessionId: string) => void;
  onSucceeded: (sessionId: string, revision: string) => void;
  onFailed: (sessionId: string, error: unknown) => void;
};

export class SidecarSaveCoordinator {
  private readonly sessions = new Map<string, SessionSaveState>();

  setRevision(sessionId: string, revision: string | null): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.pending === 0) session.revision = revision;
    } else {
      this.sessions.set(sessionId, {
        revision,
        queue: Promise.resolve(),
        pending: 0,
      });
    }
  }

  enqueue(operation: EnqueueSidecarSave): Promise<void> {
    let session = this.sessions.get(operation.sessionId);
    if (!session) {
      session = {
        revision: operation.initialRevision,
        queue: Promise.resolve(),
        pending: 0,
      };
      this.sessions.set(operation.sessionId, session);
    }
    session.pending += 1;
    session.queue = session.queue.then(async () => {
      operation.onStarted(operation.sessionId);
      try {
        const result = await operation.save(
          operation.sessionId,
          operation.contents,
          session.revision,
        );
        session.revision = result.revision;
        operation.onSucceeded(operation.sessionId, result.revision);
      } catch (error) {
        operation.onFailed(operation.sessionId, error);
      } finally {
        session.pending -= 1;
      }
    });
    return session.queue;
  }
}

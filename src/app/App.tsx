import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { BrandGlyph } from "../components/BrandGlyph";
import { DocumentMinimap } from "../components/DocumentMinimap";
import { DocumentOutline } from "../components/DocumentOutline";
import { DocumentSurface } from "../components/DocumentSurface";
import { ReviewPanel } from "../components/ReviewPanel";
import { SelectionComposer } from "../components/SelectionComposer";
import { Toolbar } from "../components/Toolbar";
import {
  confirmAnchorCandidate,
  matchAllAnchors,
  type AnchorCandidate,
} from "../lib/anchors/match";
import {
  addComment,
  createReviewComment,
  deleteComment,
  updateComment,
} from "../lib/comments/model";
import { fingerprintText } from "../lib/fingerprints";
import { generateReviewMarkdown } from "../lib/export/review";
import { parseMarkdownDocument } from "../lib/markdown/model";
import {
  createAnchor,
  mapDomSelection,
  type MappedSelection,
} from "../lib/markdown/selection";
import {
  createEmptySidecar,
  parseSidecarJson,
  serializeSidecar,
  sidecarV1Schema,
  type ReviewComment,
  type SidecarV1,
} from "../lib/schema/sidecar";
import {
  getNativeService,
  NativeServiceError,
  type NativeService,
  type OpenedDocument,
} from "../services/native";
import { appReducer, initialState, type CommentFilter } from "./state";

type PendingSelection = {
  mapped: MappedSelection;
  position: { left: number; top: number };
  invalidated: boolean;
};

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [native, setNative] = useState<NativeService | null>(null);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const documentRegionRef = useRef<HTMLElement>(null);
  const sidecarRevisionRef = useRef<string | null>(null);
  const sidecarRef = useRef<SidecarV1 | null>(null);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    void getNativeService().then(setNative);
  }, []);
  useEffect(() => {
    sidecarRevisionRef.current = state.sidecarRevision;
    sidecarRef.current = state.sidecar;
  }, [state.sidecar, state.sidecarRevision]);

  const loadOpenedDocument = useCallback(
    async (
      opened: OpenedDocument,
      options?: {
        sidecar?: SidecarV1 | null;
        sidecarRevision?: string | null;
        issue?: string | null;
      },
    ) => {
      if (!native) return;
      const fingerprint = await fingerprintText(opened.content);
      if (fingerprint.sha256 !== opened.revision.sha256) {
        throw new Error(
          "The native and frontend source fingerprints did not agree.",
        );
      }
      const model = await parseMarkdownDocument(opened.content, fingerprint);
      let sidecar = options?.sidecar;
      let sidecarRevision = options?.sidecarRevision;
      let issue = options?.issue ?? null;
      if (sidecar === undefined) {
        const loaded = await native.loadSidecar(opened.sessionId);
        sidecarRevision = loaded.revision;
        if (loaded.contents === null) {
          sidecar = createEmptySidecar({
            filename: opened.filename,
            sha256: fingerprint.sha256,
            normalizedSha256: fingerprint.normalizedSha256,
          });
        } else {
          const parsed = parseSidecarJson(loaded.contents);
          if (
            parsed.kind === "valid" &&
            parsed.sidecar.source.filename === opened.filename
          ) {
            sidecar = parsed.sidecar;
          } else if (parsed.kind === "unsupported") {
            sidecar = null;
            issue = `Sidecar schema version ${parsed.schemaVersion} is unsupported and will not be overwritten.`;
          } else {
            sidecar = null;
            issue =
              parsed.kind === "invalid"
                ? parsed.message
                : "The sidecar belongs to a different source filename and will not be overwritten.";
          }
        }
      }
      const matches = sidecar
        ? matchAllAnchors(
            sidecar.comments.map(({ id, anchor }) => ({ id, anchor })),
            model,
          )
        : new Map();
      dispatch({
        type: "loaded",
        document: opened,
        model,
        sidecar: sidecar ?? null,
        sidecarRevision: sidecarRevision ?? null,
        sidecarIssue: issue,
        matches,
      });
    },
    [native],
  );

  const openDocument = useCallback(async () => {
    if (!native) return;
    dispatch({ type: "loading" });
    try {
      const opened = await native.openDocument();
      if (!opened) {
        dispatch({
          type: "loading_cancelled",
          phase: state.document ? "ready" : "empty",
        });
        return;
      }
      await loadOpenedDocument(opened);
      setPendingSelection(null);
    } catch (error) {
      dispatch({ type: "failed", message: describeError(error) });
    }
  }, [loadOpenedDocument, native, state.document]);

  const persistSidecar = useCallback(
    (candidate: SidecarV1) => {
      if (!native || !state.document || !state.model) return;
      const currentDocument = state.document;
      const currentModel = state.model;
      const sidecar = sidecarV1Schema.parse({
        ...candidate,
        source: {
          ...candidate.source,
          lastObservedSha256: currentModel.fingerprint.sha256,
          lastObservedNormalizedSha256:
            currentModel.fingerprint.normalizedSha256,
        },
      });
      sidecarRef.current = sidecar;
      dispatch({
        type: "local_sidecar",
        sidecar,
        matches: matchAllAnchors(
          sidecar.comments.map(({ id, anchor }) => ({ id, anchor })),
          currentModel,
        ),
      });
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        dispatch({ type: "save_started" });
        try {
          const result = await native.saveSidecar(
            currentDocument.sessionId,
            serializeSidecar(sidecar),
            sidecarRevisionRef.current,
          );
          sidecarRevisionRef.current = result.revision;
          dispatch({ type: "save_succeeded", revision: result.revision });
        } catch (error) {
          const conflict =
            error instanceof NativeServiceError &&
            error.code === "sidecar_conflict";
          dispatch({
            type: "save_failed",
            status: conflict ? "conflict" : "error",
            message: conflict
              ? "The sidecar changed outside Revdown. Reload it or explicitly overwrite the external version."
              : describeError(error),
          });
        }
      });
    },
    [native, state.document, state.model],
  );

  const captureSelection = useCallback(() => {
    if (!state.model || state.sidecarIssue) return;
    const surface = window.document.getElementById("document-surface");
    if (!(surface instanceof HTMLElement)) return;
    const result = mapDomSelection(window.getSelection(), surface, state.model);
    if (result.kind === "unsupported") {
      if (!window.getSelection()?.isCollapsed)
        dispatch({ type: "set_message", message: result.message });
      return;
    }
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setPendingSelection({
      mapped: result.selection,
      position: {
        left: Math.min(
          window.innerWidth - 380,
          Math.max(16, rect.left || window.innerWidth / 2 - 180),
        ),
        top: Math.min(
          window.innerHeight - 280,
          Math.max(76, (rect.bottom || 76) + 10),
        ),
      },
      invalidated: false,
    });
    dispatch({ type: "set_message", message: null });
  }, [state.model, state.sidecarIssue]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        captureSelection();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [captureSelection]);

  useEffect(() => {
    if (!native || !state.document || state.phase !== "ready") return;
    let active = true;
    const check = async () => {
      try {
        const revision = await native.pollSource(state.document!.sessionId);
        if (active && revision.sha256 !== state.document!.revision.sha256) {
          dispatch({ type: "source_changed", value: true });
        }
      } catch {
        // A transient polling failure is surfaced only if a user-initiated reload also fails.
      }
    };
    const interval = window.setInterval(() => void check(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [native, state.document, state.phase]);

  const reloadSource = useCallback(async () => {
    if (!native || !state.document) return;
    try {
      const opened = await native.reloadSource(state.document.sessionId);
      await loadOpenedDocument(opened, {
        sidecar: state.sidecar,
        sidecarRevision: state.sidecarRevision,
        issue: state.sidecarIssue,
      });
      setPendingSelection((pending) =>
        pending ? { ...pending, invalidated: true } : null,
      );
    } catch (error) {
      dispatch({ type: "set_message", message: describeError(error) });
    }
  }, [
    loadOpenedDocument,
    native,
    state.document,
    state.sidecar,
    state.sidecarIssue,
    state.sidecarRevision,
  ]);

  const reloadSidecar = useCallback(async () => {
    if (!native || !state.document) return;
    try {
      const loaded = await native.loadSidecar(state.document.sessionId);
      if (!loaded.contents)
        throw new Error("The external sidecar no longer exists.");
      const parsed = parseSidecarJson(loaded.contents);
      if (parsed.kind !== "valid")
        throw new Error("The external sidecar cannot be loaded safely.");
      await loadOpenedDocument(state.document, {
        sidecar: parsed.sidecar,
        sidecarRevision: loaded.revision,
        issue: null,
      });
    } catch (error) {
      dispatch({ type: "set_message", message: describeError(error) });
    }
  }, [loadOpenedDocument, native, state.document]);

  const overwriteConflict = useCallback(async () => {
    if (!native || !state.document || !sidecarRef.current) return;
    try {
      const external = await native.loadSidecar(state.document.sessionId);
      sidecarRevisionRef.current = external.revision;
      const result = await native.saveSidecar(
        state.document.sessionId,
        serializeSidecar(sidecarRef.current),
        external.revision,
      );
      sidecarRevisionRef.current = result.revision;
      dispatch({ type: "save_succeeded", revision: result.revision });
    } catch (error) {
      dispatch({
        type: "save_failed",
        status: "error",
        message: describeError(error),
      });
    }
  }, [native, state.document]);

  const saveNewComment = (body: string) => {
    if (!state.sidecar || !state.model || !pendingSelection) return;
    const anchor = createAnchor(state.model, pendingSelection.mapped);
    persistSidecar(
      addComment(state.sidecar, createReviewComment({ body, anchor })),
    );
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const mutateComment = (mutation: (sidecar: SidecarV1) => SidecarV1) => {
    if (state.sidecar && !state.sidecarIssue)
      persistSidecar(mutation(state.sidecar));
  };

  const exportText = useMemo(
    () =>
      state.sidecar
        ? generateReviewMarkdown(state.sidecar, state.matches, {
            includeResolved: state.includeResolvedExport,
          })
        : "",
    [state.includeResolvedExport, state.matches, state.sidecar],
  );

  const copyReview = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      dispatch({
        type: "set_message",
        message: "Review copied to the clipboard.",
      });
    } catch {
      dispatch({
        type: "set_message",
        message: "Clipboard access was unavailable.",
      });
    }
  };

  const exportReview = async () => {
    if (!native || !state.document || !exportText) return;
    try {
      const result = await native.exportReview(
        state.document.sessionId,
        `${state.document.filename}.rd.md`,
        exportText,
      );
      if (result.saved)
        dispatch({ type: "set_message", message: "Review exported." });
    } catch (error) {
      dispatch({ type: "set_message", message: describeError(error) });
    }
  };

  const comments = state.sidecar?.comments ?? [];
  const ready =
    state.phase === "ready" && state.model && state.document && native;

  return (
    <div className="appShell">
      <Toolbar
        filename={state.document?.filename}
        filter={state.filter}
        panelOpen={state.panelOpen}
        includeResolved={state.includeResolvedExport}
        saveStatus={state.saveStatus}
        canComment={Boolean(ready && state.sidecar && !state.sidecarIssue)}
        canExport={Boolean(ready && state.sidecar)}
        canNavigate={Boolean(ready)}
        outlineOpen={outlineOpen}
        minimapOpen={minimapOpen}
        onOpen={() => void openDocument()}
        onComment={captureSelection}
        onTogglePanel={() => dispatch({ type: "toggle_panel" })}
        onToggleOutline={() => setOutlineOpen((open) => !open)}
        onToggleMinimap={() => setMinimapOpen((open) => !open)}
        onFilter={(filter: CommentFilter) =>
          dispatch({ type: "set_filter", filter })
        }
        onIncludeResolved={(value) =>
          dispatch({ type: "set_export_resolved", value })
        }
        onExport={() => void exportReview()}
        onCopy={() => void copyReview()}
      />

      {state.sourceChanged && (
        <div className="banner warningBanner" role="status">
          <span>
            The source changed outside Revdown. Reload to re-evaluate anchors;
            Revdown will not write to it.
          </span>
          <button type="button" onClick={() => void reloadSource()}>
            Reload source
          </button>
        </div>
      )}
      {state.message && (
        <div
          className={`banner ${state.saveStatus === "conflict" ? "warningBanner" : "infoBanner"}`}
          role="status"
        >
          <span>{state.message}</span>
          {state.saveStatus === "conflict" && (
            <>
              <button type="button" onClick={() => void reloadSidecar()}>
                Reload sidecar
              </button>
              <button type="button" onClick={() => void overwriteConflict()}>
                Overwrite external version
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => dispatch({ type: "set_message", message: null })}
          >
            Dismiss
          </button>
        </div>
      )}

      <main className={`workspace ${state.panelOpen ? "withPanel" : ""}`}>
        {outlineOpen && ready && (
          <DocumentOutline
            model={state.model!}
            scrollContainerRef={documentRegionRef}
            onClose={() => setOutlineOpen(false)}
          />
        )}
        <section
          ref={documentRegionRef}
          className="documentRegion"
          aria-busy={state.phase === "loading"}
        >
          {state.phase === "empty" && (
            <div className="emptyState">
              <span className="emptyMark" aria-hidden="true">
                <BrandGlyph />
              </span>
              <p className="eyebrow">Local-first Markdown review</p>
              <h1>Feedback without fingerprints on the source.</h1>
              <p>
                Open a Markdown file, comment on rendered selections, and export
                a precise review—while the original stays byte-for-byte
                untouched.
              </p>
              <button
                className="primaryButton largeButton"
                type="button"
                disabled={!native}
                onClick={() => void openDocument()}
              >
                Open your first document
              </button>
            </div>
          )}
          {state.phase === "loading" && (
            <div className="loadingState">Reading and mapping Markdown…</div>
          )}
          {state.phase === "error" && (
            <div className="emptyState">
              <h1>Revdown could not open that document.</h1>
              <p>{state.message}</p>
              <button
                className="primaryButton"
                type="button"
                onClick={() => void openDocument()}
              >
                Choose another file
              </button>
            </div>
          )}
          {ready && (
            <DocumentSurface
              model={state.model!}
              comments={comments}
              matches={state.matches}
              selectedCommentId={state.selectedCommentId}
              native={native}
              sessionId={state.document!.sessionId}
              onSelection={captureSelection}
              onSelectComment={(id) => dispatch({ type: "select_comment", id })}
              onMessage={(message) =>
                dispatch({ type: "set_message", message })
              }
            />
          )}
        </section>
        {state.panelOpen && ready && (
          <ReviewPanel
            comments={comments}
            matches={state.matches}
            filter={state.filter}
            selectedId={state.selectedCommentId}
            readOnly={Boolean(state.sidecarIssue)}
            onSelect={(id) => dispatch({ type: "select_comment", id })}
            onEdit={(id, body) =>
              mutateComment((sidecar) => updateComment(sidecar, id, { body }))
            }
            onToggleResolved={(comment) =>
              mutateComment((sidecar) =>
                updateComment(sidecar, comment.id, {
                  status: comment.status === "open" ? "resolved" : "open",
                }),
              )
            }
            onDelete={(id) =>
              mutateComment((sidecar) => deleteComment(sidecar, id))
            }
            onConfirmCandidate={(
              comment: ReviewComment,
              candidate: AnchorCandidate,
            ) => {
              if (!state.model) return;
              const anchor = confirmAnchorCandidate(
                comment.anchor,
                candidate,
                state.model,
              );
              mutateComment((sidecar) =>
                updateComment(sidecar, comment.id, { anchor }),
              );
            }}
            onOpenExternal={(url) =>
              void native.openExternal(url).catch(() => {
                dispatch({
                  type: "set_message",
                  message: "Revdown blocked or could not open that link.",
                });
              })
            }
          />
        )}
        {minimapOpen && ready && (
          <DocumentMinimap
            model={state.model!}
            comments={comments}
            matches={state.matches}
            selectedCommentId={state.selectedCommentId}
            scrollContainerRef={documentRegionRef}
            onClose={() => setMinimapOpen(false)}
          />
        )}
      </main>

      {pendingSelection && (
        <SelectionComposer
          mapped={pendingSelection.mapped}
          position={pendingSelection.position}
          invalidated={pendingSelection.invalidated}
          onCancel={() => setPendingSelection(null)}
          onSave={saveNewComment}
        />
      )}
    </div>
  );
}

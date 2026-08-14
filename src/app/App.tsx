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
import { ExportInstructionsDialog } from "../components/ExportInstructionsDialog";
import { ReviewPanel } from "../components/ReviewPanel";
import { ReaderSettingsPanel } from "../components/ReaderSettingsPanel";
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
  loadExportInstruction,
  saveExportInstruction,
} from "../lib/settings/export";
import {
  applyReaderSettings,
  loadReaderSettings,
  resolveTheme,
  saveReaderSettings,
  themeWindowAppearance,
  type ReaderSettings,
} from "../lib/settings/reader";
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
import {
  appReducer,
  initialState,
  reviewMutationsAllowed,
  type CommentFilter,
} from "./state";
import { SidecarSaveCoordinator } from "./saveQueue";

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
  const mutationsAllowed = reviewMutationsAllowed(state);
  const activeSessionId = state.document?.sessionId;
  const [native, setNative] = useState<NativeService | null>(null);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [exportInstructionsOpen, setExportInstructionsOpen] = useState(false);
  const [exportInstruction, setExportInstruction] = useState(() =>
    loadExportInstruction(window.localStorage),
  );
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(() =>
    loadReaderSettings(window.localStorage),
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const documentRegionRef = useRef<HTMLElement>(null);
  const saveCoordinatorRef = useRef(new SidecarSaveCoordinator());
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const toggleWindowFullscreen = useCallback(() => {
    if (!native) return;
    void native.setWindowFullscreen(!windowFullscreen).catch(() => undefined);
  }, [native, windowFullscreen]);

  useEffect(() => {
    void getNativeService().then(setNative);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    if (native) {
      void native
        .observeWindowFullscreen((fullscreen) => {
          if (!cancelled) setWindowFullscreen(fullscreen);
        })
        .then((stop) => {
          if (cancelled) stop();
          else unsubscribe = stop;
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [native]);
  useEffect(() => {
    document.documentElement.dataset.windowFullscreen =
      String(windowFullscreen);
  }, [windowFullscreen]);
  useEffect(() => {
    const toggleWithKeyboard = (event: KeyboardEvent) => {
      const macShortcut = event.metaKey && event.ctrlKey && event.key === "f";
      if (macShortcut || (windowFullscreen && event.key === "Escape")) {
        event.preventDefault();
        toggleWindowFullscreen();
      }
    };
    window.addEventListener("keydown", toggleWithKeyboard, true);
    return () =>
      window.removeEventListener("keydown", toggleWithKeyboard, true);
  }, [toggleWindowFullscreen, windowFullscreen]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);
  useEffect(() => {
    const theme = resolveTheme(readerSettings.theme, systemDark);
    applyReaderSettings(document.documentElement, readerSettings, theme);
    saveReaderSettings(window.localStorage, readerSettings);
    if (native) {
      void native
        .setWindowAppearance(themeWindowAppearance(theme))
        .catch(() => undefined);
    }
  }, [native, readerSettings, systemDark]);
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
      saveCoordinatorRef.current.setRevision(
        opened.sessionId,
        sidecarRevision ?? null,
      );
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

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let openQueue = Promise.resolve();

    const consumeOpenRequest = () => {
      openQueue = openQueue
        .then(async () => {
          while (!cancelled) {
            const opened = await native.takePendingDocument();
            if (!opened || cancelled) return;
            dispatch({ type: "loading" });
            await loadOpenedDocument(opened);
            setPendingSelection(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            dispatch({ type: "failed", message: describeError(error) });
        });
    };

    const start = async () => {
      try {
        const stop = await native.observeOpenRequests(consumeOpenRequest);
        if (cancelled) {
          stop();
          return;
        }
        unsubscribe = stop;
      } catch {
        // The initial queued request can still be consumed without events.
      }
      if (!cancelled) consumeOpenRequest();
    };
    void start();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [loadOpenedDocument, native]);

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
      if (!native || !state.document || !state.model || !mutationsAllowed)
        return;
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
      dispatch({
        type: "local_sidecar",
        sessionId: currentDocument.sessionId,
        sidecar,
        matches: matchAllAnchors(
          sidecar.comments.map(({ id, anchor }) => ({ id, anchor })),
          currentModel,
        ),
      });
      void saveCoordinatorRef.current.enqueue({
        sessionId: currentDocument.sessionId,
        contents: serializeSidecar(sidecar),
        initialRevision: state.sidecarRevision,
        save: (sessionId, contents, expectedRevision) =>
          native.saveSidecar(sessionId, contents, expectedRevision),
        onStarted: (sessionId) => dispatch({ type: "save_started", sessionId }),
        onSucceeded: (sessionId, revision) =>
          dispatch({ type: "save_succeeded", sessionId, revision }),
        onFailed: (sessionId, error) => {
          const conflict =
            error instanceof NativeServiceError &&
            error.code === "sidecar_conflict";
          dispatch({
            type: "save_failed",
            sessionId,
            status: conflict ? "conflict" : "error",
            message: conflict
              ? "The sidecar changed outside Revdown. Reload it or explicitly overwrite the external version."
              : describeError(error),
          });
        },
      });
    },
    [
      mutationsAllowed,
      native,
      state.document,
      state.model,
      state.sidecarRevision,
    ],
  );

  const captureSelection = useCallback(() => {
    if (!state.model || !mutationsAllowed) return;
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
  }, [mutationsAllowed, state.model]);

  useEffect(() => {
    if (!native || !activeSessionId || state.phase !== "ready") return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let debounce: number | undefined;
    const sessionId = activeSessionId;
    void native
      .observeSourceChanges(sessionId, () => {
        if (debounce !== undefined) window.clearTimeout(debounce);
        debounce = window.setTimeout(() => {
          if (!active) return;
          dispatch({ type: "source_changed", value: true });
          setPendingSelection((pending) =>
            pending ? { ...pending, invalidated: true } : null,
          );
        }, 200);
      })
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch((error: unknown) => {
        if (active)
          dispatch({ type: "set_message", message: describeError(error) });
      });
    return () => {
      active = false;
      if (debounce !== undefined) window.clearTimeout(debounce);
      unsubscribe?.();
    };
  }, [activeSessionId, native, state.phase]);

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
    if (!native || !state.document || !state.sidecar || !mutationsAllowed)
      return;
    const sessionId = state.document.sessionId;
    try {
      const external = await native.loadSidecar(sessionId);
      saveCoordinatorRef.current.setRevision(sessionId, external.revision);
      const result = await native.saveSidecar(
        sessionId,
        serializeSidecar(state.sidecar),
        external.revision,
      );
      saveCoordinatorRef.current.setRevision(sessionId, result.revision);
      dispatch({
        type: "save_succeeded",
        sessionId,
        revision: result.revision,
      });
    } catch (error) {
      dispatch({
        type: "save_failed",
        sessionId,
        status: "error",
        message: describeError(error),
      });
    }
  }, [mutationsAllowed, native, state.document, state.sidecar]);

  const saveNewComment = (body: string) => {
    if (
      !state.sidecar ||
      !state.model ||
      !pendingSelection ||
      pendingSelection.invalidated ||
      !mutationsAllowed
    )
      return;
    const anchor = createAnchor(state.model, pendingSelection.mapped);
    persistSidecar(
      addComment(state.sidecar, createReviewComment({ body, anchor })),
    );
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const mutateComment = (mutation: (sidecar: SidecarV1) => SidecarV1) => {
    if (state.sidecar && mutationsAllowed)
      persistSidecar(mutation(state.sidecar));
  };

  const exportText = useMemo(
    () =>
      state.sidecar
        ? generateReviewMarkdown(state.sidecar, state.matches, {
            includeResolved: state.includeResolvedExport,
            instruction: exportInstruction,
          })
        : "",
    [
      exportInstruction,
      state.includeResolvedExport,
      state.matches,
      state.sidecar,
    ],
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
  const resolvedTheme = resolveTheme(readerSettings.theme, systemDark);
  const ready =
    state.phase === "ready" && state.model && state.document && native;

  return (
    <div className="appShell">
      <a className="skipLink" href="#document-surface">
        Skip to document
      </a>
      <Toolbar
        filename={state.document?.filename}
        filter={state.filter}
        panelOpen={state.panelOpen}
        includeResolved={state.includeResolvedExport}
        saveStatus={state.saveStatus}
        canExport={Boolean(ready && state.sidecar)}
        canNavigate={Boolean(ready)}
        outlineOpen={outlineOpen}
        minimapOpen={minimapOpen}
        appearanceOpen={appearanceOpen}
        windowFullscreen={windowFullscreen}
        onOpen={() => void openDocument()}
        onEditExportInstructions={() => {
          setAppearanceOpen(false);
          setExportInstructionsOpen(true);
        }}
        onTogglePanel={() => dispatch({ type: "toggle_panel" })}
        onToggleOutline={() => setOutlineOpen((open) => !open)}
        onToggleMinimap={() => setMinimapOpen((open) => !open)}
        onToggleAppearance={() => setAppearanceOpen((open) => !open)}
        onToggleFullscreen={toggleWindowFullscreen}
        onFilter={(filter: CommentFilter) =>
          dispatch({ type: "set_filter", filter })
        }
        onIncludeResolved={(value) =>
          dispatch({ type: "set_export_resolved", value })
        }
        onExport={() => void exportReview()}
        onCopy={() => void copyReview()}
      />

      {appearanceOpen && (
        <ReaderSettingsPanel
          settings={readerSettings}
          onChange={setReaderSettings}
          onClose={closeAppearance}
        />
      )}

      {exportInstructionsOpen && (
        <ExportInstructionsDialog
          instruction={exportInstruction}
          onCancel={() => setExportInstructionsOpen(false)}
          onSave={(instruction) => {
            setExportInstruction(instruction);
            saveExportInstruction(window.localStorage, instruction);
            setExportInstructionsOpen(false);
          }}
        />
      )}

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
              <button
                type="button"
                disabled={!mutationsAllowed}
                onClick={() => void overwriteConflict()}
              >
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
            readOnly={!mutationsAllowed}
            readOnlyMessage={
              state.sourceChanged
                ? "Comments are read-only until the changed source is reloaded."
                : "This sidecar is read-only until its validation issue is resolved."
            }
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
            theme={resolvedTheme}
            scrollContainerRef={documentRegionRef}
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

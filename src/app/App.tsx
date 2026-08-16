import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AgentIntegrationPanel } from "../components/AgentIntegrationPanel";
import { AuthorProfilePanel } from "../components/AuthorProfilePanel";
import { BrandGlyph } from "../components/BrandGlyph";
import { DocumentMinimap } from "../components/DocumentMinimap";
import { DocumentOutline } from "../components/DocumentOutline";
import {
  DocumentSearch,
  DOCUMENT_SEARCH_INPUT_ID,
} from "../components/DocumentSearch";
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
import { upsertAuthor } from "../lib/authors/model";
import { buildAgentReviewSnapshot } from "../lib/agent/reviewSnapshot";
import type { PendingAgentReport } from "../lib/agent/report";
import { generateReviewMarkdown } from "../lib/export/review";
import { parseMarkdownDocument } from "../lib/markdown/model";
import { searchMarkdownDocument } from "../lib/markdown/search";
import {
  createAgentAccessToken,
  defaultMcpServerUrl,
  loadAgentIntegrationSettings,
  mcpClientConfigurations,
  saveAgentIntegrationSettings,
  type McpClientConfiguration,
} from "../lib/settings/agent";
import {
  loadAuthorProfile,
  saveAuthorProfile,
  type LocalAuthorProfile,
} from "../lib/settings/author";
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
  loadReadingPosition,
  saveReadingPosition,
} from "../lib/settings/readingPosition";
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
  type McpServerStatus,
  type OpenedDocument,
} from "../services/native";
import {
  appReducer,
  initialState,
  reviewMutationsAllowed,
  type CommentFilter,
} from "./state";
import { SidecarSaveCoordinator } from "./saveQueue";
import { SourceChangeVerifier } from "./sourceChange";

type PendingSelection = {
  mapped: MappedSelection;
  position: { left: number; top: number };
  invalidated: boolean;
};

const SEARCH_HIGHLIGHT_LIMIT = 500;

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const mutationsAllowed = reviewMutationsAllowed(state);
  const activeSessionId = state.document?.sessionId;
  const activeDocumentId = state.document?.documentId;
  const activeSourceSha256 = state.document?.revision.sha256;
  const [native, setNative] = useState<NativeService | null>(null);
  const documentLoadIdRef = useRef(0);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [authorProfileOpen, setAuthorProfileOpen] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<LocalAuthorProfile>(() =>
    loadAuthorProfile(window.localStorage),
  );
  const [agentIntegrationOpen, setAgentIntegrationOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState(() =>
    loadAgentIntegrationSettings(window.localStorage),
  );
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [agentReports, setAgentReports] = useState<
    ReadonlyMap<string, PendingAgentReport>
  >(() => new Map());
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
  const closeAuthorProfile = useCallback(() => setAuthorProfileOpen(false), []);
  const closeAgentIntegration = useCallback(
    () => setAgentIntegrationOpen(false),
    [],
  );
  const focusDocumentSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => {
      const input = window.document.getElementById(DOCUMENT_SEARCH_INPUT_ID);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    });
  }, []);
  const closeDocumentSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => {
      window.document.getElementById("document-surface")?.focus({
        preventScroll: true,
      });
    });
  }, []);
  const toggleWindowFullscreen = useCallback(() => {
    if (!native) return;
    void native.setWindowFullscreen(!windowFullscreen).catch(() => undefined);
  }, [native, windowFullscreen]);

  useEffect(() => {
    void getNativeService().then(setNative);
  }, []);
  useEffect(() => {
    saveAgentIntegrationSettings(window.localStorage, agentSettings);
  }, [agentSettings]);
  useEffect(() => {
    saveAuthorProfile(window.localStorage, authorProfile);
  }, [authorProfile]);
  useEffect(() => {
    if (!native) return;
    let active = true;
    setMcpError(null);
    const updateServer = async () => {
      try {
        const status = agentSettings.enabled
          ? await native.startMcpServer(agentSettings.token)
          : await native.stopMcpServer();
        if (active) setMcpStatus(status);
      } catch (error) {
        if (active) {
          setMcpStatus(null);
          setMcpError(describeError(error));
        }
      }
    };
    void updateServer();
    return () => {
      active = false;
    };
  }, [agentSettings.enabled, agentSettings.token, native]);
  useEffect(() => {
    if (!native) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void native
      .observeMcpReports((batch) => {
        if (!active) return;
        setAgentReports((current) => {
          const next = new Map(current);
          for (const result of batch.results) {
            next.set(result.commentId, {
              ...result,
              sourceSha256: batch.sourceSha256,
              sidecarRevision: batch.sidecarRevision,
            });
          }
          return next;
        });
      })
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch((error: unknown) => {
        if (active) setMcpError(describeError(error));
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [native]);
  useEffect(() => {
    setAgentReports(new Map());
  }, [activeSessionId, activeSourceSha256]);
  useEffect(() => {
    if (state.sourceChanged) setAgentReports(new Map());
  }, [state.sourceChanged]);
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
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase();
      const macFullscreenShortcut =
        event.metaKey && event.ctrlKey && key === "f";
      if (macFullscreenShortcut) {
        event.preventDefault();
        toggleWindowFullscreen();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        key === "f" &&
        state.phase === "ready" &&
        state.model
      ) {
        event.preventDefault();
        focusDocumentSearch();
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeDocumentSearch();
        return;
      }
      if (windowFullscreen && event.key === "Escape") {
        event.preventDefault();
        toggleWindowFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyboardShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleKeyboardShortcut, true);
  }, [
    closeDocumentSearch,
    focusDocumentSearch,
    searchOpen,
    state.model,
    state.phase,
    toggleWindowFullscreen,
    windowFullscreen,
  ]);
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatchIndex(0);
  }, [activeSessionId]);
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
      const loadId = ++documentLoadIdRef.current;
      const fingerprint = {
        sha256: opened.revision.sha256,
        normalizedSha256: opened.revision.normalizedSha256,
      };
      const [model, loadedSidecar] = await Promise.all([
        parseMarkdownDocument(opened.content, fingerprint),
        options?.sidecar === undefined
          ? native.loadSidecar(opened.sessionId)
          : Promise.resolve(null),
      ]);
      if (loadId !== documentLoadIdRef.current) return;
      let sidecar = options?.sidecar;
      let sidecarRevision = options?.sidecarRevision;
      let issue = options?.issue ?? null;
      if (sidecar === undefined) {
        if (!loadedSidecar) return;
        sidecarRevision = loadedSidecar.revision;
        if (loadedSidecar.contents === null) {
          sidecar = createEmptySidecar({
            filename: opened.filename,
            sha256: fingerprint.sha256,
            normalizedSha256: fingerprint.normalizedSha256,
          });
        } else {
          const parsed = parseSidecarJson(loadedSidecar.contents);
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

    const consumeOpenRequest = (restoreWhenEmpty = false) => {
      openQueue = openQueue
        .then(async () => {
          let openedAny = false;
          while (!cancelled) {
            const opened = await native.takePendingDocument();
            if (!opened || cancelled) break;
            openedAny = true;
            dispatch({ type: "loading" });
            await loadOpenedDocument(opened);
            setPendingSelection(null);
          }
          if (restoreWhenEmpty && !openedAny && !cancelled) {
            const restored = await native.restoreRecentDocument();
            if (restored && !cancelled) {
              dispatch({ type: "loading" });
              await loadOpenedDocument(restored);
              setPendingSelection(null);
            }
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            dispatch({ type: "failed", message: describeError(error) });
        });
    };

    const start = async () => {
      try {
        const stop = await native.observeOpenRequests(() =>
          consumeOpenRequest(false),
        );
        if (cancelled) {
          stop();
          return;
        }
        unsubscribe = stop;
      } catch {
        // The initial queued request can still be consumed without events.
      }
      if (!cancelled) consumeOpenRequest(true);
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

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void native
      .observeOpenPickerRequests(() => {
        if (!cancelled) void openDocument();
      })
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [native, openDocument]);

  useEffect(() => {
    if (state.phase !== "ready" || !activeDocumentId) return;
    const region = documentRegionRef.current;
    if (!region) return;
    let restored = false;
    let saveTimer: number | undefined;
    const frames = new Set<number>();
    const scheduleFrame = (callback: () => void) => {
      const frame = window.requestAnimationFrame(() => {
        frames.delete(frame);
        callback();
      });
      frames.add(frame);
    };
    const persist = () => {
      if (!restored) return;
      const maximum = Math.max(region.scrollHeight - region.clientHeight, 0);
      const position = maximum > 0 ? region.scrollTop / maximum : 0;
      saveReadingPosition(window.localStorage, activeDocumentId, position);
    };
    const scheduleSave = () => {
      if (!restored) return;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(persist, 180);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    region.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", persistWhenHidden);
    scheduleFrame(() => {
      scheduleFrame(() => {
        const maximum = Math.max(region.scrollHeight - region.clientHeight, 0);
        region.scrollTop =
          loadReadingPosition(window.localStorage, activeDocumentId) * maximum;
        scheduleFrame(() => {
          restored = true;
        });
      });
    });
    return () => {
      window.clearTimeout(saveTimer);
      for (const frame of frames) window.cancelAnimationFrame(frame);
      persist();
      region.removeEventListener("scroll", scheduleSave);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, [activeDocumentId, state.phase]);

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
    if (
      !native ||
      !activeSessionId ||
      !activeSourceSha256 ||
      state.phase !== "ready"
    )
      return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const sessionId = activeSessionId;
    const verifier = new SourceChangeVerifier({
      delayMs: 200,
      check: () => native.sourceHasChanged(sessionId, activeSourceSha256),
      onChanged: () => {
        dispatch({ type: "source_changed", value: true });
        setPendingSelection((pending) =>
          pending ? { ...pending, invalidated: true } : null,
        );
      },
      onError: (error) =>
        dispatch({ type: "set_message", message: describeError(error) }),
    });
    void native
      .observeSourceChanges(sessionId, verifier.notify)
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
      verifier.dispose();
      unsubscribe?.();
    };
  }, [activeSessionId, activeSourceSha256, native, state.phase]);

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
    const now = new Date().toISOString();
    const sidecar = upsertAuthor(state.sidecar, authorProfile, now);
    persistSidecar(
      addComment(
        sidecar,
        createReviewComment({
          body,
          anchor,
          authorId: authorProfile.id,
          now,
        }),
        now,
      ),
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

  const agentSnapshot = useMemo(
    () =>
      state.document && state.model
        ? buildAgentReviewSnapshot({
            filename: state.document.filename,
            sourceSize: state.document.revision.size,
            model: state.model,
            sidecar: state.sidecar,
            sidecarRevision: state.sidecarRevision,
            sidecarIssue: state.sidecarIssue,
            sourceChanged: state.sourceChanged,
            matches: state.matches,
          })
        : null,
    [
      state.document,
      state.matches,
      state.model,
      state.sidecar,
      state.sidecarIssue,
      state.sidecarRevision,
      state.sourceChanged,
    ],
  );

  useEffect(() => {
    if (!native) return;
    let active = true;
    void native
      .publishMcpSnapshot(agentSettings.enabled ? agentSnapshot : null)
      .catch((error: unknown) => {
        if (active) setMcpError(describeError(error));
      });
    return () => {
      active = false;
    };
  }, [agentSettings.enabled, agentSnapshot, native]);

  const agentConfigurations = useMemo(
    () =>
      mcpClientConfigurations(
        mcpStatus?.url ?? defaultMcpServerUrl,
        agentSettings.token,
      ),
    [agentSettings.token, mcpStatus?.url],
  );

  const copyAgentConfiguration = async (
    configuration: McpClientConfiguration,
  ) => {
    try {
      await navigator.clipboard.writeText(configuration.configuration);
      dispatch({
        type: "set_message",
        message: `${configuration.configurationLabel} copied to the clipboard.`,
      });
    } catch {
      setMcpError("Clipboard access was unavailable.");
    }
  };

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

  const comments = useMemo(
    () => state.sidecar?.comments ?? [],
    [state.sidecar],
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResults = useMemo(
    () =>
      state.model
        ? searchMarkdownDocument(state.model, deferredSearchQuery)
        : { matches: [], total: 0, limited: false },
    [deferredSearchQuery, state.model],
  );
  const searchPending = searchQuery !== deferredSearchQuery;
  const currentSearchIndex =
    searchResults.matches.length > 0
      ? ((searchMatchIndex % searchResults.matches.length) +
          searchResults.matches.length) %
        searchResults.matches.length
      : -1;
  const activeSearchMatch =
    currentSearchIndex >= 0
      ? searchResults.matches[currentSearchIndex]
      : undefined;
  const decoratedSearchMatches = useMemo(() => {
    if (!searchOpen || searchPending) return [];
    if (searchResults.matches.length <= SEARCH_HIGHLIGHT_LIMIT)
      return searchResults.matches;
    const highlighted = searchResults.matches.slice(0, SEARCH_HIGHLIGHT_LIMIT);
    if (activeSearchMatch && currentSearchIndex >= SEARCH_HIGHLIGHT_LIMIT) {
      return [...highlighted, activeSearchMatch];
    }
    return highlighted;
  }, [
    activeSearchMatch,
    currentSearchIndex,
    searchOpen,
    searchPending,
    searchResults.matches,
  ]);
  useEffect(() => {
    setSearchMatchIndex(0);
  }, [deferredSearchQuery, state.model]);
  const navigateSearch = useCallback(
    (direction: 1 | -1) => {
      if (searchPending || searchResults.matches.length === 0) return;
      setSearchMatchIndex(
        (current) =>
          (current + direction + searchResults.matches.length) %
          searchResults.matches.length,
      );
    },
    [searchPending, searchResults.matches.length],
  );
  const visibleAgentReports = useMemo(() => {
    const visible = new Map<string, PendingAgentReport>();
    if (!state.model || state.sourceChanged) return visible;
    for (const comment of comments) {
      const report = agentReports.get(comment.id);
      if (
        report &&
        comment.status === "open" &&
        report.sourceSha256 === state.model.fingerprint.sha256 &&
        report.commentUpdatedAt === comment.updatedAt
      ) {
        visible.set(comment.id, report);
      }
    }
    return visible;
  }, [agentReports, comments, state.model, state.sourceChanged]);
  const dismissAgentReport = (commentId: string) => {
    setAgentReports((current) => {
      const next = new Map(current);
      next.delete(commentId);
      return next;
    });
  };
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
        canOpen={Boolean(native)}
        canExport={Boolean(ready && state.sidecar)}
        canNavigate={Boolean(ready)}
        outlineOpen={outlineOpen}
        minimapOpen={minimapOpen}
        appearanceOpen={appearanceOpen}
        authorProfileOpen={authorProfileOpen}
        agentIntegrationOpen={agentIntegrationOpen}
        searchOpen={searchOpen}
        windowFullscreen={windowFullscreen}
        onOpen={() => void openDocument()}
        onEditExportInstructions={() => {
          setAppearanceOpen(false);
          setAuthorProfileOpen(false);
          setAgentIntegrationOpen(false);
          setExportInstructionsOpen(true);
        }}
        onTogglePanel={() => dispatch({ type: "toggle_panel" })}
        onToggleOutline={() => setOutlineOpen((open) => !open)}
        onToggleMinimap={() => setMinimapOpen((open) => !open)}
        onToggleAppearance={() => {
          setAgentIntegrationOpen(false);
          setAuthorProfileOpen(false);
          setAppearanceOpen((open) => !open);
        }}
        onToggleAuthorProfile={() => {
          setAppearanceOpen(false);
          setAgentIntegrationOpen(false);
          setExportInstructionsOpen(false);
          setAuthorProfileOpen((open) => !open);
        }}
        onToggleAgentIntegration={() => {
          setAppearanceOpen(false);
          setAuthorProfileOpen(false);
          setExportInstructionsOpen(false);
          setAgentIntegrationOpen((open) => !open);
        }}
        onToggleSearch={() => {
          if (searchOpen) closeDocumentSearch();
          else focusDocumentSearch();
        }}
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

      {authorProfileOpen && (
        <AuthorProfilePanel
          profile={authorProfile}
          onSave={(profile) => {
            setAuthorProfile(profile);
            if (
              state.sidecar?.authors?.some(
                (author) => author.id === profile.id,
              ) &&
              mutationsAllowed
            ) {
              persistSidecar(upsertAuthor(state.sidecar, profile));
            }
            setAuthorProfileOpen(false);
          }}
          onClose={closeAuthorProfile}
        />
      )}

      {agentIntegrationOpen && (
        <AgentIntegrationPanel
          settings={agentSettings}
          status={mcpStatus}
          error={mcpError}
          sharedFilename={state.document?.filename}
          configurations={agentConfigurations}
          onEnabledChange={(enabled) =>
            setAgentSettings((settings) => ({ ...settings, enabled }))
          }
          onCopyConfiguration={(configuration) =>
            void copyAgentConfiguration(configuration)
          }
          onRotateToken={() =>
            setAgentSettings((settings) => ({
              ...settings,
              token: createAgentAccessToken(),
            }))
          }
          onClose={closeAgentIntegration}
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
            targetSourceOffset={
              searchOpen && !searchPending
                ? (activeSearchMatch?.sourceRange.start ?? null)
                : null
            }
            onClose={() => setOutlineOpen(false)}
          />
        )}
        <section
          ref={documentRegionRef}
          className="documentRegion"
          aria-busy={state.phase === "loading"}
        >
          {searchOpen && ready && (
            <DocumentSearch
              query={searchQuery}
              current={currentSearchIndex + 1}
              available={searchResults.matches.length}
              total={searchResults.total}
              limited={searchResults.limited}
              pending={searchPending}
              onQueryChange={(query) => {
                setSearchQuery(query);
                setSearchMatchIndex(0);
              }}
              onPrevious={() => navigateSearch(-1)}
              onNext={() => navigateSearch(1)}
              onClose={closeDocumentSearch}
            />
          )}
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
              searchMatches={decoratedSearchMatches}
              activeSearchMatchId={
                searchOpen && !searchPending
                  ? (activeSearchMatch?.id ?? null)
                  : null
              }
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
            authors={state.sidecar?.authors ?? []}
            matches={state.matches}
            filter={state.filter}
            selectedId={state.selectedCommentId}
            readOnly={!mutationsAllowed}
            agentReports={visibleAgentReports}
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
            onAcceptAgentReport={(comment) => {
              mutateComment((sidecar) =>
                updateComment(sidecar, comment.id, { status: "resolved" }),
              );
              dismissAgentReport(comment.id);
            }}
            onDismissAgentReport={dismissAgentReport}
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
          authorName={authorProfile.displayName}
          position={pendingSelection.position}
          invalidated={pendingSelection.invalidated}
          onCancel={() => setPendingSelection(null)}
          onSave={saveNewComment}
        />
      )}
    </div>
  );
}

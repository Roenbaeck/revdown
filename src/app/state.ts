import type { AnchorMatch } from "../lib/anchors/match";
import type { MarkdownDocumentModel } from "../lib/markdown/model";
import type { SidecarV1 } from "../lib/schema/sidecar";
import type { OpenedDocument } from "../services/native";

export type CommentFilter = "open" | "resolved" | "all";
export type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

export type AppState = {
  phase: "empty" | "loading" | "ready" | "error";
  document: OpenedDocument | null;
  model: MarkdownDocumentModel | null;
  sidecar: SidecarV1 | null;
  sidecarRevision: string | null;
  sidecarIssue: string | null;
  matches: ReadonlyMap<string, AnchorMatch>;
  panelOpen: boolean;
  filter: CommentFilter;
  includeResolvedExport: boolean;
  selectedCommentId: string | null;
  saveStatus: SaveStatus;
  message: string | null;
  sourceChanged: boolean;
};

export const initialState: AppState = {
  phase: "empty",
  document: null,
  model: null,
  sidecar: null,
  sidecarRevision: null,
  sidecarIssue: null,
  matches: new Map(),
  panelOpen: true,
  filter: "open",
  includeResolvedExport: false,
  selectedCommentId: null,
  saveStatus: "idle",
  message: null,
  sourceChanged: false,
};

export type AppAction =
  | { type: "loading" }
  | { type: "loading_cancelled"; phase: "empty" | "ready" }
  | {
      type: "loaded";
      document: OpenedDocument;
      model: MarkdownDocumentModel;
      sidecar: SidecarV1 | null;
      sidecarRevision: string | null;
      sidecarIssue: string | null;
      matches: ReadonlyMap<string, AnchorMatch>;
    }
  | { type: "failed"; message: string }
  | { type: "set_message"; message: string | null }
  | { type: "set_filter"; filter: CommentFilter }
  | { type: "toggle_panel" }
  | { type: "set_export_resolved"; value: boolean }
  | { type: "select_comment"; id: string | null }
  | {
      type: "local_sidecar";
      sidecar: SidecarV1;
      matches: ReadonlyMap<string, AnchorMatch>;
    }
  | { type: "save_started" }
  | { type: "save_succeeded"; revision: string }
  | { type: "save_failed"; status: "conflict" | "error"; message: string }
  | { type: "source_changed"; value: boolean };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "loading":
      return { ...state, phase: "loading", message: null };
    case "loading_cancelled":
      return { ...state, phase: action.phase, message: null };
    case "loaded":
      return {
        ...state,
        phase: "ready",
        document: action.document,
        model: action.model,
        sidecar: action.sidecar,
        sidecarRevision: action.sidecarRevision,
        sidecarIssue: action.sidecarIssue,
        matches: action.matches,
        saveStatus: "idle",
        sourceChanged: false,
        message: action.sidecarIssue,
      };
    case "failed":
      return { ...state, phase: "error", message: action.message };
    case "set_message":
      return { ...state, message: action.message };
    case "set_filter":
      return { ...state, filter: action.filter };
    case "toggle_panel":
      return { ...state, panelOpen: !state.panelOpen };
    case "set_export_resolved":
      return { ...state, includeResolvedExport: action.value };
    case "select_comment":
      return { ...state, selectedCommentId: action.id, panelOpen: true };
    case "local_sidecar":
      return {
        ...state,
        sidecar: action.sidecar,
        matches: action.matches,
        selectedCommentId: action.sidecar.comments.some(
          (comment) => comment.id === state.selectedCommentId,
        )
          ? state.selectedCommentId
          : null,
      };
    case "save_started":
      return { ...state, saveStatus: "saving", message: null };
    case "save_succeeded":
      return {
        ...state,
        saveStatus: "saved",
        sidecarRevision: action.revision,
        message: null,
      };
    case "save_failed":
      return { ...state, saveStatus: action.status, message: action.message };
    case "source_changed":
      return { ...state, sourceChanged: action.value };
  }
}

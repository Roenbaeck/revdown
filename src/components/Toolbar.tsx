import type { MouseEvent } from "react";
import type { CommentFilter, SaveStatus } from "../app/state";
import { BrandGlyph } from "./BrandGlyph";

type ToolbarProps = {
  filename: string | undefined;
  filter: CommentFilter;
  panelOpen: boolean;
  outlineOpen: boolean;
  minimapOpen: boolean;
  appearanceOpen: boolean;
  authorProfileOpen: boolean;
  agentIntegrationOpen: boolean;
  searchOpen: boolean;
  windowFullscreen: boolean;
  includeResolved: boolean;
  saveStatus: SaveStatus;
  canOpen: boolean;
  canExport: boolean;
  canNavigate: boolean;
  onOpen: () => void;
  onEditExportInstructions: () => void;
  onTogglePanel: () => void;
  onToggleOutline: () => void;
  onToggleMinimap: () => void;
  onToggleAppearance: () => void;
  onToggleAuthorProfile: () => void;
  onToggleAgentIntegration: () => void;
  onToggleSearch: () => void;
  onToggleFullscreen: () => void;
  onFilter: (filter: CommentFilter) => void;
  onIncludeResolved: (value: boolean) => void;
  onExport: () => void;
  onCopy: () => void;
};

function closeToolbarMenu(event: MouseEvent<HTMLElement>): void {
  const menu = event.currentTarget.closest("details");
  if (menu instanceof HTMLDetailsElement) menu.open = false;
}

function SettingsGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.08A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.08A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  );
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="brand" aria-label="Revdown" data-tauri-drag-region>
        <span className="brandMark" aria-hidden="true">
          <BrandGlyph />
        </span>
        <span>Revdown</span>
      </div>
      <button
        className="primaryButton toolbarOpenButton"
        type="button"
        onClick={props.onOpen}
        aria-label="Open Markdown"
        disabled={!props.canOpen}
      >
        <span className="toolbarWideLabel">Open Markdown</span>
        <span className="toolbarCompactLabel" aria-hidden="true">
          Open
        </span>
      </button>
      <span className="filename" title={props.filename} data-tauri-drag-region>
        {props.filename ?? "No document open"}
      </span>
      <div className="toolbarSpacer" data-tauri-drag-region />
      <span
        className={`saveState saveState-${props.saveStatus}`}
        aria-live="polite"
        data-tauri-drag-region
      >
        {props.saveStatus === "saving" && "Saving…"}
        {props.saveStatus === "saved" && "Saved"}
        {props.saveStatus === "conflict" && "Save conflict"}
        {props.saveStatus === "error" && "Save failed"}
      </span>
      <label className="compactField">
        <span className="visuallyHidden">Filter comments</span>
        <select
          value={props.filter}
          onChange={(event) =>
            props.onFilter(event.target.value as CommentFilter)
          }
          disabled={!props.canExport}
        >
          <option value="open">Open comments</option>
          <option value="resolved">Resolved comments</option>
          <option value="all">All comments</option>
        </select>
      </label>
      <button
        className="toolbarSearchButton"
        type="button"
        onClick={props.onToggleSearch}
        aria-label="Search document"
        aria-expanded={props.searchOpen}
        aria-controls="document-search"
        title="Search document (⌘F or Ctrl+F)"
        disabled={!props.canNavigate}
      >
        <SearchGlyph />
      </button>
      <div className="toolbarExportActions">
        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={props.includeResolved}
            onChange={(event) => props.onIncludeResolved(event.target.checked)}
            disabled={!props.canExport}
          />
          Export resolved
        </label>
        <button type="button" onClick={props.onEditExportInstructions}>
          Edit instructions…
        </button>
        <button
          type="button"
          onClick={props.onCopy}
          disabled={!props.canExport}
        >
          Copy review
        </button>
        <button
          type="button"
          onClick={props.onExport}
          disabled={!props.canExport}
        >
          Export review
        </button>
      </div>
      <div className="toolbarViewActions">
        <button
          type="button"
          onClick={props.onToggleAuthorProfile}
          aria-expanded={props.authorProfileOpen}
          aria-controls="author-profile"
        >
          Reviewer
        </button>
        <button
          type="button"
          onClick={props.onToggleAgentIntegration}
          aria-expanded={props.agentIntegrationOpen}
          aria-controls="agent-integration"
        >
          Agent access
        </button>
        <button
          type="button"
          onClick={props.onToggleAppearance}
          aria-expanded={props.appearanceOpen}
          aria-controls="reader-settings"
        >
          Appearance
        </button>
        <button type="button" onClick={props.onToggleFullscreen}>
          {props.windowFullscreen ? "Exit full screen" : "Full screen"}
        </button>
        <button
          type="button"
          onClick={props.onToggleOutline}
          aria-pressed={props.outlineOpen}
          disabled={!props.canNavigate}
        >
          {props.outlineOpen ? "Hide outline" : "Show outline"}
        </button>
        <button
          type="button"
          onClick={props.onTogglePanel}
          aria-pressed={props.panelOpen}
        >
          {props.panelOpen ? "Hide review" : "Show review"}
        </button>
        <button
          type="button"
          onClick={props.onToggleMinimap}
          aria-pressed={props.minimapOpen}
          disabled={!props.canNavigate}
        >
          {props.minimapOpen ? "Hide minimap" : "Show minimap"}
        </button>
      </div>
      <details className="toolbarMenu toolbarExportMenu" name="toolbar-menu">
        <summary>Export</summary>
        <div className="toolbarMenuPanel">
          <label className="checkboxLabel">
            <input
              type="checkbox"
              checked={props.includeResolved}
              onChange={(event) =>
                props.onIncludeResolved(event.target.checked)
              }
              disabled={!props.canExport}
            />
            Include resolved comments
          </label>
          <button
            type="button"
            onClick={(event) => {
              props.onEditExportInstructions();
              closeToolbarMenu(event);
            }}
          >
            Edit instructions…
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onCopy();
              closeToolbarMenu(event);
            }}
            disabled={!props.canExport}
          >
            Copy review
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onExport();
              closeToolbarMenu(event);
            }}
            disabled={!props.canExport}
          >
            Export review…
          </button>
        </div>
      </details>
      <details className="toolbarMenu toolbarViewMenu" name="toolbar-menu">
        <summary aria-label="View and settings" title="View and settings">
          <SettingsGlyph />
        </summary>
        <div className="toolbarMenuPanel">
          <button
            type="button"
            onClick={(event) => {
              props.onToggleAuthorProfile();
              closeToolbarMenu(event);
            }}
            aria-expanded={props.authorProfileOpen}
            aria-controls="author-profile"
          >
            Reviewer profile…
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onToggleAgentIntegration();
              closeToolbarMenu(event);
            }}
            aria-expanded={props.agentIntegrationOpen}
            aria-controls="agent-integration"
          >
            Agent access…
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onToggleAppearance();
              closeToolbarMenu(event);
            }}
            aria-expanded={props.appearanceOpen}
            aria-controls="reader-settings"
          >
            Appearance…
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onToggleFullscreen();
              closeToolbarMenu(event);
            }}
          >
            {props.windowFullscreen ? "Exit full screen" : "Full screen"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onToggleOutline();
              closeToolbarMenu(event);
            }}
            aria-pressed={props.outlineOpen}
            disabled={!props.canNavigate}
          >
            {props.outlineOpen ? "Hide outline" : "Show outline"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onTogglePanel();
              closeToolbarMenu(event);
            }}
            aria-pressed={props.panelOpen}
          >
            {props.panelOpen ? "Hide review" : "Show review"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              props.onToggleMinimap();
              closeToolbarMenu(event);
            }}
            aria-pressed={props.minimapOpen}
            disabled={!props.canNavigate}
          >
            {props.minimapOpen ? "Hide minimap" : "Show minimap"}
          </button>
        </div>
      </details>
    </header>
  );
}

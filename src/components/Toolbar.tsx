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
  windowFullscreen: boolean;
  includeResolved: boolean;
  saveStatus: SaveStatus;
  canComment: boolean;
  canExport: boolean;
  canNavigate: boolean;
  onOpen: () => void;
  onComment: () => void;
  onTogglePanel: () => void;
  onToggleOutline: () => void;
  onToggleMinimap: () => void;
  onToggleAppearance: () => void;
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

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="brand" aria-label="Revdown">
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
      >
        <span className="toolbarWideLabel">Open Markdown</span>
        <span className="toolbarCompactLabel" aria-hidden="true">
          Open
        </span>
      </button>
      <span className="filename" title={props.filename}>
        {props.filename ?? "No document open"}
      </span>
      <div className="toolbarSpacer" />
      <span
        className={`saveState saveState-${props.saveStatus}`}
        aria-live="polite"
      >
        {props.saveStatus === "saving" && "Saving…"}
        {props.saveStatus === "saved" && "Saved"}
        {props.saveStatus === "conflict" && "Save conflict"}
        {props.saveStatus === "error" && "Save failed"}
      </span>
      <button
        className="toolbarCommentButton"
        type="button"
        onClick={props.onComment}
        disabled={!props.canComment}
        title="⌘/Ctrl+Shift+M"
        aria-label="Comment on selection"
      >
        <span className="toolbarWideLabel">Comment on selection</span>
        <span className="toolbarCompactLabel" aria-hidden="true">
          Comment
        </span>
      </button>
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
        <summary>View</summary>
        <div className="toolbarMenuPanel">
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

import type { CommentFilter, SaveStatus } from "../app/state";
import { BrandGlyph } from "./BrandGlyph";

type ToolbarProps = {
  filename: string | undefined;
  filter: CommentFilter;
  panelOpen: boolean;
  outlineOpen: boolean;
  minimapOpen: boolean;
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
  onFilter: (filter: CommentFilter) => void;
  onIncludeResolved: (value: boolean) => void;
  onExport: () => void;
  onCopy: () => void;
};

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand" aria-label="Revdown">
        <span className="brandMark" aria-hidden="true">
          <BrandGlyph />
        </span>
        <span>Revdown</span>
      </div>
      <button className="primaryButton" type="button" onClick={props.onOpen}>
        Open Markdown
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
        type="button"
        onClick={props.onComment}
        disabled={!props.canComment}
        title="⌘/Ctrl+Shift+M"
      >
        Comment on selection
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
      <label className="checkboxLabel">
        <input
          type="checkbox"
          checked={props.includeResolved}
          onChange={(event) => props.onIncludeResolved(event.target.checked)}
          disabled={!props.canExport}
        />
        Export resolved
      </label>
      <button type="button" onClick={props.onCopy} disabled={!props.canExport}>
        Copy review
      </button>
      <button
        type="button"
        onClick={props.onExport}
        disabled={!props.canExport}
      >
        Export review
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
    </header>
  );
}

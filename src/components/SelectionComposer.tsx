import { useState } from "react";
import type { MappedSelection } from "../lib/markdown/selection";

type SelectionComposerProps = {
  mapped: MappedSelection;
  position: { left: number; top: number };
  invalidated: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
};

export function SelectionComposer(props: SelectionComposerProps) {
  const [body, setBody] = useState("");
  return (
    <section
      className="selectionComposer"
      style={{ left: props.position.left, top: props.position.top }}
      role="dialog"
      aria-label="New review comment"
    >
      <p className="selectionQuote">“{props.mapped.renderedText}”</p>
      {props.invalidated && (
        <p className="inlineWarning">
          The source reloaded. Your draft is safe, but reselect the target
          before saving.
        </p>
      )}
      <label>
        <span className="visuallyHidden">Comment</span>
        <textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What should change?"
          rows={4}
        />
      </label>
      <div className="composerActions">
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className="primaryButton"
          type="button"
          disabled={!body.trim() || props.invalidated}
          onClick={() => props.onSave(body.trim())}
        >
          Save comment
        </button>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import type { MappedSelection } from "../lib/markdown/selection";

type SelectionComposerProps = {
  mapped: MappedSelection;
  authorName: string;
  position: { left: number; top: number };
  invalidated: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
};

export function SelectionComposer(props: SelectionComposerProps) {
  const [body, setBody] = useState("");
  const composerRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onCancelRef = useRef(props.onCancel);
  onCancelRef.current = props.onCancel;

  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const composer = composerRef.current;
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !composer) return;
      const focusable = [
        ...composer.querySelectorAll<HTMLElement>(
          'textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    composer?.addEventListener("keydown", handleKeyDown);
    return () => {
      composer?.removeEventListener("keydown", handleKeyDown);
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  return (
    <section
      ref={composerRef}
      className="selectionComposer"
      style={{ left: props.position.left, top: props.position.top }}
      role="dialog"
      aria-modal="true"
      aria-label="New review comment"
    >
      <p className="selectionQuote">“{props.mapped.renderedText}”</p>
      <p className="composerAuthor">Commenting as {props.authorName}</p>
      {props.invalidated && (
        <p className="inlineWarning">
          The source reloaded. Your draft is safe, but reselect the target
          before saving.
        </p>
      )}
      <label>
        <span className="visuallyHidden">Comment</span>
        <textarea
          ref={textareaRef}
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

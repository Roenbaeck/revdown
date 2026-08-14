import { useEffect, useRef, useState } from "react";
import {
  defaultExportInstruction,
  MAX_EXPORT_INSTRUCTION_LENGTH,
} from "../lib/settings/export";

type ExportInstructionsDialogProps = {
  instruction: string;
  onSave: (instruction: string) => void;
  onCancel: () => void;
};

export function ExportInstructionsDialog(props: ExportInstructionsDialogProps) {
  const [draft, setDraft] = useState(props.instruction);
  const dialogRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onCancelRef = useRef(props.onCancel);
  onCancelRef.current = props.onCancel;

  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
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
    dialog?.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", handleKeyDown);
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  const normalized = draft.trim();

  return (
    <div className="modalBackdrop">
      <section
        ref={dialogRef}
        className="exportInstructionsDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-instructions-title"
        aria-describedby="export-instructions-help"
      >
        <div className="settingsHeading">
          <div>
            <span className="eyebrow">Export</span>
            <h2 id="export-instructions-title">Review instructions</h2>
          </div>
          <button
            type="button"
            onClick={props.onCancel}
            aria-label="Close export instructions"
          >
            ×
          </button>
        </div>
        <p id="export-instructions-help" className="exportInstructionsHelp">
          This Markdown is included in every copied or saved review. Customize
          it for the person, model, or agent that will apply your comments.
        </p>
        <label htmlFor="export-instruction">Instruction</label>
        <textarea
          ref={textareaRef}
          id="export-instruction"
          value={draft}
          rows={10}
          maxLength={MAX_EXPORT_INSTRUCTION_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="exportInstructionActions">
          <button
            type="button"
            onClick={() => setDraft(defaultExportInstruction)}
          >
            Restore default
          </button>
          <span className="actionSpacer" />
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="primaryButton"
            type="button"
            disabled={!normalized}
            onClick={() => props.onSave(normalized)}
          >
            Save instructions
          </button>
        </div>
      </section>
    </div>
  );
}

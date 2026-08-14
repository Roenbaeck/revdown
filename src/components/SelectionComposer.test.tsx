import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { MappedSelection } from "../lib/markdown/selection";
import { SelectionComposer } from "./SelectionComposer";

const mapped: MappedSelection = {
  block: {
    id: "paragraph:0:6",
    kind: "paragraph",
    start: 0,
    end: 6,
    lineStart: 1,
    lineEnd: 1,
    headingPath: [],
    sourceSha256: "a".repeat(64),
    renderedText: "target",
    renderedSpans: [
      { renderedStart: 0, renderedEnd: 6, sourceMap: [0, 1, 2, 3, 4, 5, 6] },
    ],
    renderedInlineRanges: [],
  },
  sourceRange: { start: 0, end: 6 },
  sourceText: "target",
  renderedText: "target",
  prefix: "",
  suffix: "",
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add comment
      </button>
      {open && (
        <SelectionComposer
          mapped={mapped}
          position={{ left: 0, top: 0 }}
          invalidated={false}
          onSave={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("selection composer accessibility", () => {
  it("traps focus, closes with Escape, and restores the originating focus", () => {
    render(<Harness />);
    const origin = screen.getByRole("button", { name: "Add comment" });
    origin.focus();
    fireEvent.click(origin);

    const dialog = screen.getByRole("dialog", { name: "New review comment" });
    const textarea = screen.getByPlaceholderText("What should change?");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(textarea).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(textarea).toHaveFocus();
    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(origin).toHaveFocus();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultExportInstruction } from "../lib/settings/export";
import { ExportInstructionsDialog } from "./ExportInstructionsDialog";

describe("ExportInstructionsDialog", () => {
  it("edits, validates, and saves the instruction", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ExportInstructionsDialog
        instruction="Original instruction"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Review instructions",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const textarea = screen.getByLabelText("Instruction");
    expect(textarea).toHaveFocus();
    await user.clear(textarea);
    expect(
      screen.getByRole("button", { name: "Save instructions" }),
    ).toBeDisabled();
    await user.type(textarea, "  Use my house style.  ");
    await user.click(screen.getByRole("button", { name: "Save instructions" }));

    expect(onSave).toHaveBeenCalledWith("Use my house style.");
  });

  it("restores the built-in default as an editable draft", async () => {
    const user = userEvent.setup();
    render(
      <ExportInstructionsDialog
        instruction="Custom instruction"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Restore default" }));
    expect(screen.getByLabelText("Instruction")).toHaveValue(
      defaultExportInstruction,
    );
  });
});

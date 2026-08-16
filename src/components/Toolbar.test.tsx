import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "./Toolbar";

function renderToolbar(onEditExportInstructions = vi.fn()) {
  const result = render(
    <Toolbar
      filename="draft.md"
      filter="open"
      panelOpen
      outlineOpen
      minimapOpen
      appearanceOpen={false}
      agentIntegrationOpen={false}
      searchOpen={false}
      windowFullscreen={false}
      includeResolved={false}
      saveStatus="idle"
      canExport
      canNavigate
      onOpen={vi.fn()}
      onEditExportInstructions={onEditExportInstructions}
      onTogglePanel={vi.fn()}
      onToggleOutline={vi.fn()}
      onToggleMinimap={vi.fn()}
      onToggleAppearance={vi.fn()}
      onToggleAgentIntegration={vi.fn()}
      onToggleSearch={vi.fn()}
      onToggleFullscreen={vi.fn()}
      onFilter={vi.fn()}
      onIncludeResolved={vi.fn()}
      onExport={vi.fn()}
      onCopy={vi.fn()}
    />,
  );
  return { ...result, onEditExportInstructions };
}

describe("Toolbar", () => {
  it("keeps passive title-bar areas draggable without a redundant comment action", () => {
    const { container } = renderToolbar();

    expect(container.querySelector(".toolbar")).toHaveAttribute(
      "data-tauri-drag-region",
    );
    for (const selector of [".brand", ".filename", ".toolbarSpacer"]) {
      expect(container.querySelector(selector)).toHaveAttribute(
        "data-tauri-drag-region",
      );
    }
    expect(
      screen.queryByRole("button", { name: /comment on selection/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("View and settings")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search document" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("View", { exact: true })).not.toBeInTheDocument();
  });

  it("opens the export instruction editor", async () => {
    const user = userEvent.setup();
    const { onEditExportInstructions } = renderToolbar();

    await user.click(
      screen.getAllByRole("button", { name: "Edit instructions…" })[0]!,
    );
    expect(onEditExportInstructions).toHaveBeenCalledOnce();
  });
});

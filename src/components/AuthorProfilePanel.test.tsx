import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorProfilePanel } from "./AuthorProfilePanel";

const profile = {
  id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
  displayName: "Local reviewer",
  kind: "human" as const,
};

describe("AuthorProfilePanel", () => {
  it("trims and saves the display name without changing identity", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AuthorProfilePanel
        profile={profile}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Display name" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "  Alice  ");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(onSave).toHaveBeenCalledWith({
      ...profile,
      displayName: "Alice",
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentSearch } from "./DocumentSearch";

function renderSearch(
  overrides: Partial<React.ComponentProps<typeof DocumentSearch>> = {},
) {
  const props = {
    query: "source",
    current: 1,
    available: 3,
    total: 3,
    limited: false,
    pending: false,
    onQueryChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<DocumentSearch {...props} />), props };
}

describe("DocumentSearch", () => {
  it("focuses the query and supports next, previous, and close shortcuts", async () => {
    const user = userEvent.setup();
    const { props } = renderSearch();
    const input = screen.getByRole("searchbox", { name: "Search text" });

    expect(input).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("{Escape}");

    expect(props.onNext).toHaveBeenCalledOnce();
    expect(props.onPrevious).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("reports empty and limited result sets", () => {
    const { rerender } = renderSearch({
      current: 0,
      available: 0,
      total: 0,
    });
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();

    rerender(
      <DocumentSearch
        query="a"
        current={2}
        available={50_000}
        total={72_100}
        limited
        pending={false}
        onQueryChange={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2 / 50,000+")).toHaveAccessibleName(
      "2 of the first 50,000 navigable results; 72,100 total results",
    );
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { AgentIntegrationPanel } from "./AgentIntegrationPanel";

function renderPanel(
  overrides: Partial<ComponentProps<typeof AgentIntegrationPanel>> = {},
) {
  const onEnabledChange = vi.fn();
  const onCopyConfiguration = vi.fn();
  const result = render(
    <AgentIntegrationPanel
      settings={{ enabled: false, token: "a".repeat(64) }}
      status={{
        supported: true,
        running: false,
        url: "http://127.0.0.1:37419/mcp",
      }}
      error={null}
      sharedFilename="review.md"
      configuration="[mcp_servers.revdown]"
      onEnabledChange={onEnabledChange}
      onCopyConfiguration={onCopyConfiguration}
      onRotateToken={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
  return { ...result, onEnabledChange, onCopyConfiguration };
}

describe("AgentIntegrationPanel", () => {
  it("enables local agent access explicitly", async () => {
    const user = userEvent.setup();
    const { onEnabledChange } = renderPanel();

    await user.click(
      screen.getByRole("checkbox", { name: "Enable local MCP server" }),
    );
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("shows and copies the Codex configuration when enabled", async () => {
    const user = userEvent.setup();
    const { onCopyConfiguration } = renderPanel({
      settings: { enabled: true, token: "b".repeat(64) },
    });

    expect(screen.getByLabelText("Codex MCP configuration")).toHaveTextContent(
      "mcp_servers.revdown",
    );
    await user.click(
      screen.getByRole("button", { name: "Copy Codex configuration" }),
    );
    expect(onCopyConfiguration).toHaveBeenCalledOnce();
  });

  it("disables the server control in the browser preview", () => {
    renderPanel({
      status: {
        supported: false,
        running: false,
        url: "http://127.0.0.1:37419/mcp",
      },
    });

    expect(
      screen.getByRole("checkbox", { name: "Enable local MCP server" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Unavailable in the browser preview"),
    ).toBeVisible();
  });
});

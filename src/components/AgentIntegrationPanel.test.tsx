import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { mcpClientConfigurations } from "../lib/settings/agent";
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
      configurations={mcpClientConfigurations(
        "http://127.0.0.1:37419/mcp",
        "a".repeat(64),
      )}
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

  it("starts with generic connection details and offers multiple clients", async () => {
    const user = userEvent.setup();
    const { onCopyConfiguration } = renderPanel({
      settings: { enabled: true, token: "b".repeat(64) },
    });

    expect(screen.getByLabelText("MCP connection details")).toHaveTextContent(
      "Streamable HTTP",
    );
    expect(screen.getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Claude Code" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenCode" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Antigravity" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Copy connection details" }),
    );
    expect(onCopyConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection" }),
    );
  });

  it("switches to and copies a client-specific setup", async () => {
    const user = userEvent.setup();
    const { onCopyConfiguration } = renderPanel({
      settings: { enabled: true, token: "b".repeat(64) },
    });

    await user.selectOptions(
      screen.getByLabelText("MCP client"),
      "claude-code",
    );
    expect(screen.getByLabelText("Claude Code MCP command")).toHaveTextContent(
      "claude mcp add --transport http",
    );
    await user.click(
      screen.getByRole("button", { name: "Copy Claude Code command" }),
    );
    expect(onCopyConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude-code" }),
    );
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

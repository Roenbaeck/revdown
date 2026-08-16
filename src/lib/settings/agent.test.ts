import {
  loadAgentIntegrationSettings,
  mcpClientConfigurations,
  saveAgentIntegrationSettings,
  type McpClientId,
} from "./agent";

describe("agent integration settings", () => {
  it("defaults to disabled with a generated token", () => {
    const settings = loadAgentIntegrationSettings({ getItem: () => null }, () =>
      "a".repeat(64),
    );
    expect(settings).toEqual({ enabled: false, token: "a".repeat(64) });
  });

  it("round-trips a valid local setting", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const settings = { enabled: true, token: "b".repeat(64) };
    saveAgentIntegrationSettings(storage, settings);
    expect(loadAgentIntegrationSettings(storage)).toEqual(settings);
  });

  it("generates client-neutral details and supported client configurations", () => {
    const configurations = mcpClientConfigurations(
      "http://127.0.0.1:37419/mcp",
      "c".repeat(64),
    );
    const configurationFor = (id: McpClientId) => {
      const configuration = configurations.find((item) => item.id === id);
      expect(configuration).toBeDefined();
      return configuration?.configuration ?? "";
    };

    expect(configurations.map(({ id }) => id)).toEqual([
      "connection",
      "codex",
      "claude-code",
      "opencode",
      "antigravity",
    ]);

    expect(configurationFor("connection")).toContain(
      "Transport: Streamable HTTP",
    );

    const codex = configurationFor("codex");
    expect(codex).toContain("[mcp_servers.revdown]");
    expect(codex).toContain('url = "http://127.0.0.1:37419/mcp"');
    expect(codex).toContain('Authorization = "Bearer ccccc');
    expect(codex).toContain(
      'enabled_tools = ["get_review_state", "list_comments", "get_comment", "report_comment_results"]',
    );
    expect(codex).toContain('default_tools_approval_mode = "writes"');

    expect(configurationFor("claude-code")).toContain(
      "claude mcp add --transport http --scope user revdown",
    );

    const openCode = configurationFor("opencode");
    expect(openCode).toContain('"type": "remote"');
    expect(openCode).toContain('"oauth": false');

    const antigravity = configurationFor("antigravity");
    expect(antigravity).toContain('"mcpServers"');
    expect(antigravity).toContain('"serverUrl": "http://127.0.0.1:37419/mcp"');

    for (const configuration of configurations) {
      expect(configuration.configuration).toContain(
        `Authorization${configuration.id === "connection" ? ":" : ""}`,
      );
      expect(configuration.configuration).toContain(`Bearer ${"c".repeat(64)}`);
    }
  });
});

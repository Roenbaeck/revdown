import {
  codexMcpConfiguration,
  loadAgentIntegrationSettings,
  saveAgentIntegrationSettings,
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

  it("generates a conservative Codex configuration", () => {
    const configuration = codexMcpConfiguration(
      "http://127.0.0.1:37419/mcp",
      "c".repeat(64),
    );
    expect(configuration).toContain("[mcp_servers.revdown]");
    expect(configuration).toContain('url = "http://127.0.0.1:37419/mcp"');
    expect(configuration).toContain('Authorization = "Bearer ccccc');
    expect(configuration).toContain(
      'enabled_tools = ["get_review_state", "list_comments", "get_comment", "report_comment_results"]',
    );
    expect(configuration).toContain('default_tools_approval_mode = "writes"');
  });
});

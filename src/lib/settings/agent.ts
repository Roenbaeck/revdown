const STORAGE_KEY = "revdown.agent-integration.v1";

export const defaultMcpServerUrl = "http://127.0.0.1:37419/mcp";

export type AgentIntegrationSettings = {
  enabled: boolean;
  token: string;
};

export type McpClientId =
  | "connection"
  | "codex"
  | "claude-code"
  | "opencode"
  | "antigravity";

export type McpClientConfiguration = {
  id: McpClientId;
  label: string;
  instructions: string;
  configuration: string;
  configurationLabel: string;
  copyLabel: string;
};

const MCP_TOOL_NAMES = [
  "get_review_state",
  "list_comments",
  "get_comment",
  "report_comment_results",
] as const;

function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 64 &&
    /^[0-9a-f]+$/u.test(value)
  );
}

export function createAgentAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loadAgentIntegrationSettings(
  storage: Pick<Storage, "getItem">,
  createToken: () => string = createAgentAccessToken,
): AgentIntegrationSettings {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "enabled" in parsed &&
        typeof parsed.enabled === "boolean" &&
        "token" in parsed &&
        isToken(parsed.token)
      ) {
        return { enabled: parsed.enabled, token: parsed.token };
      }
    }
  } catch {
    // Invalid local settings fall back to a fresh disabled integration.
  }
  return { enabled: false, token: createToken() };
}

export function saveAgentIntegrationSettings(
  storage: Pick<Storage, "setItem">,
  settings: AgentIntegrationSettings,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function jsonConfiguration(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function mcpClientConfigurations(
  url: string,
  token: string,
): readonly McpClientConfiguration[] {
  const authorization = `Bearer ${token}`;
  const tools = MCP_TOOL_NAMES.join(", ");

  return [
    {
      id: "connection",
      label: "Connection details",
      instructions:
        "Use these values in any MCP client that supports remote Streamable HTTP servers with custom headers.",
      configuration: `Transport: Streamable HTTP
URL: ${url}
HTTP header: Authorization: ${authorization}
Tools: ${tools}
`,
      configurationLabel: "MCP connection details",
      copyLabel: "Copy connection details",
    },
    {
      id: "codex",
      label: "Codex",
      instructions:
        "Add this to ~/.codex/config.toml, then restart Codex. Inspect the connection with /mcp.",
      configuration: `[mcp_servers.revdown]
url = ${JSON.stringify(url)}
http_headers = { Authorization = ${JSON.stringify(authorization)} }
enabled_tools = ["${MCP_TOOL_NAMES.join('", "')}"]
default_tools_approval_mode = "writes"
`,
      configurationLabel: "Codex MCP configuration",
      copyLabel: "Copy Codex configuration",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      instructions:
        "Run this in a terminal to add Revdown at user scope. Inspect the connection with /mcp.",
      configuration: `claude mcp add --transport http --scope user revdown ${url} --header 'Authorization: ${authorization}'\n`,
      configurationLabel: "Claude Code MCP command",
      copyLabel: "Copy Claude Code command",
    },
    {
      id: "opencode",
      label: "OpenCode",
      instructions:
        "Merge this into ~/.config/opencode/opencode.json, then restart OpenCode. Inspect the connection with opencode mcp list.",
      configuration: jsonConfiguration({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          revdown: {
            type: "remote",
            url,
            enabled: true,
            oauth: false,
            headers: { Authorization: authorization },
          },
        },
      }),
      configurationLabel: "OpenCode MCP configuration",
      copyLabel: "Copy OpenCode configuration",
    },
    {
      id: "antigravity",
      label: "Antigravity",
      instructions:
        "Merge this into ~/.gemini/config/mcp_config.json, then refresh Installed MCP Servers under Settings → Customizations.",
      configuration: jsonConfiguration({
        mcpServers: {
          revdown: {
            serverUrl: url,
            headers: { Authorization: authorization },
          },
        },
      }),
      configurationLabel: "Antigravity MCP configuration",
      copyLabel: "Copy Antigravity configuration",
    },
  ];
}

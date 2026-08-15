const STORAGE_KEY = "revdown.agent-integration.v1";

export const defaultMcpServerUrl = "http://127.0.0.1:37419/mcp";

export type AgentIntegrationSettings = {
  enabled: boolean;
  token: string;
};

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

export function codexMcpConfiguration(url: string, token: string): string {
  return `[mcp_servers.revdown]
url = "${url}"
http_headers = { Authorization = "Bearer ${token}" }
enabled_tools = ["get_review_state", "list_comments", "get_comment", "report_comment_results"]
default_tools_approval_mode = "writes"
`;
}

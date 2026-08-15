import { useEffect, useRef } from "react";
import type { AgentIntegrationSettings } from "../lib/settings/agent";
import type { McpServerStatus } from "../services/native";

type AgentIntegrationPanelProps = {
  settings: AgentIntegrationSettings;
  status: McpServerStatus | null;
  error: string | null;
  sharedFilename: string | undefined;
  configuration: string;
  onEnabledChange: (enabled: boolean) => void;
  onCopyConfiguration: () => void;
  onRotateToken: () => void;
  onClose: () => void;
};

export function AgentIntegrationPanel(props: AgentIntegrationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { onClose } = props;

  useEffect(() => {
    panelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const available = props.status?.supported !== false;
  const statusLabel = !available
    ? "Unavailable in the browser preview"
    : props.error
      ? "Could not start"
      : props.status?.running
        ? "Running on this Mac"
        : props.settings.enabled
          ? "Starting…"
          : "Off";

  return (
    <aside
      ref={panelRef}
      id="agent-integration"
      className="readerSettingsPanel agentIntegrationPanel"
      aria-label="Agent access"
      tabIndex={-1}
    >
      <div className="settingsHeading">
        <div>
          <span className="eyebrow">Local integration</span>
          <h2>Agent access</h2>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close agent access"
        >
          ×
        </button>
      </div>

      <p className="agentIntegrationIntro">
        Share the current review with Codex through a local MCP server. Codex
        can read comments and queue outcome reports; only you can resolve them.
        Revdown never exposes the source path or lets an agent modify the
        source.
      </p>

      <label className="agentIntegrationToggle">
        <input
          type="checkbox"
          checked={props.settings.enabled}
          disabled={!available}
          onChange={(event) => props.onEnabledChange(event.target.checked)}
        />
        Enable local MCP server
      </label>

      <dl className="agentIntegrationStatus">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div>
          <dt>Shared review</dt>
          <dd>{props.sharedFilename ?? "No document open"}</dd>
        </div>
      </dl>

      {props.error && (
        <p className="agentIntegrationError" role="alert">
          {props.error}
        </p>
      )}

      {props.settings.enabled && available && (
        <>
          <div className="agentConfiguration">
            <h3>Connect Codex</h3>
            <p>
              Add this to <code>~/.codex/config.toml</code>, then restart Codex.
              You can inspect the connection with <code>/mcp</code>.
            </p>
            <pre aria-label="Codex MCP configuration">
              <code>{props.configuration}</code>
            </pre>
          </div>
          <div className="agentIntegrationActions">
            <button type="button" onClick={props.onCopyConfiguration}>
              Copy Codex configuration
            </button>
            <button type="button" onClick={props.onRotateToken}>
              Rotate access token
            </button>
          </div>
          <p className="agentSecurityNote">
            Keep the token private. Rotating it immediately invalidates the old
            configuration. Agent reports remain pending until you review them
            and are not retained after Revdown closes.
          </p>
        </>
      )}
    </aside>
  );
}

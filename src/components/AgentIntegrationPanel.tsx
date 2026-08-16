import { useEffect, useRef, useState } from "react";
import type {
  AgentIntegrationSettings,
  McpClientConfiguration,
  McpClientId,
} from "../lib/settings/agent";
import type { McpServerStatus } from "../services/native";

type AgentIntegrationPanelProps = {
  settings: AgentIntegrationSettings;
  status: McpServerStatus | null;
  error: string | null;
  sharedFilename: string | undefined;
  configurations: readonly McpClientConfiguration[];
  onEnabledChange: (enabled: boolean) => void;
  onCopyConfiguration: (configuration: McpClientConfiguration) => void;
  onRotateToken: () => void;
  onClose: () => void;
};

export function AgentIntegrationPanel(props: AgentIntegrationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [clientId, setClientId] = useState<McpClientId>("connection");
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
        ? "Running locally"
        : props.settings.enabled
          ? "Starting…"
          : "Off";
  const selectedConfiguration =
    props.configurations.find(
      (configuration) => configuration.id === clientId,
    ) ?? props.configurations[0];

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
        Share the current review with any compatible tool through a local MCP
        server. Connected tools can read comments and queue outcome reports;
        only you can resolve them. Revdown never exposes the source path or lets
        an MCP client modify the source.
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
          <label className="agentClientPicker">
            Setup for
            <select
              aria-label="MCP client"
              value={selectedConfiguration?.id ?? "connection"}
              onChange={(event) => {
                const configuration = props.configurations.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (configuration) setClientId(configuration.id);
              }}
            >
              {props.configurations.map((configuration) => (
                <option key={configuration.id} value={configuration.id}>
                  {configuration.label}
                </option>
              ))}
            </select>
          </label>
          {selectedConfiguration && (
            <div className="agentConfiguration">
              <h3>
                {selectedConfiguration.id === "connection"
                  ? "Connection details"
                  : `Connect ${selectedConfiguration.label}`}
              </h3>
              <p>{selectedConfiguration.instructions}</p>
              <pre aria-label={selectedConfiguration.configurationLabel}>
                <code>{selectedConfiguration.configuration}</code>
              </pre>
            </div>
          )}
          <div className="agentIntegrationActions">
            {selectedConfiguration && (
              <button
                type="button"
                onClick={() => props.onCopyConfiguration(selectedConfiguration)}
              >
                {selectedConfiguration.copyLabel}
              </button>
            )}
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

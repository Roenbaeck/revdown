import { useEffect, useRef } from "react";
import {
  defaultReaderSettings,
  type ReaderSettings,
} from "../lib/settings/reader";

type ReaderSettingsPanelProps = {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
  onClose: () => void;
};

export function ReaderSettingsPanel(props: ReaderSettingsPanelProps) {
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

  const update = <K extends keyof ReaderSettings>(
    key: K,
    value: ReaderSettings[K],
  ) => props.onChange({ ...props.settings, [key]: value });

  return (
    <aside
      ref={panelRef}
      id="reader-settings"
      className="readerSettingsPanel"
      aria-label="Reading appearance"
      tabIndex={-1}
    >
      <div className="settingsHeading">
        <div>
          <span className="eyebrow">Reading</span>
          <h2>Appearance</h2>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close appearance"
        >
          ×
        </button>
      </div>
      <label>
        Theme
        <select
          value={props.settings.theme}
          onChange={(event) =>
            update("theme", event.target.value as ReaderSettings["theme"])
          }
        >
          <option value="system">Follow system</option>
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        Typeface
        <select
          value={props.settings.font}
          onChange={(event) =>
            update("font", event.target.value as ReaderSettings["font"])
          }
        >
          <option value="serif">Book serif</option>
          <option value="sans">System sans</option>
        </select>
      </label>
      <label>
        Text size
        <select
          value={props.settings.size}
          onChange={(event) =>
            update("size", event.target.value as ReaderSettings["size"])
          }
        >
          <option value="small">Small · 90%</option>
          <option value="medium">Medium · 100%</option>
          <option value="large">Large · 110%</option>
          <option value="extra-large">Extra large · 120%</option>
        </select>
      </label>
      <label>
        Line spacing
        <select
          value={props.settings.spacing}
          onChange={(event) =>
            update("spacing", event.target.value as ReaderSettings["spacing"])
          }
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="relaxed">Relaxed</option>
        </select>
      </label>
      <label>
        Line width
        <select
          value={props.settings.width}
          onChange={(event) =>
            update("width", event.target.value as ReaderSettings["width"])
          }
        >
          <option value="narrow">Narrow</option>
          <option value="medium">Comfortable</option>
          <option value="wide">Wide</option>
        </select>
      </label>
      <button
        type="button"
        className="settingsReset"
        onClick={() => props.onChange(defaultReaderSettings)}
      >
        Reset defaults
      </button>
    </aside>
  );
}

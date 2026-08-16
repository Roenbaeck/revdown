import { useEffect, useRef, useState } from "react";
import type { LocalAuthorProfile } from "../lib/settings/author";

type AuthorProfilePanelProps = {
  profile: LocalAuthorProfile;
  onSave: (profile: LocalAuthorProfile) => void;
  onClose: () => void;
};

export function AuthorProfilePanel(props: AuthorProfilePanelProps) {
  const [displayName, setDisplayName] = useState(props.profile.displayName);
  const inputRef = useRef<HTMLInputElement>(null);
  const { onClose } = props;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const normalizedName = displayName.trim();
  return (
    <aside
      id="author-profile"
      className="readerSettingsPanel authorProfilePanel"
      aria-label="Reviewer profile"
    >
      <div className="settingsHeading">
        <div>
          <span className="eyebrow">Attribution</span>
          <h2>Reviewer profile</h2>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close reviewer profile"
        >
          ×
        </button>
      </div>
      <p className="authorProfileHelp">
        New comments use this name. Your profile stays local, while its public
        name and identifier are copied into each document sidecar you review.
      </p>
      <label>
        Display name
        <input
          ref={inputRef}
          value={displayName}
          maxLength={100}
          autoComplete="name"
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <div className="authorProfileActions">
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="primaryButton"
          type="button"
          disabled={!normalizedName}
          onClick={() =>
            props.onSave({ ...props.profile, displayName: normalizedName })
          }
        >
          Save profile
        </button>
      </div>
    </aside>
  );
}

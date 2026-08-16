import { useEffect, useRef } from "react";

export const DOCUMENT_SEARCH_INPUT_ID = "document-search-input";

type DocumentSearchProps = {
  query: string;
  current: number;
  available: number;
  total: number;
  limited: boolean;
  pending: boolean;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

function resultStatus(props: DocumentSearchProps): {
  short: string;
  accessible: string;
} {
  if (props.pending) {
    return { short: "Searching…", accessible: "Searching document" };
  }
  if (!props.query) {
    return { short: "", accessible: "Enter text to search" };
  }
  if (props.total === 0) {
    return { short: "No results", accessible: "No search results" };
  }
  if (props.limited) {
    return {
      short: `${props.current} / ${props.available.toLocaleString()}+`,
      accessible: `${props.current} of the first ${props.available.toLocaleString()} navigable results; ${props.total.toLocaleString()} total results`,
    };
  }
  return {
    short: `${props.current} / ${props.total.toLocaleString()}`,
    accessible: `${props.current} of ${props.total.toLocaleString()} results`,
  };
}

export function DocumentSearch(props: DocumentSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = resultStatus(props);
  const canNavigate = !props.pending && props.available > 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      id="document-search"
      className="documentSearch"
      role="search"
      aria-label="Find in document"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) props.onPrevious();
          else props.onNext();
        }
      }}
    >
      <label className="visuallyHidden" htmlFor={DOCUMENT_SEARCH_INPUT_ID}>
        Search text
      </label>
      <input
        ref={inputRef}
        id={DOCUMENT_SEARCH_INPUT_ID}
        type="search"
        value={props.query}
        placeholder="Find in document"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      <output
        className="documentSearchStatus"
        aria-live="polite"
        aria-label={status.accessible}
        title={status.accessible}
      >
        {status.short}
      </output>
      <button
        type="button"
        className="documentSearchIconButton"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!canNavigate}
        onClick={props.onPrevious}
      >
        ↑
      </button>
      <button
        type="button"
        className="documentSearchIconButton"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!canNavigate}
        onClick={props.onNext}
      >
        ↓
      </button>
      <button
        type="button"
        className="documentSearchIconButton"
        aria-label="Close search"
        title="Close search (Escape)"
        onClick={props.onClose}
      >
        ×
      </button>
    </div>
  );
}

export type SourceRevision = {
  sha256: string;
  size: number;
  modifiedMs: number;
};

export type OpenedDocument = {
  sessionId: string;
  filename: string;
  content: string;
  revision: SourceRevision;
};

export type LoadedSidecar = {
  contents: string | null;
  revision: string | null;
};

export type SaveResult = {
  revision: string;
};

export type ExportResult = {
  saved: boolean;
};

export type WindowAppearance = {
  theme: "light" | "dark";
  backgroundColor: string;
};

export type NativeService = {
  openDocument(): Promise<OpenedDocument | null>;
  takePendingDocument(): Promise<OpenedDocument | null>;
  observeOpenRequests(listener: () => void): Promise<() => void>;
  loadSidecar(sessionId: string): Promise<LoadedSidecar>;
  saveSidecar(
    sessionId: string,
    contents: string,
    expectedRevision: string | null,
  ): Promise<SaveResult>;
  exportReview(
    sessionId: string,
    defaultFilename: string,
    contents: string,
  ): Promise<ExportResult>;
  pollSource(sessionId: string): Promise<SourceRevision>;
  reloadSource(sessionId: string): Promise<OpenedDocument>;
  readLocalImage(
    sessionId: string,
    relativePath: string,
  ): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  setWindowAppearance(appearance: WindowAppearance): Promise<void>;
  setWindowFullscreen(fullscreen: boolean): Promise<void>;
  observeWindowFullscreen(
    listener: (fullscreen: boolean) => void,
  ): Promise<() => void>;
};

export class NativeServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeServiceError";
  }
}

let nativeServicePromise: Promise<NativeService> | undefined;

export function getNativeService(): Promise<NativeService> {
  nativeServicePromise ??= isTauriRuntime()
    ? import("./native.tauri").then(
        ({ TauriNativeService }) => new TauriNativeService(),
      )
    : import("./native.browser").then(
        ({ BrowserNativeService }) => new BrowserNativeService(),
      );
  return nativeServicePromise;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

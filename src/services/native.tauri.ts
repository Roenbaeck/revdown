import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ExportResult,
  LoadedSidecar,
  NativeService,
  OpenedDocument,
  SaveResult,
  WindowAppearance,
} from "./native";
import { NativeServiceError } from "./native";

type NativeErrorShape = { code?: unknown; message?: unknown };
type SourceChangedEvent = { sessionId: string };

function normalizeNativeError(error: unknown): never {
  if (typeof error === "object" && error !== null) {
    const shape = error as NativeErrorShape;
    if (typeof shape.code === "string" && typeof shape.message === "string") {
      throw new NativeServiceError(shape.code, shape.message);
    }
  }
  throw new NativeServiceError(
    "native_error",
    error instanceof Error ? error.message : String(error),
  );
}

async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    return normalizeNativeError(error);
  }
}

export class TauriNativeService implements NativeService {
  private immersiveFullscreen = false;

  openDocument(): Promise<OpenedDocument | null> {
    return command("open_document");
  }

  takePendingDocument(): Promise<OpenedDocument | null> {
    return command("take_pending_document");
  }

  observeOpenRequests(listener: () => void): Promise<() => void> {
    return getCurrentWindow().listen("revdown-open-document", listener);
  }

  loadSidecar(sessionId: string): Promise<LoadedSidecar> {
    return command("load_sidecar", { sessionId });
  }

  saveSidecar(
    sessionId: string,
    contents: string,
    expectedRevision: string | null,
  ): Promise<SaveResult> {
    return command("save_sidecar", { sessionId, contents, expectedRevision });
  }

  exportReview(
    sessionId: string,
    defaultFilename: string,
    contents: string,
  ): Promise<ExportResult> {
    return command("export_review", { sessionId, defaultFilename, contents });
  }

  async observeSourceChanges(
    sessionId: string,
    listener: () => void,
  ): Promise<() => void> {
    const unlisten = await getCurrentWindow().listen<SourceChangedEvent>(
      "revdown-source-changed",
      ({ payload }) => {
        if (payload.sessionId === sessionId) listener();
      },
    );
    try {
      await command("watch_source", { sessionId });
    } catch (error) {
      unlisten();
      throw error;
    }
    return () => {
      unlisten();
      void command("unwatch_source", { sessionId }).catch(() => undefined);
    };
  }

  sourceHasChanged(
    sessionId: string,
    expectedSha256: string,
  ): Promise<boolean> {
    return command("source_has_changed", { sessionId, expectedSha256 });
  }

  reloadSource(sessionId: string): Promise<OpenedDocument> {
    return command("reload_source", { sessionId });
  }

  readLocalImage(
    sessionId: string,
    relativePath: string,
  ): Promise<string | null> {
    return command("read_local_image", { sessionId, relativePath });
  }

  openExternal(url: string): Promise<void> {
    return command("open_external", { url });
  }

  async setWindowAppearance(appearance: WindowAppearance): Promise<void> {
    const window = getCurrentWindow();
    await Promise.all([
      window.setTheme(appearance.theme),
      window.setBackgroundColor(appearance.backgroundColor),
    ]);
  }

  async setWindowFullscreen(fullscreen: boolean): Promise<void> {
    await command("set_window_fullscreen", { fullscreen });
  }

  async observeWindowFullscreen(
    listener: (fullscreen: boolean) => void,
  ): Promise<() => void> {
    const window = getCurrentWindow();
    const unlisten = await window.listen<boolean>(
      "revdown-fullscreen-changed",
      ({ payload }) => {
        this.immersiveFullscreen = payload;
        listener(payload);
      },
    );
    this.immersiveFullscreen = await command<boolean>(
      "window_fullscreen_state",
    );
    listener(this.immersiveFullscreen);
    return unlisten;
  }
}

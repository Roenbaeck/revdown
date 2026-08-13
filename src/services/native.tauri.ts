import { invoke } from "@tauri-apps/api/core";
import type {
  ExportResult,
  LoadedSidecar,
  NativeService,
  OpenedDocument,
  SaveResult,
  SourceRevision,
} from "./native";
import { NativeServiceError } from "./native";

type NativeErrorShape = { code?: unknown; message?: unknown };

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
  openDocument(): Promise<OpenedDocument | null> {
    return command("open_document");
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

  pollSource(sessionId: string): Promise<SourceRevision> {
    return command("poll_source", { sessionId });
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
}

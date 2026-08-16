import type {
  ExportResult,
  LoadedSidecar,
  McpServerStatus,
  NativeService,
  OpenedDocument,
  SaveResult,
  SourceRevision,
  WindowAppearance,
} from "./native";
import type { AgentReviewSnapshot } from "../lib/agent/reviewSnapshot";
import type { McpReportBatch } from "../lib/agent/report";
import { NativeServiceError } from "./native";
import {
  decodeUtf8,
  encodeUtf8,
  fingerprintBytes,
  sha256Hex,
} from "../lib/fingerprints";

type BrowserSession = {
  document: OpenedDocument;
  sidecar: LoadedSidecar;
};

const demoSource = `# Welcome to Revdown

Revdown lets you review **rendered Markdown** without changing the source document.

Select text in this paragraph to add a comment. Comments are stored in a versioned sidecar and can be exported for a person or coding agent.

| Capability | MVP behavior |
| --- | --- |
| Source | Always read-only |
| Anchors | Exact, relocated, ambiguous, or unmatched |

Inline math renders safely as $E = mc^2$.

\`\`\`ts
const sourceIntegrity = "byte-for-byte";
\`\`\`
`;

async function revisionFor(
  content: string,
  modifiedMs = Date.now(),
): Promise<SourceRevision> {
  const bytes = encodeUtf8(content);
  return {
    ...(await fingerprintBytes(bytes)),
    size: bytes.byteLength,
    modifiedMs,
  };
}

function chooseMarkdownFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown,text/plain";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.click();
  });
}

export class BrowserNativeService implements NativeService {
  private readonly sessions = new Map<string, BrowserSession>();

  async openDocument(): Promise<OpenedDocument | null> {
    let filename: string;
    let content: string;
    let modifiedMs: number;
    let revision: SourceRevision;
    if (new URLSearchParams(window.location.search).has("demo")) {
      filename = "welcome.md";
      content = demoSource;
      modifiedMs = 0;
      revision = await revisionFor(content, modifiedMs);
    } else {
      const file = await chooseMarkdownFile();
      if (!file) return null;
      filename = file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      content = decodeUtf8(bytes);
      modifiedMs = file.lastModified;
      revision = {
        ...(await fingerprintBytes(bytes)),
        size: bytes.byteLength,
        modifiedMs,
      };
    }
    const sessionId = crypto.randomUUID();
    const document: OpenedDocument = {
      sessionId,
      documentId: await sha256Hex(encodeUtf8(`browser:${filename}`)),
      filename,
      content,
      revision,
    };
    this.sessions.set(sessionId, {
      document,
      sidecar: { contents: null, revision: null },
    });
    return document;
  }

  takePendingDocument(): Promise<OpenedDocument | null> {
    return Promise.resolve(null);
  }

  restoreRecentDocument(): Promise<OpenedDocument | null> {
    return Promise.resolve(null);
  }

  observeOpenRequests(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }

  observeOpenPickerRequests(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }

  loadSidecar(sessionId: string): Promise<LoadedSidecar> {
    return Promise.resolve(this.session(sessionId).sidecar);
  }

  async saveSidecar(
    sessionId: string,
    contents: string,
    expectedRevision: string | null,
  ): Promise<SaveResult> {
    const session = this.session(sessionId);
    if (session.sidecar.revision !== expectedRevision) {
      throw new NativeServiceError(
        "sidecar_conflict",
        "The sidecar changed outside Revdown.",
      );
    }
    const revision = await sha256Hex(encodeUtf8(contents));
    session.sidecar = { contents, revision };
    return { revision };
  }

  exportReview(
    sessionId: string,
    defaultFilename: string,
    contents: string,
  ): Promise<ExportResult> {
    this.session(sessionId);
    const url = URL.createObjectURL(
      new Blob([contents], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = defaultFilename;
    link.click();
    URL.revokeObjectURL(url);
    return Promise.resolve({ saved: true });
  }

  observeSourceChanges(
    sessionId: string,
    listener: () => void,
  ): Promise<() => void> {
    this.session(sessionId);
    void listener;
    return Promise.resolve(() => undefined);
  }

  sourceHasChanged(
    sessionId: string,
    expectedSha256: string,
  ): Promise<boolean> {
    const session = this.session(sessionId);
    return Promise.resolve(session.document.revision.sha256 !== expectedSha256);
  }

  reloadSource(sessionId: string): Promise<OpenedDocument> {
    return Promise.resolve(this.session(sessionId).document);
  }

  readLocalImage(
    sessionId: string,
    relativePath: string,
  ): Promise<string | null> {
    this.session(sessionId);
    void relativePath;
    return Promise.resolve(null);
  }

  openExternal(url: string): Promise<void> {
    const parsed = new URL(url);
    if (!new Set(["http:", "https:", "mailto:"]).has(parsed.protocol)) {
      throw new NativeServiceError(
        "unsafe_url",
        "This link scheme is not allowed.",
      );
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }

  setWindowAppearance(appearance: WindowAppearance): Promise<void> {
    void appearance;
    return Promise.resolve();
  }

  async setWindowFullscreen(fullscreen: boolean): Promise<void> {
    if (fullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  }

  observeWindowFullscreen(
    listener: (fullscreen: boolean) => void,
  ): Promise<() => void> {
    const update = () => listener(document.fullscreenElement !== null);
    update();
    document.addEventListener("fullscreenchange", update);
    return Promise.resolve(() =>
      document.removeEventListener("fullscreenchange", update),
    );
  }

  startMcpServer(): Promise<McpServerStatus> {
    return Promise.resolve({
      supported: false,
      running: false,
      url: "http://127.0.0.1:37419/mcp",
    });
  }

  stopMcpServer(): Promise<McpServerStatus> {
    return this.startMcpServer();
  }

  getMcpServerStatus(): Promise<McpServerStatus> {
    return this.startMcpServer();
  }

  publishMcpSnapshot(snapshot: AgentReviewSnapshot | null): Promise<void> {
    void snapshot;
    return Promise.resolve();
  }

  observeMcpReports(
    listener: (batch: McpReportBatch) => void,
  ): Promise<() => void> {
    void listener;
    return Promise.resolve(() => undefined);
  }

  private session(id: string): BrowserSession {
    const session = this.sessions.get(id);
    if (!session)
      throw new NativeServiceError(
        "invalid_session",
        "The document session is no longer open.",
      );
    return session;
  }
}

import { BrowserNativeService } from "./native.browser";

describe("BrowserNativeService source revisions", () => {
  it("compares the current session bytes with the expected source hash", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    const native = new BrowserNativeService();
    const opened = await native.openDocument();
    expect(opened).not.toBeNull();
    if (!opened) return;
    expect(opened.revision.normalizedSha256).toMatch(/^[0-9a-f]{64}$/u);

    await expect(
      native.sourceHasChanged(opened.sessionId, opened.revision.sha256),
    ).resolves.toBe(false);
    await expect(
      native.sourceHasChanged(opened.sessionId, "0".repeat(64)),
    ).resolves.toBe(true);
  });

  it("reports local MCP transport as unavailable in a browser", async () => {
    const native = new BrowserNativeService();

    await expect(native.getMcpServerStatus()).resolves.toEqual({
      supported: false,
      running: false,
      url: "http://127.0.0.1:37419/mcp",
    });
    await expect(native.publishMcpSnapshot(null)).resolves.toBeUndefined();
    await expect(native.observeMcpReports(vi.fn())).resolves.toEqual(
      expect.any(Function),
    );
  });
});

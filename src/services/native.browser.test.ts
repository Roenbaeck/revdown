import { BrowserNativeService } from "./native.browser";

describe("BrowserNativeService source revisions", () => {
  it("compares the current session bytes with the expected source hash", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    const native = new BrowserNativeService();
    const opened = await native.openDocument();
    expect(opened).not.toBeNull();
    if (!opened) return;

    await expect(
      native.sourceHasChanged(opened.sessionId, opened.revision.sha256),
    ).resolves.toBe(false);
    await expect(
      native.sourceHasChanged(opened.sessionId, "0".repeat(64)),
    ).resolves.toBe(true);
  });
});

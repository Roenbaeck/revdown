import { expect, test } from "@playwright/test";

async function selectRenderedText(
  page: import("@playwright/test").Page,
  text: string,
) {
  await page.locator("#document-surface").evaluate((surface, selectedText) => {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const offset = node.textContent?.indexOf(selectedText) ?? -1;
      if (offset >= 0) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + selectedText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        surface.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not select ${selectedText}`);
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Revdown" }),
  ).toBeVisible();
});

test("renders GFM, code, and math through the browser harness", async ({
  page,
}) => {
  await expect(page.getByRole("table")).toContainText("Source");
  await expect(page.locator(".katex")).toBeVisible();
  await expect(page.locator("code.rd-highlighted-code")).toContainText(
    "sourceIntegrity",
  );
  await expect(page.locator("#document-surface script")).toHaveCount(0);
});

test("creates, manages, and navigates a source-backed comment", async ({
  page,
}) => {
  await selectRenderedText(page, "rendered Markdown");
  const composer = page.getByRole("dialog", { name: "New review comment" });
  await expect(composer).toBeVisible();
  await composer
    .getByPlaceholder("What should change?")
    .fill("Clarify why this distinction matters.");
  await composer.getByRole("button", { name: "Save comment" }).click();

  await expect(
    page.getByText("Clarify why this distinction matters."),
  ).toBeVisible();
  await expect(
    page.locator(".rd-anchor-selected, .rd-anchor").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(
    page.getByText("Clarify why this distinction matters."),
  ).toBeHidden();

  await page.getByLabel("Filter comments").selectOption("resolved");
  await expect(
    page.getByText("Clarify why this distinction matters."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.getByLabel("Filter comments").selectOption("open");
  await expect(
    page.getByText("Clarify why this distinction matters."),
  ).toBeVisible();
});

test("exports a self-describing review to the clipboard", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit does not expose clipboard permissions consistently in headless mode.",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await selectRenderedText(page, "source document");
  const composer = page.getByRole("dialog", { name: "New review comment" });
  await composer
    .getByPlaceholder("What should change?")
    .fill("Add a concrete integrity example.");
  await composer.getByRole("button", { name: "Save comment" }).click();
  await page.getByRole("button", { name: "Copy review" }).click();
  await expect(page.getByText("Review copied to the clipboard.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("# Revdown review");
  expect(clipboard).toContain("Never guess an ambiguous or unmatched target");
  expect(clipboard).toContain("Add a concrete integrity example.");
});

test("rejects a selection spanning unrelated blocks", async ({ page }) => {
  await page.locator("#document-surface").evaluate((surface) => {
    const paragraphs = surface.querySelectorAll("p");
    const firstWalker = document.createTreeWalker(
      paragraphs[0]!,
      NodeFilter.SHOW_TEXT,
    );
    const secondWalker = document.createTreeWalker(
      paragraphs[1]!,
      NodeFilter.SHOW_TEXT,
    );
    const startNode = firstWalker.nextNode();
    const endNode = secondWalker.nextNode();
    if (!startNode || !endNode)
      throw new Error("Expected selectable paragraph text");
    const range = document.createRange();
    range.setStart(startNode, 0);
    range.setEnd(endNode, Math.min(6, endNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    surface.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page.getByText(/must target text within one paragraph/u),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "New review comment" }),
  ).toBeHidden();
});

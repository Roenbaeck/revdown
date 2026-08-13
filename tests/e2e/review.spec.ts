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

test("opens the example novel without blocking the document surface", async ({
  page,
}) => {
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  const started = Date.now();
  await chooser.setFiles("Subnosis.md");
  const surface = page.locator("#document-surface");
  await expect(surface).toBeVisible();
  expect(await surface.locator("[data-rd-block-id]").count()).toBeGreaterThan(
    9_000,
  );
  expect(Date.now() - started).toBeLessThan(5_000);

  const outline = page.getByRole("complementary", {
    name: "Document outline",
  });
  await expect(outline).toBeVisible();
  expect(await outline.locator(".outlineList button").count()).toBeGreaterThan(
    200,
  );
  await outline.locator(".outlineList button").nth(10).click();
  await expect
    .poll(() =>
      page.locator(".documentRegion").evaluate((region) => region.scrollTop),
    )
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Hide outline" }).first().click();
  await expect(outline).toBeHidden();
  await page.getByRole("button", { name: "Show outline" }).click();
  await expect(outline).toBeVisible();

  const minimap = page.getByRole("button", {
    name: "Document minimap with 0 comment markers",
  });
  await expect(minimap).toBeVisible();
  const minimapBounds = await minimap.boundingBox();
  if (!minimapBounds) throw new Error("Expected a visible minimap");
  await page.mouse.click(
    minimapBounds.x + minimapBounds.width / 2,
    minimapBounds.y + minimapBounds.height * 0.8,
  );
  await expect
    .poll(() =>
      page.locator(".documentRegion").evaluate((region) => region.scrollTop),
    )
    .toBeGreaterThan(1_000);
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
    page.getByRole("button", {
      name: "Document minimap with 1 comment marker",
    }),
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

  await page.getByRole("button", { name: "Delete" }).click();
  const confirmation = page.getByRole("group", {
    name: "Confirm comment deletion",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete comment" }).click();
  await expect(
    page.getByText("Clarify why this distinction matters."),
  ).toBeHidden();
  await expect(page.locator(".commentCount")).toHaveText("0");
  await expect(
    page.getByRole("button", {
      name: "Document minimap with 0 comment markers",
    }),
  ).toBeVisible();
});

test("comments on text inside a tight linked list item", async ({ page }) => {
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles("tests/fixtures/source-mapping.md");
  await expect(
    page.getByRole("heading", { name: "Mapping fixture" }),
  ).toBeVisible();

  await selectRenderedText(page, "the earlier draft, not a current task list");
  await expect(
    page.getByRole("dialog", { name: "New review comment" }),
  ).toBeVisible();
  await expect(
    page.getByText(/must target text within one paragraph/u),
  ).toBeHidden();
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

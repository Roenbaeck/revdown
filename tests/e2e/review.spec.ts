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

async function clickToolbarAction(
  page: import("@playwright/test").Page,
  menuName: "Export" | "View",
  actionName: string | RegExp,
) {
  const action = page.getByRole("button", { name: actionName }).first();
  if (!(await action.isVisible())) {
    await page
      .locator(".toolbarMenu")
      .filter({ has: page.locator("summary", { hasText: menuName }) })
      .locator("summary")
      .click();
  }
  await page.getByRole("button", { name: actionName }).first().click();
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

test("renders the Markdown conformance fixture with working footnotes", async ({
  page,
}) => {
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles("tests/fixtures/markdown-kitchen-sink.md");

  const surface = page.locator("#document-surface");
  await expect(
    page.getByRole("heading", { name: "Markdown kitchen sink" }),
  ).toBeVisible();
  await expect(surface.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(surface.locator("table")).toContainText("Unicode");
  await expect(surface.locator(".katex-display")).toBeVisible();
  await expect(surface.locator("code.rd-highlighted-code")).toContainText(
    "source-backed",
  );
  const footnote = surface.locator("[data-footnote-ref]").first();
  await footnote.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("fn-");
});

test("persists themes and reading controls", async ({ page }) => {
  await clickToolbarAction(page, "View", /Appearance/u);
  const settings = page.getByRole("complementary", {
    name: "Reading appearance",
  });
  await settings.getByLabel("Theme").selectOption("dark");
  await settings.getByLabel("Typeface").selectOption("sans");
  await settings.getByLabel("Text size").selectOption("extra-large");
  await settings.getByLabel("Line spacing").selectOption("relaxed");
  await settings.getByLabel("Line width").selectOption("narrow");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reader-size",
    "extra-large",
  );
  const surface = page.locator("#document-surface");
  await expect
    .poll(() =>
      surface.evaluate((element) => ({
        font: getComputedStyle(element).fontFamily,
        lineHeight: getComputedStyle(element).lineHeight,
        width: element.getBoundingClientRect().width,
      })),
    )
    .toMatchObject({ font: /sans-serif/u });
  expect((await surface.boundingBox())?.width).toBeLessThanOrEqual(702);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reader-width",
    "narrow",
  );
});

test("keeps narrow toolbar controls on one line", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator(".toolbarViewMenu > summary")).toBeVisible();
  await expect(page.locator(".toolbarExportMenu > summary")).toBeVisible();

  const controls = page.locator(
    ".toolbar > button:visible, .toolbar > label:visible select, .toolbar > details:visible > summary",
  );
  const measurements = await controls.evaluateAll((elements) =>
    elements.map((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      whiteSpace: getComputedStyle(element).whiteSpace,
    })),
  );
  expect(new Set(measurements.map(({ height }) => height))).toEqual(
    new Set([38]),
  );
  expect(measurements.every(({ whiteSpace }) => whiteSpace === "nowrap")).toBe(
    true,
  );
});

test("keeps a short document compact at the top of the minimap", async ({
  page,
}) => {
  const track = page.getByRole("button", {
    name: "Document minimap with 0 comment markers",
  });
  const document = track.locator(".minimapDocument");
  const [trackBounds, documentBounds] = await Promise.all([
    track.boundingBox(),
    document.boundingBox(),
  ]);
  if (!trackBounds || !documentBounds)
    throw new Error("Expected a visible minimap document");
  expect(documentBounds.y - trackBounds.y).toBeLessThanOrEqual(1);
  expect(documentBounds.height).toBeLessThan(trackBounds.height / 2);
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

  await clickToolbarAction(page, "View", "Hide outline");
  await expect(outline).toBeHidden();
  await clickToolbarAction(page, "View", "Show outline");
  await expect(outline).toBeVisible();

  const minimap = page.getByRole("button", {
    name: "Document minimap with 0 comment markers",
  });
  await expect(minimap).toBeVisible();
  const minimapPanel = page.getByRole("complementary", {
    name: "Document minimap panel",
  });
  const minimapBounds = await minimap.boundingBox();
  const minimapPanelBounds = await minimapPanel.boundingBox();
  if (!minimapBounds) throw new Error("Expected a visible minimap");
  if (!minimapPanelBounds) throw new Error("Expected a visible minimap panel");
  expect(minimapBounds.height).toBeGreaterThan(minimapPanelBounds.height - 16);
  const minimapDocumentBounds = await minimap
    .locator(".minimapDocument")
    .boundingBox();
  if (!minimapDocumentBounds)
    throw new Error("Expected a visible minimap document");
  expect(minimapDocumentBounds.height).toBeGreaterThanOrEqual(
    minimapBounds.height - 2,
  );
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
  await clickToolbarAction(page, "Export", "Copy review");
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

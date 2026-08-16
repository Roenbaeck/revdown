import { expect, test } from "@playwright/test";
import {
  buildLargeMarkdownFixture,
  LARGE_MARKDOWN_EXPECTED_BLOCKS,
  LARGE_MARKDOWN_EXPECTED_HEADINGS,
} from "../fixtures/large-markdown";

const LARGE_DOCUMENT_OPEN_BUDGET_MS = 5_000;

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
  menuName: "Export" | "View and settings",
  actionName: string | RegExp,
) {
  const action = page.getByRole("button", { name: actionName }).first();
  if (!(await action.isVisible())) {
    const menu =
      menuName === "Export"
        ? page.locator(".toolbarExportMenu > summary")
        : page.getByLabel("View and settings");
    await menu.click();
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

test("soft-wraps long fenced-code lines without changing their text", async ({
  page,
}) => {
  await page.goto("/");
  const longLine = `const reviewable = "${"long-source-token-".repeat(80)}";`;
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "long-code-line.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Wrapped code\n\n\`\`\`ts\n${longLine}\n\`\`\`\n`),
  });

  const code = page.locator("pre code");
  await expect(code).toHaveText(longLine);
  await expect
    .poll(() =>
      code.evaluate((element) => {
        const pre = element.closest("pre");
        if (!pre) return null;
        return {
          whiteSpace: getComputedStyle(element).whiteSpace,
          fits: pre.scrollWidth <= pre.clientWidth + 1,
        };
      }),
    )
    .toEqual({ whiteSpace: "pre-wrap", fits: true });
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
  await clickToolbarAction(page, "View and settings", /Appearance/u);
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

test("searches rendered text with keyboard navigation", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const search = page.getByRole("search", { name: "Find in document" });
  const query = search.getByRole("searchbox", { name: "Search text" });
  await expect(query).toBeFocused();

  await query.fill("source");
  await expect(search.locator(".documentSearchStatus")).toHaveText("1 / 3");
  await expect(page.locator(".rd-search-active").first()).toBeVisible();

  await query.press("Enter");
  await expect(search.locator(".documentSearchStatus")).toHaveText("2 / 3");
  await query.press("Shift+Enter");
  await expect(search.locator(".documentSearchStatus")).toHaveText("1 / 3");

  await query.fill("review rendered");
  await expect(search.locator(".documentSearchStatus")).toHaveText("1 / 1");
  await expect
    .poll(() =>
      page
        .locator(".rd-search-active")
        .allTextContents()
        .then((parts) => parts.join("")),
    )
    .toBe("review rendered");

  await query.press("Escape");
  await expect(search).toBeHidden();
  await expect(page.locator(".rd-search-match")).toHaveCount(0);
});

test("attributes new comments to the local reviewer profile", async ({
  page,
}) => {
  await clickToolbarAction(page, "View and settings", "Reviewer profile…");
  const profile = page.getByRole("complementary", {
    name: "Reviewer profile",
  });
  await profile.getByLabel("Display name").fill("Alice");
  await profile.getByRole("button", { name: "Save profile" }).click();

  await selectRenderedText(page, "rendered Markdown");
  const composer = page.getByRole("dialog", { name: "New review comment" });
  await expect(composer).toContainText("Commenting as Alice");
  await composer.getByPlaceholder("What should change?").fill("Alice review");
  await composer.getByRole("button", { name: "Save comment" }).click();

  await expect(page.getByLabel("Author: Alice")).toBeVisible();
  await page.getByLabel("Filter by author").selectOption({ label: "Alice" });
  await expect(page.getByText("Alice review")).toBeVisible();

  await clickToolbarAction(page, "View and settings", "Reviewer profile…");
  await expect(
    page
      .getByRole("complementary", { name: "Reviewer profile" })
      .getByLabel("Display name"),
  ).toHaveValue("Alice");
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

test("opens a generated novel without blocking the document surface", async ({
  page,
}) => {
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  const started = process.env.CI ? undefined : Date.now();
  await chooser.setFiles({
    name: "generated-performance-novel.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(buildLargeMarkdownFixture()),
  });
  const surface = page.locator("#document-surface");
  await expect(surface).toBeVisible();
  expect(await surface.locator("[data-rd-block-id]").count()).toBe(
    LARGE_MARKDOWN_EXPECTED_BLOCKS,
  );
  if (started !== undefined) {
    expect(Date.now() - started).toBeLessThan(LARGE_DOCUMENT_OPEN_BUDGET_MS);
  }

  const outline = page.getByRole("complementary", {
    name: "Document outline",
  });
  await expect(outline).toBeVisible();
  expect(await outline.locator(".outlineList button").count()).toBe(
    LARGE_MARKDOWN_EXPECTED_HEADINGS,
  );
  await outline.locator(".outlineList button").nth(10).click();
  await expect
    .poll(() =>
      page.locator(".documentRegion").evaluate((region) => region.scrollTop),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("Control+f");
  const search = page.getByRole("search", { name: "Find in document" });
  await search
    .getByRole("searchbox", { name: "Search text" })
    .fill("Chapter 100");
  await expect(search.locator(".documentSearchStatus")).toHaveText("1 / 44");
  await expect(page.locator(".rd-search-active").first()).toBeVisible();
  const activeOutlineItem = outline.locator(".outlineItemActive");
  await expect(activeOutlineItem).toHaveText("Chapter 100");
  await expect
    .poll(() =>
      activeOutlineItem.evaluate((item) => {
        const list = item.parentElement;
        if (!list) return false;
        const itemBounds = item.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        const itemCenter = itemBounds.top + itemBounds.height / 2;
        const listCenter = listBounds.top + listBounds.height / 2;
        return Math.abs(itemCenter - listCenter);
      }),
    )
    .toBeLessThan(2);
  await search.getByRole("searchbox", { name: "Search text" }).press("Escape");

  await clickToolbarAction(page, "View and settings", "Hide outline");
  await expect(outline).toBeHidden();
  await clickToolbarAction(page, "View and settings", "Show outline");
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
  const anchor = page.getByRole("button", {
    name: "open review comment, exact anchor: rendered Markdown",
  });
  await expect(anchor).toHaveText("rendered Markdown");
  await anchor.focus();
  await anchor.press("Enter");
  await expect(page.locator('.commentCard[aria-current="true"]')).toContainText(
    "Clarify why this distinction matters.",
  );
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

test("highlights only the exact selection inside a longer text span", async ({
  page,
}) => {
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "precise-highlight.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Precise highlight\n\nThis sentence mentions symlink and sidecar as separate targets.",
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Precise highlight" }),
  ).toBeVisible();

  await selectRenderedText(page, "symlink");
  const composer = page.getByRole("dialog", { name: "New review comment" });
  await composer.getByPlaceholder("What should change?").fill("Check symlink.");
  await composer.getByRole("button", { name: "Save comment" }).click();

  const anchor = page.getByRole("button", {
    name: "open review comment, exact anchor: symlink",
  });
  await expect(anchor).toHaveText("symlink");
  await expect(page.locator(".rd-anchor")).toHaveCount(1);
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
  await clickToolbarAction(page, "Export", "Edit instructions…");
  const instructions = page.getByRole("dialog", {
    name: "Review instructions",
  });
  const customInstruction =
    "Apply the feedback using the project terminology. Report anything you cannot locate.";
  await instructions
    .getByRole("textbox", { name: "Instruction" })
    .fill(customInstruction);
  await instructions.getByRole("button", { name: "Save instructions" }).click();
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
  expect(clipboard).toContain(customInstruction);
  expect(clipboard).not.toContain(
    "Never guess an ambiguous or unmatched target",
  );
  expect(clipboard).toContain("Add a concrete integrity example.");

  await page.reload();
  await clickToolbarAction(page, "Export", "Edit instructions…");
  await expect(page.getByRole("textbox", { name: "Instruction" })).toHaveValue(
    customInstruction,
  );
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

import { fingerprintText } from "../fingerprints";
import { parseMarkdownDocument } from "./model";
import { mapDomSelection } from "./selection";

function selectText(surface: HTMLElement, text: string): Selection {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection!;
    }
    node = walker.nextNode();
  }
  throw new Error(`Could not find ${text}`);
}

describe("DOM selection source mapping", () => {
  it("round-trips formatted and linked rendered selections to raw Markdown", async () => {
    const source =
      "Select *formatted* and [linked text](https://example.com) here.";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const surface = document.createElement("article");
    surface.innerHTML = model.html;
    document.body.append(surface);

    const formatted = mapDomSelection(
      selectText(surface, "formatted"),
      surface,
      model,
    );
    expect(formatted.kind).toBe("mapped");
    if (formatted.kind === "mapped")
      expect(formatted.selection.sourceText).toBe("*formatted*");

    const linked = mapDomSelection(
      selectText(surface, "linked text"),
      surface,
      model,
    );
    expect(linked.kind).toBe("mapped");
    if (linked.kind === "mapped") {
      expect(linked.selection.sourceText).toBe(
        "[linked text](https://example.com)",
      );
    }
    surface.remove();
  });

  it("maps code containing Unicode using UTF-16 offsets", async () => {
    const source = "```js\nconst face = '😀';\n```";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const surface = document.createElement("article");
    surface.innerHTML = model.html;
    document.body.append(surface);
    const mapped = mapDomSelection(selectText(surface, "😀"), surface, model);
    expect(mapped.kind).toBe("mapped");
    if (mapped.kind === "mapped") {
      expect(mapped.selection.sourceText).toBe("😀");
      expect(
        mapped.selection.sourceRange.end - mapped.selection.sourceRange.start,
      ).toBe(2);
    }
    surface.remove();
  });

  it("maps CRLF text, table cells, and complete inline math", async () => {
    const source =
      "# H\r\n\r\nA *café 😀* value.\r\n\r\n| Cell | Math |\r\n| --- | --- |\r\n| alpha | $E=mc^2$ |";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const surface = document.createElement("article");
    surface.innerHTML = model.html;
    document.body.append(surface);

    const unicode = mapDomSelection(
      selectText(surface, "café 😀"),
      surface,
      model,
    );
    expect(unicode.kind).toBe("mapped");
    if (unicode.kind === "mapped")
      expect(unicode.selection.sourceText).toBe("*café 😀*");

    const cell = mapDomSelection(selectText(surface, "alpha"), surface, model);
    expect(cell.kind).toBe("mapped");
    if (cell.kind === "mapped")
      expect(cell.selection.block.kind).toBe("tableCell");

    const mathElement = surface.querySelector<HTMLElement>(
      "[data-rd-math-start]",
    );
    const mathWalker = document.createTreeWalker(
      mathElement!,
      NodeFilter.SHOW_TEXT,
    );
    const mathText = mathWalker.nextNode();
    expect(mathText).toBeDefined();
    const mathRange = document.createRange();
    mathRange.setStart(mathText!, 0);
    mathRange.setEnd(mathText!, Math.min(1, mathText!.textContent!.length));
    const mathSelection = window.getSelection()!;
    mathSelection.removeAllRanges();
    mathSelection.addRange(mathRange);
    const math = mapDomSelection(mathSelection, surface, model);
    expect(math.kind).toBe("mapped");
    if (math.kind === "mapped")
      expect(math.selection.sourceText).toBe("$E=mc^2$");
    surface.remove();
  });

  it("rejects cross-block selections", async () => {
    const source = "First paragraph.\n\nSecond paragraph.";
    const model = await parseMarkdownDocument(
      source,
      await fingerprintText(source),
    );
    const surface = document.createElement("article");
    surface.innerHTML = model.html;
    document.body.append(surface);
    const paragraphs = surface.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!.firstChild!, 0);
    range.setEnd(paragraphs[1]!.firstChild!.firstChild!, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(mapDomSelection(selection, surface, model).kind).toBe("unsupported");
    surface.remove();
  });
});

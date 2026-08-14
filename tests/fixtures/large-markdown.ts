const CHAPTER_COUNT = 210;
const PARAGRAPHS_PER_CHAPTER = 43;

export const LARGE_MARKDOWN_EXPECTED_BLOCKS =
  1 + CHAPTER_COUNT * (1 + PARAGRAPHS_PER_CHAPTER);
export const LARGE_MARKDOWN_EXPECTED_HEADINGS = 1 + CHAPTER_COUNT;

export function buildLargeMarkdownFixture(): string {
  const blocks = ["# Generated performance novel"];
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
    blocks.push(`## Chapter ${chapter}`);
    for (
      let paragraph = 1;
      paragraph <= PARAGRAPHS_PER_CHAPTER;
      paragraph += 1
    ) {
      blocks.push(
        `Chapter ${chapter}, paragraph ${paragraph}: source-backed Unicode prose 😀 with stable anchors.`,
      );
    }
  }
  return `${blocks.join("\n\n")}\n`;
}

# Revdown Application Plan

Status: MVP implemented; pre-release validation in progress
Last revised: 2026-08-13

## 1. Product Summary

Revdown is a cross-platform desktop application for reviewing Markdown without
modifying the source document. A reviewer opens a local Markdown file, selects
text in its rendered form, and attaches comments. Revdown stores those comments
in a structured sidecar file next to the source.

The sidecar is designed for two related uses:

1. Reopen the document in Revdown and continue the review.
2. Export the review as concise, self-describing Markdown that a person, an LLM,
   or a coding agent can use to revise the source document.

Revdown itself never applies revisions to the source Markdown in the initial
application. Its job is to capture precise feedback, preserve it safely, and
make the feedback portable.

## 2. Problem Statement

Reviewing a long Markdown document produced by an LLM is awkward in a text
editor. Adding feedback directly to the document:

- changes the source and can accidentally damage its syntax;
- mixes source content with review instructions;
- makes exact selections difficult to communicate;
- creates unnecessary tokens when the document is sent back to an LLM; and
- provides no reliable way to detect whether comments still match after the
  source changes.

Existing Markdown editors focus on changing the document. Existing code review
tools generally require a repository, commit, or pull request. Revdown fills the
smaller local workflow between those categories.

## 3. Goals

The initial application will:

- run as a native desktop application on Windows and macOS;
- open local UTF-8 Markdown files in a read-only rendered view;
- render CommonMark, GitHub Flavored Markdown, code, and math well;
- let a reviewer comment on a selection within a rendered source block;
- create, edit, resolve, reopen, and delete comments;
- keep the source document byte-for-byte unchanged;
- save comments atomically in a versioned JSON sidecar;
- detect document drift and re-anchor comments conservatively;
- distinguish exact, relocated, ambiguous, and unmatched anchors;
- export an efficient Markdown review for LLM and agent workflows; and
- remain useful without an account, network connection, or LLM API key.

## 4. Non-Goals for the Initial Application

The first release will not:

- edit or automatically revise the source Markdown;
- call hosted or local LLM APIs;
- provide real-time collaboration or cloud synchronization;
- replace Git or preserve a full history of source-document snapshots;
- support threaded discussions or multiple reviewer identities;
- guarantee arbitrary selections across unrelated rendered blocks;
- execute embedded HTML, scripts, or active content;
- support every Markdown dialect or MDX; or
- infer a numeric amount of drift from a cryptographic hash.

These exclusions keep the first version focused on trustworthy annotation and
export. Features can be reconsidered after the core workflow is proven.

## 5. Product Principles

### 5.1 Source integrity

Revdown must never write to the opened Markdown file. All writes go to a new or
existing sidecar or to an explicitly chosen export path.

### 5.2 Transparent confidence

The application must not silently guess where a stale comment belongs. Match
quality is visible, and ambiguous or unmatched comments remain available for
manual action.

### 5.3 Local first

Reviewing and exporting work offline. Remote content is not required for the
core experience.

### 5.4 Structured storage, readable interchange

JSON is the canonical application format. Markdown is a generated interchange
format for people and LLMs. Keeping these roles separate prevents display
formatting from becoming a fragile persistence contract.

### 5.5 Model-agnostic instructions

Exports describe the task and format without assuming the document's domain or
the capabilities of a specific LLM. The instructions ask a reviser to preserve
the source's purpose, voice, and style unless a comment directs otherwise.

## 6. Primary Workflow

1. The user opens `document.md`.
2. Revdown reads the file without obtaining write access and renders it.
3. Revdown looks for `document.md.rd.json` in the same directory.
4. Existing comments are validated, matched against the current document, and
   shown in the document and review panel.
5. The user selects text within one supported rendered block and creates a
   comment.
6. Revdown captures source positions, quotes, surrounding context, structural
   hints, and hashes for the anchor.
7. Revdown writes the sidecar atomically. The source remains untouched.
8. The user exports open comments to Markdown or copies the generated review to
   the clipboard.
9. A person, LLM, or coding agent applies the feedback and reports any comments
   it could not match confidently.
10. When the changed source is reopened, Revdown re-evaluates all anchors and
    displays their current status.

## 7. User Experience

### 7.1 Main window

The desktop window has five stable regions:

- A compact toolbar for opening a document, toggling navigation and review
  panels, filtering comment status, and exporting the review.
- A collapsible document outline that lists source-backed headings and scrolls
  directly to them.
- A scrollable rendered-document surface where comment anchors are highlighted.
- A resizable review panel listing comments in document order.
- A collapsible, canvas-rendered minimap with a live viewport indicator and
  visible markers for open and resolved comments.

The document is the primary surface. Comments should be easy to discover but
must not obscure the text. Selecting a comment scrolls to and emphasizes its
anchor; selecting an anchor opens its comment. Outline and minimap navigation
must remain inexpensive for novel-sized documents and must not duplicate the
entire rendered document as hidden DOM.

Packaged builds register Revdown as an alternate viewer for `.md` and
`.markdown` documents without replacing the user's chosen default application.
Files opened from Finder, Explorer, or a command-line launch are routed through
the same read-only loader as the Open Markdown action. A request made while
Revdown is already running reuses and focuses the existing application window.

### 7.2 Creating a comment

After a valid text selection, a small comment action appears near the selection.
Activating it opens a focused composer. Saving creates the sidecar if necessary.
Canceling creates no persistent data.

For the MVP, a selection must remain within one source-backed block, such as a
paragraph, heading, list item, blockquote paragraph, table cell, or code block.
Unsupported selections receive a clear explanation rather than being truncated
or accepted imprecisely.

### 7.3 Comment states

Comments have a review state:

- `open`: included in exports by default;
- `resolved`: retained but omitted from exports by default.

Separately, each comment has a computed anchor state:

- `exact`: the original document fingerprint and source range still match;
- `relocated`: a unique, high-confidence match was found after document drift;
- `ambiguous`: more than one plausible match exists;
- `unmatched`: no sufficiently reliable match exists.

Anchor state is computed when a document is loaded and is not silently written
back to the sidecar. The user may explicitly confirm a relocated or ambiguous
match to replace the stored anchor with one based on the current document.

### 7.4 Accessibility

The application targets WCAG 2.2 AA for its own interface. All commands need a
keyboard path, focus must remain visible, status cannot be communicated by color
alone, and comment-to-anchor navigation must work with assistive technology.
Standard browser text selection remains available to keyboard users.

### 7.5 Reading appearance

Reader preferences include system-aware light, sepia, and dark themes plus
serif or sans-serif type, four text sizes, three line spacings, and three line
widths. Preferences are stored locally and never modify the source document or
its sidecar. The native window background follows the resolved theme. On macOS,
the content uses an overlay title bar so both windowed and full-screen layouts
draw through the native title-bar region without revealing an unrelated border.
The macOS bundle opts out of display safe-area compatibility mode after keeping
toolbar controls away from the camera housing with safe-area insets. Since
native macOS full screen reserves the camera/menu-bar strip, Revdown's View >
Full screen action uses the platform's simple full-screen mode so the window
background reaches the display edge without a Space transition. The macOS
traffic-light control retains its native full-screen behavior. Revdown observes
both modes so its View action and Escape can exit whichever mode is active.

## 8. File Conventions

### 8.1 Canonical sidecar

The default sidecar name is the complete source filename followed by
`.rd.json`:

| Source | Sidecar |
| --- | --- |
| `document.md` | `document.md.rd.json` |
| `notes.markdown` | `notes.markdown.rd.json` |

Preserving the full source filename avoids collisions between files with the
same stem but different extensions. The shorter `.rd` marker keeps the name
recognizable without spelling out the product name.

The sidecar resides next to its source by default. It contains the source
filename, never an absolute path, so a document and sidecar can be moved
together or committed without leaking machine-specific paths.

### 8.2 Generated review export

The default exported Markdown name is `<source-filename>.rd.md`, for example
`document.md.rd.md`. An export is derived data and may be regenerated at any
time. It is not read as canonical annotation storage.

Clipboard export produces the same content without creating a file.

## 9. Canonical Sidecar Model

### 9.1 Format rules

- JSON encoded as UTF-8.
- A required integer `schemaVersion`, beginning at `1`.
- UUID v4 identifiers generated with the platform cryptographic API.
- UTC timestamps in ISO 8601 format.
- SHA-256 values encoded as lowercase hexadecimal.
- Source offsets represented as zero-based UTF-16 code-unit offsets into the
  decoded JavaScript source string, with an exclusive end offset.
- Display line and column hints represented as one-based values.
- Unknown future properties preserved when safely rewriting a supported schema.
- Unsupported schema versions opened read-only with a clear error; they are
  never overwritten.

The offset convention is explicit because JavaScript string offsets differ from
UTF-8 byte offsets for some characters. Exact file hashes are calculated over
the original bytes and are independent of source offsets.

### 9.2 Source fingerprints

Two document fingerprints are useful:

- `sha256`: hash of the exact file bytes. Equality means the file is
  byte-for-byte identical.
- `normalizedSha256`: hash after decoding valid UTF-8, removing an optional UTF-8
  byte-order mark, converting CRLF and CR line endings to LF, and encoding as
  UTF-8 again. No other whitespace or Unicode normalization is performed.

The normalized hash prevents line-ending conversion alone from making every
comment appear stale. Neither hash measures how much a document changed.

Each anchor stores the document hashes observed when that anchor was created or
explicitly confirmed. This matters because new comments may be added after an
older source has already changed.

### 9.3 Initial schema shape

The following example is illustrative. The implementation must define and test
the authoritative runtime schema before persistence work begins.

```json
{
  "schemaVersion": 1,
  "source": {
    "filename": "document.md",
    "lastObservedSha256": "0123456789abcdef...",
    "lastObservedNormalizedSha256": "0123456789abcdef..."
  },
  "createdAt": "2026-08-13T10:00:00.000Z",
  "updatedAt": "2026-08-13T10:05:00.000Z",
  "comments": [
    {
      "id": "5a5ea9e9-7983-48e7-9377-fac74a69f061",
      "status": "open",
      "body": "Explain why this constraint is necessary.",
      "createdAt": "2026-08-13T10:05:00.000Z",
      "updatedAt": "2026-08-13T10:05:00.000Z",
      "anchor": {
        "documentSha256": "0123456789abcdef...",
        "documentNormalizedSha256": "0123456789abcdef...",
        "sourceRange": {
          "start": 418,
          "end": 463
        },
        "sourceText": "the queue accepts at most one pending request",
        "textQuote": {
          "exact": "the queue accepts at most one pending request",
          "prefix": "During shutdown, ",
          "suffix": ". Further requests"
        },
        "block": {
          "start": 392,
          "end": 489,
          "sourceSha256": "abcdef0123456789..."
        },
        "headingPath": ["Architecture", "Shutdown"],
        "lineHint": {
          "start": 18,
          "end": 18
        }
      }
    }
  ]
}
```

Comment bodies use Markdown text but are rendered with the same safety rules as
the source. Threaded replies, attachments, authors, and full source snapshots
are intentionally absent from schema version 1.

## 10. Selection and Source Mapping

Source mapping is the highest technical risk and must be proven before the full
interface is built.

The unified parser provides positional metadata on Markdown syntax-tree nodes.
Revdown will preserve that metadata as Markdown is transformed to HTML and will
mark source-backed rendered blocks with their source ranges. Within each block,
it will maintain a mapping between selectable DOM text and the corresponding raw
Markdown source.

The mapping must account for inline Markdown syntax whose rendered text differs
from its source, including emphasis, links, escapes, entities, and inline code.
The stored anchor therefore contains both:

- `sourceText`: the exact raw Markdown slice; and
- `textQuote.exact`: the text the reviewer saw and selected.

Initial behavior by content type:

- Paragraphs, headings, list items, and blockquotes: support text selections
  across inline formatting within one block.
- Links: select the visible label; retain the raw Markdown source slice.
- Fenced code: support selections within one code block and preserve raw code.
- Tables: support a selection within one cell.
- Math: allow anchoring the complete inline or display math source node; selecting
  an arbitrary visual subexpression is deferred because KaTeX output does not
  map reliably back to source characters.
- Images and non-text nodes: allow a block-level comment in a later milestone,
  but not an arbitrary text selection in the initial vertical slice.
- Raw HTML: do not execute it and do not promise source-mapped selection in the
  MVP.

A dedicated source-mapping spike must demonstrate correct round trips for
Unicode, CRLF, repeated text, emphasis, links, inline code, fenced code, lists,
tables, and math. Failure of that spike should change the rendering approach
before other application code depends on it.

## 11. Re-Anchoring After Document Drift

Opening a document never mutates stored anchors automatically. Revdown computes
matches using increasingly permissive evidence:

1. If the exact or normalized document hash matches, verify `sourceRange` and
   `sourceText` at the stored offsets.
2. Search for an exact `sourceText` match inside the original containing block
   or current heading section.
3. Search for an exact rendered `textQuote` in source-backed blocks, scoring its
   prefix, suffix, block fingerprint, and heading path.
4. Search for a unique exact source or rendered quote elsewhere in the document.
5. Apply conservative fuzzy comparison only within structurally plausible
   blocks.
6. If no single candidate clears the confidence threshold, classify the anchor
   as `ambiguous` or `unmatched`.

Line numbers and heading paths are hints, not identities. Paragraph indexes such
as `p[2]` are not stored because inserting a paragraph makes them stale.

Confidence thresholds will be selected against a checked-in fixture corpus,
not intuition. Tests must include repeated phrases and deliberately misleading
near-matches. The algorithm should prefer an unresolved comment over a wrong
high-confidence match.

## 12. LLM and Agent Export Contract

The generated Markdown review contains:

- the target filename and observed document hashes;
- short format and execution instructions;
- each exported comment's ID and anchor state;
- heading context and line hints;
- exact target text plus prefix and suffix;
- raw source text when it differs materially from rendered text; and
- the reviewer's feedback.

Open comments are exported by default. The user may include resolved comments.
Ambiguous and unmatched comments remain in the export and are clearly marked.

The generated instructions will communicate these rules:

1. Locate each target using all supplied anchor evidence rather than line hints
   alone.
2. Apply the feedback while preserving the document's purpose, voice, style,
   and formatting unless the comment requests a change.
3. Focus edits on the targeted region, but adjust nearby text when necessary for
   grammar, correctness, consistency, or natural flow.
4. Avoid unrelated rewrites.
5. Do not guess when a target remains ambiguous or unmatched.
6. When filesystem tools are available, edit the named source and summarize the
   result. Otherwise, provide the revised document in the form appropriate to
   the active conversation.
7. Report which comments were applied, skipped, ambiguous, or unmatched.

These are instructions contained in user-provided data, not a guarantee of LLM
behavior. System or user instructions in the active LLM environment may take
precedence. Revdown will make the review self-describing without claiming that
every model or agent will execute it automatically.

## 13. Technology Decisions

### 13.1 Desktop and frontend

| Area | Decision | Reason |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Small distributable, native filesystem boundary, Windows and macOS support |
| Native layer | Stable Rust | Safe file operations, hashing, dialogs, and file watching |
| Frontend | React with strict TypeScript | Mature accessibility, component, and testing ecosystem |
| Build tool | Vite | Fast local development and first-class Tauri integration |
| Package manager | pnpm | Reproducible lockfile and efficient dependency management |
| Styling | CSS Modules plus global design tokens | Scoped styles without a large runtime or utility dependency |
| Application state | React reducer/context initially | The MVP state model does not justify a separate state library |

Use a currently supported Node.js LTS release and the stable Rust toolchain.
Exact dependency versions belong in lockfiles rather than this plan.

### 13.2 Content pipeline

| Capability | Decision |
| --- | --- |
| Markdown AST | unified with remark-parse |
| GFM | remark-gfm |
| Math syntax | remark-math |
| HTML conversion | remark-rehype and controlled rehype plugins |
| Math rendering | KaTeX through rehype-katex |
| Code highlighting | Shiki with languages and themes loaded on demand |
| Schema validation | Zod at the TypeScript boundary |
| Hashing | SHA-256 through Rust or the Web Crypto API with shared test vectors |

Shiki initialization must be asynchronous and cached. Themes are initialized
once, while each supported language grammar is imported only when a document
uses it; unsupported language labels fall back to unhighlighted code.

### 13.3 Testing and quality

| Layer | Tooling |
| --- | --- |
| Type checking | TypeScript compiler in strict mode |
| Frontend unit/component tests | Vitest and Testing Library |
| Browser workflow tests | Playwright against the frontend harness |
| Rust tests | Cargo test |
| Formatting and linting | Prettier, ESLint, rustfmt, and Clippy |
| CI | GitHub Actions on Windows and macOS |

Playwright does not by itself validate every native Tauri integration. Browser
tests will cover rendering, selection, comments, and export through mocked native
adapters. Rust tests cover native services, and packaged desktop smoke tests are
run on both target platforms before release.

## 14. Application Architecture

The frontend owns parsing, rendering, selection mapping, comments, anchor
matching, validation, and export generation. Rust provides a deliberately narrow
native boundary:

- open-file dialog;
- read source bytes;
- read an optional sidecar;
- atomically write a validated sidecar or export;
- return file metadata and change notifications;
- open approved external links in the system browser; and
- calculate hashes if measurements show a benefit over Web Crypto.

All native calls use typed request and response objects. Frontend features depend
on an interface rather than direct Tauri imports so the same workflows can run
in browser tests.

Suggested initial project layout:

```text
src/
  app/
  components/
  features/
    comments/
    document/
    export/
  lib/
    anchors/
    markdown/
    schema/
  services/
    native.ts
    native.browser.ts
src-tauri/
  src/
    commands/
    files.rs
    lib.rs
tests/
  fixtures/
  e2e/
```

Code organization may evolve, but anchor logic, persistence schema, Markdown
rendering, and native I/O should remain separable and independently testable.

## 15. Persistence and Conflict Handling

Sidecar saves use an atomic replace strategy:

1. Serialize validated JSON with stable formatting and a trailing newline.
2. Write a uniquely named temporary file in the destination directory.
3. Flush and close the temporary file.
4. Replace the destination using the safest atomic operation available on the
   platform.
5. Clean up abandoned temporary files when possible.

Before saving, Revdown compares the sidecar's current file metadata or content
hash with the version originally loaded. If another process changed it, Revdown
does not overwrite it. The user is offered reload or explicit conflict
resolution.

Source file changes trigger a debounced reload prompt. Unsaved comment text is
kept in memory while the source is reparsed. Revdown never writes a watched
source file.

## 16. Security and Privacy

Markdown is untrusted input even when it is local. The initial application will:

- use a strict Tauri capability configuration and content security policy;
- disable script execution and unsafe URL schemes;
- not pass raw HTML through to executable DOM;
- sanitize any HTML introduced by rendering plugins;
- prevent Markdown links from invoking Tauri commands;
- open web links externally rather than inside the privileged application view;
- resolve local image paths against the document directory and prevent path
  traversal outside approved scope;
- avoid loading remote images by default to prevent tracking and network leaks;
- validate sidecars before displaying or writing them; and
- never include absolute local paths in exports unless the user explicitly asks.

Comment Markdown follows the same rendering policy. No telemetry is included in
the initial application.

## 17. Performance Targets

Performance will be measured on named reference machines once the first vertical
slice exists. Initial release targets are:

- A 1 MiB Markdown document becomes readable within 2 seconds on a supported
  mid-range machine after application startup.
- Selection and comment interactions do not perform synchronous full-document
  reparsing.
- Saving a normal sidecar feels immediate and never blocks document scrolling.
- A sidecar with 1,000 comments can be loaded and matched without freezing the
  interface.
- Shiki languages and themes are loaded lazily and cached.

Large-document fixtures and timing instrumentation will be checked in. If the
targets are missed, profiling precedes architectural changes.

## 18. Delivery Milestones

### Milestone 0: Project foundation

- Scaffold Tauri 2, React, TypeScript, Vite, and pnpm.
- Add formatting, linting, strict type checking, unit tests, and CI.
- Define the native adapter interface and minimal Tauri capabilities.
- Add Windows and macOS development instructions.

Exit criterion: a packaged empty application builds in CI on both target
platforms, and all quality commands pass locally.

### Milestone 1: Source-mapping risk spike

- Build the unified Markdown pipeline with GFM, KaTeX, and Shiki.
- Preserve source positions through the render tree.
- Implement DOM-selection-to-source mapping for the supported MVP blocks.
- Create fixture documents covering formatting and encoding edge cases.
- Document unsupported selections in code and product behavior.

Exit criterion: automated fixtures prove that visible selections round-trip to
the intended raw source ranges on Chromium and WebKit browser engines. The team
accepts the mapping approach before feature work continues.

### Milestone 2: Read-only document viewer

- Open a Markdown file through the native dialog.
- Render it in the main window with a polished reading layout.
- Add safe links, local images, loading, empty, and error states.
- Watch for external source changes without writing to the source.

Exit criterion: representative Markdown files render correctly on Windows and
macOS, and tests verify that viewer actions never modify the source bytes.

### Milestone 3: Comments and persistence

- Finalize the version 1 Zod schema and compatibility fixtures.
- Add comment creation, editing, resolving, reopening, and deletion.
- Add document highlights and the review panel.
- Implement sidecar discovery, validation, atomic save, and conflict detection.

Exit criterion: closing and reopening restores comments and exact anchors; forced
write failures or external sidecar changes do not corrupt or overwrite data.

### Milestone 4: Drift and re-anchoring

- Implement exact and normalized fingerprints.
- Implement deterministic candidate generation and confidence scoring.
- Display exact, relocated, ambiguous, and unmatched states.
- Add explicit anchor confirmation and replacement.
- Build a drift fixture corpus with repeated and misleading text.

Exit criterion: changed documents retain reliable anchors, uncertain cases are
never presented as exact, and the test corpus has no known false-positive
high-confidence matches.

### Milestone 5: Review export

- Generate the model-agnostic Markdown review format.
- Add file and clipboard export.
- Filter open and resolved comments.
- Include and report uncertain anchors without inventing matches.
- Test exports against representative documents and comments containing Markdown
  syntax, code fences, and Unicode.

Exit criterion: a person or coding agent can understand each exported target and
instruction without access to Revdown's JSON schema documentation.

### Milestone 6: Release hardening

- Complete keyboard and screen-reader review.
- Verify security policy, link handling, and path containment.
- Measure and tune performance targets.
- Add application metadata, icons, installers, and update documentation.
- Build macOS and Windows artifacts when a GitHub release is published, with
  optional Developer ID/notarization and Authenticode signing credentials.
- Run packaged smoke tests on supported Windows and macOS versions.

Exit criterion: release checklist passes on both platforms with no known source
integrity, sidecar data-loss, or high-severity security defects.

## 19. MVP Acceptance Criteria

The MVP is complete when all of the following are true:

1. A user can open and read a local Markdown document containing GFM, code, and
   math on Windows and macOS.
2. The user can comment on a supported rendered selection and manage the comment
   without changing the source file.
3. Revdown writes and reloads a valid `document.md.rd.json` sidecar atomically.
4. Exact source bytes before and after a complete review session are identical.
5. Comments remain anchored after common insertions and moves when there is a
   unique reliable match.
6. Ambiguous and missing targets are visibly reported and never silently guessed.
7. The user can export a self-describing Markdown review to a file or clipboard.
8. External sidecar modifications produce a conflict instead of data loss.
9. Raw Markdown content cannot execute scripts or privileged native commands.
10. Automated checks and packaged smoke tests pass on the supported platforms.

## 20. Known Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Rendered text cannot always map cleanly to Markdown source | Complete the source-mapping spike first; constrain unsupported selections explicitly |
| System webviews differ between Windows and macOS | Test Chromium and WebKit browser harnesses; perform packaged smoke tests on both systems |
| Fuzzy matching attaches feedback to the wrong text | Prefer unresolved states, require uniqueness, and tune thresholds against adversarial fixtures |
| Sidecar writes lose concurrent changes | Use atomic writes and optimistic conflict detection |
| Large documents block the UI | Avoid reparsing on interaction, lazy-load highlighting, measure with large fixtures |
| Local Markdown loads unsafe content | Use strict CSP, sanitize output, block active HTML and remote resources by default |
| Export instructions are treated as guaranteed commands | Describe them as portable guidance and always report uncertain targets |
| Schema changes break older reviews | Version the schema, preserve fixtures, and implement explicit migrations |

## 21. Post-MVP Possibilities

Potential later work, guided by actual usage:

- optional LLM provider integrations;
- a CLI for validating sidecars and generating exports;
- block-level comments on images, diagrams, and rendered math;
- carefully designed cross-block selections;
- comment threads, authors, labels, and review summaries;
- portable review bundles containing an optional source snapshot;
- Git-aware source revision metadata;
- additional Markdown dialects;
- Linux packages; and
- agent integrations that can apply feedback and return per-comment results.

None of these should broaden the initial architecture until the annotation,
re-anchoring, and export workflow has been validated with real documents.

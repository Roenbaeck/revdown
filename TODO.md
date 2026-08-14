# Revdown code review TODO

Static review performed 2026-08-14 against the MVP invariants in
[AGENTS.md](AGENTS.md) and [PLAN.md](PLAN.md). The local environment has no
Node.js, pnpm, or Rust toolchain installed, so this was a dry-run source review:
no lint, typecheck, unit, browser, Rust, or packaged-app command was executed.
Editor diagnostics only reported missing installed type definitions from the
absent `node_modules` directory; that is not treated as a project defect.

## P0 - Release blockers

- [ ] **Prevent review export from overwriting the opened source or canonical
      sidecar.** `export_review` accepts the save-dialog destination and passes
      it directly to `atomic_write`, so selecting the open `.md` file replaces
      the source with generated review Markdown. This violates Revdown's core
      source-integrity guarantee.
  - Evidence: [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L401-L428)
  - Improvement: move destination validation into a testable helper, resolve
    the selected path safely (including Windows case folding and existing
    symlink/reparse aliases), and reject the active source and its `.rd.json`
    sidecar before opening either for write.
  - Done when: Rust tests cover direct, case-variant, relative, symlink/reparse,
    source, and sidecar destinations and compare source bytes before and after
    rejected exports.

- [ ] **Scope queued saves and save results to the document session that
      created them.** The component-wide save queue reads the mutable global
      sidecar revision when a queued operation starts, and its completion
      always dispatches into the current document. Opening document B while a
      save for A is pending can use B's revision for A, then apply A's result to
      B's state.
  - Evidence: [src/app/App.tsx](src/app/App.tsx#L288-L335),
    [src/app/state.ts](src/app/state.ts#L47-L70)
  - Improvement: maintain save state per session or capture a session token and
    expected revision in every queued operation. Ignore completion actions that
    do not match the active session, and invalidate or drain old queues on a
    document switch.
  - Done when: a deterministic test delays A's save, opens B, completes A, and
    proves that B's revision, save status, sidecar, and conflict controls remain
    unchanged.

## P1 - Correctness and data integrity

- [ ] **Match rendered quote evidence only through rendered-to-source maps.**
      The rendered fallback searches `model.source` for `textQuote.exact`.
      Visible text can therefore relocate to an invisible link destination,
      image URL, Markdown delimiter, or other raw syntax. Context scoring also
      compares rendered prefix/suffix text to raw source, and confirmation
      replaces rendered context with raw Markdown slices.
  - Evidence: [src/lib/anchors/match.ts](src/lib/anchors/match.ts#L48-L65),
    [src/lib/anchors/match.ts](src/lib/anchors/match.ts#L239-L268),
    [src/lib/anchors/match.ts](src/lib/anchors/match.ts#L297-L326),
    [src/lib/markdown/selection.ts](src/lib/markdown/selection.ts#L68-L86)
  - Improvement: build rendered candidates from source-backed rendered spans
    and their boundary maps, score rendered context in rendered coordinates,
    and regenerate confirmed `textQuote` context from the rendered block.
  - Done when: adversarial tests reject occurrences found only in link/image
    destinations or syntax, while correctly relocating formatted text, links,
    entities, inline code, Unicode, and repeated visible phrases.

- [ ] **Block sidecar mutations while the source-change banner is active.**
      Polling sets `sourceChanged`, but comment capture, edit, resolve, delete,
      and anchor confirmation still use and persist the stale in-memory model.
      This can add anchors for source content that no longer exists on disk.
  - Evidence: [src/app/App.tsx](src/app/App.tsx#L345-L395),
    [src/app/App.tsx](src/app/App.tsx#L454-L475),
    [src/app/App.tsx](src/app/App.tsx#L530-L539)
  - Improvement: make source drift part of the shared mutation guard and UI
    read-only state. Preserve any composer/edit draft across reload, reparse,
    and rematch before allowing persistence again.
  - Done when: tests modify the source externally during a draft and before
    each mutation type, then verify no stale anchor is written and draft text
    survives reload.

- [ ] **Close the conflict-check-to-replace race for sidecar saves.** The
      current implementation hashes and compares the destination, closes that
      read, and only then performs the atomic replacement. Another process can
      change the sidecar in that interval and be overwritten despite optimistic
      conflict detection.
  - Evidence: [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L285-L311)
  - Improvement: use the strongest platform-specific conditional replacement
    or locking protocol available across validation and replacement. If a true
    compare-and-swap cannot be guaranteed, preserve the candidate as a conflict
    file and surface explicit recovery instead of overwriting uncertain state.
  - Done when: a synchronization-hook test injects an external write after the
    revision check and proves the external bytes are retained.

- [ ] **Require an actual source-backed block before reporting an anchor as
      exact.** A matching fingerprint and raw slice currently return `exact`
      even when `blockForRange` finds no renderable candidate. A malformed or
      legacy sidecar can therefore show a trusted state for an anchor that
      cannot be highlighted or navigated.
  - Evidence: [src/lib/anchors/match.ts](src/lib/anchors/match.ts#L198-L224),
    [src/lib/schema/sidecar.ts](src/lib/schema/sidecar.ts#L12-L59)
  - Improvement: classify ranges outside supported source-backed blocks as
    unmatched (or a validation issue), and validate block/range consistency
    against the loaded document before displaying trust states.
  - Done when: same-hash tests cover out-of-document ranges, Markdown-only
    syntax ranges, unsupported blocks, and mismatched stored block bounds.

## P1 - Performance targets

- [ ] **Bound and index stale-anchor matching work.** For each stale comment,
      fuzzy matching scans every structurally plausible block, creates multiple
      token windows, and runs Levenshtein comparison for each. The existing
      1,000-comment test exercises only the constant-time unchanged-fingerprint
      path, not the expensive drift path.
  - Evidence: [src/lib/anchors/match.ts](src/lib/anchors/match.ts#L128-L166),
    [src/lib/anchors/match.test.ts](src/lib/anchors/match.test.ts#L75-L122)
  - Improvement: pre-index normalized blocks once per document; reject by
    length, rare tokens, and structure before edit distance; cap candidate work
    per anchor; and move a large matching batch off interaction-critical work
    if profiling still shows long tasks.
  - Done when: benchmarks cover 1,000 relocated, ambiguous, and unmatched
    anchors in adversarial repeated text and enforce a measured responsiveness
    budget on named reference hardware.

- [ ] **Avoid a full Markdown pipeline and full DOM list for every comment.**
      Every mounted `CommentBody` fingerprints and parses its body through the
      document renderer, while `ReviewPanel` eagerly mounts all filtered
      comments. A 1,000-comment sidecar starts 1,000 async pipelines and creates
      all comment DOM at once.
  - Evidence: [src/components/CommentBody.tsx](src/components/CommentBody.tsx#L10-L27),
    [src/components/ReviewPanel.tsx](src/components/ReviewPanel.tsx#L153-L181),
    [src/lib/markdown/model.ts](src/lib/markdown/model.ts#L662-L681)
  - Improvement: add a cached, comment-specific safe renderer without source
    mapping or unnecessary highlighting, and virtualize/window the review list
    while preserving focus and selected-comment navigation.
  - Done when: a component/performance test opens and scrolls 1,000 mixed-size
    comments without a parse storm, focus loss, or user-visible long task.

- [ ] **Replace whole-file polling with debounced native change events.** Every
      two seconds the frontend invokes a native command that reads, UTF-8
      decodes, and hashes the entire source, even when nothing changed. The plan
      calls for native watching, and the separate byte and metadata reads can
      also describe different file states during an external write.
  - Evidence: [src/app/App.tsx](src/app/App.tsx#L374-L395),
    [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L92-L110),
    [src/services/native.ts](src/services/native.ts#L43-L49)
  - Improvement: expose a typed watch subscription through `NativeService`,
    debounce/coalesce events, and read content plus revision from one stable
    handle (or retry when metadata changes during the read).
  - Done when: adapter and native tests cover rapid writes, atomic replacements,
    temporary invalid UTF-8, deletion/recreation, and unsubscribe/session
    cleanup without repeated idle reads.

## P2 - Security, robustness, and UX

- [ ] **Validate the complete sidecar schema at the native write boundary.**
      Rust currently checks JSON syntax, schema version, filename, and that
      `comments` is an array. It can still overwrite canonical storage with
      malformed IDs, timestamps, hashes, ranges, states, or nested anchors if
      the command is invoked outside the expected frontend path.
  - Evidence: [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L203-L232),
    [src/lib/schema/sidecar.ts](src/lib/schema/sidecar.ts#L61-L109)
  - Improvement: enforce an equivalent typed version-1 contract in Rust while
    preserving unknown properties, or generate/share one authoritative schema
    and validate it on both sides of the IPC boundary.
  - Done when: Rust rejects malformed-but-structural version-1 fixtures and
    compatibility tests prove unknown properties survive valid rewrites.

- [ ] **Escape untrusted export metadata as Markdown.** The target filename is
      inserted into an inline-code span and heading-path segments are inserted
      directly into list text. Backticks and Markdown control characters can
      break the generated review structure or make data look like instructions.
  - Evidence: [src/lib/export/review.ts](src/lib/export/review.ts#L13-L31),
    [src/lib/export/review.ts](src/lib/export/review.ts#L67-L82)
  - Improvement: use dedicated emitters for Markdown plain text and inline code
    (or fenced metadata blocks), rather than interpolating untrusted values.
  - Done when: export tests cover filenames and headings containing backticks,
    brackets, emphasis markers, HTML, tabs, and allowed platform control cases.

- [ ] **Complete keyboard and screen-reader behavior for anchors and dialogs.**
      Document highlights are ordinary spans activated only by a delegated
      click, so they are not focusable or keyboard discoverable. The selection
      composer has dialog semantics and autofocus but no modal focus boundary,
      Escape handling, or focus restoration.
  - Evidence: [src/components/DocumentSurface.tsx](src/components/DocumentSurface.tsx#L142-L176),
    [src/components/SelectionComposer.tsx](src/components/SelectionComposer.tsx#L15-L43)
  - Improvement: provide semantic, focusable anchor navigation with accessible
    comment/status labels; implement modal focus management; restore focus to
    the originating action/selection; and preserve ordinary text selection.
  - Done when: Testing Library and Playwright keyboard tests cover anchor-to-
    comment navigation, dialog tab order, Escape/cancel, focus restoration, and
    status announcement without relying on color.

- [ ] **Use a FIFO for associated-file open requests or explicitly enforce a
      tested last-request-wins policy.** Native state stores only one pending
      path, so a burst of Finder/Explorer/single-instance requests silently
      replaces earlier requests before React consumes them.
  - Evidence: [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L17-L24),
    [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L77-L91)
  - Improvement: queue accepted requests with bounded FIFO behavior and define
    how sequential requests interact with unsaved drafts and pending saves.
  - Done when: native and integration tests enqueue multiple paths and observe
    deterministic handling without dropped requests or cross-session state.

## P2 - Validation and release hardening

- [ ] **Add regression coverage for persistence and the full MVP workflow.**
      Current browser coverage creates/manages a comment and copies an export,
      but does not reopen persisted comments, exercise source drift states,
      force a sidecar conflict, test file-export cancellation/failure, preserve
      a draft during reload, or prove source bytes across a complete session.
  - Evidence: [tests/e2e/review.spec.ts](tests/e2e/review.spec.ts#L217-L373),
    [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs#L507-L605)
  - Improvement: map tests directly to every MVP acceptance criterion, using
    the browser adapter for deterministic workflows and Rust tests for native
    atomicity, failures, path aliases, and source-byte integrity.
  - Done when: each acceptance criterion in `PLAN.md` names at least one
    automated check plus any required Windows/macOS packaged smoke test.

- [ ] **Run all documented Rust and packaged-app gates in CI.** Desktop CI runs
      `cargo test` and a Tauri build but omits `cargo fmt --check` and Clippy.
      Release jobs publish installers without smoke-testing the package, file
      association, second-instance routing, native dialogs, or persistence.
  - Evidence: [.github/workflows/ci.yml](.github/workflows/ci.yml#L37-L55),
    [.github/workflows/release.yml](.github/workflows/release.yml#L1-L89)
  - Improvement: add formatting and warning-denying Clippy gates, then install
    and launch built artifacts on Windows and macOS for a minimal source-open,
    sidecar-save, export, and source-integrity smoke path before publication.
  - Done when: release artifacts are withheld on any quality or packaged-smoke
    failure, and platform-specific checks are documented in `RELEASING.md`.

## Reviewed controls with no immediate action

- Raw HTML is not enabled, generated HTML is sanitized, and Markdown links are
  converted to inert data attributes before entering the document surface.
- Native external links allow only `http`, `https`, and `mailto` and open in the
  system handler rather than the privileged webview.
- Sidecar writes use unique sibling temporary files, flush contents, and use an
  atomic replacement primitive; the remaining concern is the conflict race
  listed above.
- Unsupported sidecar schema versions are surfaced read-only instead of being
  silently overwritten.
- Shiki initialization and language loading are cached and lazy rather than
  loading every grammar at startup.
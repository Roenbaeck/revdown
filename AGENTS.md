# Repository Guidelines

These instructions apply to the entire repository. Keep them current as the
project moves from planning into implementation.

## Sources of Truth

- Read [PLAN.md](PLAN.md) before making architectural or product decisions. It
  defines the MVP, technology choices, sidecar model, milestones, and acceptance
  criteria.
- Use [README.md](README.md) for the concise public description, not as a full
  technical specification.
- Follow the current implementation and locked dependency versions once they
  exist. If code and the plan disagree, identify the discrepancy instead of
  silently implementing a third design.
- Keep work within the requested milestone. Do not pull post-MVP features into
  foundational changes unless the user explicitly requests them.
- When a deliberate decision changes the architecture, schema, file convention,
  or product scope, update the plan in the same change.

## Non-Negotiable Product Invariants

- Revdown never writes to an opened source Markdown document. Writes are limited
  to sidecars and user-requested exports. Test source integrity with byte-level
  comparisons around workflows that perform file I/O.
- Canonical comments live in versioned JSON named
  `<source-filename>.rd.json`. Generated `<source-filename>.rd.md` reviews are
  derived interchange artifacts, not application storage.
- Never silently guess or persist a re-anchored location. Present uncertain
  anchors as `ambiguous` or `unmatched`; replacing a stored anchor requires an
  explicit user action.
- Treat line numbers and heading paths as hints, not identities. Preserve exact
  source text, rendered quote context, source positions, and fingerprints as
  defined in the plan.
- The core review and export workflow must remain local-first and usable without
  an account, network connection, or LLM API.
- Treat source Markdown, comment Markdown, and sidecar JSON as untrusted input.

## Architecture

- Use Tauri 2 with stable Rust for the desktop boundary and React with strict
  TypeScript and Vite for the frontend.
- The frontend owns Markdown parsing and rendering, source mapping, comments,
  anchor matching, schema validation, and export generation.
- Keep Rust narrowly responsible for native dialogs, safe reads, atomic writes,
  file metadata and watching, approved external links, and native operations
  that are demonstrably preferable to browser APIs.
- Feature code depends on a typed native-service interface. Do not import Tauri
  APIs directly throughout React components or domain modules. Maintain a
  browser implementation for tests.
- Use unified/remark/rehype syntax trees and positional metadata. Do not parse or
  transform Markdown with regular expressions.
- Use React reducer/context for application state until measured complexity
  justifies another state library. Use CSS Modules and global design tokens for
  styling.
- Keep anchor logic, schema, Markdown rendering, export generation, and native
  I/O independently testable.

## Implementation Priorities

- Complete the source-mapping risk spike before building substantial surrounding
  UI. A polished viewer is not useful if rendered selections cannot map back to
  reliable Markdown source ranges.
- Prefer the smallest vertical change that can be validated against a milestone
  exit criterion.
- Preserve source-position metadata through every Markdown transformation.
- Store both the raw source slice and the rendered text quote when markup makes
  them differ.
- Keep Shiki initialization asynchronous, lazy, and cached. Do not load all
  grammars or themes at startup.
- Generate UUIDs with a cryptographic platform API and use shared test vectors
  for hashing and normalization behavior.
- Add a dependency only when the platform, standard library, or established
  project dependency does not already solve the problem. Explain security- or
  architecture-significant additions in the relevant documentation.

## Schema and Persistence

- Validate sidecars at the TypeScript boundary before use or write. Never
  overwrite an unsupported schema version.
- Preserve unknown properties when safely rewriting a supported schema version.
- Treat offsets as zero-based UTF-16 code-unit offsets with an exclusive end,
  exactly as specified in the plan. Add Unicode and CRLF fixtures for all
  position-sensitive behavior.
- Store document fingerprints on each anchor, since comments in one sidecar may
  have been created against different source revisions.
- Serialize deterministically as UTF-8 with a trailing newline.
- Save through a sibling temporary file and the safest atomic replacement
  available on the platform. Detect external sidecar changes and surface a
  conflict instead of overwriting them.
- Automatic matching is computed state. Persist a new anchor only after explicit
  confirmation by the user.
- Any schema change requires compatibility fixtures, migration behavior where
  applicable, and an update to the schema documentation in the plan.

## Security and Privacy

- Maintain a strict Tauri capability configuration and content security policy.
  Expose only the native commands the application currently needs.
- Do not execute raw HTML or scripts from Markdown. Sanitize renderer output and
  reject unsafe URL schemes.
- Open approved web links outside the privileged application view.
- Resolve local resources against an approved document directory and prevent
  path traversal. Do not load remote images by default.
- Do not put absolute local paths, document contents, comments, or other private
  data into logs, analytics, errors, or exports unless the user explicitly asks.
- Do not add telemetry as part of unrelated work.

## Code Style

- Keep TypeScript in strict mode. Validate unknown external data before
  narrowing it; avoid `any` and unsafe type assertions.
- Prefer small domain-focused modules and explicit types at I/O, schema, and
  native-command boundaries.
- Use descriptive names. Comments should explain non-obvious constraints or
  tradeoffs, not narrate the code.
- In Rust, propagate structured errors across the Tauri boundary without
  exposing sensitive paths or implementation details to users.
- Keep formatting changes scoped. Do not combine feature work with unrelated
  refactors or dependency churn.

## Testing and Validation

The repository currently contains planning documents only. Do not claim that
application tests or builds passed until the application and commands exist.

Milestone 0 should establish these standard commands in `package.json`:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm tauri dev`
- `pnpm tauri build`

Before running commands, inspect `package.json` and `src-tauri/Cargo.toml` and use
the scripts and toolchain actually present. For Rust changes, run the applicable
`cargo fmt --check`, `cargo clippy`, and `cargo test` commands. For frontend
changes, run the narrowest relevant Vitest or Playwright check first, followed by
lint and type checking for the affected workspace.

Validation must reflect the changed behavior:

- Selection or anchoring changes require source-mapping fixtures, including
  Unicode, CRLF, repeated text, inline formatting, links, code, tables, and math
  as applicable.
- Re-anchoring changes require adversarial repeated and near-match cases. A false
  high-confidence match is more serious than leaving a comment unresolved.
- Persistence changes require round-trip, write-failure, atomicity, and external
  conflict tests.
- Native-boundary changes require Rust tests and a browser-adapter test where
  appropriate.
- Security-sensitive rendering or path changes require explicit hostile-input
  tests.
- Documentation-only changes require at least Markdown diagnostics, local-link
  validation, and `git diff --check`.
- Platform-specific changes must be checked on the relevant target. State clearly
  when a packaged Windows or macOS smoke test could not be run.

## Change Discipline

- Preserve user changes and avoid modifying unrelated files.
- Do not edit generated files manually when an authoritative generator exists.
- Do not weaken source integrity, matching confidence, schema compatibility,
  atomic persistence, or security behavior merely to make a test pass.
- Keep [README.md](README.md) concise and user-facing. Put durable product and
  architecture decisions in [PLAN.md](PLAN.md), and detailed implementation
  rationale near the owning code once it exists.
- Finish each change with a concise summary of behavior, validation performed,
  and any platform or test limitations.
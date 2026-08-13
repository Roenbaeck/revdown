# Revdown development

Revdown uses a React/TypeScript frontend and a narrow Tauri 2 Rust boundary. Use
Node.js 22 or later, pnpm 11, and the stable Rust toolchain.

## Setup

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Install the Playwright browsers once before running browser workflows:

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Run the browser harness with `pnpm dev`. Add `?demo=1` to the local URL to use
the built-in sample document. The harness exercises the same parsing, source
mapping, comment, matching, and export code as the desktop application while
using an in-memory native-service adapter.

## Desktop development

On macOS, install Xcode Command Line Tools. On Windows, install Microsoft C++
Build Tools and WebView2 as described in the Tauri prerequisites. Then run:

```sh
pnpm tauri dev
```

Create a platform installer with:

```sh
pnpm tauri build
```

Tauri packages the current platform only. Release candidates therefore need a
macOS build on macOS and a Windows build on Windows; CI runs both.

Publishing a GitHub release builds and uploads both desktop installers. See
[RELEASING.md](RELEASING.md) for optional macOS notarization and Windows
Authenticode signing secrets.

## Validation map

- `pnpm lint`: strict TypeScript ESLint rules
- `pnpm typecheck`: strict TypeScript project build
- `pnpm test`: schema, hashing, source mapping, anchoring, and export fixtures
- `pnpm test:e2e`: Chromium and WebKit review workflows
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml`: atomic persistence,
  conflicts, and byte-level source integrity

The source file is never a write target. Native writes are restricted to the
derived sidecar path and a user-selected export path. Do not weaken this
boundary when adding features.

# Revdown

Revdown is a desktop application for reviewing Markdown without editing
the source document. Select text in a rendered Markdown view, attach feedback,
and keep the comments in a structured sidecar file that can be reopened later or
exported for an LLM or coding agent.

It is intended for workflows where a document needs careful, contextual feedback
but direct inline edits would be risky, noisy, or hard to communicate. The source
Markdown remains byte-for-byte unchanged by Revdown.

## Intended Workflow

1. Open a local Markdown document in a read-only rendered view.
2. Select rendered text and add comments without touching the source.
3. Reopen, edit, resolve, and navigate comments alongside the document.
4. Detect when the source has changed and identify relocated, ambiguous, or
   unmatched comments.
5. Export a concise, self-describing Markdown review for a person, LLM, or coding
   agent to apply.

## Sidecar Files

Comments use versioned JSON as their canonical format. The complete source
filename is preserved and `.rd.json` is appended:

```text
document.md
document.md.rd.json
```

This avoids modifying the document, supports version control, and retains the
structured anchor data needed to match comments after the document changes.
Human- and LLM-readable Markdown is generated as an export rather than used as
the application database.

## MVP Capabilities

- Native Windows and macOS application
- CommonMark and GitHub Flavored Markdown rendering
- KaTeX math rendering and Shiki code highlighting
- Collapsible outline and comment-aware minimap for long documents
- System-aware light, sepia, and dark themes with reading controls
- Finder and Explorer “Open With” support for `.md` and `.markdown` files
- Comments anchored to rendered selections
- Conservative re-anchoring after document drift
- Clear reporting of ambiguous and unmatched feedback
- Markdown file and clipboard export with customizable review instructions
- Opt-in local MCP access for reading the active review and returning pending
  per-comment outcomes
- Local-first operation with no account or API key required

## Agent Access

The desktop app can share the active review with a locally running Codex client.
Open the cog menu, choose **Agent access**, enable the localhost MCP server, and
copy the generated configuration into Codex. Codex can read comment status and
bounded anchor context without receiving the source path. It can also queue an
`applied`, `skipped`, `ambiguous`, or `blocked` outcome for each comment. Reports
appear beside comments for review; only the user can accept an applied report
and resolve its comment. MCP never edits the source document or sidecar.

## Stack

Revdown uses Tauri 2 with a React and TypeScript frontend. Markdown is processed
through unified, remark, and rehype. Rust provides a narrow native
boundary for safe file access, atomic sidecar writes, and file watching.

See [PLAN.md](PLAN.md) for the product decisions, sidecar model, architecture,
security constraints, milestones, and MVP acceptance criteria.

## Development

The MVP implementation is available as a pre-release. See
[DEVELOPMENT.md](DEVELOPMENT.md) for macOS and Windows prerequisites, local
commands, browser-harness testing, and packaging instructions.

## License

Revdown is free and open-source software licensed under the
[MIT License](LICENSE). If you or your organization benefits from using Revdown
commercially, please consider sponsoring its continued development.

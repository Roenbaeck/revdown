# Revdown

Revdown is a planned desktop application for reviewing Markdown without editing
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

## Planned Capabilities

- Native Windows and macOS application
- CommonMark and GitHub Flavored Markdown rendering
- KaTeX math rendering and Shiki code highlighting
- Comments anchored to rendered selections
- Conservative re-anchoring after document drift
- Clear reporting of ambiguous and unmatched feedback
- Markdown file and clipboard export for LLM and agent workflows
- Local-first operation with no account or API key required

## Planned Stack

Revdown will use Tauri 2 with a React and TypeScript frontend. Markdown will be
processed through unified, remark, and rehype. Rust will provide a narrow native
boundary for safe file access, atomic sidecar writes, and file watching.

See [PLAN.md](PLAN.md) for the product decisions, sidecar model, architecture,
security constraints, milestones, and MVP acceptance criteria.

## Status

Revdown is currently in planning and has not yet reached a usable release.

## License

Revdown is free and open-source software licensed under the
[MIT License](LICENSE). If you or your organization benefits from using Revdown
commercially, please consider sponsoring its continued development.

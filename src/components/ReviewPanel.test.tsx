import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import type { PendingAgentReport } from "../lib/agent/report";
import type { ReviewComment } from "../lib/schema/sidecar";
import { ReviewPanel } from "./ReviewPanel";

const comment: ReviewComment = {
  id: "8d79a898-a0cc-4f9d-9f12-6397cd52bbca",
  status: "open",
  body: "**Clarify** this behavior.",
  createdAt: "2026-08-15T08:30:00.000Z",
  updatedAt: "2026-08-15T08:30:00.000Z",
  anchor: {
    documentSha256: "a".repeat(64),
    documentNormalizedSha256: "a".repeat(64),
    sourceRange: { start: 10, end: 23 },
    sourceText: "selected text",
    textQuote: { exact: "selected text", prefix: "Before ", suffix: " after" },
    block: { start: 0, end: 30, sourceSha256: "b".repeat(64) },
    headingPath: ["Draft"],
    lineHint: { start: 3, end: 3 },
  },
};

function renderPanel(
  report: PendingAgentReport,
  overrides: Partial<ComponentProps<typeof ReviewPanel>> = {},
) {
  const onAcceptAgentReport = vi.fn();
  const onDismissAgentReport = vi.fn();
  render(
    <ReviewPanel
      comments={[comment]}
      matches={new Map()}
      filter="all"
      selectedId={null}
      readOnly={false}
      agentReports={new Map([[comment.id, report]])}
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onToggleResolved={vi.fn()}
      onDelete={vi.fn()}
      onAcceptAgentReport={onAcceptAgentReport}
      onDismissAgentReport={onDismissAgentReport}
      onConfirmCandidate={vi.fn()}
      onOpenExternal={vi.fn()}
      {...overrides}
    />,
  );
  return { onAcceptAgentReport, onDismissAgentReport };
}

function report(outcome: PendingAgentReport["outcome"]): PendingAgentReport {
  return {
    commentId: comment.id,
    commentUpdatedAt: comment.updatedAt,
    outcome,
    note: "Implementation updated and covered by a regression test.",
    sourceSha256: "a".repeat(64),
    sidecarRevision: "c".repeat(64),
  };
}

describe("ReviewPanel agent reports", () => {
  it("requires explicit confirmation before resolving an applied result", async () => {
    const user = userEvent.setup();
    const { onAcceptAgentReport } = renderPanel(report("applied"));

    expect(screen.getByLabelText("Agent report")).toHaveTextContent("applied");
    await user.click(
      screen.getByRole("button", { name: "Accept and resolve" }),
    );
    expect(onAcceptAgentReport).toHaveBeenCalledWith(comment);
  });

  it("keeps non-applied outcomes open and lets the user acknowledge them", async () => {
    const user = userEvent.setup();
    const { onDismissAgentReport } = renderPanel(report("blocked"));

    expect(
      screen.queryByRole("button", { name: "Accept and resolve" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onDismissAgentReport).toHaveBeenCalledWith(comment.id);
  });

  it("renders an untrusted report note as plain text", async () => {
    renderPanel({
      ...report("blocked"),
      note: '<img src="https://tracker.invalid/pixel" onerror="alert(1)">',
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent report")).toHaveTextContent(
      '<img src="https://tracker.invalid/pixel" onerror="alert(1)">',
    );
    await screen.findByText("Clarify", { selector: "strong" });
  });
});

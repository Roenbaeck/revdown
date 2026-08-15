import { useMemo, useState } from "react";
import type { CommentFilter } from "../app/state";
import type { PendingAgentReport } from "../lib/agent/report";
import type { AnchorCandidate, AnchorMatch } from "../lib/anchors/match";
import type { ReviewComment } from "../lib/schema/sidecar";
import { CommentBody } from "./CommentBody";

type ReviewPanelProps = {
  comments: readonly ReviewComment[];
  matches: ReadonlyMap<string, AnchorMatch>;
  filter: CommentFilter;
  selectedId: string | null;
  readOnly: boolean;
  readOnlyMessage?: string;
  agentReports: ReadonlyMap<string, PendingAgentReport>;
  onSelect: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  onToggleResolved: (comment: ReviewComment) => void;
  onDelete: (id: string) => void;
  onAcceptAgentReport: (comment: ReviewComment) => void;
  onDismissAgentReport: (commentId: string) => void;
  onConfirmCandidate: (
    comment: ReviewComment,
    candidate: AnchorCandidate,
  ) => void;
  onOpenExternal: (url: string) => void;
};

function CommentCard(
  props: ReviewPanelProps & { comment: ReviewComment; match: AnchorMatch },
) {
  const { comment, match } = props;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const agentReport = props.agentReports.get(comment.id);
  return (
    <article
      className={`commentCard ${comment.id === props.selectedId ? "commentCardSelected" : ""}`}
      aria-current={comment.id === props.selectedId ? "true" : undefined}
    >
      <button
        className="commentTarget"
        type="button"
        onClick={() => props.onSelect(comment.id)}
      >
        <span className={`statusBadge anchor-${match.state}`}>
          {match.state}
        </span>
        <span className="statusBadge">{comment.status}</span>
        <span className="commentLocation">
          {comment.anchor.headingPath.at(-1) ?? "Document"} · line{" "}
          {comment.anchor.lineHint.start}
        </span>
      </button>
      {editing ? (
        <div className="editComment">
          <textarea
            value={draft}
            rows={5}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="cardActions">
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!draft.trim() || props.readOnly}
              onClick={() => {
                props.onEdit(comment.id, draft.trim());
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <CommentBody
          body={comment.body}
          onOpenExternal={props.onOpenExternal}
        />
      )}
      {agentReport && (
        <section className="agentReport" aria-label="Agent report">
          <div className="agentReportHeading">
            <span>Agent report</span>
            <strong>{agentReport.outcome}</strong>
          </div>
          {agentReport.note && <p>{agentReport.note}</p>}
          <div className="cardActions">
            {agentReport.outcome === "applied" ? (
              <>
                <button
                  className="primaryButton"
                  type="button"
                  disabled={props.readOnly}
                  onClick={() => props.onAcceptAgentReport(comment)}
                >
                  Accept and resolve
                </button>
                <button
                  type="button"
                  onClick={() => props.onDismissAgentReport(comment.id)}
                >
                  Keep open
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => props.onDismissAgentReport(comment.id)}
              >
                Acknowledge
              </button>
            )}
          </div>
        </section>
      )}
      {match.state === "ambiguous" && match.candidates.length > 0 && (
        <details className="candidateList">
          <summary>{match.candidates.length} possible targets</summary>
          {match.candidates.slice(0, 5).map((candidate, index) => (
            <button
              type="button"
              key={`${candidate.sourceRange.start}:${candidate.sourceRange.end}`}
              disabled={props.readOnly}
              onClick={() => props.onConfirmCandidate(comment, candidate)}
            >
              Confirm candidate {index + 1} (offset{" "}
              {candidate.sourceRange.start})
            </button>
          ))}
        </details>
      )}
      {match.state === "relocated" && match.candidate && (
        <button
          className="confirmAnchor"
          type="button"
          disabled={props.readOnly}
          onClick={() => props.onConfirmCandidate(comment, match.candidate!)}
        >
          Confirm relocated anchor
        </button>
      )}
      {confirmingDelete ? (
        <div
          className="deleteConfirmation"
          role="group"
          aria-label="Confirm comment deletion"
        >
          <span>Delete permanently?</span>
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button
            className="dangerButton"
            type="button"
            disabled={props.readOnly}
            onClick={() => props.onDelete(comment.id)}
          >
            Delete comment
          </button>
        </div>
      ) : (
        <div className="cardActions">
          <button
            type="button"
            disabled={props.readOnly}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={props.readOnly}
            onClick={() => props.onToggleResolved(comment)}
          >
            {comment.status === "open" ? "Resolve" : "Reopen"}
          </button>
          <button
            type="button"
            disabled={props.readOnly}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}

export function ReviewPanel(props: ReviewPanelProps) {
  const comments = useMemo(() => {
    const filtered = props.comments.filter(
      (comment) => props.filter === "all" || comment.status === props.filter,
    );
    return [...filtered].sort((a, b) => {
      const aStart =
        props.matches.get(a.id)?.candidate?.sourceRange.start ??
        Number.MAX_SAFE_INTEGER;
      const bStart =
        props.matches.get(b.id)?.candidate?.sourceRange.start ??
        Number.MAX_SAFE_INTEGER;
      return aStart - bStart || a.createdAt.localeCompare(b.createdAt);
    });
  }, [props.comments, props.filter, props.matches]);

  return (
    <aside className="reviewPanel" aria-label="Review comments">
      <div className="panelHeading">
        <div>
          <span className="eyebrow">Review</span>
          <h2>Comments</h2>
        </div>
        <span className="commentCount">{comments.length}</span>
      </div>
      {props.readOnly && (
        <p className="inlineWarning">
          {props.readOnlyMessage ??
            "This sidecar is read-only until its validation issue is resolved."}
        </p>
      )}
      {comments.length === 0 ? (
        <div className="panelEmpty">
          <p>No comments in this view.</p>
          <span>Select document text to add precise feedback.</span>
        </div>
      ) : (
        <div className="commentList">
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              {...props}
              comment={comment}
              match={
                props.matches.get(comment.id) ?? {
                  state: "unmatched",
                  confidence: 0,
                  candidates: [],
                }
              }
            />
          ))}
        </div>
      )}
    </aside>
  );
}

import {
  commentSchema,
  sidecarV1Schema,
  type Anchor,
  type ReviewComment,
  type SidecarV1,
} from "../schema/sidecar";

export function createReviewComment(input: {
  body: string;
  anchor: Anchor;
  authorId?: string;
  id?: string;
  now?: string;
}): ReviewComment {
  const timestamp = input.now ?? new Date().toISOString();
  return commentSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    status: "open",
    body: input.body,
    ...(input.authorId ? { authorId: input.authorId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    anchor: input.anchor,
  });
}

export function addComment(
  sidecar: SidecarV1,
  comment: ReviewComment,
  now?: string,
): SidecarV1 {
  return sidecarV1Schema.parse({
    ...sidecar,
    updatedAt: now ?? new Date().toISOString(),
    comments: [...sidecar.comments, comment],
  });
}

export function updateComment(
  sidecar: SidecarV1,
  id: string,
  update: Partial<Pick<ReviewComment, "body" | "status" | "anchor">>,
  now?: string,
): SidecarV1 {
  const timestamp = now ?? new Date().toISOString();
  return sidecarV1Schema.parse({
    ...sidecar,
    updatedAt: timestamp,
    comments: sidecar.comments.map((comment) =>
      comment.id === id
        ? { ...comment, ...update, updatedAt: timestamp }
        : comment,
    ),
  });
}

export function deleteComment(
  sidecar: SidecarV1,
  id: string,
  now?: string,
): SidecarV1 {
  return sidecarV1Schema.parse({
    ...sidecar,
    updatedAt: now ?? new Date().toISOString(),
    comments: sidecar.comments.filter((comment) => comment.id !== id),
  });
}

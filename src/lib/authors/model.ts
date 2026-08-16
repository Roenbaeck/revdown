import {
  sidecarV1Schema,
  type AuthorProfile,
  type ReviewComment,
  type SidecarV1,
} from "../schema/sidecar";

export const LEGACY_AUTHOR_NAME = "Unknown";

export type CommentAuthor =
  | AuthorProfile
  | { id: null; displayName: typeof LEGACY_AUTHOR_NAME; kind: "unknown" };

export function authorIndex(
  authors: readonly AuthorProfile[] | undefined,
): ReadonlyMap<string, AuthorProfile> {
  return new Map((authors ?? []).map((author) => [author.id, author]));
}

export function commentAuthor(
  comment: ReviewComment,
  authors: ReadonlyMap<string, AuthorProfile>,
): CommentAuthor {
  const author = comment.authorId ? authors.get(comment.authorId) : undefined;
  return (
    author ?? { id: null, displayName: LEGACY_AUTHOR_NAME, kind: "unknown" }
  );
}

export function upsertAuthor(
  sidecar: SidecarV1,
  author: AuthorProfile,
  now?: string,
): SidecarV1 {
  const authors = sidecar.authors ?? [];
  const existing = authors.findIndex((candidate) => candidate.id === author.id);
  const nextAuthors =
    existing < 0
      ? [...authors, author]
      : authors.map((candidate, index) =>
          index === existing ? { ...candidate, ...author } : candidate,
        );
  return sidecarV1Schema.parse({
    ...sidecar,
    updatedAt: now ?? new Date().toISOString(),
    authors: nextAuthors,
  });
}

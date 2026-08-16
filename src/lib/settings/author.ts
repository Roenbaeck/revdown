import { authorProfileSchema } from "../schema/sidecar";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type AuthorIdFactory = () => string;

const STORAGE_KEY = "revdown.author-profile.v1";
export const DEFAULT_AUTHOR_NAME = "Local reviewer";

export type LocalAuthorProfile = {
  id: string;
  displayName: string;
  kind: "human";
};

export function createLocalAuthorProfile(
  createId: AuthorIdFactory = () => crypto.randomUUID(),
): LocalAuthorProfile {
  const profile = authorProfileSchema.parse({
    id: createId(),
    displayName: DEFAULT_AUTHOR_NAME,
    kind: "human",
  });
  return {
    id: profile.id,
    displayName: profile.displayName,
    kind: "human",
  };
}

export function loadAuthorProfile(
  storage: StorageLike,
  createId?: AuthorIdFactory,
): LocalAuthorProfile {
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (serialized) {
      const parsed = authorProfileSchema.safeParse(
        JSON.parse(serialized) as unknown,
      );
      if (parsed.success && parsed.data.kind === "human") {
        return {
          id: parsed.data.id,
          displayName: parsed.data.displayName,
          kind: "human",
        };
      }
    }
  } catch {
    // Fall through to a fresh local identity.
  }
  return createLocalAuthorProfile(createId);
}

export function saveAuthorProfile(
  storage: StorageLike,
  profile: LocalAuthorProfile,
): void {
  try {
    const validated = authorProfileSchema.parse(profile);
    if (validated.kind !== "human") return;
    storage.setItem(STORAGE_KEY, JSON.stringify(validated));
  } catch {
    // Attribution preferences are optional; storage failures must not block review.
  }
}

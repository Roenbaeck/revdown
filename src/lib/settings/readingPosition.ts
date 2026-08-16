const STORAGE_KEY = "revdown.reading-positions.v1";
const MAX_POSITIONS = 24;

type StoredPosition = {
  position: number;
  updatedAt: number;
};

type StoredPositions = Record<string, StoredPosition>;

function validPosition(value: unknown): value is StoredPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredPosition>;
  return (
    typeof candidate.position === "number" &&
    Number.isFinite(candidate.position) &&
    candidate.position >= 0 &&
    candidate.position <= 1 &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
  );
}

function loadPositions(storage: Storage): StoredPositions {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, StoredPosition] =>
          entry[0].length > 0 && validPosition(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function loadReadingPosition(
  storage: Storage,
  documentId: string,
): number {
  return loadPositions(storage)[documentId]?.position ?? 0;
}

export function saveReadingPosition(
  storage: Storage,
  documentId: string,
  position: number,
  updatedAt = Date.now(),
): void {
  if (!documentId || !Number.isFinite(position)) return;
  const positions = loadPositions(storage);
  positions[documentId] = {
    position: Math.max(0, Math.min(position, 1)),
    updatedAt,
  };
  const recent = Object.entries(positions)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_POSITIONS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // Reading position is a convenience and must never block document use.
  }
}

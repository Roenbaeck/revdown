type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "revdown.export-instruction.v1";

export const MAX_EXPORT_INSTRUCTION_LENGTH = 20_000;

export const defaultExportInstruction = `Use all supplied anchor evidence; line numbers are hints, not identities. Apply each comment while preserving the document’s purpose, voice, style, and formatting unless the feedback requests otherwise. Keep edits focused, adjusting nearby text only when needed for grammar, correctness, consistency, or natural flow. Avoid unrelated rewrites. Never guess an ambiguous or unmatched target.

When filesystem tools are available, edit the named source file and summarize the result. Otherwise provide the revised document in the form appropriate to the active conversation. Report every comment as applied, skipped, ambiguous, or unmatched.`;

function validInstruction(value: string | null): value is string {
  if (value === null) return false;
  return (
    value.trim().length > 0 && value.length <= MAX_EXPORT_INSTRUCTION_LENGTH
  );
}

export function loadExportInstruction(storage: StorageLike): string {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return validInstruction(stored) ? stored.trim() : defaultExportInstruction;
  } catch {
    return defaultExportInstruction;
  }
}

export function saveExportInstruction(
  storage: StorageLike,
  instruction: string,
): void {
  const normalized = instruction.trim();
  if (!validInstruction(normalized)) return;
  try {
    storage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Export customization is optional; storage failures must not block export.
  }
}

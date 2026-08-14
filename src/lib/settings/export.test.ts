import {
  defaultExportInstruction,
  loadExportInstruction,
  MAX_EXPORT_INSTRUCTION_LENGTH,
  saveExportInstruction,
} from "./export";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
}

describe("export instruction settings", () => {
  it("round-trips a customized instruction", () => {
    const storage = memoryStorage();
    saveExportInstruction(storage, "  Apply only the requested fixes.  ");

    expect(storage.value()).toBe("Apply only the requested fixes.");
    expect(loadExportInstruction(storage)).toBe(
      "Apply only the requested fixes.",
    );
  });

  it("falls back to the default for empty or oversized stored values", () => {
    expect(loadExportInstruction(memoryStorage("   "))).toBe(
      defaultExportInstruction,
    );
    expect(
      loadExportInstruction(
        memoryStorage("x".repeat(MAX_EXPORT_INSTRUCTION_LENGTH + 1)),
      ),
    ).toBe(defaultExportInstruction);
  });
});

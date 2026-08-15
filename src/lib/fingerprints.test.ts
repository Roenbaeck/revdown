import {
  encodeUtf8,
  fingerprintBytes,
  fingerprintText,
  normalizeSourceText,
  sha256Hex,
} from "./fingerprints";

describe("document fingerprints", () => {
  it("normalizes only BOM and line endings", () => {
    expect(normalizeSourceText("\uFEFFcafé\r\nA\rB  ")).toBe("café\nA\nB  ");
  });

  it("keeps the exact hash while normalizing equivalent line endings", async () => {
    const crlf = await fingerprintText("emoji 😀\r\nnext\r\n");
    const lf = await fingerprintText("emoji 😀\nnext\n");
    expect(crlf.sha256).not.toBe(lf.sha256);
    expect(crlf.normalizedSha256).toBe(lf.normalizedSha256);
  });

  it("removes an optional UTF-8 BOM for only the normalized hash", async () => {
    const withBom = await fingerprintBytes(encodeUtf8("\uFEFFvalue"));
    const withoutBom = await fingerprintText("value");
    expect(withBom.sha256).not.toBe(withoutBom.sha256);
    expect(withBom.normalizedSha256).toBe(withoutBom.normalizedSha256);
  });

  it("uses the shared SHA-256 vector", async () => {
    const result = await fingerprintText("abc");
    expect(result.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes only the bytes inside a view", async () => {
    const bytes = encodeUtf8("xabcx").subarray(1, 4);
    await expect(sha256Hex(bytes)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

export type DocumentFingerprint = {
  sha256: string;
  normalizedSha256: string;
};

const utf8Encoder = new TextEncoder();
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeUtf8(bytes: Uint8Array): string {
  return strictUtf8Decoder.decode(bytes);
}

export function encodeUtf8(value: string): Uint8Array {
  return utf8Encoder.encode(value);
}

export function normalizeSourceText(value: string): string {
  const withoutBom = value.startsWith("\uFEFF") ? value.slice(1) : value;
  return withoutBom.replace(/\r\n?/gu, "\n");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input =
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function fingerprintBytes(
  bytes: Uint8Array,
): Promise<DocumentFingerprint> {
  const decoded = decodeUtf8(bytes);
  const [sha256, normalizedSha256] = await Promise.all([
    sha256Hex(bytes),
    sha256Hex(encodeUtf8(normalizeSourceText(decoded))),
  ]);
  return { sha256, normalizedSha256 };
}

export async function fingerprintText(
  value: string,
): Promise<DocumentFingerprint> {
  return fingerprintBytes(encodeUtf8(value));
}

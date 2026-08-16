import { z } from "zod";

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Expected a SHA-256 hash");
const utcTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    "Expected a UTC timestamp",
  );
const uuidV4Schema = z
  .string()
  .uuid()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );

export const authorProfileSchema = z
  .object({
    id: uuidV4Schema,
    displayName: z.string().trim().min(1).max(100),
    kind: z.enum(["human", "agent"]),
  })
  .passthrough();

const sourceRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .passthrough()
  .refine(({ start, end }) => end > start, {
    message: "The source range must not be empty",
  });

const textQuoteSchema = z
  .object({
    exact: z.string().min(1),
    prefix: z.string(),
    suffix: z.string(),
  })
  .passthrough();

const blockSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    sourceSha256: sha256Schema,
  })
  .passthrough()
  .refine(({ start, end }) => end > start, {
    message: "The block range must not be empty",
  });

const lineHintSchema = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    startColumn: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
  })
  .passthrough();

export const anchorSchema = z
  .object({
    documentSha256: sha256Schema,
    documentNormalizedSha256: sha256Schema,
    sourceRange: sourceRangeSchema,
    sourceText: z.string().min(1),
    textQuote: textQuoteSchema,
    block: blockSchema,
    headingPath: z.array(z.string().min(1)),
    lineHint: lineHintSchema,
  })
  .passthrough();

export const commentSchema = z
  .object({
    id: uuidV4Schema,
    status: z.enum(["open", "resolved"]),
    body: z.string().trim().min(1).max(100_000),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    authorId: uuidV4Schema.optional(),
    anchor: anchorSchema,
  })
  .passthrough();

const sourceSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .refine((value) => !value.includes("/") && !value.includes("\\"), {
        message: "The sidecar source must contain a filename, not a path",
      }),
    lastObservedSha256: sha256Schema,
    lastObservedNormalizedSha256: sha256Schema,
  })
  .passthrough();

export const sidecarV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    source: sourceSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    authors: z.array(authorProfileSchema).optional(),
    comments: z.array(commentSchema),
  })
  .passthrough()
  .superRefine((sidecar, context) => {
    const seen = new Set<string>();
    sidecar.authors?.forEach((author, index) => {
      if (seen.has(author.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authors", index, "id"],
          message: "Author profile IDs must be unique",
        });
      }
      seen.add(author.id);
    });
  });

export type Anchor = z.infer<typeof anchorSchema>;
export type AuthorProfile = z.infer<typeof authorProfileSchema>;
export type ReviewComment = z.infer<typeof commentSchema>;
export type SidecarV1 = z.infer<typeof sidecarV1Schema>;

export type SidecarParseResult =
  | { kind: "valid"; sidecar: SidecarV1 }
  | { kind: "invalid"; message: string }
  | { kind: "unsupported"; schemaVersion: number };

export function parseSidecarJson(text: string): SidecarParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { kind: "invalid", message: "The sidecar is not valid JSON." };
  }

  if (typeof value === "object" && value !== null && "schemaVersion" in value) {
    const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
    if (
      typeof schemaVersion === "number" &&
      Number.isInteger(schemaVersion) &&
      schemaVersion !== 1
    ) {
      return { kind: "unsupported", schemaVersion };
    }
  }

  const parsed = sidecarV1Schema.safeParse(value);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      kind: "invalid",
      message: firstIssue
        ? `Invalid sidecar at ${firstIssue.path.join(".") || "root"}: ${firstIssue.message}`
        : "The sidecar does not match schema version 1.",
    };
  }
  return { kind: "valid", sidecar: parsed.data };
}

export function serializeSidecar(sidecar: SidecarV1): string {
  const validated = sidecarV1Schema.parse(sidecar);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function createEmptySidecar(input: {
  filename: string;
  sha256: string;
  normalizedSha256: string;
  now?: string;
}): SidecarV1 {
  const timestamp = input.now ?? new Date().toISOString();
  return sidecarV1Schema.parse({
    schemaVersion: 1,
    source: {
      filename: input.filename,
      lastObservedSha256: input.sha256,
      lastObservedNormalizedSha256: input.normalizedSha256,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    authors: [],
    comments: [],
  });
}

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

export const agentReportOutcomeSchema = z.enum([
  "applied",
  "skipped",
  "ambiguous",
  "blocked",
]);

export const mcpReportBatchSchema = z
  .object({
    sourceSha256: sha256Schema,
    sidecarRevision: sha256Schema.nullable(),
    results: z
      .array(
        z
          .object({
            commentId: z.string().uuid(),
            commentUpdatedAt: utcTimestampSchema,
            outcome: agentReportOutcomeSchema,
            note: z.string().max(4_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type AgentReportOutcome = z.infer<typeof agentReportOutcomeSchema>;
export type McpReportBatch = z.infer<typeof mcpReportBatchSchema>;
export type PendingAgentReport = McpReportBatch["results"][number] & {
  sourceSha256: string;
  sidecarRevision: string | null;
};

export function parseMcpReportBatch(value: unknown): McpReportBatch | null {
  const parsed = mcpReportBatchSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

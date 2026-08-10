import { z } from "zod";
import {
  ChangeSnapshotSchema,
  ExecutionPlanSchema,
  ExecutionProfileSchema,
  ExecutionSchema,
  ExecutionStatusSchema,
  RepositoryRefSchema,
} from "./domain";

/**
 * HTTP API contracts. Shared verbatim between the API server and the CLI so the
 * wire format has a single source of truth.
 */

export const CreateExecutionRequestSchema = z.object({
  repository: RepositoryRefSchema,
  change: ChangeSnapshotSchema.optional(),
  intent: z.string().optional(),
  profile: ExecutionProfileSchema.optional(),
  plan: ExecutionPlanSchema,
});
export type CreateExecutionRequest = z.infer<
  typeof CreateExecutionRequestSchema
>;

export const ListExecutionsQuerySchema = z.object({
  status: ExecutionStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListExecutionsQuery = z.infer<typeof ListExecutionsQuerySchema>;

export const ExecutionSummarySchema = z.object({
  id: z.string(),
  status: ExecutionStatusSchema,
  intent: z.string().optional(),
  repositoryName: z.string(),
  profileName: z.string(),
  stepCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

export const ExecutionListResponseSchema = z.object({
  executions: z.array(ExecutionSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ExecutionListResponse = z.infer<typeof ExecutionListResponseSchema>;

export const CreateExecutionResponseSchema = ExecutionSchema;
export type CreateExecutionResponse = z.infer<
  typeof CreateExecutionResponseSchema
>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

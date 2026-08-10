import { z } from "zod";
import { ExecutionStatusSchema, ExecutionStepStatusSchema } from "./domain";

/**
 * Structured execution events.
 *
 * Clients (the CLI, the future dashboard) subscribe to these rather than
 * scraping terminal strings. Events are persisted append-only so they can be
 * streamed live and replayed after the fact.
 */
export const ExecutionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("execution.started"),
    executionId: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal("execution.status"),
    executionId: z.string(),
    status: ExecutionStatusSchema,
    at: z.string(),
  }),
  z.object({
    type: z.literal("step.started"),
    executionId: z.string(),
    stepId: z.string(),
    name: z.string(),
    command: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal("step.output"),
    executionId: z.string(),
    stepId: z.string(),
    stream: z.enum(["stdout", "stderr"]),
    data: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal("step.completed"),
    executionId: z.string(),
    stepId: z.string(),
    status: ExecutionStepStatusSchema,
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    at: z.string(),
  }),
  z.object({
    type: z.literal("execution.completed"),
    executionId: z.string(),
    status: ExecutionStatusSchema,
    at: z.string(),
  }),
]);
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export type ExecutionEventType = ExecutionEvent["type"];

/** An event as stored, with its monotonic per-database sequence number. */
export interface StoredEvent {
  seq: number;
  executionId: string;
  event: ExecutionEvent;
}

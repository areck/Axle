import { ulid } from "ulid";

/**
 * Identifier helpers.
 *
 * Ids are prefixed and ULID-based so they are globally unique, URL-safe, and
 * lexicographically sortable by creation time (useful for the execution history
 * that will later power Axle Graph).
 */

export const ID_PREFIXES = {
  execution: "exec",
  step: "step",
  artifact: "art",
  diagnostic: "diag",
} as const;

export function newExecutionId(): string {
  return `${ID_PREFIXES.execution}_${ulid()}`;
}

export function newStepId(): string {
  return `${ID_PREFIXES.step}_${ulid()}`;
}

export function newArtifactId(): string {
  return `${ID_PREFIXES.artifact}_${ulid()}`;
}

export function newDiagnosticId(): string {
  return `${ID_PREFIXES.diagnostic}_${ulid()}`;
}

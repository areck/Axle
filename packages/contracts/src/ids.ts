import { ulid } from "ulid";

/**
 * Identifier helpers.
 *
 * Ids are prefixed and ULID-based so they are globally unique, URL-safe, and
 * lexicographically sortable by creation time (useful for the execution history
 * that will later power Axle Graph).
 */

export function newExecutionId(): string {
  return `exec_${ulid()}`;
}

export function newStepId(): string {
  return `step_${ulid()}`;
}

export function newArtifactId(): string {
  return `art_${ulid()}`;
}

export function newDiagnosticId(): string {
  return `diag_${ulid()}`;
}

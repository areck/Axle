import type { CreateExecutionRequest } from "./api";

/**
 * Axle Control hooks.
 *
 * This is an extension point, not a governance system yet. The MVP ships an
 * allow-all development policy with resource limits; production policies will
 * eventually gate allowed commands, network access, secrets, resource limits,
 * cloud permissions, agent identity, and repository permissions.
 */

export interface ResourceLimits {
  cpu: number;
  memoryMb: number;
  /** Wall-clock budget for the whole execution. */
  totalTimeoutSeconds: number;
  /** Maximum captured output per step before truncation. */
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  cpu: 2,
  memoryMb: 4096,
  totalTimeoutSeconds: 1800,
  maxOutputBytes: 5_000_000,
};

export interface PolicyDecision {
  allow: boolean;
  reasons?: string[];
  /** Effective limits the runtime must enforce for this execution. */
  limits: ResourceLimits;
}

export interface ExecutionPolicy {
  validate(request: CreateExecutionRequest): Promise<PolicyDecision>;
}

import type { CreateExecutionRequest } from "./api";
import type { ResourceLimits } from "./domain";

/**
 * Axle Control hooks.
 *
 * This is an extension point, not a governance system yet. The MVP ships an
 * allow-all development policy with default resource limits; production policies
 * will gate allowed commands, network access, secrets, resource limits, cloud
 * permissions, agent identity, and repository permissions. The `limits` a policy
 * returns are carried on the Execution and enforced by the worker.
 */

export interface PolicyDecision {
  allow: boolean;
  reasons?: string[];
  /** Effective limits the runtime must enforce for this execution. */
  limits: ResourceLimits;
}

export interface ExecutionPolicy {
  validate(request: CreateExecutionRequest): Promise<PolicyDecision>;
}

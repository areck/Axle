import {
  type CreateExecutionRequest,
  DEFAULT_LIMITS,
  type ExecutionPolicy,
  type PolicyDecision,
} from "@axle/contracts";

/**
 * Development policy: allow every execution and attach default resource limits.
 *
 * This is the Axle Control extension point. Production policies will gate
 * allowed commands, network access, secrets, agent identity, and repository
 * permissions here.
 */
export class AllowAllPolicy implements ExecutionPolicy {
  async validate(_request: CreateExecutionRequest): Promise<PolicyDecision> {
    return { allow: true, limits: DEFAULT_LIMITS };
  }
}

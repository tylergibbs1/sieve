/**
 * Action policy system.
 * Allows agents to configure guardrails on what actions are permitted.
 */

export type PolicyDecision = "allow" | "deny" | "confirm";

export type ActionType = "click" | "type" | "select" | "clear" | "navigation" | "batch";

export interface ActionPolicy {
  /** Default decision for actions not explicitly listed. */
  default: PolicyDecision;
  /** Per-action overrides. */
  rules: Partial<Record<ActionType, PolicyDecision>>;
}

/** Default policy: allow everything. */
export const DEFAULT_POLICY: ActionPolicy = {
  default: "allow",
  rules: {},
};

export interface PolicyCheckResult {
  decision: PolicyDecision;
  action: ActionType;
}

/** Check if an action is allowed by the current policy. */
export function checkPolicy(policy: ActionPolicy, action: ActionType): PolicyCheckResult {
  const decision = policy.rules[action] ?? policy.default;
  return { decision, action };
}

export class PolicyDeniedError extends Error {
  readonly action: ActionType;

  constructor(action: ActionType) {
    super(`Action denied by policy: ${action}`);
    this.name = "PolicyDeniedError";
    this.action = action;
  }
}

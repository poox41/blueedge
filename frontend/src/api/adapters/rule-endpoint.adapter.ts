import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

export function normalizeRuleEndpoint(raw: KubeResource): RuleEndpointView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    type:
      typeof raw.ruleEndpointType === "string"
        ? raw.ruleEndpointType
        : getNestedString(raw, ["spec", "ruleEndpointType"]),
    targetResource:
      typeof raw.targetResource === "string"
        ? raw.targetResource
        : getNestedString(raw, ["spec", "targetResource"]),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeRuleEndpointList(payload: unknown): RuleEndpointView[] {
  return asItems<KubeResource>(payload).map(normalizeRuleEndpoint);
}

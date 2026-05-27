import type { KubeResource, RuleView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

export function normalizeRule(raw: KubeResource): RuleView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    source: typeof raw.source === "string" ? raw.source : getNestedString(raw, ["spec", "source"]),
    target: typeof raw.target === "string" ? raw.target : getNestedString(raw, ["spec", "target"]),
    sourceResource:
      typeof raw.sourceResource === "string" ? raw.sourceResource : getNestedString(raw, ["spec", "sourceResource"]),
    targetResource:
      typeof raw.targetResource === "string" ? raw.targetResource : getNestedString(raw, ["spec", "targetResource"]),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeRuleList(payload: unknown): RuleView[] {
  return asItems<KubeResource>(payload).map(normalizeRule);
}

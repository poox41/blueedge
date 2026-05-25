import type { KubeResource, RuleView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

export function normalizeRule(raw: KubeResource): RuleView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    source: getNestedString(raw, ["spec", "source"]),
    target: getNestedString(raw, ["spec", "target"]),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeRuleList(payload: unknown): RuleView[] {
  return asItems<KubeResource>(payload).map(normalizeRule);
}

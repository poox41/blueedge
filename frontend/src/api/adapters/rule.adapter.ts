import type { KubeResource, RuleView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

function stringifyRuleResource(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const resource = value as Record<string, unknown>;
  if (typeof resource.path === "string") return resource.path;
  if (typeof resource.resource === "string") return resource.resource;
  if (typeof resource.topic === "string" && typeof resource.node_name === "string") {
    return `${resource.node_name}/${resource.topic}`;
  }
  if (typeof resource.topic === "string") return resource.topic;
  return Object.entries(resource)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => `${key}: ${item}`)
    .join(", ");
}

export function normalizeRule(raw: KubeResource): RuleView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    source: typeof raw.source === "string" ? raw.source : getNestedString(raw, ["spec", "source"]),
    target: typeof raw.target === "string" ? raw.target : getNestedString(raw, ["spec", "target"]),
    sourceResource:
      typeof raw.sourceResource === "string"
        ? raw.sourceResource
        : stringifyRuleResource(raw.spec?.sourceResource) || getNestedString(raw, ["spec", "sourceResource"]),
    targetResource:
      typeof raw.targetResource === "string"
        ? raw.targetResource
        : stringifyRuleResource(raw.spec?.targetResource) || getNestedString(raw, ["spec", "targetResource"]),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeRuleList(payload: unknown): RuleView[] {
  return asItems<KubeResource>(payload).map(normalizeRule);
}

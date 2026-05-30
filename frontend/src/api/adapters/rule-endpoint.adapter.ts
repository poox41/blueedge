import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

export function normalizeRuleEndpoint(raw: KubeResource): RuleEndpointView {
  const specProperties = raw.spec?.properties as Record<string, unknown> | undefined;
  const flatProperties = raw.properties as Record<string, unknown> | undefined;
  const properties = specProperties || flatProperties;
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
        : getNestedString(raw, ["spec", "targetResource"],
          typeof properties?.targetResource === "string"
            ? properties.targetResource
            : typeof properties?.topic === "string"
              ? properties.topic
              : typeof properties?.resource === "string"
                ? properties.resource
                : typeof properties?.path === "string"
                  ? properties.path
                  : "-",
        ),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeRuleEndpointList(payload: unknown): RuleEndpointView[] {
  return asItems<KubeResource>(payload).map(normalizeRuleEndpoint);
}

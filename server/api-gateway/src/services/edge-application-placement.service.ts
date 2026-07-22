import { labelsOf, metadataOf } from "../utils/kubernetes.js";

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

export function edgeApplicationTargetGroupNames(resource: any): string[] {
  const groups = resource?.spec?.workloadScope?.targetNodeGroups;
  return Array.isArray(groups) ? groups.map((item: any) => String(item?.name || "")).filter(Boolean) : [];
}

export function matchedNodesForNodeGroup(group: any, nodes: any[]): any[] {
  const explicit = Array.isArray(group?.spec?.nodes) ? group.spec.nodes.map(String).filter(Boolean) : [];
  const matchLabels = stringRecord(group?.spec?.matchLabels);
  return explicit.length
    ? nodes.filter((node) => explicit.includes(String(metadataOf(node).name)))
    : nodes.filter((node) => Object.keys(matchLabels).length > 0 && Object.entries(matchLabels).every(([key, value]) => labelsOf(node)[key] === value));
}

export function edgeApplicationTargetsOnlyMatchingNodes(
  resource: any,
  groupsByName: Map<string, any>,
  nodes: any[],
  nodePredicate: (node: any) => boolean,
): boolean {
  const targets = edgeApplicationTargetGroupNames(resource);
  return targets.length > 0 && targets.every((name) => {
    const group = groupsByName.get(name);
    if (!group) return false;
    const matched = matchedNodesForNodeGroup(group, nodes);
    return matched.length > 0 && matched.every(nodePredicate);
  });
}

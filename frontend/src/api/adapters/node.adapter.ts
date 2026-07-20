import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNestedString } from "./common";

function getNodeReadyStatus(raw: KubeResource): EdgeNodeView["status"] {
  const flatStatus = (raw as Record<string, unknown>).status;
  if (flatStatus === "Ready" || flatStatus === "NotReady") return flatStatus;
  if (typeof flatStatus === "string") return "Unknown";

  const conditions = (raw.status?.conditions || []) as Array<{ type?: string; status?: string }>;
  const ready = conditions.find((item) => item.type === "Ready");
  if (!ready) return "Unknown";
  return ready.status === "True" ? "Ready" : "NotReady";
}

function getInternalIP(raw: KubeResource): string {
  if (typeof raw.internalIP === "string") return raw.internalIP;

  const addresses = (raw.status?.addresses || []) as Array<{ type?: string; address?: string }>;
  return addresses.find((item) => item.type === "InternalIP")?.address || addresses[0]?.address || "-";
}

function getStringList(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function getLabelRecords(raw: KubeResource): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = [];
  if (raw.metadata?.labels) records.push(raw.metadata.labels);

  const flatLabels = (raw as Record<string, unknown>).labels;
  if (flatLabels && typeof flatLabels === "object" && !Array.isArray(flatLabels)) {
    records.push(flatLabels as Record<string, string>);
  }

  return records;
}

function isEdgeNode(raw: KubeResource): boolean {
  const flat = raw as Record<string, unknown>;
  const kubeletVersion = typeof flat.kubeletVersion === "string"
    ? flat.kubeletVersion
    : getNestedString(raw, ["status", "nodeInfo", "kubeletVersion"], "");
  const isKubeEdgeKubelet = kubeletVersion.toLowerCase().includes("kubeedge");
  if (isKubeEdgeKubelet) return true;

  const roles = [
    ...getStringList(flat.roles),
    ...getStringList(flat.role),
    ...getStringList(flat.nodeRole),
  ].map((item) => item.toLowerCase());
  if (roles.includes("edge")) return true;
  if (roles.includes("agent") && isKubeEdgeKubelet) return true;

  return getLabelRecords(raw).some((labels) => {
    if ("node-role.kubernetes.io/edge" in labels) return true;
    if ("node-role.kubernetes.io/agent" in labels && isKubeEdgeKubelet) return true;
    if (labels["blueedge.io/node-role"] === "edge" || labels.nodeType === "edge" || labels.role === "edge") return true;
    return false;
  });
}

export function normalizeNode(raw: KubeResource): EdgeNodeView {
  return {
    name: getName(raw),
    status: getNodeReadyStatus(raw),
    role: isEdgeNode(raw) ? "edge" : "cloud",
    internalIP: getInternalIP(raw),
    osImage: getNestedString(raw, ["status", "nodeInfo", "osImage"]),
    kubeletVersion: typeof raw.kubeletVersion === "string" ? raw.kubeletVersion : getNestedString(raw, ["status", "nodeInfo", "kubeletVersion"]),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeNodeList(payload: unknown): EdgeNodeView[] {
  return asItems<KubeResource>(payload).map(normalizeNode);
}

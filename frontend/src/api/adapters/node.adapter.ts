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

function isEdgeNode(raw: KubeResource): boolean {
  const name = getName(raw).toLowerCase();
  if (name.includes("edge")) return true;

  const labels = raw.metadata?.labels || {};
  return Object.keys(labels).some((key) => key.includes("edge") || key.includes("kubeedge")) ||
    Object.values(labels).some((value) => value.includes("edge"));
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

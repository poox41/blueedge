import type { KubeResource, ServiceView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

function formatPorts(raw: KubeResource): string {
  if (typeof raw.ports === "string") return raw.ports;

  const ports = (raw.spec?.ports || raw.ports || []) as Array<{ port?: number; protocol?: string; nodePort?: number }>;
  if (!Array.isArray(ports) || ports.length === 0) return "-";

  return ports
    .map((item) => {
      const protocol = item.protocol || "TCP";
      return item.nodePort ? `${item.port}:${item.nodePort}/${protocol}` : `${item.port}/${protocol}`;
    })
    .join(", ");
}

function getExternalIP(raw: KubeResource): string {
  if (typeof raw.externalIP === "string") return raw.externalIP;
  const externalIPs = raw.spec?.externalIPs as string[] | undefined;
  if (Array.isArray(externalIPs) && externalIPs.length > 0) return externalIPs.join(", ");
  const loadBalancer = raw.status?.loadBalancer as { ingress?: Array<{ ip?: string; hostname?: string }> } | undefined;
  if (Array.isArray(loadBalancer?.ingress) && loadBalancer.ingress.length > 0) {
    return loadBalancer.ingress.map((item) => item.ip || item.hostname).filter(Boolean).join(", ");
  }
  return "-";
}

export function normalizeService(raw: KubeResource): ServiceView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    type: typeof raw.type === "string" ? raw.type : getNestedString(raw, ["spec", "type"], "ClusterIP"),
    clusterIP: typeof raw.clusterIP === "string" ? raw.clusterIP : getNestedString(raw, ["spec", "clusterIP"]),
    externalIP: getExternalIP(raw),
    ports: formatPorts(raw),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeServiceList(payload: unknown): ServiceView[] {
  return asItems<KubeResource>(payload).map(normalizeService);
}

import { gatewayRequest } from "@/api/request";

export interface NodeMetric {
  name: string;
  cpuMillicores: number;
  memoryBytes: number;
  cpuPercent: number;
  memoryPercent: number;
}

export interface PodMetric {
  name: string;
  namespace: string;
  cpuMillicores: number;
  memoryBytes: number;
}

export async function listNodeMetrics(): Promise<NodeMetric[]> {
  const res = await gatewayRequest<{ items?: NodeMetric[] }>("/metrics/nodes");
  return Array.isArray(res.data.items) ? res.data.items : [];
}

export async function listPodMetrics(namespace?: string): Promise<PodMetric[]> {
  const res = await gatewayRequest<{ items?: PodMetric[] }>("/metrics/pods", {
    params: { namespace },
  });
  return Array.isArray(res.data.items) ? res.data.items : [];
}

export function formatMemory(bytes: number): string {
  if (!bytes) return "-";
  const mi = bytes / 1024 ** 2;
  if (mi >= 1024) return `${(mi / 1024).toFixed(1)}Gi`;
  return `${Math.round(mi)}Mi`;
}

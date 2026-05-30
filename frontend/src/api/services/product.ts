import { gatewayRequest } from "@/api/request";

export interface ProductOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
}

export interface ClusterMetrics {
  timestamp?: string;
  cpu: {
    usedMillicores: number;
    capacityMillicores: number;
    percent: number;
  };
  memory: {
    usedBytes: number;
    capacityBytes: number;
    percent: number;
  };
  source: string;
}

export interface ClusterMetricsHistory {
  items: ClusterMetrics[];
  source: string;
  stale?: boolean;
}

export interface ClusterEvent {
  name: string;
  namespace: string;
  type: string;
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
  };
  count: number;
  lastTimestamp: string;
}

export async function getProductOverview(): Promise<ProductOverview> {
  const res = await gatewayRequest<ProductOverview>("/overview");
  return res.data;
}

export async function getClusterMetrics(): Promise<ClusterMetrics> {
  const res = await gatewayRequest<ClusterMetrics>("/metrics/cluster");
  return res.data;
}

export async function getClusterMetricsHistory(): Promise<ClusterMetricsHistory> {
  const res = await gatewayRequest<ClusterMetricsHistory>("/metrics/cluster/history");
  return res.data;
}

export async function listClusterEvents(namespace?: string): Promise<ClusterEvent[]> {
  const res = await gatewayRequest<{ items?: ClusterEvent[] }>("/events", {
    params: { namespace },
  });
  return Array.isArray(res.data.items) ? res.data.items : [];
}

export async function getPodLogs(namespace: string, name: string, tailLines = 200): Promise<string> {
  const res = await gatewayRequest<string>(`/workloads/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`, {
    params: { tailLines },
  });
  return res.data;
}

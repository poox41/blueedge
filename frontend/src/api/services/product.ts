import { gatewayRequest } from "@/api/request";

export interface ProductOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
}

export interface ClusterMetrics {
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

export async function getProductOverview(): Promise<ProductOverview> {
  const res = await gatewayRequest<ProductOverview>("/overview");
  return res.data;
}

export async function getClusterMetrics(): Promise<ClusterMetrics> {
  const res = await gatewayRequest<ClusterMetrics>("/metrics/cluster");
  return res.data;
}

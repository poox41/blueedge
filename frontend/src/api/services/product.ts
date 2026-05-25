import { gatewayRequest } from "@/api/request";

export interface ProductOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
}

export async function getProductOverview(): Promise<ProductOverview> {
  const res = await gatewayRequest<ProductOverview>("/overview");
  return res.data;
}

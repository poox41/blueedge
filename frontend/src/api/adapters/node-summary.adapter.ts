export interface NodeSummaryResponse {
  item: NodeSummaryItem;
  warnings?: Array<{ source: string; message: string }>;
}

export interface NodeSummaryItem {
  name: string;
  status: "ready" | "notReady" | "unknown" | string;
  roles: string[];
  architecture: string;
  os: string;
  kernelVersion: string;
  containerRuntime: string;
  kubeletVersion: string;
  kubeEdgeVersion: string;
  internalIP: string;
  createdAt: string;
  conditions: Array<{ type?: string; status?: string; message?: string; reason?: string }>;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  metrics: { cpuUsage: number | null; memoryUsage: number | null; available: boolean };
  pods: {
    total: number;
    running: number;
    abnormal: number;
    items: Array<{ name: string; namespace: string; status: string; nodeName: string; podIP: string; restartCount: number; images: string[]; createdAt: string }>;
  };
  events: unknown[];
  accessConfig: unknown | null;
  edgeUnitRef: string;
  nodeGroupRefs: string[];
  raw: any;
}

export function nodeSummaryStatusText(status: string) {
  if (status === "ready") return "就绪";
  if (status === "notReady") return "未就绪";
  return "未知";
}

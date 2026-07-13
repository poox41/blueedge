export interface PodSummaryResponse {
  item: PodSummaryItem;
  warnings?: Array<{ source: string; message: string }>;
}

export interface PodSummaryItem {
  name: string;
  namespace: string;
  status: string;
  phase: string;
  nodeName: string;
  podIP: string;
  hostIP: string;
  createdAt: string;
  restartCount: number;
  containers: Array<Record<string, any>>;
  conditions: Array<Record<string, any>>;
  metrics: {
    available: boolean;
    containers: Array<{ name: string; cpuUsage: number; memoryUsage: number }>;
  };
  events: Array<any>;
  recentLogs: { available: boolean; container: string; content: string };
  owner: { kind: string; name: string } | null;
  node: { name: string; status: string; internalIP: string } | null;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  raw: any;
}

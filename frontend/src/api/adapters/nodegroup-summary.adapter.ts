export interface NodeGroupSummaryResponse {
  item: NodeGroupSummaryItem;
  warnings?: Array<{ source: string; message: string }>;
}

export interface NodeGroupSummaryItem {
  name: string;
  createdAt: string;
  selectorType: "nodes" | "matchLabels" | string;
  explicitNodes: string[];
  matchLabels: Record<string, string>;
  matchedNodes: string[];
  nodes: {
    ready: number;
    total: number;
    items: Array<{ name: string; status: string; internalIP?: string; labels?: Record<string, string> }>;
  };
  edgeUnits: Array<{ name: string; rawRef?: { kind: string; name: string } }>;
  applications: { total: number; healthy: number };
  batchTasks?: { total: number };
  labels: Record<string, string>;
  annotations: Record<string, string>;
  description: string;
  raw: any;
}

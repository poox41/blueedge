export interface DeviceTwinSummaryItem {
  name: string;
  propertyName: string;
  desiredValue: string;
  reportedValue: string;
  status: "synced" | "outOfSync" | "unknown" | string;
  lastUpdatedAt: string;
  metadata: Record<string, unknown>;
}

export interface DeviceSummary {
  name: string;
  namespace: string;
  deviceModelRef: string;
  status: "online" | "offline" | "unknown" | string;
  nodeName: string;
  edgeUnitRef: string;
  nodeGroupRef: string;
  protocol: string;
  access: {
    protocol: string;
    address: string;
    endpoint: string;
    metadata: Record<string, unknown>;
  };
  twins: {
    total: number;
    synced: number;
    outOfSync: number;
    unknown: number;
    items: DeviceTwinSummaryItem[];
  };
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  rawRef: {
    kind: "Device";
    namespace: string;
    name: string;
  };
  raw?: any;
}

export interface DeviceSummaryListResponse {
  items: DeviceSummary[];
  warnings?: Array<{ source: string; code?: string; message: string }>;
}

export interface DeviceSummaryResponse {
  item: DeviceSummary;
  warnings?: Array<{ source: string; code?: string; message: string }>;
}

export function deviceStatusText(status: string) {
  if (status === "online") return "在线";
  if (status === "offline") return "离线";
  return "未知";
}

export function deviceStatusColor(status: string) {
  if (status === "online") return "success";
  if (status === "offline") return "default";
  return "default";
}

export function twinStatusText(status: string) {
  if (status === "synced") return "已同步";
  if (status === "outOfSync") return "未同步";
  return "未知";
}

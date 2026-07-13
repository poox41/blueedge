export type ObservabilityKind = "node" | "pod" | "deployment" | "edgeapplication" | "device";

export interface ObservabilityWarning {
  source: string;
  code?: string;
  message: string;
}

export interface ObservabilityMetrics {
  available: boolean;
  reason?: string;
  scope: string;
  cpuUsage: number | string | null;
  memoryUsage: number | string | null;
  containers: Array<{ name: string; cpuUsage: number; memoryUsage: number }>;
  pods: Array<{ name: string; namespace: string; cpuUsage: number; memoryUsage: number; containers: Array<{ name: string; cpuUsage: number; memoryUsage: number }> }>;
}

export interface ObservabilityEvent {
  name: string;
  namespace: string;
  type: string;
  reason: string;
  message: string;
  involvedObject: { kind: string; name: string };
  count: number;
  lastTimestamp: string;
}

export interface ObservabilityLogPod {
  podName: string;
  container: string;
  available: boolean;
  content: string;
  truncated: boolean;
  reason?: string;
}

export interface ObservabilitySummary {
  kind: ObservabilityKind;
  namespace: string;
  name: string;
  metrics: ObservabilityMetrics;
  events: {
    available: boolean;
    reason?: string;
    items: ObservabilityEvent[];
  };
  logs: {
    available: boolean;
    reason?: string;
    pods: ObservabilityLogPod[];
  };
  relatedResources: {
    pods: Array<{ name: string; namespace: string; status: string; nodeName: string; podIP: string; restartCount: number; images: string[]; createdAt: string }>;
    node: { name: string; status: string; internalIP: string } | null;
    deployment: { namespace: string; name: string } | null;
    edgeApplication: { namespace: string; name: string } | null;
  };
  stale: boolean;
}

export interface ObservabilitySummaryResponse {
  item: ObservabilitySummary;
  warnings?: ObservabilityWarning[];
}

export interface ObservabilityLogsResponse {
  item: {
    kind: ObservabilityKind;
    namespace: string;
    name: string;
    available?: boolean;
    reason?: string;
    pods: ObservabilityLogPod[];
  };
  warnings?: ObservabilityWarning[];
}

export function observabilityUnavailableText(reason?: string) {
  if (reason === "node_logs_not_configured") return "节点系统日志能力未配置";
  if (reason === "device_logs_not_configured" || reason === "device_metrics_not_configured") return "当前未配置数据源";
  if (reason === "not_requested") return "未请求";
  if (reason === "no_pods") return "未找到关联 Pod";
  return "监控数据不可用";
}

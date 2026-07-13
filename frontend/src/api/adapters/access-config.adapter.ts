export type AccessConfigStatus = "pending" | "registered" | "ready" | "abnormal" | "expired" | "unknown";
export type AccessConfigArchitecture = "amd64" | "arm64" | "arm";

export interface AccessConfigWarning {
  source: string;
  message: string;
}

export interface AccessConfigView {
  name: string;
  edgeUnitRef: string;
  nodeGroupRef: string;
  nodeName: string;
  architecture: AccessConfigArchitecture;
  os: string;
  kubeEdgeVersion: string;
  cloudCoreAddress: string;
  protocol: string;
  registry: string;
  status: AccessConfigStatus;
  registered: boolean;
  ready: boolean;
  createdAt: string;
  description: string;
}

export interface AccessConfigListResponse {
  items: AccessConfigView[];
  warnings?: AccessConfigWarning[];
}

export interface AccessConfigDetailResponse {
  item: AccessConfigView;
  warnings?: AccessConfigWarning[];
}

export interface AccessConfigInstallCommandResponse {
  name: string;
  ready: boolean;
  command: string;
  commandTemplate: string;
  missingRequirements: string[];
  expiresAt: string | null;
  warnings?: AccessConfigWarning[];
}

export interface AccessConfigUiModel extends AccessConfigView {
  statusLabel: string;
  nodeLabel: string;
}

function statusLabel(status: AccessConfigStatus): string {
  if (status === "ready") return "已就绪";
  if (status === "registered") return "已注册";
  if (status === "abnormal") return "异常";
  if (status === "expired") return "已过期";
  if (status === "pending") return "待接入";
  return "未知";
}

function formatCreatedAt(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toAccessConfigUiModel(item: AccessConfigView): AccessConfigUiModel {
  return {
    ...item,
    statusLabel: statusLabel(item.status),
    nodeLabel: `blueedge.io/edge-unit: ${item.edgeUnitRef}`,
    createdAt: formatCreatedAt(item.createdAt),
  };
}

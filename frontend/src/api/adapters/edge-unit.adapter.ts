export type EdgeUnitStatus = "running" | "abnormal" | "unknown";
export type EdgeUnitAccessType = "external" | "dedicated" | "unknown";
export type EdgeUnitComponentState = "installed" | "notInstalled" | "unknown";

export interface EdgeUnitWarning {
  source: string;
  message: string;
}

export interface EdgeUnitView {
  name: string;
  status: EdgeUnitStatus;
  accessType: EdgeUnitAccessType;
  clusterName: string;
  kubeEdgeVersion: string;
  createdAt: string;
  nodes: { ready: number; total: number };
  workloads: { healthy: number; total: number };
  applications: { healthy: number; total: number };
  components: {
    insight: EdgeUnitComponentState;
    monitor: EdgeUnitComponentState;
  };
  description?: string;
  nodeScale?: "小型" | "中型" | "大型";
  mqttEnabled?: boolean;
  protocols?: string[];
  accessAddresses?: string[];
  ports?: {
    websocket: string;
    quic: string;
    https: string;
    cloudStream: string;
    tunnel: string;
  };
  uninstallPolicy?: "保留相关命名空间" | "删除相关命名空间";
  incrementalSync?: IncrementalSyncStatus;
  rawRef: {
    kind: "EdgeUnitConfigMap";
    name: string;
  };
}

export interface IncrementalSyncStatus {
  installed: boolean;
  enabled: boolean;
  edgeController: boolean;
  syncController: boolean;
  cloudHub: boolean;
  taskManager: boolean;
  namespace: string;
  configMap: string;
  message: string;
  restarted?: boolean;
}

export interface EdgeUnitListResponse {
  items: EdgeUnitView[];
  warnings?: EdgeUnitWarning[];
}

export interface EdgeUnitDetailResponse {
  item: EdgeUnitView;
  warnings?: EdgeUnitWarning[];
}

export interface EdgeUnitUiModel {
  name: string;
  status: "running" | "abnormal" | "unknown";
  access: "外接" | "专有" | "未配置";
  cluster: string;
  version: string;
  createdAt: string;
  nodes: [number, number];
  workloads: [number, number];
  apps: [number, number];
  insight: boolean;
  monitor: boolean;
  accessType: EdgeUnitAccessType;
  insightStatus: EdgeUnitComponentState;
  monitorStatus: EdgeUnitComponentState;
  rawRefKind: "EdgeUnitConfigMap";
  rawRefName: string;
  description?: string;
  nodeScale?: "小型" | "中型" | "大型";
  mqttEnabled?: boolean;
  protocols?: string[];
  accessAddresses?: string[];
  ports?: {
    websocket: string;
    quic: string;
    https: string;
    cloudStream: string;
    tunnel: string;
  };
  uninstallPolicy?: "保留相关命名空间" | "删除相关命名空间";
  incrementalSync?: IncrementalSyncStatus;
}

export interface WorkbenchEdgeUnitModel {
  name: string;
  status: "运行中" | "异常" | "未知";
  type: "外接" | "专有" | "未配置";
  cluster: string;
  version: string;
  createdAt: string;
  nodeScale: "小型" | "中型" | "大型" | "未配置";
  mqtt: "已启用" | "未启用" | "未配置";
  access: string;
  protocols: string;
  description: string;
  accessAddresses: string[];
  protocolList: string[];
  ports: {
    websocket: string;
    quic: string;
    https: string;
    cloudStream: string;
    tunnel: string;
  };
  uninstallPolicy: "保留相关命名空间" | "删除相关命名空间" | "未配置";
  nodes: [number, number];
  workloads: [number, number];
  apps: [number, number];
  accessType: EdgeUnitAccessType;
  insightStatus: EdgeUnitComponentState;
  monitorStatus: EdgeUnitComponentState;
  rawRefKind: "EdgeUnitConfigMap";
  rawRefName: string;
}

const defaultPorts = {
  websocket: "30000",
  quic: "30001",
  https: "30002",
  cloudStream: "30003",
  tunnel: "30004",
};

function accessLabel(value: EdgeUnitAccessType): EdgeUnitUiModel["access"] {
  if (value === "external") return "外接";
  if (value === "dedicated") return "专有";
  return "未配置";
}

function statusLabel(value: EdgeUnitStatus): WorkbenchEdgeUnitModel["status"] {
  if (value === "running") return "运行中";
  if (value === "abnormal") return "异常";
  return "未知";
}

function formatCreatedAt(value: string): string {
  if (!value || value === "unknown") return "未配置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toHomeEdgeUnit(item: EdgeUnitView): EdgeUnitUiModel {
  const cluster = !item.clusterName || item.clusterName === "unknown" ? "未配置" : item.clusterName;
  const version = !item.kubeEdgeVersion || item.kubeEdgeVersion === "unknown" ? "未配置" : item.kubeEdgeVersion;
  return {
    name: item.name,
    status: item.status,
    access: accessLabel(item.accessType),
    cluster,
    version,
    createdAt: formatCreatedAt(item.createdAt),
    nodes: [item.nodes.ready, item.nodes.total],
    workloads: [item.workloads.healthy, item.workloads.total],
    apps: [item.applications.healthy, item.applications.total],
    insight: item.components.insight === "installed",
    monitor: item.components.monitor === "installed",
    accessType: item.accessType,
    insightStatus: item.components.insight,
    monitorStatus: item.components.monitor,
    rawRefKind: item.rawRef.kind,
    rawRefName: item.rawRef.name,
    description: item.description || "",
    nodeScale: item.nodeScale,
    mqttEnabled: item.mqttEnabled,
    protocols: item.protocols,
    accessAddresses: item.accessAddresses,
    ports: item.ports,
    uninstallPolicy: item.uninstallPolicy,
    incrementalSync: item.incrementalSync,
  };
}

export function toWorkbenchEdgeUnit(item: EdgeUnitView): WorkbenchEdgeUnitModel {
  const home = toHomeEdgeUnit(item);
  return {
    name: home.name,
    status: statusLabel(item.status),
    type: home.access,
    cluster: home.cluster,
    version: home.version,
    createdAt: home.createdAt,
    nodeScale: home.nodeScale || "未配置",
    mqtt: home.mqttEnabled === undefined ? "未配置" : home.mqttEnabled ? "已启用" : "未启用",
    access: home.accessAddresses?.join("、") || "未配置",
    protocols: home.protocols?.join("、") || "未配置",
    description: home.description || `${home.name} 边缘单元`,
    accessAddresses: home.accessAddresses || [],
    protocolList: home.protocols || [],
    ports: home.ports || Object.fromEntries(Object.keys(defaultPorts).map((key) => [key, "未配置"])) as typeof defaultPorts,
    uninstallPolicy: home.uninstallPolicy || "未配置",
    nodes: home.nodes,
    workloads: home.workloads,
    apps: home.apps,
    accessType: home.accessType,
    insightStatus: home.insightStatus,
    monitorStatus: home.monitorStatus,
    rawRefKind: home.rawRefKind,
    rawRefName: home.rawRefName,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNamespace } from "@/contexts/NamespaceContext";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import yaml from "js-yaml";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Info,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Tag,
  Terminal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination, useListPagination } from "@/components/common/ListPagination";
import { Textarea } from "@/components/ui/textarea";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  createEdgeUnitDeploymentResource,
  deleteDeploymentResource,
  deletePodResource,
  getDeployment,
  listDeployments,
  listNamespaces,
  listNodes,
  listPods,
  updateEdgeUnitDeploymentResource,
} from "@/api/services/resources";
import {
  executeDeploymentCommand,
  getEdgeUnitResources,
  getDeploymentAudit,
  getResourceLogs,
  getResourceObservability,
  listDeploymentRevisions,
  rollbackDeploymentRevision,
  runDeploymentAction,
} from "@/api/services/product";
import type { DeploymentAuditRecord, DeploymentRevision } from "@/api/services/product";
import { observabilityUnavailableText } from "@/api/adapters/observability.adapter";
import type { ObservabilityEvent, ObservabilitySummary } from "@/api/adapters/observability.adapter";
import type { EdgeNodeView, KubeResource, WorkloadView } from "@/types/kubeedge";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";

type WorkloadStatus = "运行中" | "等待中" | "未就绪";

type Workload = {
  id: string;
  name: string;
  alias: string;
  status: WorkloadStatus;
  namespace: string;
  readyReplicas: number;
  replicas: number;
  image: string;
  createTime: string;
  description: string;
  raw?: KubeResource;
};

type DeploymentPodRow = {
  name: string;
  status: string;
  statusMessage: string;
  statusError: boolean;
  readyContainers: number;
  totalContainers: number;
  podIP: string;
  nodeName: string;
  restartCount: number;
  cpu: string;
  memory: string;
  raw: KubeResource;
};

type PodColumnKey = "name" | "status" | "containers" | "ip" | "node" | "restarts" | "cpu" | "memory";

const podColumns: Array<{ key: PodColumnKey; label: string }> = [
  { key: "name", label: "容器组名称" },
  { key: "status", label: "状态" },
  { key: "containers", label: "容器（正常/总量）" },
  { key: "ip", label: "容器组 IP" },
  { key: "node", label: "节点" },
  { key: "restarts", label: "重启次数" },
  { key: "cpu", label: "CPU 申请值/限制值" },
  { key: "memory", label: "内存申请值/限制值" },
];

type WorkloadMenuAction = "console" | "monitor" | "logs" | "yaml" | "update" | "labels" | "status" | "rollback";

type WorkloadActionPanel = {
  type: WorkloadMenuAction;
  item: Workload;
};

type WorkloadUpdateForm = {
  image: string;
  replicas: string;
};

type WorkloadDetailTab = "pods" | "containers" | "scheduling" | "labels" | "access" | "versions" | "events" | "audit" | "yaml";

type WorkloadWizardLocation = {
  step: 0 | 1 | 2;
  advancedTab?: 0 | 1 | 2 | 3;
};

type WorkloadForm = {
  name: string;
  alias: string;
  namespace: string;
  replicas: string;
  description: string;
  containerName: string;
  image: string;
  pullPolicy: "IfNotPresent" | "Always" | "Never";
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  privileged: boolean;
  port: string;
  lifecyclePostStart: string;
  lifecyclePreStop: string;
  startupProbe: boolean;
  readinessProbe: boolean;
  livenessProbe: boolean;
  envKey: string;
  envValue: string;
  volumeName: string;
  volumeMountPath: string;
  runAsUser: string;
  runAsGroup: string;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
  schedulingMode: "all" | "nodeSelector" | "nodeName" | "podAntiAffinity";
  nodeSelectors: KeyValueDraft[];
  nodeSelectorValue: string;
  workloadLabels: string;
  workloadAnnotations: string;
  podLabels: string;
  networkType: "none" | "portMapping" | "hostNetwork";
  strategy: "RollingUpdate" | "Recreate";
  maxSurge: string;
  maxUnavailable: string;
  partition: string;
  timeoutSeconds: string;
};

type KeyValueDraft = {
  id: string;
  key: string;
  value: string;
};

type VolumeDraft = {
  id: string;
  name: string;
  type: "emptyDir" | "hostPath" | "configMap" | "secret";
  mountPath: string;
  source: string;
};

type ContainerDraft = {
  id: string;
  name: string;
  image: string;
  pullPolicy: WorkloadForm["pullPolicy"];
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  privileged: boolean;
  lifecyclePostStart: string;
  lifecyclePreStop: string;
  startupProbe: boolean;
  readinessProbe: boolean;
  livenessProbe: boolean;
  envs: KeyValueDraft[];
  volumes: VolumeDraft[];
  runAsUser: string;
  runAsGroup: string;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
};

const createContainerDraft = (index: number): ContainerDraft => ({
  id: `container-${Date.now()}-${index}`,
  name: "",
  image: "",
  pullPolicy: "IfNotPresent",
  cpuRequest: "",
  cpuLimit: "",
  memoryRequest: "",
  memoryLimit: "",
  privileged: false,
  lifecyclePostStart: "",
  lifecyclePreStop: "",
  startupProbe: false,
  readinessProbe: false,
  livenessProbe: false,
  envs: [{ id: `env-${Date.now()}-${index}`, key: "", value: "" }],
  volumes: [],
  runAsUser: "",
  runAsGroup: "",
  readOnlyRootFilesystem: false,
  allowPrivilegeEscalation: false,
});

const defaultForm: WorkloadForm = {
  name: "",
  alias: "",
  namespace: "",
  replicas: "1",
  description: "",
  containerName: "",
  image: "",
  pullPolicy: "IfNotPresent",
  cpuRequest: "",
  cpuLimit: "",
  memoryRequest: "",
  memoryLimit: "",
  privileged: false,
  port: "80",
  lifecyclePostStart: "",
  lifecyclePreStop: "",
  startupProbe: false,
  readinessProbe: false,
  livenessProbe: false,
  envKey: "",
  envValue: "",
  volumeName: "",
  volumeMountPath: "",
  runAsUser: "",
  runAsGroup: "",
  readOnlyRootFilesystem: false,
  allowPrivilegeEscalation: false,
  schedulingMode: "nodeSelector",
  nodeSelectors: [{ id: "node-selector-1", key: "blueedge.io/node-role", value: "edge" }],
  nodeSelectorValue: "",
  workloadLabels: "",
  workloadAnnotations: "",
  podLabels: "",
  networkType: "none",
  strategy: "RollingUpdate",
  maxSurge: "25%",
  maxUnavailable: "25%",
  partition: "0",
  timeoutSeconds: "600",
};

const wizardLocationForDetailTab = (tab: WorkloadDetailTab): WorkloadWizardLocation | null => {
  if (tab === "yaml") return null;
  if (tab === "containers") return { step: 1 };
  if (tab === "scheduling") return { step: 2, advancedTab: 0 };
  if (tab === "labels") return { step: 2, advancedTab: 1 };
  if (tab === "access") return { step: 2, advancedTab: 2 };
  return { step: 0 };
};

const statusConfig: Record<WorkloadStatus, { className: string; dot: string }> = {
  运行中: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  等待中: { className: "bg-[#fff7ed] text-[#f59e0b]", dot: "#f59e0b" },
  未就绪: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ef4444" },
};

const defaultYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-workload
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80
`;

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const highlightYamlValue = (value: string): string => {
  const leading = value.match(/^\s*/)?.[0] || "";
  const raw = value.slice(leading.length);
  if (!raw) return escapeHtml(value);
  const color = /^(true|false|null|~)$/i.test(raw)
    ? "#569CD6"
    : /^-?\d+(\.\d+)?$/.test(raw)
      ? "#B5CEA8"
      : "#CE9178";
  return `${escapeHtml(leading)}<span style="color:${color}">${escapeHtml(raw)}</span>`;
};

const highlightYamlLine = (line: string): string => {
  const commentIndex = line.indexOf("#");
  const source = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = source.match(/^(\s*-\s*|\s*)([A-Za-z_][A-Za-z0-9_-]*)(:\s*)(.*)$/);
  if (keyMatch) {
    const [, prefix, key, colon, rest] = keyMatch;
    return `${escapeHtml(prefix)}<span style="color:#9CDCFE">${escapeHtml(key)}</span>${escapeHtml(colon)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  const listMatch = source.match(/^(\s*-\s+)(.*)$/);
  if (listMatch) {
    const [, prefix, rest] = listMatch;
    return `${escapeHtml(prefix)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  return `${escapeHtml(source)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
};

const highlightYaml = (code: string): string => code.split("\n").map(highlightYamlLine).join("\n");

const asStringRecord = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
    : {};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];

const formatDateTime = (value: string): string => {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
};

const configuredValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "未配置";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const replicaSetBelongsToDeployment = (replicaSetName: string, deploymentName: string): boolean => {
  const prefix = `${deploymentName}-`;
  if (!deploymentName || !replicaSetName.startsWith(prefix)) return false;
  const hash = replicaSetName.slice(prefix.length);
  return Boolean(hash) && !hash.includes("-");
};

const deploymentPodRows = (pods: unknown[], item: Workload): DeploymentPodRow[] => {
  const deploymentSpec = asRecord(item.raw?.spec);
  const selector = asStringRecord(asRecord(deploymentSpec.selector).matchLabels);
  return pods.flatMap((pod) => {
    const resource = asRecord(pod);
    const metadata = asRecord(resource.metadata);
    const podLabels = asStringRecord(metadata.labels);
    const ownerReferences = asRecordArray(metadata.ownerReferences);
    const selectorMatches = Object.keys(selector).length > 0 && Object.entries(selector).every(([key, value]) => podLabels[key] === value);
    const ownerMatches = ownerReferences.some((owner) => String(owner.kind || "") === "ReplicaSet" && replicaSetBelongsToDeployment(String(owner.name || ""), item.name));
    if (ownerReferences.length > 0 ? !ownerMatches : !selectorMatches) return [];
    const spec = asRecord(resource.spec);
    const status = asRecord(resource.status);
    const containerSpecs = asRecordArray(spec.containers);
    const containerStatuses = asRecordArray(status.containerStatuses);
    const allContainerStatuses = [...asRecordArray(status.initContainerStatuses), ...containerStatuses];
    const waitingStates = allContainerStatuses
      .map((entry) => asRecord(asRecord(entry.state).waiting))
      .filter((entry) => Object.keys(entry).length > 0);
    const terminatedStates = allContainerStatuses
      .map((entry) => asRecord(asRecord(entry.state).terminated))
      .filter((entry) => Object.keys(entry).length > 0);
    const containerState = waitingStates.find((entry) => String(entry.reason || "") !== "ContainerCreating")
      || waitingStates[0]
      || terminatedStates.find((entry) => Number(entry.exitCode || 0) !== 0)
      || terminatedStates[0];
    const containerReason = String(containerState?.reason || "");
    const containerMessage = String(containerState?.message || "");
    const statusErrorReasons = new Set(["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff", "CreateContainerConfigError", "CreateContainerError", "RunContainerError", "InvalidImageName"]);
    const statusLabels: Record<string, string> = {
      ImagePullBackOff: "镜像拉取失败（ImagePullBackOff）",
      ErrImagePull: "镜像拉取失败（ErrImagePull）",
      CrashLoopBackOff: "容器反复崩溃（CrashLoopBackOff）",
      CreateContainerConfigError: "容器配置错误",
      CreateContainerError: "容器创建失败",
      RunContainerError: "容器启动失败",
      InvalidImageName: "镜像名称无效",
      ContainerCreating: "容器创建中",
      PodInitializing: "容器初始化中",
    };
    const resources = containerSpecs.map((container) => asRecord(container.resources));
    const requests = resources.map((entry) => asRecord(entry.requests));
    const limits = resources.map((entry) => asRecord(entry.limits));
    const resourceText = (key: "cpu" | "memory") => {
      const requested = requests.map((entry) => entry[key]).filter(Boolean).map(String).join(" + ");
      const limited = limits.map((entry) => entry[key]).filter(Boolean).map(String).join(" + ");
      return requested || limited ? `${requested || "未配置"} / ${limited || "未配置"}` : "未配置";
    };
    return [{
      name: String(metadata.name || "未配置"),
      status: statusLabels[containerReason] || containerReason || String(status.phase || "未知"),
      statusMessage: containerMessage,
      statusError: statusErrorReasons.has(containerReason) || String(status.phase || "") === "Failed",
      readyContainers: containerStatuses.filter((entry) => entry.ready === true).length,
      totalContainers: containerSpecs.length,
      podIP: String(status.podIP || "未配置"),
      nodeName: String(spec.nodeName || "未配置"),
      restartCount: containerStatuses.reduce((sum, entry) => sum + Number(entry.restartCount || 0), 0),
      cpu: resourceText("cpu"),
      memory: resourceText("memory"),
      raw: resource as KubeResource,
    }];
  });
};

const parseKeyValueText = (value: string): Record<string, string> =>
  Object.fromEntries(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [key, ...rest] = item.split("=");
        return [key.trim(), rest.join("=").trim()];
      })
      .filter(([key]) => key),
  );

const draftListToRecord = (drafts: KeyValueDraft[]): Record<string, string> =>
  Object.fromEntries(drafts.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]));

const recordToDraftList = (record: Record<string, string>, prefix: string): KeyValueDraft[] =>
  Object.entries(record).map(([key, value], index) => ({ id: `${prefix}-${index}-${key}`, key, value }));

const getFirstContainer = (resource: KubeResource): Record<string, any> => {
  const containers = (resource.spec?.template as any)?.spec?.containers;
  return Array.isArray(containers) && containers.length ? containers[0] : {};
};

const getWorkloadStatus = (workload: WorkloadView): WorkloadStatus => {
  if (workload.replicas > 0 && workload.availableReplicas >= workload.replicas) return "运行中";
  const rawStatus = workload.raw?.status as Record<string, any> | undefined;
  const conditions = Array.isArray(rawStatus?.conditions) ? rawStatus.conditions : [];
  const failed = conditions.some((item) =>
    (item?.type === "ReplicaFailure" && item?.status === "True") ||
    (item?.type === "Progressing" && item?.status === "False" && item?.reason === "ProgressDeadlineExceeded"),
  );
  return failed ? "未就绪" : "等待中";
};

const toWorkload = (workload: WorkloadView): Workload => {
  const annotations = asStringRecord(workload.raw.metadata?.annotations);
  const container = getFirstContainer(workload.raw);
  return {
    id: `${workload.namespace}/${workload.name}`,
    name: workload.name,
    alias: annotations["blueedge.io/alias"] || annotations.alias || "-",
    status: getWorkloadStatus(workload),
    namespace: workload.namespace,
    readyReplicas: workload.availableReplicas,
    replicas: workload.replicas,
    image: typeof container.image === "string" ? container.image : "-",
    createTime: formatDateTime(workload.createdAt),
    description: annotations["blueedge.io/description"] || annotations.description || "-",
    raw: workload.raw,
  };
};

const ensureDeploymentResource = (source: string): KubeResource => {
  const parsed = yaml.load(source) as KubeResource;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML 内容必须是 Kubernetes Deployment 对象");
  }
  if (parsed.kind !== "Deployment") {
    throw new Error("当前页面只支持创建 kind: Deployment");
  }
  return {
    ...parsed,
    metadata: {
      ...(parsed.metadata || {}),
      namespace: parsed.metadata?.namespace || "default",
    },
  };
};

const cloneDeploymentResource = (resource: KubeResource | undefined): KubeResource => {
  if (!resource) return {};
  return JSON.parse(JSON.stringify(resource)) as KubeResource;
};

const normalizeDeploymentForUpdate = (item: Workload, resource: KubeResource): KubeResource => {
  const normalized = cloneDeploymentResource(resource);
  const metadata = {
    ...(normalized.metadata || {}),
    name: item.name,
    namespace: item.namespace,
  };
  delete (metadata as Record<string, unknown>).managedFields;

  return {
    ...normalized,
    apiVersion: normalized.apiVersion || "apps/v1",
    kind: "Deployment",
    metadata,
    status: undefined,
  };
};

const buildDeploymentUpdateResource = (item: Workload, form: WorkloadUpdateForm): KubeResource => {
  const fallback = buildDeploymentResource({
    ...defaultForm,
    name: item.name,
    namespace: item.namespace,
    replicas: form.replicas,
    image: form.image,
  });
  const resource = normalizeDeploymentForUpdate(item, item.raw || fallback);
  const spec = { ...(resource.spec || {}) } as Record<string, any>;
  const template = { ...(spec.template || {}) } as Record<string, any>;
  const podSpec = { ...(template.spec || {}) } as Record<string, any>;
  const containers = Array.isArray(podSpec.containers) ? [...podSpec.containers] : [];
  const firstContainer = { ...(containers[0] || { name: "main" }) };

  firstContainer.image = form.image.trim();
  containers[0] = firstContainer;
  podSpec.containers = containers;
  template.spec = podSpec;
  spec.template = template;
  spec.replicas = Number(form.replicas) || 1;

  return {
    ...resource,
    spec,
  };
};

const ensureDeploymentUpdateResource = (item: Workload, source: string): KubeResource => {
  const parsed = ensureDeploymentResource(source);
  const parsedMetadata = (parsed.metadata || {}) as Record<string, any>;
  const rawMetadata = (item.raw?.metadata || {}) as Record<string, any>;
  const metadata = {
    ...parsedMetadata,
    resourceVersion: parsedMetadata.resourceVersion || rawMetadata.resourceVersion,
    name: item.name,
    namespace: item.namespace,
  } as KubeResource["metadata"] & Record<string, any>;
  const merged: KubeResource = {
    ...parsed,
    metadata,
  };
  return normalizeDeploymentForUpdate(item, merged);
};

const buildDeploymentMetadataUpdateResource = (item: Workload, labels: KeyValueDraft[], annotations: KeyValueDraft[]): KubeResource => {
  const fallback = buildDeploymentResource({
    ...defaultForm,
    name: item.name,
    namespace: item.namespace,
    replicas: String(item.replicas),
    image: item.image,
  });
  const resource = normalizeDeploymentForUpdate(item, item.raw || fallback);
  return {
    ...resource,
    metadata: {
      ...(resource.metadata || {}),
      name: item.name,
      namespace: item.namespace,
      labels: draftListToRecord(labels),
      annotations: draftListToRecord(annotations),
    },
  };
};

const buildDeploymentResource = (form: WorkloadForm): KubeResource => {
  const name = form.name.trim();
  const namespace = form.namespace.trim() || "default";
  const workloadLabels = {
    ...parseKeyValueText(form.workloadLabels),
    app: name,
  };
  const podLabels = {
    ...parseKeyValueText(form.podLabels),
    ...workloadLabels,
  };
  const container: Record<string, any> = {
    name: form.containerName.trim() || "main",
    image: form.image.trim(),
    imagePullPolicy: form.pullPolicy,
  };
  const port = Number(form.port);
  if (Number.isFinite(port) && port > 0) {
    container.ports = [{ containerPort: port }];
  }
  const envKey = form.envKey.trim();
  if (envKey) {
    container.env = [{ name: envKey, value: form.envValue }];
  }
  const resources: Record<string, any> = {};
  if (form.cpuRequest || form.memoryRequest) {
    resources.requests = {
      ...(form.cpuRequest ? { cpu: form.cpuRequest } : {}),
      ...(form.memoryRequest ? { memory: form.memoryRequest } : {}),
    };
  }
  if (form.cpuLimit || form.memoryLimit) {
    resources.limits = {
      ...(form.cpuLimit ? { cpu: form.cpuLimit } : {}),
      ...(form.memoryLimit ? { memory: form.memoryLimit } : {}),
    };
  }
  if (Object.keys(resources).length) container.resources = resources;
  if (form.privileged || form.runAsUser || form.runAsGroup || form.readOnlyRootFilesystem || form.allowPrivilegeEscalation) {
    container.securityContext = {
      ...(form.privileged ? { privileged: true } : {}),
      ...(form.runAsUser ? { runAsUser: Number(form.runAsUser) } : {}),
      ...(form.runAsGroup ? { runAsGroup: Number(form.runAsGroup) } : {}),
      ...(form.readOnlyRootFilesystem ? { readOnlyRootFilesystem: true } : {}),
      allowPrivilegeEscalation: form.allowPrivilegeEscalation,
    };
  }
  const podSpec: Record<string, any> = { containers: [container] };
  if (form.networkType === "hostNetwork") {
    podSpec.hostNetwork = true;
    podSpec.dnsPolicy = "ClusterFirstWithHostNet";
  }
  if (form.schedulingMode === "all") {
    podSpec.nodeSelector = { "blueedge.io/node-role": "edge" };
  }
  if (form.schedulingMode === "nodeSelector") {
    const nodeSelector = { ...draftListToRecord(form.nodeSelectors), "blueedge.io/node-role": "edge" };
    if (Object.keys(nodeSelector).length > 0) podSpec.nodeSelector = nodeSelector;
  }
  if (form.schedulingMode === "nodeName" && form.nodeSelectorValue.trim()) {
    podSpec.nodeName = form.nodeSelectorValue.trim();
  }
  if (form.schedulingMode === "podAntiAffinity") {
    podSpec.nodeSelector = { "blueedge.io/node-role": "edge" };
    podSpec.affinity = {
      podAntiAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [{
          weight: 100,
          podAffinityTerm: {
            topologyKey: "kubernetes.io/hostname",
            labelSelector: { matchLabels: workloadLabels },
          },
        }],
      },
    };
  }

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace,
      labels: workloadLabels,
      annotations: {
        ...parseKeyValueText(form.workloadAnnotations),
        ...(form.alias.trim() ? { "blueedge.io/alias": form.alias.trim() } : {}),
        ...(form.description.trim() ? { "blueedge.io/description": form.description.trim() } : {}),
      },
    },
    spec: {
      replicas: Number(form.replicas) || 1,
      selector: { matchLabels: workloadLabels },
      strategy: {
        type: form.strategy,
        ...(form.strategy === "RollingUpdate" ? {
          rollingUpdate: {
            maxSurge: form.maxSurge || "25%",
            maxUnavailable: form.maxUnavailable || "25%",
          },
        } : {}),
      },
      progressDeadlineSeconds: Number(form.timeoutSeconds) || 600,
      template: {
        metadata: { labels: podLabels },
        spec: podSpec,
      },
    },
  };
};

const workloadWizardValues = (item: Workload): { form: WorkloadForm; containers: ContainerDraft[] } => {
  const raw = item.raw || {};
  const metadata = asRecord(raw.metadata);
  const annotations = asStringRecord(metadata.annotations);
  const spec = asRecord(raw.spec);
  const strategy = asRecord(spec.strategy);
  const rollingUpdate = asRecord(strategy.rollingUpdate);
  const template = asRecord(spec.template);
  const templateMetadata = asRecord(template.metadata);
  const podSpec = asRecord(template.spec);
  const nodeSelector = asStringRecord(podSpec.nodeSelector);
  const rawContainers = asRecordArray(podSpec.containers);
  const firstPort = asRecord(asRecordArray(rawContainers[0]?.ports)[0]);
  const schedulingMode: WorkloadForm["schedulingMode"] = typeof podSpec.nodeName === "string" && podSpec.nodeName
    ? "nodeName"
    : Object.keys(asRecord(podSpec.affinity)).length > 0
      ? "podAntiAffinity"
      : Object.keys(nodeSelector).length > 0
        ? "nodeSelector"
        : "all";
  const labelsToText = (value: unknown) => Object.entries(asStringRecord(value)).map(([key, val]) => `${key}=${val}`).join("\n");
  const containers = rawContainers.length > 0 ? rawContainers.map((rawContainer, index) => {
    const resources = asRecord(rawContainer.resources);
    const requests = asRecord(resources.requests);
    const limits = asRecord(resources.limits);
    const securityContext = asRecord(rawContainer.securityContext);
    const envs = asRecordArray(rawContainer.env).map((entry, envIndex) => ({
      id: `env-edit-${index}-${envIndex}`,
      key: configuredValue(entry.name) === "未配置" ? "" : configuredValue(entry.name),
      value: configuredValue(entry.value) === "未配置" ? "" : configuredValue(entry.value),
    }));
    return {
      ...createContainerDraft(index),
      id: `container-edit-${index}`,
      name: configuredValue(rawContainer.name) === "未配置" ? "" : configuredValue(rawContainer.name),
      image: configuredValue(rawContainer.image) === "未配置" ? "" : configuredValue(rawContainer.image),
      pullPolicy: (["Always", "Never", "IfNotPresent"].includes(String(rawContainer.imagePullPolicy)) ? rawContainer.imagePullPolicy : "IfNotPresent") as WorkloadForm["pullPolicy"],
      cpuRequest: configuredValue(requests.cpu) === "未配置" ? "" : configuredValue(requests.cpu),
      cpuLimit: configuredValue(limits.cpu) === "未配置" ? "" : configuredValue(limits.cpu),
      memoryRequest: configuredValue(requests.memory) === "未配置" ? "" : configuredValue(requests.memory),
      memoryLimit: configuredValue(limits.memory) === "未配置" ? "" : configuredValue(limits.memory),
      privileged: securityContext.privileged === true,
      startupProbe: Boolean(rawContainer.startupProbe),
      readinessProbe: Boolean(rawContainer.readinessProbe),
      livenessProbe: Boolean(rawContainer.livenessProbe),
      envs: envs.length ? envs : [{ id: `env-edit-${index}-0`, key: "", value: "" }],
      runAsUser: typeof securityContext.runAsUser === "number" ? String(securityContext.runAsUser) : "",
      runAsGroup: typeof securityContext.runAsGroup === "number" ? String(securityContext.runAsGroup) : "",
      readOnlyRootFilesystem: securityContext.readOnlyRootFilesystem === true,
      allowPrivilegeEscalation: securityContext.allowPrivilegeEscalation === true,
    };
  }) : [{ ...createContainerDraft(0), name: "main", image: item.image }];

  return {
    form: {
      ...defaultForm,
      name: item.name,
      alias: annotations["blueedge.io/alias"] || item.alias || "",
      namespace: item.namespace,
      replicas: String(spec.replicas ?? item.replicas),
      description: annotations["blueedge.io/description"] || item.description || "",
      containerName: containers[0].name,
      image: containers[0].image,
      pullPolicy: containers[0].pullPolicy,
      cpuRequest: containers[0].cpuRequest,
      cpuLimit: containers[0].cpuLimit,
      memoryRequest: containers[0].memoryRequest,
      memoryLimit: containers[0].memoryLimit,
      privileged: containers[0].privileged,
      port: firstPort.containerPort ? String(firstPort.containerPort) : "",
      schedulingMode,
      nodeSelectors: Object.entries(nodeSelector).map(([key, value], index) => ({ id: `node-selector-edit-${index}`, key, value })),
      nodeSelectorValue: typeof podSpec.nodeName === "string" ? podSpec.nodeName : "",
      workloadLabels: labelsToText(metadata.labels),
      workloadAnnotations: Object.entries(asStringRecord(metadata.annotations))
        .filter(([key]) => key !== "blueedge.io/alias" && key !== "blueedge.io/description")
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
      podLabels: labelsToText(templateMetadata.labels),
      networkType: podSpec.hostNetwork === true ? "hostNetwork" : firstPort.containerPort ? "portMapping" : "none",
      strategy: strategy.type === "Recreate" ? "Recreate" : "RollingUpdate",
      maxSurge: configuredValue(rollingUpdate.maxSurge) === "未配置" ? "25%" : configuredValue(rollingUpdate.maxSurge),
      maxUnavailable: configuredValue(rollingUpdate.maxUnavailable) === "未配置" ? "25%" : configuredValue(rollingUpdate.maxUnavailable),
      timeoutSeconds: spec.progressDeadlineSeconds ? String(spec.progressDeadlineSeconds) : "600",
    },
    containers,
  };
};

export function Deployments() {
  const { selectedNamespace } = useNamespace();
  const { selectedEdgeUnitName } = useEdgeUnits();
  const [items, setItems] = useState<Workload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [yamlOpen, setYamlOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardEditTarget, setWizardEditTarget] = useState<Workload | null>(null);
  const [wizardLocation, setWizardLocation] = useState<WorkloadWizardLocation>({ step: 0 });
  const [deleteTarget, setDeleteTarget] = useState<Workload | null>(null);
  const [selectedWorkload, setSelectedWorkload] = useState<Workload | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionPanel, setActionPanel] = useState<WorkloadActionPanel | null>(null);
  const loadRequestId = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) {
        setItems([]);
        return;
      }
      const [allRows, scope] = await Promise.all([
        listDeployments(selectedNamespace === "all" ? undefined : selectedNamespace),
        getEdgeUnitResources(selectedEdgeUnitName),
      ]);
      const allowed = new Set(scope.item.deployments.map((item) => `${item.namespace}/${item.name}`));
      const rows = allRows.filter((item) => allowed.has(`${item.namespace}/${item.name}`));
      if (requestId !== loadRequestId.current) return;
      setItems(rows.map(toWorkload));
      void Promise.allSettled(rows.map((row) => getDeployment(row.namespace, row.name))).then((detailResults) => {
        if (requestId !== loadRequestId.current) return;
        setItems(rows.map((row, index) => {
          const detailResult = detailResults[index];
          return toWorkload(detailResult.status === "fulfilled" ? detailResult.value : row);
        }));
      });
    } catch (err) {
      if (requestId !== loadRequestId.current) return;
      setError(err instanceof Error ? err.message : "加载工作负载失败");
      setItems([]);
    } finally {
      if (requestId === loadRequestId.current) setIsLoading(false);
    }
  }, [selectedEdgeUnitName, selectedNamespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => [item.name, item.alias, item.namespace, item.image].some((value) => value.toLowerCase().includes(keyword)));
  }, [items, search]);
  const { paginatedItems, paginationProps } = useListPagination(filtered);

  const createFromForm = async (form: WorkloadForm) => {
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await createEdgeUnitDeploymentResource(selectedEdgeUnitName, buildDeploymentResource(form));
      setWizardOpen(false);
      await loadData();
      showToast("工作负载创建成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作负载失败");
    } finally {
      setIsLoading(false);
    }
  };

  const openWizardEditor = (item: Workload, tab: WorkloadDetailTab) => {
    if (tab === "yaml") {
      handleMenuAction("yaml", item);
      return;
    }
    setWizardEditTarget(item);
    setWizardLocation(wizardLocationForDetailTab(tab) || { step: 0 });
    setWizardOpen(true);
  };

  const updateFromWizard = async (item: Workload, form: WorkloadForm) => {
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      const generated = buildDeploymentResource({ ...form, name: item.name, namespace: item.namespace });
      const currentMetadata = (item.raw?.metadata || {}) as Record<string, unknown>;
      const currentSpec = asRecord(item.raw?.spec);
      const currentTemplate = asRecord(currentSpec.template);
      const currentTemplateMetadata = asRecord(currentTemplate.metadata);
      const currentPodSpec = { ...asRecord(currentTemplate.spec) };
      delete currentPodSpec.nodeName;
      delete currentPodSpec.nodeSelector;
      delete currentPodSpec.affinity;
      delete currentPodSpec.hostNetwork;
      delete currentPodSpec.dnsPolicy;
      const generatedSpec = asRecord(generated.spec);
      const generatedTemplate = asRecord(generatedSpec.template);
      const generatedTemplateMetadata = asRecord(generatedTemplate.metadata);
      const generatedPodSpec = asRecord(generatedTemplate.spec);
      const resource = normalizeDeploymentForUpdate(item, {
        ...generated,
        metadata: {
          ...currentMetadata,
          ...(generated.metadata || {}),
          ...(currentMetadata.resourceVersion ? { resourceVersion: currentMetadata.resourceVersion } : {}),
        } as KubeResource["metadata"],
        spec: {
          ...currentSpec,
          ...generatedSpec,
          template: {
            ...currentTemplate,
            ...generatedTemplate,
            metadata: {
              ...currentTemplateMetadata,
              ...generatedTemplateMetadata,
              annotations: currentTemplateMetadata.annotations,
            },
            spec: { ...currentPodSpec, ...generatedPodSpec },
          },
        },
      });
      await updateEdgeUnitDeploymentResource(selectedEdgeUnitName, item.namespace, item.name, resource);
      setWizardOpen(false);
      setWizardEditTarget(null);
      setSelectedWorkload((current) => current?.id === item.id ? { ...current, raw: resource } : current);
      await loadData();
      showToast("工作负载更新成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "更新工作负载失败";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const createFromYaml = async (source: string) => {
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await createEdgeUnitDeploymentResource(selectedEdgeUnitName, ensureDeploymentResource(source));
      setYamlOpen(false);
      await loadData();
      showToast("工作负载创建成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "YAML 创建工作负载失败");
    } finally {
      setIsLoading(false);
    }
  };

  const updateFromForm = async (item: Workload, form: WorkloadUpdateForm) => {
    setIsLoading(true);
    setError("");
    try {
      const resource = buildDeploymentUpdateResource(item, form);
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await updateEdgeUnitDeploymentResource(selectedEdgeUnitName, item.namespace, item.name, resource);
      setActionPanel(null);
      setSelectedWorkload((current) => current?.id === item.id ? {
        ...current,
        image: form.image.trim(),
        replicas: Number(form.replicas) || 1,
        raw: resource,
      } : current);
      await loadData();
      showToast("工作负载更新成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "更新工作负载失败";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateFromYaml = async (item: Workload, source: string) => {
    setIsLoading(true);
    setError("");
    try {
      const resource = ensureDeploymentUpdateResource(item, source);
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await updateEdgeUnitDeploymentResource(selectedEdgeUnitName, item.namespace, item.name, resource);
      setActionPanel(null);
      const container = getFirstContainer(resource);
      setSelectedWorkload((current) => current?.id === item.id ? {
        ...current,
        image: typeof container.image === "string" ? container.image : current.image,
        replicas: Number(resource.spec?.replicas) || current.replicas,
        raw: resource,
      } : current);
      await loadData();
      showToast("工作负载 YAML 更新成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "YAML 更新工作负载失败";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateFromMetadata = async (item: Workload, labels: KeyValueDraft[], annotations: KeyValueDraft[]) => {
    setIsLoading(true);
    setError("");
    try {
      const resource = buildDeploymentMetadataUpdateResource(item, labels, annotations);
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await updateEdgeUnitDeploymentResource(selectedEdgeUnitName, item.namespace, item.name, resource);
      setActionPanel(null);
      setSelectedWorkload((current) => current?.id === item.id ? { ...current, raw: resource } : current);
      await loadData();
      showToast("工作负载标签与注解更新成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "更新工作负载标签与注解失败";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeploymentResource(deleteTarget.namespace, deleteTarget.name);
      setSelectedWorkload((current) => (current?.id === deleteTarget.id ? null : current));
      setDeleteTarget(null);
      await loadData();
      showToast("工作负载删除成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工作负载失败");
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 1800);
  };

  const handleMenuAction = (action: WorkloadMenuAction, item: Workload) => {
    setMenuOpenId(null);
    if (action === "update") {
      setActionPanel({ type: action, item });
      return;
    }
    setActionPanel({ type: action, item });
  };

  const reloadWorkload = useCallback(async (item: Workload) => {
    const detail = toWorkload(await getDeployment(item.namespace, item.name));
    setSelectedWorkload((current) => current?.id === item.id ? detail : current);
    await loadData();
  }, [loadData]);

  if (selectedWorkload) {
    return (
      <>
        <WorkloadDetailPage
          item={selectedWorkload}
          onBack={() => setSelectedWorkload(null)}
          onAction={(action) => handleMenuAction(action, selectedWorkload)}
          onEdit={(tab) => openWizardEditor(selectedWorkload, tab)}
          onDelete={() => setDeleteTarget(selectedWorkload)}
          onReload={() => reloadWorkload(selectedWorkload)}
        />
        <CreateWorkloadWizard
          open={wizardOpen}
          onOpenChange={(open) => { setWizardOpen(open); if (!open) setWizardEditTarget(null); }}
          onCreate={createFromForm}
          editItem={wizardEditTarget}
          initialLocation={wizardLocation}
          onUpdate={updateFromWizard}
        />
        <WorkloadActionModal
          panel={actionPanel}
          onClose={() => setActionPanel(null)}
          onUpdate={updateFromForm}
          onYamlUpdate={updateFromYaml}
          onMetadataUpdate={updateFromMetadata}
          onReload={reloadWorkload}
        />
        <WorkloadDeleteDialog target={deleteTarget} loading={isLoading} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
        <ToastNotice message={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  return (
    <div className="page-container space-y-5">
      <ToastNotice message={toast} onClose={() => setToast(null)} />

      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">工作负载</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">管理边缘应用部署</p>
      </section>

      <section className="page-toolbar">
        <div className="toolbar-search relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入工作负载名称搜索"
            className="h-9 rounded-[10px] pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setYamlOpen(true)} className="btn-secondary flex shrink-0 items-center gap-1.5 text-xs">
            YAML 创建
          </button>
          <button type="button" onClick={() => setWizardOpen(true)} className="btn-black flex shrink-0 items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            镜像创建
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">
          {error}
        </div>
      )}

      <section className="table-card overflow-x-auto">
        <Table className="min-w-[1000px] table-fixed border-collapse">
          <TableHeader>
            <TableRow className="table-header-row bg-white hover:bg-white">
              <TableHead className="table-header-cell table-header-name table-name-workload w-[160px]">工作负载名称</TableHead>
              <TableHead className="table-header-cell w-[140px]">工作负载别名</TableHead>
              <TableHead className="table-header-cell w-[90px]">状态</TableHead>
              <TableHead className="table-header-cell w-[90px]">命名空间</TableHead>
              <TableHead className="table-header-cell w-[80px]">容器组</TableHead>
              <TableHead className="table-header-cell w-[180px]">镜像</TableHead>
              <TableHead className="table-header-cell w-[140px]">创建时间</TableHead>
              <TableHead className="table-header-cell table-header-action table-action-wide w-[160px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex flex-col items-center justify-center py-14 text-[var(--color-text-tertiary)]">
                    <RefreshCw className="mb-2 h-8 w-8 animate-spin" />
                    <span className="text-sm">加载中...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="flex flex-col items-center justify-center py-14 text-[var(--color-text-tertiary)]">
                    <RotateCcw className="mb-2 h-8 w-8" />
                    <span className="text-sm">暂无数据</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((item) => (
                <TableRow key={item.id} className="table-row group cursor-pointer" onClick={() => setSelectedWorkload(item)}>
                  <TableCell className="table-name-cell table-name-workload">
                    <span className="text-sm font-medium text-[#1e6bff]">{item.name}</span>
                  </TableCell>
                  <TableCell className="table-cell text-xs text-[var(--color-text-secondary)]">{item.alias || "-"}</TableCell>
                  <TableCell className="table-cell overflow-visible"><StatusPill status={item.status} /></TableCell>
                  <TableCell className="table-cell text-xs text-[#111827]">{item.namespace}</TableCell>
                  <TableCell className="table-cell"><PodCount ready={item.readyReplicas} total={item.replicas} /></TableCell>
                  <TableCell className="table-cell"><ImageChip image={item.image} /></TableCell>
                  <TableCell className="table-cell text-xs text-[var(--color-text-tertiary)]">{item.createTime}</TableCell>
                  <TableCell className="table-action-cell table-action-wide" onClick={(event) => event.stopPropagation()}>
                    <WorkloadRowActions
                      open={menuOpenId === item.id}
                      onOpenChange={(open) => setMenuOpenId(open ? item.id : null)}
                      onView={() => setSelectedWorkload(item)}
                      onStatus={() => handleMenuAction("status", item)}
                      onDelete={() => setDeleteTarget(item)}
                      onAction={(action) => handleMenuAction(action, item)}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <ListPagination {...paginationProps} />
      </section>

      <YamlCreateModal open={yamlOpen} defaultValue={defaultYaml} onSubmit={createFromYaml} onCancel={() => setYamlOpen(false)} />
      <CreateWorkloadWizard
        open={wizardOpen}
        onOpenChange={(open) => { setWizardOpen(open); if (!open) setWizardEditTarget(null); }}
        onCreate={createFromForm}
        editItem={wizardEditTarget}
        initialLocation={wizardLocation}
        onUpdate={updateFromWizard}
      />
      <WorkloadActionModal
        panel={actionPanel}
        onClose={() => setActionPanel(null)}
        onUpdate={updateFromForm}
        onYamlUpdate={updateFromYaml}
        onMetadataUpdate={updateFromMetadata}
        onReload={reloadWorkload}
      />

      <WorkloadDeleteDialog target={deleteTarget} loading={isLoading} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
    </div>
  );
}

function WorkloadDeleteDialog({ target, loading, onCancel, onConfirm }: { target: Workload | null; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [confirmName, setConfirmName] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setConfirmName("");
    setCopied(false);
  }, [target]);
  const copyName = async () => {
    if (!target) return;
    const copySucceeded = await copyToClipboard(target.name);
    if (!copySucceeded) {
      setCopied(false);
      return;
    }
    setCopied(true);
  };
  const confirmed = Boolean(target && confirmName === target.name);
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-[480px] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        <AlertDialogHeader className="flex h-[61px] flex-row items-center justify-between border-b border-[#f0f1f3] px-6 text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff4d4f]/10"><AlertTriangle className="h-4 w-4 text-[#ff4d4f]" /></span>
            <AlertDialogTitle className="text-sm">确认删除「{target?.name}」吗？</AlertDialogTitle>
          </div>
          <AlertDialogCancel className="action-button m-0 h-8 w-8 rounded-[10px] border-[#e8ecf3] p-0"><X className="h-4 w-4" /></AlertDialogCancel>
        </AlertDialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2 rounded-lg border border-[#ffd591] bg-[#fff7e6] p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fa8c16]" />
            <p className="text-xs leading-5 text-[#ad6800]">此操作不可恢复。删除后相关资源将被永久移除。</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#111827]">请输入 <strong className="text-[#ff4d4f]">{target?.name}</strong> 以确认删除</label>
              <button type="button" onClick={() => void copyName()} className="flex items-center gap-1 text-xs text-[#1a73e8]">
                {copied ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Copy className="h-3 w-3" />}
                {copied ? "已复制" : "复制名称"}
              </button>
            </div>
            <Input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={target?.name} className="h-10 rounded-[10px]" />
          </div>
        </div>
        <AlertDialogFooter className="h-[69px] border-t border-[#f0f1f3] px-6 py-4">
          <AlertDialogCancel className="btn-secondary m-0">取消</AlertDialogCancel>
          <AlertDialogAction className="h-9 rounded-[10px] px-5 text-sm" disabled={!confirmed || loading} onClick={onConfirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StatusPill({ status }: { status: WorkloadStatus }) {
  const style = statusConfig[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", style.className)}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {status}
    </span>
  );
}

function WorkloadStatusOverview({ status }: { status: WorkloadStatus }) {
  const items = [
    { label: "运行中", active: status === "运行中", color: "#16a34a", bg: "#dcfce7" },
    { label: "等待中", active: status === "等待中", color: "#f59e0b", bg: "#fff5e5" },
    { label: "未就绪", active: status === "未就绪", color: "#ef4444", bg: "#fdecec" },
  ];
  return (
    <div className="flex items-center gap-2">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
          style={{
            color: item.active ? item.color : "#94a3b8",
            background: item.active ? item.bg : "#f8fafc",
            borderColor: item.active ? item.bg : "#e5e7eb",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.active ? item.color : "#cbd5e1" }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function PodCount({ ready, total }: { ready: number; total: number }) {
  return (
    <span className="text-sm font-semibold">
      <span className={ready === total ? "text-[#22c55e]" : "text-[#f59e0b]"}>{ready}</span>
      <span className="text-[var(--color-text-tertiary)]"> / {total}</span>
    </span>
  );
}

function ImageChip({ image }: { image: string }) {
  return <span className="inline-block max-w-[220px] truncate rounded-lg bg-[var(--color-bg-soft)] px-2.5 py-1 font-mono text-sm text-[#111827]">{image}</span>;
}

function ToastNotice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed right-6 top-6 z-[80] flex h-12 items-center gap-3 rounded-2xl border border-[#eef2f7] bg-white px-5 text-sm font-semibold text-[#334155] shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
      <CheckCircle2 className="h-5 w-5 text-[#22c55e]" />
      <span>{message}</span>
      <button type="button" onClick={onClose} className="ml-1 text-[#94a3b8] hover:text-[#475569]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function WorkloadRowActions({
  open,
  onOpenChange,
  onView,
  onStatus,
  onDelete,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onAction: (action: WorkloadMenuAction) => void;
}) {
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const toggleMenu = () => {
    if (!open && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      const menuWidth = 148;
      const menuHeight = 392;
      const viewportPadding = 12;
      const gap = 8;
      const canOpenDown = rect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding;
      setMenuPosition({
        top: canOpenDown
          ? rect.bottom + gap
          : Math.max(viewportPadding, rect.top - gap - menuHeight),
        left: Math.max(16, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 16)),
      });
    }
    onOpenChange(!open);
  };

  const runAction = (action: WorkloadMenuAction) => {
    onOpenChange(false);
    onAction(action);
  };

  return (
    <div className="relative inline-flex justify-end">
      <div className="action-group">
        <button type="button" className="action-button" title="查看" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="action-button" title="工作负载状态" onClick={onStatus}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button ref={moreButtonRef} type="button" className="action-button" title="更多" onClick={toggleMenu}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && createPortal(
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-[70] cursor-default" onClick={() => onOpenChange(false)} />
          <div
            className="fixed z-[90] overflow-hidden rounded-2xl border border-[#eef2f7] bg-white py-1.5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
            style={{ top: menuPosition.top, left: menuPosition.left, width: 148 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-0.5 px-1.5">
              <WorkloadMenuItem icon={<Terminal className="h-3.5 w-3.5" />} label="控制台" onClick={() => runAction("console")} />
              <WorkloadMenuItem icon={<Activity className="h-3.5 w-3.5" />} label="监控" onClick={() => runAction("monitor")} />
              <WorkloadMenuItem icon={<FileText className="h-3.5 w-3.5" />} label="日志" onClick={() => runAction("logs")} />
            </div>
            <div className="my-1.5 h-px bg-[#eef2f7]" />
            <div className="space-y-0.5 px-1.5">
              <WorkloadMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="编辑 YAML" onClick={() => runAction("yaml")} />
              <WorkloadMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="更新" onClick={() => runAction("update")} />
              <WorkloadMenuItem icon={<RotateCcw className="h-3.5 w-3.5" />} label="回退" onClick={() => runAction("rollback")} />
            </div>
            <div className="my-1.5 h-px bg-[#eef2f7]" />
            <div className="space-y-0.5 px-1.5">
              <WorkloadMenuItem icon={<Play className="h-3.5 w-3.5" />} label="状态" suffix="›" onClick={() => runAction("status")} />
              <WorkloadMenuItem icon={<Tag className="h-3.5 w-3.5" />} label="标签与注解" onClick={() => runAction("labels")} />
            </div>
            <div className="my-1.5 h-px bg-[#eef2f7]" />
            <div className="px-1.5">
              <WorkloadMenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除" danger onClick={() => { onOpenChange(false); onDelete(); }} />
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function WorkloadMenuItem({
  icon,
  label,
  suffix,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  suffix?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "当前版本暂未开放" : undefined}
      className={cn(
        "flex h-8 w-full items-center rounded-lg px-2 text-xs font-medium hover:bg-[#f8fafc]",
        danger ? "text-[#64748b]" : "text-[#334155]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="mr-2 flex w-4 shrink-0 items-center justify-center text-[#94a3b8]">{icon}</span>
      <span className="shrink-0">{label}</span>
      {suffix && <span className="ml-auto text-[#94a3b8]">{suffix}</span>}
    </button>
  );
}

function WorkloadDetailPage({
  item,
  onBack,
  onAction,
  onEdit,
  onDelete,
  onReload,
}: {
  item: Workload;
  onBack: () => void;
  onAction: (action: WorkloadMenuAction) => void;
  onEdit: (tab: WorkloadDetailTab) => void;
  onDelete: () => void;
  onReload: () => Promise<void>;
}) {
  const detailTabs: { id: string; label: string; icon: ReactNode; disabled?: boolean }[] = [
    { id: "pods", label: "容器组", icon: <Server className="h-4 w-4" /> },
    { id: "containers", label: "容器配置", icon: <Box className="h-4 w-4" /> },
    { id: "scheduling", label: "节点调度", icon: <FileText className="h-4 w-4" /> },
    { id: "labels", label: "标签与注解", icon: <Tag className="h-4 w-4" /> },
    { id: "access", label: "访问配置", icon: <Settings className="h-4 w-4" /> },
    { id: "versions", label: "版本记录", icon: <FileText className="h-4 w-4" /> },
    { id: "events", label: "事件列表", icon: <RefreshCw className="h-4 w-4" /> },
    { id: "audit", label: "审计", icon: <FileText className="h-4 w-4" /> },
    { id: "yaml", label: "YAML", icon: <FileText className="h-4 w-4" /> },
  ];
  const [activeTab, setActiveTab] = useState<WorkloadDetailTab>("pods");
  const [moreOpen, setMoreOpen] = useState(false);
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [observabilityWarning, setObservabilityWarning] = useState("");
  const [eventsLoading, setEventsLoading] = useState(false);
  const [pods, setPods] = useState<DeploymentPodRow[]>([]);
  const [podSearch, setPodSearch] = useState("");
  const [podsLoading, setPodsLoading] = useState(false);
  const [podsError, setPodsError] = useState("");
  const [podNotice, setPodNotice] = useState<string | null>(null);
  const [visiblePodColumns, setVisiblePodColumns] = useState<Set<PodColumnKey>>(() => new Set(podColumns.map((column) => column.key)));
  const [podYaml, setPodYaml] = useState<DeploymentPodRow | null>(null);
  const [podLogs, setPodLogs] = useState<DeploymentPodRow | null>(null);
  const [podMonitor, setPodMonitor] = useState<DeploymentPodRow | null>(null);
  const podsRequestId = useRef(0);
  const eventsRequestId = useRef(0);
  const yaml = buildWorkloadYaml(item);
  const strategy = configuredValue(asRecord(item.raw?.spec).strategy && asRecord(asRecord(item.raw?.spec).strategy).type);
  const visiblePods = useMemo(() => {
    const keyword = podSearch.trim().toLowerCase();
    return keyword ? pods.filter((pod) => pod.name.toLowerCase().includes(keyword)) : pods;
  }, [podSearch, pods]);

  const loadEvents = useCallback(async () => {
    const requestId = ++eventsRequestId.current;
    setEventsLoading(true);
    setObservabilityWarning("");
    try {
      const result = await getResourceObservability("deployment", item.namespace, item.name, { includeMetrics: false, includeEvents: true });
      if (requestId !== eventsRequestId.current) return;
      setEvents(result.item.events.items);
      setObservabilityWarning((result.warnings || []).map((warning) => warning.message).join("；"));
    } catch (err) {
      if (requestId === eventsRequestId.current) setObservabilityWarning(err instanceof Error ? err.message : "加载事件失败");
    } finally {
      if (requestId === eventsRequestId.current) setEventsLoading(false);
    }
  }, [item.name, item.namespace]);

  const loadDeploymentPods = useCallback(async (showNotice = false) => {
    const requestId = ++podsRequestId.current;
    const refreshStartedAt = performance.now();
    setPodsLoading(true);
    setPodsError("");
    try {
      const result = await listPods(item.namespace, showNotice);
      if (showNotice) {
        const remainingAnimationTime = Math.max(0, 1000 - (performance.now() - refreshStartedAt));
        await new Promise((resolve) => window.setTimeout(resolve, remainingAnimationTime));
      }
      if (requestId === podsRequestId.current) {
        setPods(deploymentPodRows(result, item));
        if (showNotice) {
          setPodNotice("容器组列表已刷新");
          window.setTimeout(() => setPodNotice(null), 1800);
        }
      }
    } catch (err) {
      if (requestId === podsRequestId.current) setPodsError(err instanceof Error ? err.message : "加载关联 Pod 失败");
    } finally {
      if (requestId === podsRequestId.current) setPodsLoading(false);
    }
  }, [item]);

  const togglePodColumn = (key: PodColumnKey, checked: boolean) => {
    setVisiblePodColumns((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const deletePod = async (pod: DeploymentPodRow) => {
    if (!window.confirm(`确认删除容器组「${pod.name}」吗？由工作负载管理的容器组可能会自动重建。`)) return;
    try {
      await deletePodResource(item.namespace, pod.name);
      await loadDeploymentPods();
      setPodNotice("容器组删除成功");
      window.setTimeout(() => setPodNotice(null), 1800);
    } catch (err) {
      setPodsError(err instanceof Error ? err.message : "删除容器组失败");
    }
  };

  useEffect(() => {
    if (activeTab === "events") void loadEvents();
    if (activeTab === "pods") void loadDeploymentPods();
  }, [activeTab, loadDeploymentPods, loadEvents]);

  useEffect(() => () => {
    podsRequestId.current += 1;
    eventsRequestId.current += 1;
  }, []);

  const runMoreAction = (action: WorkloadMenuAction) => {
    setMoreOpen(false);
    onAction(action);
  };

  return (
    <div className="page-container space-y-5">
      <section className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} className="action-button mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-[#111827]">{item.name}</h1>
              <StatusPill status={item.status} />
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.namespace} · {item.image}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onAction("yaml")} className="btn-secondary flex items-center gap-1.5 text-xs">
            <FileText className="h-[13px] w-[13px]" />编辑YAML
          </button>
          <button type="button" onClick={() => onEdit(activeTab)} className="btn-black flex items-center gap-1.5 text-xs">
            <Pencil className="h-[13px] w-[13px]" />编辑
          </button>
          <button type="button" onClick={() => onAction("console")} className="btn-secondary flex items-center gap-1.5 text-xs"><Terminal className="h-[13px] w-[13px]" />控制台</button>
          <button type="button" onClick={() => onAction("monitor")} className="btn-secondary flex items-center gap-1.5 text-xs"><Activity className="h-[13px] w-[13px]" />监控</button>
          <button type="button" onClick={() => onAction("logs")} className="btn-secondary flex items-center gap-1.5 text-xs"><FileText className="h-[13px] w-[13px]" />日志</button>
          <div className="relative">
            <button type="button" onClick={() => setMoreOpen((current) => !current)} className="action-button h-10 w-10"><MoreHorizontal className="h-4 w-4" /></button>
            {moreOpen && (
              <>
                <button type="button" aria-label="关闭更多菜单" className="fixed inset-0 z-[40] cursor-default" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-12 z-[60] w-[148px] overflow-hidden rounded-2xl border border-[#eef2f7] bg-white py-1.5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
                  <div className="space-y-0.5 px-1.5">
                    <WorkloadMenuItem icon={<RotateCcw className="h-3.5 w-3.5" />} label="回退" onClick={() => runMoreAction("rollback")} />
                    <WorkloadMenuItem icon={<Play className="h-3.5 w-3.5" />} label="状态" suffix="›" onClick={() => runMoreAction("status")} />
                    <WorkloadMenuItem icon={<Tag className="h-3.5 w-3.5" />} label="标签与注解" onClick={() => runMoreAction("labels")} />
                  </div>
                  <div className="my-1.5 h-px bg-[#eef2f7]" />
                  <div className="px-1.5">
                    <WorkloadMenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除" danger onClick={() => { setMoreOpen(false); onDelete(); }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#eef2f7] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="mb-6 text-sm font-semibold text-[#111827]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-10 gap-y-6">
          <DetailInfoItem label="工作负载名称" value={item.name} />
          <DetailInfoItem label="工作负载别名" value={item.alias} />
          <DetailInfoItem label="命名空间" value={<span className="rounded-lg bg-[#f3f4f6] px-2.5 py-1 text-sm font-semibold text-[#334155]">{item.namespace}</span>} />
          <DetailInfoItem label="描述" value={item.description} />
        </div>
        <div className="my-6 h-px bg-[#eef2f7]" />
        <div className="grid grid-cols-4 gap-x-10 gap-y-6">
          <DetailInfoItem
            label="状态"
            value={(
              <div className="flex flex-wrap gap-2">
                <WorkloadStatusOverview status={item.status} />
              </div>
            )}
          />
          <DetailInfoItem label="升级策略" value={<span className="rounded-lg bg-[#f3f4f6] px-2.5 py-1 font-mono text-sm font-semibold text-[#334155]">{strategy}</span>} />
          <DetailInfoItem label="正常实例数/全部实例数" value={`${item.readyReplicas}/${item.replicas}`} />
          <DetailInfoItem label="创建时间" value={item.createTime} />
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => !tab.disabled && setActiveTab(tab.id as WorkloadDetailTab)}
            disabled={tab.disabled}
            title={tab.disabled ? "当前版本暂未开放" : undefined}
            className={cn(activeTab === tab.id ? "btn-tab-active" : "btn-tab", tab.disabled && "cursor-not-allowed opacity-50 hover:bg-white")}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "pods" && (
        <section className="rounded-2xl border border-[#eef2f7] bg-white px-7 py-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <ToastNotice message={podNotice} onClose={() => setPodNotice(null)} />
          <div className="mb-3 flex items-center justify-between">
            <div className="relative w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <Input value={podSearch} onChange={(event) => setPodSearch(event.target.value)} placeholder="搜索容器组名称" className="h-9 rounded-[10px] pl-9 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="action-button" title="列设置"><Settings className="h-3.5 w-3.5" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" sideOffset={8} avoidCollisions={false} className="z-[90] w-[230px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-2xl border-[#eef2f7] bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                  <DropdownMenuLabel className="px-3 py-2 text-sm font-semibold">列设置</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {podColumns.map((column) => {
                    const checked = visiblePodColumns.has(column.key);
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.key}
                        checked={checked}
                        onCheckedChange={(nextChecked) => togglePodColumn(column.key, nextChecked === true)}
                        onSelect={(event) => event.preventDefault()}
                        className="min-h-10 gap-3 rounded-xl px-3 text-sm hover:bg-[#f6f8fb] [&>span:first-child]:hidden"
                      >
                        <span className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border",
                          checked ? "border-[#1683ff] bg-[#1683ff] text-white" : "border-[#94a3b8] bg-white",
                        )}>
                          {checked && <Check className="h-3 w-3 !text-white" strokeWidth={3} />}
                        </span>
                        {column.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <button type="button" onClick={() => void loadDeploymentPods(true)} disabled={podsLoading} className="action-button" title="刷新关联 Pod">
                <RotateCcw className={cn("h-3.5 w-3.5", podsLoading && "animate-spin [animation-duration:1.2s]")} />
              </button>
            </div>
          </div>
          {podsError && <div className="mb-3 rounded-lg border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{podsError}</div>}
          <div className="overflow-hidden rounded-2xl border border-[#eef2f7]">
          <Table>
            <TableHeader><TableRow>
              {visiblePodColumns.has("name") && <TableHead>容器组名称</TableHead>}
              {visiblePodColumns.has("status") && <TableHead>状态</TableHead>}
              {visiblePodColumns.has("containers") && <TableHead>容器（正常/总量）</TableHead>}
              {visiblePodColumns.has("ip") && <TableHead>容器组 IP</TableHead>}
              {visiblePodColumns.has("node") && <TableHead>节点</TableHead>}
              {visiblePodColumns.has("restarts") && <TableHead>重启次数</TableHead>}
              {visiblePodColumns.has("cpu") && <TableHead>CPU 申请值/限制值</TableHead>}
              {visiblePodColumns.has("memory") && <TableHead>内存申请值/限制值</TableHead>}
              <TableHead className="text-right">操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visiblePods.length === 0 ? <TableRow><TableCell colSpan={visiblePodColumns.size + 1} className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">{podsLoading ? "正在加载关联 Pod..." : "暂无关联 Pod"}</TableCell></TableRow> : visiblePods.map((pod) => (
                <TableRow key={pod.name}>
                  {visiblePodColumns.has("name") && <TableCell className="font-semibold text-[#1e6bff]">{pod.name}</TableCell>}
                  {visiblePodColumns.has("status") && <TableCell className="min-w-[220px]">
                    <div className={cn("font-medium", pod.statusError ? "text-[#dc2626]" : "text-[#334155]")}>{pod.status}</div>
                    {pod.statusMessage && <div className="mt-1 max-w-[320px] truncate text-xs text-[#94a3b8]" title={pod.statusMessage}>{pod.statusMessage}</div>}
                  </TableCell>}
                  {visiblePodColumns.has("containers") && <TableCell>{pod.readyContainers}/{pod.totalContainers}</TableCell>}
                  {visiblePodColumns.has("ip") && <TableCell>{pod.podIP}</TableCell>}
                  {visiblePodColumns.has("node") && <TableCell>{pod.nodeName}</TableCell>}
                  {visiblePodColumns.has("restarts") && <TableCell>{pod.restartCount}</TableCell>}
                  {visiblePodColumns.has("cpu") && <TableCell>{pod.cpu}</TableCell>}
                  {visiblePodColumns.has("memory") && <TableCell>{pod.memory}</TableCell>}
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="action-button" title="更多操作"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={8} className="z-[90] w-[168px] rounded-2xl border-[#eef2f7] bg-white p-2.5 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
                        <DropdownMenuItem onSelect={() => setPodYaml(pod)} className="min-h-11 gap-2.5 rounded-xl px-3 text-xs font-semibold text-[#334155] [&_svg]:!h-[13px] [&_svg]:!w-[13px] [&_svg]:!text-[#334155]"><FileText />查看 YAML</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPodLogs(pod)} className="min-h-11 gap-2.5 rounded-xl px-3 text-xs font-semibold text-[#334155] [&_svg]:!h-[13px] [&_svg]:!w-[13px] [&_svg]:!text-[#334155]"><FileText />日志</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPodMonitor(pod)} className="min-h-11 gap-2.5 rounded-xl px-3 text-xs font-semibold text-[#334155] [&_svg]:!h-[13px] [&_svg]:!w-[13px] [&_svg]:!text-[#334155]"><Activity />监控</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void deletePod(pod)} className="min-h-11 gap-2.5 rounded-xl px-3 text-xs font-semibold [&_svg]:!h-[13px] [&_svg]:!w-[13px]"><Trash2 />删除</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-text-secondary)]"><span>共 {visiblePods.length} 条</span><span>第 1 / 1 页</span></div>
          {podYaml && <PodYamlDialog pod={podYaml} onClose={() => setPodYaml(null)} />}
          {podLogs && <WorkloadLogsDrawer item={item} pod={podLogs} onClose={() => setPodLogs(null)} />}
          {podMonitor && <WorkloadMonitorDrawer item={item} pod={podMonitor} onClose={() => setPodMonitor(null)} />}
        </section>
      )}

      {activeTab !== "pods" && (
        <WorkloadDetailTabContent
          tab={activeTab}
          item={item}
          pods={pods}
          yaml={yaml}
          events={events}
          warning={observabilityWarning}
          eventsLoading={eventsLoading}
          onRefreshEvents={loadEvents}
          onAction={onAction}
          onEdit={onEdit}
          onReload={onReload}
        />
      )}
    </div>
  );
}

function DetailInfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-tertiary)]">{label}</p>
      <div className="truncate text-sm font-semibold text-[#111827]">{value}</div>
    </div>
  );
}

function WorkloadDetailTabContent({
  tab,
  item,
  pods,
  yaml,
  events,
  warning,
  eventsLoading,
  onRefreshEvents,
  onAction,
  onEdit,
  onReload,
}: {
  tab: WorkloadDetailTab;
  item: Workload;
  pods: DeploymentPodRow[];
  yaml: string;
  events: ObservabilityEvent[];
  warning: string;
  eventsLoading: boolean;
  onRefreshEvents: () => Promise<void>;
  onAction: (action: WorkloadMenuAction) => void;
  onEdit: (tab: WorkloadDetailTab) => void;
  onReload: () => Promise<void>;
}) {
  const template = asRecord(asRecord(item.raw?.spec).template);
  const templateMetadata = asRecord(template.metadata);
  const podSpec = asRecord(template.spec);
  const containers = asRecordArray(podSpec.containers);
  const workloadMetadata = asRecord(item.raw?.metadata);
  const workloadStatus = asRecord(item.raw?.status);
  const generation = Number(workloadMetadata.generation || 0);
  const observedGeneration = Number(workloadStatus.observedGeneration || 0);
  const yamlSynced = generation > 0 && observedGeneration >= generation;
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [containerSection, setContainerSection] = useState<"basic" | "lifecycle" | "health" | "env" | "storage" | "security">("basic");

  useEffect(() => {
    if (activeContainerIndex >= containers.length) setActiveContainerIndex(0);
  }, [activeContainerIndex, containers.length]);

  if (tab === "containers") {
    const container = containers[activeContainerIndex];
    const resources = asRecord(container?.resources);
    const requests = asRecord(resources.requests);
    const limits = asRecord(resources.limits);
    const securityContext = asRecord(container?.securityContext);
    const lifecycle = asRecord(container?.lifecycle);
    const env = asRecordArray(container?.env);
    const volumeMounts = asRecordArray(container?.volumeMounts);
    const containerSections = [
      ["basic", "基本信息"],
      ["lifecycle", "生命周期"],
      ["health", "健康检查"],
      ["env", "环境变量"],
      ["storage", "数据存储"],
      ["security", "安全设置"],
    ] as const;
    return (
      <section className="rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-2">
            <span className="shrink-0 px-2 text-sm font-medium text-[#64748b]">当前容器</span>
            {containers.map((item, index) => (
              <button
                key={`${configuredValue(item.name)}-${index}`}
                type="button"
                onClick={() => setActiveContainerIndex(index)}
                className={cn("rounded-xl border px-4 py-2 text-sm font-semibold", activeContainerIndex === index ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#dfe5ee] bg-white text-[#475569]")}
              >
                {configuredValue(item.name)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onEdit("containers")} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"><Pencil className="h-4 w-4" />编辑</button>
        </div>
        {containers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#dfe5ee] px-4 py-12 text-center text-sm text-[var(--color-text-tertiary)]">未配置容器</div>
        ) : (
          <div>
            <div className="mb-5 flex gap-7 border-b border-[#e2e8f0]">
              {containerSections.map(([id, label]) => (
                <button key={id} type="button" onClick={() => setContainerSection(id)} className={cn("border-b-[3px] px-1 pb-3 text-sm font-semibold", containerSection === id ? "border-[#0f172a] text-[#0f172a]" : "border-transparent text-[#64748b]")}>{label}</button>
              ))}
            </div>
            {containerSection === "basic" && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-5 border-l-4 border-[#0f172a] pl-3 text-base font-semibold text-[#111827]">基础配置</h3>
                  <div className="grid grid-cols-4 gap-x-8 gap-y-6">
                    <DetailInfoItem label="容器名称" value={configuredValue(container.name)} />
                    <DetailInfoItem label="容器镜像" value={<ImageChip image={configuredValue(container.image)} />} />
                    <DetailInfoItem label="更新策略" value={configuredValue(container.imagePullPolicy)} />
                    <DetailInfoItem label="特权容器" value={securityContext.privileged === true ? "是" : "否"} />
                  </div>
                </div>
                <div className="h-px bg-[#eef2f7]" />
                <div className="grid grid-cols-4 gap-x-8 gap-y-6">
                  <DetailInfoItem label="CPU 申请值" value={configuredValue(requests.cpu)} />
                  <DetailInfoItem label="CPU 限制值" value={configuredValue(limits.cpu)} />
                  <DetailInfoItem label="内存申请值" value={configuredValue(requests.memory)} />
                  <DetailInfoItem label="内存限制值" value={configuredValue(limits.memory)} />
                </div>
              </div>
            )}
            {containerSection === "lifecycle" && (
              <div className="grid grid-cols-2 gap-5">
                <DetailInfoItem label="启动后执行 (Post Start)" value={configuredValue(lifecycle.postStart)} />
                <DetailInfoItem label="停止前执行 (Pre Stop)" value={configuredValue(lifecycle.preStop)} />
              </div>
            )}
            {containerSection === "health" && (
              <div className="grid grid-cols-3 gap-5">
                <DetailInfoItem label="启动探针" value={configuredValue(container.startupProbe)} />
                <DetailInfoItem label="就绪探针" value={configuredValue(container.readinessProbe)} />
                <DetailInfoItem label="存活探针" value={configuredValue(container.livenessProbe)} />
              </div>
            )}
            {containerSection === "env" && (
              env.length === 0 ? <DetailEmpty text="未配置环境变量" /> : <div className="grid grid-cols-2 gap-3">{env.map((entry, index) => <div key={`${configuredValue(entry.name)}-${index}`} className="rounded-xl bg-[#f8fafc] px-4 py-3 font-mono text-sm">{configuredValue(entry.name)} = {configuredValue(entry.value ?? entry.valueFrom)}</div>)}</div>
            )}
            {containerSection === "storage" && (
              volumeMounts.length === 0 ? <DetailEmpty text="未配置数据存储" /> : <div className="grid grid-cols-2 gap-3">{volumeMounts.map((mount, index) => <div key={`${configuredValue(mount.name)}-${index}`} className="rounded-xl bg-[#f8fafc] p-4"><DetailInfoItem label={configuredValue(mount.name)} value={configuredValue(mount.mountPath)} /></div>)}</div>
            )}
            {containerSection === "security" && (
              Object.keys(securityContext).length === 0 ? <DetailEmpty text="未配置容器安全上下文" /> : (
                <div className="grid grid-cols-3 gap-5">
                  <DetailInfoItem label="以用户运行" value={configuredValue(securityContext.runAsUser)} />
                  <DetailInfoItem label="以用户组运行" value={configuredValue(securityContext.runAsGroup)} />
                  <DetailInfoItem label="只读根文件系统" value={configuredValue(securityContext.readOnlyRootFilesystem)} />
                  <DetailInfoItem label="允许权限提升" value={configuredValue(securityContext.allowPrivilegeEscalation)} />
                  <DetailInfoItem label="特权容器" value={configuredValue(securityContext.privileged)} />
                </div>
              )
            )}
          </div>
        )}
      </section>
    );
  }

  if (tab === "scheduling") {
    const nodeSelector = asStringRecord(podSpec.nodeSelector);
    const tolerations = asRecordArray(podSpec.tolerations);
    const affinity = asRecord(podSpec.affinity);
    const scheduledNodes = Array.from(new Set(pods.map((pod) => pod.nodeName).filter((name) => name && name !== "未配置")));
    const schedulingPolicy = podSpec.nodeName
      ? "调度到指定节点"
      : Object.keys(nodeSelector).length
        ? "优先调度到标签匹配的节点"
        : Object.keys(affinity).length
          ? "按节点亲和性规则调度"
          : "由 Kubernetes 调度器选择节点";
    return (
      <DetailPanel title="节点调度" action={<button type="button" onClick={() => onEdit("scheduling")} className="detail-action-button inline-flex items-center gap-2"><Pencil className="h-4 w-4" />编辑</button>}>
        <div className="space-y-7">
          <DetailInfoItem label="调度策略" value={schedulingPolicy} />
          <div className="grid grid-cols-2 gap-6">
            <DetailInfoItem label="指定节点" value={configuredValue(podSpec.nodeName)} />
            <DetailInfoItem label="节点选择器" value={Object.keys(nodeSelector).length ? <code className="break-all font-mono">{JSON.stringify(nodeSelector)}</code> : "未配置"} />
            <DetailInfoItem label="容忍策略" value={tolerations.length ? configuredValue(tolerations) : "未配置"} />
            <DetailInfoItem label="亲和性" value={Object.keys(affinity).length ? configuredValue(affinity) : "未配置"} />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-[#111827]">调度目标节点</h3>
            {scheduledNodes.length === 0 ? <DetailEmpty text="当前没有已调度的 Pod" /> : (
              <div className="space-y-3">
                {scheduledNodes.map((nodeName) => (
                  <div key={nodeName} className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#334155]">
                    <span>{nodeName}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#dcfce7] px-3 py-1 text-xs font-semibold text-[#16a34a]"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />已调度</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DetailPanel>
    );
  }

  if (tab === "labels") {
    const rawLabels = asStringRecord(item.raw?.metadata?.labels);
    const rawAnnotations = asStringRecord(item.raw?.metadata?.annotations);
    const podLabels = asStringRecord(templateMetadata.labels);
    const podAnnotations = asStringRecord(templateMetadata.annotations);
    const labelRows: [string, string][] = Object.entries(rawLabels);
    const annotationRows: [string, string][] = Object.entries(rawAnnotations);

    return (
      <DetailPanel title="标签与注解" action={<button type="button" onClick={() => onEdit("labels")} className="detail-action-button">编辑标签与注解</button>}>
        <div className="space-y-5">
          <MetadataList title="工作负载标签" rows={labelRows} />
          <MetadataList title="容器组标签" rows={Object.entries(podLabels)} />
          <MetadataList title="工作负载注解" rows={annotationRows} />
          <MetadataList title="容器组注解" rows={Object.entries(podAnnotations)} />
        </div>
      </DetailPanel>
    );
  }

  if (tab === "access") {
    const portRows = containers.flatMap((container) => asRecordArray(container.ports).map((port) => ({
      container: configuredValue(container.name),
      containerPort: configuredValue(port.containerPort),
      hostPort: configuredValue(port.hostPort),
      protocol: configuredValue(port.protocol || "TCP"),
    })));
    return (
      <DetailPanel title="访问配置" action={<button type="button" onClick={() => onEdit("access")} className="detail-action-button inline-flex items-center gap-2"><Pencil className="h-4 w-4" />编辑</button>}>
        <div className="space-y-6">
          <DetailInfoItem label="网络类型" value={<span className="rounded-lg bg-[#f3f4f6] px-2.5 py-1 text-sm font-semibold">{podSpec.hostNetwork === true ? "主机网络" : "容器网络"}</span>} />
          <div className="h-px bg-[#eef2f7]" />
          <div>
            <h3 className="mb-3 text-sm font-semibold text-[#111827]">端口映射</h3>
            {portRows.length === 0 ? <DetailEmpty text="未配置容器端口" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>容器</TableHead><TableHead>容器端口</TableHead><TableHead>主机端口</TableHead><TableHead>协议</TableHead></TableRow></TableHeader>
                <TableBody>{portRows.map((port, index) => <TableRow key={`${port.container}-${port.containerPort}-${index}`}><TableCell>{port.container}</TableCell><TableCell>{port.containerPort}</TableCell><TableCell>{port.hostPort}</TableCell><TableCell>{port.protocol}</TableCell></TableRow>)}</TableBody>
              </Table>
            )}
          </div>
        </div>
      </DetailPanel>
    );
  }

  if (tab === "events") {
    return <WorkloadEventsPanel events={events} warning={warning} loading={eventsLoading} onRefresh={onRefreshEvents} />;
  }

  if (tab === "versions") {
    return <WorkloadVersionsPanel item={item} onReload={onReload} />;
  }

  if (tab === "audit") {
    return <WorkloadAuditPanel item={item} />;
  }

  return (
    <DetailPanel
      title="YAML"
      action={(
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-8 items-center gap-2 rounded-xl px-3 text-sm font-semibold", yamlSynced ? "bg-[#dcfce7] text-[#16a34a]" : "bg-[#fff7ed] text-[#d97706]")}>
            <span className={cn("h-2 w-2 rounded-full", yamlSynced ? "bg-[#22c55e]" : "bg-[#f59e0b]")} />
            {yamlSynced ? "已同步" : "同步中"}
          </span>
          <button type="button" onClick={() => onAction("yaml")} className="h-10 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033]">编辑 YAML</button>
        </div>
      )}
    >
      <p className="-mt-3 mb-5 text-sm text-[#64748b]">当前资源定义，可进入编辑态修改并二次确认提交</p>
      <div className="mb-5 grid grid-cols-4 gap-8">
        <DetailInfoItem label="资源类型" value={String(item.raw?.kind || "Deployment")} />
        <DetailInfoItem label="资源名称" value={item.name} />
        <DetailInfoItem label="命名空间" value={item.namespace} />
        <DetailInfoItem
          label="版本状态"
          value={(
            <span className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-1 text-sm font-semibold", yamlSynced ? "bg-[#dcfce7] text-[#16a34a]" : "bg-[#fff7ed] text-[#d97706]")}>
              <span className={cn("h-2 w-2 rounded-full", yamlSynced ? "bg-[#22c55e]" : "bg-[#f59e0b]")} />
              {yamlSynced ? "已同步" : "同步中"}
            </span>
          )}
        />
      </div>
      <div className="max-h-[520px] overflow-auto rounded-xl bg-[#1e1e1e] p-5 font-mono text-xs leading-6 text-[#d4d4d4]">
        <pre dangerouslySetInnerHTML={{ __html: highlightYaml(yaml) }} />
      </div>
    </DetailPanel>
  );
}

function WorkloadEventsPanel({ events, warning, loading, onRefresh }: { events: ObservabilityEvent[]; warning: string; loading: boolean; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const filtered = events.filter((event) => `${event.reason} ${event.message} ${event.involvedObject?.name || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const abnormalCount = events.filter((event) => event.type !== "Normal").length;
  return (
    <DetailPanel title="事件列表" action={<div className="flex gap-2"><span className="rounded-lg bg-[#f3f4f6] px-3 py-1.5 text-xs text-[#64748b]">总数 {events.length}</span><span className="rounded-lg bg-[#fff7ed] px-3 py-1.5 text-xs text-[#c2410c]">异常 {abnormalCount}</span></div>}>
      <p className="-mt-3 mb-4 text-xs text-[#94a3b8]">展示当前工作负载及其关联 Pod 的真实 Kubernetes Events</p>
      {warning && <div className="mb-3 rounded-lg border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{warning}</div>}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative w-[320px]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索事件名称、对象或描述" className="h-10 rounded-xl pl-9" /></div>
        <button type="button" onClick={() => void onRefresh()} disabled={loading} className="action-button h-10 w-10 rounded-xl" title="刷新事件列表" aria-label="刷新事件列表">
          <RotateCcw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>事件级别</TableHead><TableHead>K8S 对象</TableHead><TableHead>事件名称</TableHead><TableHead>详细描述</TableHead><TableHead>次数</TableHead><TableHead>时间</TableHead></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-[#94a3b8]">{loading ? "正在加载真实事件..." : "暂无关联事件"}</TableCell></TableRow> : filtered.map((event) => (
            <TableRow key={event.name || `${event.reason}-${event.lastTimestamp}`}><TableCell><span className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold", event.type === "Normal" ? "bg-[#f3f4f6] text-[#64748b]" : "bg-[#fee2e2] text-[#dc2626]")}>{event.type}</span></TableCell><TableCell>{event.involvedObject?.kind}/{event.involvedObject?.name}</TableCell><TableCell className="font-semibold">{event.reason}</TableCell><TableCell className="max-w-[420px] whitespace-normal text-[#475569]">{event.message}</TableCell><TableCell>{event.count || 1}</TableCell><TableCell>{formatDateTime(event.lastTimestamp)}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </DetailPanel>
  );
}

function WorkloadVersionsPanel({ item, onReload }: { item: Workload; onReload: () => Promise<void> }) {
  const [revisions, setRevisions] = useState<DeploymentRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [yamlRevision, setYamlRevision] = useState<DeploymentRevision | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<DeploymentRevision | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listDeploymentRevisions(item.namespace, item.name);
      setRevisions(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载版本记录失败");
    } finally {
      setLoading(false);
    }
  }, [item.name, item.namespace]);
  useEffect(() => { void load(); }, [load]);
  const rollback = async (revision: number) => {
    setRollingBack(revision);
    setError("");
    try {
      await rollbackDeploymentRevision(item.namespace, item.name, revision);
      setRollbackTarget(null);
      await Promise.all([load(), onReload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回退失败");
    } finally {
      setRollingBack(null);
    }
  };
  return (
    <DetailPanel title="版本记录" action={<span className="rounded-lg bg-[#eff6ff] px-3 py-1.5 text-xs font-semibold text-[#2563eb]">来源：ReplicaSet revision</span>}>
      {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}
      {loading ? <DetailEmpty text="正在读取真实 ReplicaSet 版本..." /> : revisions.length === 0 ? <DetailEmpty text="当前 Deployment 没有可用的 ReplicaSet revision" /> : (
        <div className="space-y-4">{revisions.map((revision) => (
          <div key={revision.revision} className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
            <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-lg bg-[#dbeafe] px-3 py-1 text-sm font-semibold text-[#2563eb]">Revision {revision.revision}</span>{revision.current && <span className="text-sm font-semibold text-[#16a34a]">当前版本</span>}</div><div className="flex gap-2"><button type="button" onClick={() => setYamlRevision(revision)} className="detail-action-button">查看 YAML</button>{!revision.current && <button type="button" onClick={() => setRollbackTarget(revision)} disabled={rollingBack !== null} className="h-9 rounded-xl bg-[#0f172a] px-4 text-sm font-semibold text-white disabled:bg-[#94a3b8]">回退到此版本</button>}</div></div>
            <div className="mt-4 grid grid-cols-4 gap-4 text-sm"><DetailInfoItem label="ReplicaSet" value={revision.replicaSetName} /><DetailInfoItem label="镜像" value={revision.images.join(", ") || "-"} /><DetailInfoItem label="副本" value={`${revision.availableReplicas}/${revision.replicas}`} /><DetailInfoItem label="创建时间" value={formatDateTime(revision.createdAt)} /></div>
          </div>
        ))}</div>
      )}
      {yamlRevision && (
        <ReadonlyYamlDialog
          title={`查看 YAML - Revision ${yamlRevision.revision}`}
          source={yaml.dump(yamlRevision.yaml, { lineWidth: 120, noRefs: true })}
          downloadName={`${item.name}-revision-${yamlRevision.revision}.yaml`}
          onClose={() => setYamlRevision(null)}
        />
      )}
      <Dialog open={rollbackTarget !== null} onOpenChange={(open) => !open && rollingBack === null && setRollbackTarget(null)}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[520px]" showCloseButton={false}>
          <DialogHeader className="h-[72px] justify-center border-b border-[#eef2f7] px-7">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="flex min-w-0 items-center gap-3 text-base">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff7ed] text-[#f97316]"><AlertTriangle className="h-4 w-4" /></span>
                <span className="truncate">确认回退版本「Revision {rollbackTarget?.revision}」吗？</span>
              </DialogTitle>
              <button type="button" onClick={() => setRollbackTarget(null)} disabled={rollingBack !== null} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
          </DialogHeader>
          <div className="px-7 py-6">
            <div className="flex items-start gap-3 rounded-xl border border-[#fdba74] bg-[#fff7ed] px-4 py-4 text-sm leading-6 text-[#c2410c]">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-[#f97316]" />
              <span>将工作负载「{item.name}」回退到 Revision {rollbackTarget?.revision}，当前版本配置会被替换。</span>
            </div>
          </div>
          <div className="flex h-[72px] items-center justify-end gap-3 border-t border-[#eef2f7] px-7">
            <button type="button" onClick={() => setRollbackTarget(null)} disabled={rollingBack !== null} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] disabled:opacity-50">取消</button>
            <button type="button" onClick={() => rollbackTarget && void rollback(rollbackTarget.revision)} disabled={rollingBack !== null} className="h-10 rounded-xl bg-[#ff7a00] px-5 text-sm font-semibold text-white hover:bg-[#f56f00] disabled:bg-[#fdba74]">{rollingBack !== null ? "回退中..." : "确认回退"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </DetailPanel>
  );
}

function WorkloadAuditPanel({ item }: { item: Workload }) {
  const [records, setRecords] = useState<DeploymentAuditRecord[]>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getDeploymentAudit(item.namespace, item.name).then((response) => {
      if (cancelled) return;
      setRecords(response.items);
      setWarning(response.warning);
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "加载变更记录失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.name, item.namespace]);
  return (
    <DetailPanel title="Kubernetes 变更记录" action={<span className="rounded-lg bg-[#f3f4f6] px-3 py-1.5 text-xs text-[#64748b]">metadata.managedFields</span>}>
      {warning && <div className="mb-4 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">{warning}</div>}
      {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}
      <Table><TableHeader><TableRow><TableHead>管理器</TableHead><TableHead>操作</TableHead><TableHead>API 版本</TableHead><TableHead>子资源</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{records.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-[#94a3b8]">{loading ? "正在读取真实变更记录..." : "暂无 managedFields 记录"}</TableCell></TableRow> : records.map((record, index) => <TableRow key={`${record.manager}-${record.time}-${index}`}><TableCell className="font-semibold">{record.manager}</TableCell><TableCell>{record.operation}</TableCell><TableCell>{record.apiVersion}</TableCell><TableCell>{record.subresource || "资源主体"}</TableCell><TableCell>{formatDateTime(record.time)}</TableCell></TableRow>)}</TableBody></Table>
    </DetailPanel>
  );
}

function DetailPanel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[#dfe5ee] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[var(--color-text-tertiary)]">{text}</div>;
}

function MetadataList({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-[#eef2f7] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[#111827]">{title}</h3>
      <div className="space-y-2">
        {rows.length === 0 && <div className="rounded-lg bg-white px-3 py-5 text-center text-sm text-[var(--color-text-tertiary)]">未配置</div>}
        {rows.map(([key, value]) => (
          <div key={key} className="grid min-w-0 grid-cols-1 gap-2 rounded-lg bg-white px-3 py-2 text-sm sm:grid-cols-[minmax(220px,35%)_minmax(0,1fr)] sm:gap-3">
            <span className="min-w-0 break-all font-mono leading-5 text-[#64748b]">{key}</span>
            <span className="min-w-0 break-all font-mono leading-5 text-[#111827]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const buildWorkloadYaml = (workload: Workload) => yaml.dump(
  normalizeDeploymentForUpdate(workload, workload.raw || buildDeploymentResource({
    ...defaultForm,
    name: workload.name,
    namespace: workload.namespace,
    replicas: String(workload.replicas),
    image: workload.image,
  })),
  { lineWidth: -1, noRefs: true },
);

function WorkloadActionModal({
  panel,
  onClose,
  onUpdate,
  onYamlUpdate,
  onMetadataUpdate,
  onReload,
}: {
  panel: WorkloadActionPanel | null;
  onClose: () => void;
  onUpdate: (item: Workload, form: WorkloadUpdateForm) => Promise<void>;
  onYamlUpdate: (item: Workload, source: string) => Promise<void>;
  onMetadataUpdate: (item: Workload, labels: KeyValueDraft[], annotations: KeyValueDraft[]) => Promise<void>;
  onReload: (item: Workload) => Promise<void>;
}) {
  const [updateForm, setUpdateForm] = useState<WorkloadUpdateForm>({ image: "", replicas: "1" });
  const [metadataLabels, setMetadataLabels] = useState<KeyValueDraft[]>([]);
  const [metadataAnnotations, setMetadataAnnotations] = useState<KeyValueDraft[]>([]);
  const [actionError, setActionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!panel) return;
    setActionError("");
    if (panel.type === "update") {
      setUpdateForm({ image: panel.item.image === "-" ? "" : panel.item.image, replicas: String(panel.item.replicas || 1) });
    }
    if (panel.type === "labels") {
      setMetadataLabels(recordToDraftList(asStringRecord(panel.item.raw?.metadata?.labels), "label"));
      setMetadataAnnotations(recordToDraftList(asStringRecord(panel.item.raw?.metadata?.annotations), "annotation"));
    }
  }, [panel?.item.id, panel?.item.image, panel?.item.replicas, panel?.type]);

  if (!panel) return null;

  const submitUpdate = async () => {
    if (panel.type !== "update") return;
    if (!updateForm.image.trim()) {
      setActionError("镜像不能为空");
      return;
    }
    setIsSubmitting(true);
    setActionError("");
    try {
      await onUpdate(panel.item, updateForm);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "更新工作负载失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitYamlUpdate = async (source: string) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await onYamlUpdate(panel.item, source);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "YAML 更新工作负载失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitMetadataUpdate = async () => {
    if (panel.type !== "labels") return;
    setIsSubmitting(true);
    setActionError("");
    try {
      await onMetadataUpdate(panel.item, metadataLabels, metadataAnnotations);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "更新工作负载标签与注解失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (panel.type === "yaml") {
    return (
      <YamlCreateModal
        open
        title="编辑 YAML"
        defaultValue={buildWorkloadYaml(panel.item)}
        error={actionError}
        isSubmitting={isSubmitting}
        onSubmit={submitYamlUpdate}
        onCancel={onClose}
      />
    );
  }

  if (panel.type === "logs") {
    return (
      <WorkloadLogsDrawer item={panel.item} onClose={onClose} />
    );
  }

  if (panel.type === "monitor") {
    return <WorkloadMonitorDrawer item={panel.item} onClose={onClose} />;
  }

  if (panel.type === "console") {
    return <WorkloadConsoleDialog item={panel.item} onClose={onClose} />;
  }

  if (panel.type === "status") {
    return <WorkloadStatusDialog item={panel.item} onClose={onClose} onReload={() => onReload(panel.item)} />;
  }

  if (panel.type === "rollback") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-[920px] overflow-y-auto rounded-[24px] p-6">
          <DialogHeader><DialogTitle>回退工作负载</DialogTitle></DialogHeader>
          <WorkloadVersionsPanel item={panel.item} onReload={() => onReload(panel.item)} />
        </DialogContent>
      </Dialog>
    );
  }

  const titles: Record<WorkloadMenuAction, string> = {
    monitor: "监控",
    logs: "日志",
    yaml: "编辑 YAML",
    update: "更新工作负载",
    labels: "标签与注解",
    console: "控制台",
    status: "状态",
    rollback: "回退",
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[680px] rounded-[24px] p-0" showCloseButton={false}>
        <DialogHeader className="h-16 border-b border-[#eef2f7] px-6 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">{titles[panel.type]}</DialogTitle>
            <button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button>
          </div>
        </DialogHeader>
        <div className="p-6">
          {panel.type === "update" && (
            <div className="space-y-4">
              <CreateField label="工作负载名称">
                <Input value={panel.item.name} readOnly className="h-10 rounded-xl bg-[#f8fafc]" />
              </CreateField>
              <CreateField label="镜像">
                <Input value={updateForm.image} onChange={(event) => setUpdateForm((current) => ({ ...current, image: event.target.value }))} className="h-10 rounded-xl" />
              </CreateField>
              <CreateField label="实例数">
                <Input value={updateForm.replicas} onChange={(event) => setUpdateForm((current) => ({ ...current, replicas: event.target.value }))} className="h-10 rounded-xl" />
              </CreateField>
            </div>
          )}

          {panel.type === "labels" && (
            <MetadataEditor
              labels={metadataLabels}
              annotations={metadataAnnotations}
              onLabelsChange={setMetadataLabels}
              onAnnotationsChange={setMetadataAnnotations}
            />
          )}
          {actionError && (
            <div className="mt-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">
              {actionError}
            </div>
          )}
        </div>
        <DialogFooter className="h-16 border-t border-[#eef2f7] px-6 py-0">
          <div className="flex w-full items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">取消</button>
            <button
              type="button"
              onClick={() => {
                if (panel.type === "update") {
                  void submitUpdate();
                  return;
                }
                if (panel.type === "labels") {
                  void submitMetadataUpdate();
                  return;
                }
              }}
              disabled={isSubmitting}
              className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]"
            >
              {isSubmitting ? "保存中..." : "确定"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadConsoleDialog({ item, onClose }: { item: Workload; onClose: () => void }) {
  const [pods, setPods] = useState<Array<{ name: string; containers: string[]; phase: string }>>([]);
  const [podName, setPodName] = useState("");
  const [containerName, setContainerName] = useState("");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [commandFocused, setCommandFocused] = useState(false);
  const commandInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listPods(item.namespace).then((resources) => {
      if (cancelled) return;
      const deploymentSpec = asRecord(item.raw?.spec);
      const selector = asStringRecord(asRecord(deploymentSpec.selector).matchLabels);
      const matches = resources.flatMap((resource) => {
        const pod = asRecord(resource);
        const metadata = asRecord(pod.metadata);
        const labels = asStringRecord(metadata.labels);
        const owners = asRecordArray(metadata.ownerReferences);
        const selectorMatches = Object.keys(selector).length > 0 && Object.entries(selector).every(([key, value]) => labels[key] === value);
        const ownerMatches = owners.some((owner) => String(owner.kind || "") === "ReplicaSet" && replicaSetBelongsToDeployment(String(owner.name || ""), item.name));
        if (owners.length > 0 ? !ownerMatches : !selectorMatches) return [];
        const spec = asRecord(pod.spec);
        return [{
          name: String(metadata.name || ""),
          containers: asRecordArray(spec.containers).map((container) => String(container.name || "")).filter(Boolean),
          phase: String(asRecord(pod.status).phase || "Unknown"),
        }];
      });
      setPods(matches);
      const first = matches.find((pod) => pod.phase === "Running") || matches[0];
      setPodName(first?.name || "");
      setContainerName(first?.containers[0] || "");
    }).catch((err) => setError(err instanceof Error ? err.message : "加载 Pod 失败")).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item]);

  const selectedPod = pods.find((pod) => pod.name === podName);
  const execute = async () => {
    if (!podName || !containerName || !command.trim()) return;
    setExecuting(true);
    setError("");
    try {
      const result = await executeDeploymentCommand(item.namespace, item.name, { pod: podName, container: containerName, command: command.trim() });
      setOutput(`${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.exitCode === null ? "" : `\n[exit ${result.exitCode}]`}`.trim());
      setCommand("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pod 命令执行失败");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!flex w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)] sm:max-w-none" showCloseButton={false}>
        <DialogHeader className="h-[72px] shrink-0 border-b border-[#eef1f5] px-7 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">打开控制台 {item.name}</DialogTitle>
            <button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button>
          </div>
        </DialogHeader>
        <div className="space-y-5 overflow-y-auto p-7">
          {error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#111827]">容器组</label>
            <Select value={podName || undefined} disabled={loading || pods.length === 0} onValueChange={(value) => { const next = pods.find((pod) => pod.name === value); setPodName(value); setContainerName(next?.containers[0] || ""); setOutput(""); }}>
              <SelectTrigger className="h-11 w-full rounded-xl border-2 border-[#e6eaf0] px-4 text-sm shadow-none">
                <SelectValue placeholder={loading ? "正在加载真实 Pod..." : "请选择容器组"} />
              </SelectTrigger>
              <SelectContent position="popper" align="start" className="z-[150] w-[var(--radix-select-trigger-width)] rounded-2xl p-2 shadow-[0_16px_36px_rgba(15,23,42,0.14)]" viewportClassName="h-auto">
                {pods.map((pod) => <SelectItem key={pod.name} value={pod.name} className="min-h-11 rounded-xl px-4 py-3 text-sm data-[state=checked]:bg-[#eaf2ff] data-[state=checked]:text-[#2563eb]">{pod.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#111827]">容器</label>
            <Select value={containerName || undefined} disabled={!selectedPod || selectedPod.containers.length === 0} onValueChange={(value) => { setContainerName(value); setOutput(""); }}>
              <SelectTrigger className="h-11 w-full rounded-xl border-2 border-[#e6eaf0] px-4 text-sm shadow-none">
                <SelectValue placeholder="请选择容器" />
              </SelectTrigger>
              <SelectContent position="popper" align="start" className="z-[150] w-[var(--radix-select-trigger-width)] rounded-2xl p-2 shadow-[0_16px_36px_rgba(15,23,42,0.14)]" viewportClassName="h-auto">
                {(selectedPod?.containers || []).map((container) => <SelectItem key={container} value={container} className="min-h-11 rounded-xl px-4 py-3 text-sm data-[state=checked]:bg-[#eaf2ff] data-[state=checked]:text-[#2563eb]">{container}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-hidden rounded-xl border border-[#1f2937] bg-[#0b1220]">
            <div className="border-b border-[#1f2937] px-4 py-2 font-mono text-xs text-[#94a3b8]">{podName || "-"} / {containerName || "-"}</div>
            <div className="min-h-[180px] max-h-[360px] overflow-auto p-4 font-mono text-xs leading-6 text-[#d1d5db]">
              <div>$ kubectl exec -it {podName || "<pod>"} -c {containerName || "<container>"} -- /bin/sh</div>
              <div>Connected to workload console.</div>
              {output && <pre className="whitespace-pre-wrap break-words font-mono">{output}</pre>}
              <div className="flex items-center gap-1">
                <span>#</span>
                {!command && !commandFocused && <span className="inline-block h-4 w-2 bg-[#d1d5db]" aria-hidden="true" />}
                <input
                  ref={commandInputRef}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  onFocus={() => setCommandFocused(true)}
                  onBlur={() => setCommandFocused(false)}
                  onKeyDown={(event) => { if (event.key === "Enter") void execute(); }}
                  disabled={executing || !podName || !containerName}
                  aria-label="控制台命令"
                  className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-xs text-[#d1d5db] shadow-none outline-none focus:ring-0 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="h-[72px] shrink-0 border-t border-[#eef1f5] px-7 py-0">
          <div className="flex w-full items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">取消</button>
            <button type="button" onClick={() => command.trim() ? void execute() : commandInputRef.current?.focus()} disabled={executing || !podName || !containerName} className="btn-black text-sm disabled:cursor-not-allowed disabled:opacity-45">{executing ? "执行中" : "打开"}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadStatusDialog({ item, onClose, onReload }: { item: Workload; onClose: () => void; onReload: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState("");
  const execute = async (action: "start" | "stop") => {
    const labels = { start: "启动", stop: "停止" };
    if (!window.confirm(`确认${labels[action]}工作负载 ${item.name}？该操作会真实更新集群中的 Deployment。`)) return;
    setSubmitting(action);
    setError("");
    try {
      await runDeploymentAction(item.namespace, item.name, action);
      await onReload();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${labels[action]}失败`);
    } finally {
      setSubmitting(null);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[560px] rounded-[24px] p-0" showCloseButton={false}>
        <DialogHeader className="border-b border-[#eef2f7] px-6 py-5"><div className="flex items-center justify-between"><DialogTitle>工作负载状态</DialogTitle><button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button></div></DialogHeader>
        <div className="space-y-5 p-6"><div className="grid grid-cols-3 gap-3"><DetailInfoItem label="名称" value={item.name} /><DetailInfoItem label="命名空间" value={item.namespace} /><DetailInfoItem label="副本" value={`${item.readyReplicas}/${item.replicas}`} /></div>{error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}<div className="grid grid-cols-2 gap-3"><button type="button" disabled={item.replicas > 0 || submitting !== null} onClick={() => void execute("start")} className="h-11 rounded-xl border border-[#dfe5ee] font-semibold disabled:opacity-40">启动</button><button type="button" disabled={item.replicas === 0 || submitting !== null} onClick={() => void execute("stop")} className="h-11 rounded-xl border border-[#dfe5ee] font-semibold disabled:opacity-40">停止</button></div><p className="text-xs leading-5 text-[#94a3b8]">停止会将 replicas 真实缩容为 0；启动会恢复停止前副本数。</p></div>
      </DialogContent>
    </Dialog>
  );
}

function PodYamlDialog({ pod, onClose }: { pod: DeploymentPodRow; onClose: () => void }) {
  const displayResource = JSON.parse(JSON.stringify(pod.raw)) as KubeResource;
  if (displayResource.metadata) {
    delete (displayResource.metadata as Record<string, unknown>).managedFields;
  }
  const source = yaml.dump(displayResource, { noRefs: true, lineWidth: 120 });
  return <ReadonlyYamlDialog title={`查看 YAML - ${pod.name}`} source={source} downloadName={`${pod.name}.yaml`} onClose={onClose} />;
}

function ReadonlyYamlDialog({ title, source, downloadName, onClose }: { title: string; source: string; downloadName: string; onClose: () => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const lines = source.split("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn(
        "flex flex-col gap-0 overflow-hidden p-0",
        fullscreen
          ? "!inset-0 !h-screen !max-h-none !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 sm:!max-w-none"
          : "h-[min(800px,calc(100vh-48px))] w-[min(780px,calc(100vw-48px))] max-w-none rounded-[24px] sm:max-w-[780px]",
      )} showCloseButton={false}>
        <DialogHeader className="h-14 shrink-0 justify-center border-b border-[var(--color-border)] px-5">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <DialogTitle className="min-w-0 truncate whitespace-nowrap text-base font-semibold text-[#111827]">{title}</DialogTitle>
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <button type="button" onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><Download className="h-3.5 w-3.5" />下载</button>
              <button type="button" onClick={() => setFullscreen((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{fullscreen ? "退出全屏" : "全屏"}</button>
              <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
              <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)]"><X className="h-[18px] w-[18px]" /></button>
            </div>
          </div>
        </DialogHeader>
        <div className="mx-5 mt-4 flex shrink-0 items-center gap-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm">
            <Info className="h-[18px] w-[18px] shrink-0 text-[#3b82f6]" />
            <span>为保证工作负载能被正常调度，请先阅读</span>
            <a href="https://docs.daocloud.io/kant/user-guide/edge-app/create-app.html#yaml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#2563eb] hover:underline">YAML 创建须知<ExternalLink className="h-3 w-3" /></a>
        </div>
        <div className="mx-5 my-3 min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)] bg-[#1e1e1e] py-3 font-mono text-xs leading-6 text-[#d4d4d4]">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="flex min-w-max">
                <span className="w-12 shrink-0 select-none px-2 text-right text-[#858585]">{index + 1}</span>
                <code className="whitespace-pre px-3" dangerouslySetInnerHTML={{ __html: highlightYamlLine(line) }} />
              </div>
            ))}
        </div>
        <div className="flex h-14 shrink-0 items-center justify-end border-t border-[var(--color-border)] px-5">
          <button type="button" onClick={onClose} className="h-9 rounded-xl bg-[var(--color-bg-hover)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[#eef2f7]">关闭</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadLogsDrawer({ item, pod, onClose }: { item: Workload; pod?: DeploymentPodRow; onClose: () => void }) {
  const [content, setContent] = useState("正在加载日志...");
  const [warning, setWarning] = useState("");
  const [podName, setPodName] = useState("");
  const [container, setContainer] = useState("");
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    setContent("正在加载日志...");
    setWarning("");
    setPodName("");
    setContainer("");
    setLookupError("");
    getResourceLogs("deployment", item.namespace, item.name, { tailLines: 200, pod: pod?.name }, { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        const first = res.item.pods.find((pod) => pod.available) || res.item.pods[0];
        setPodName(first?.podName || "");
        setContainer(first?.container || "");
        setContent(first
          ? first.content || (first.available ? "当前容器暂无日志" : "容器尚未启动或日志暂不可用")
          : "未找到关联 Pod");
        setWarning((res.warnings || []).map((warning) => warning.message).join("；"));
      })
      .catch((err) => {
        if (!cancelled) {
          const timedOut = controller.signal.aborted;
          setLookupError(timedOut ? "查询超时" : "查询失败");
          setContent(timedOut ? "日志请求超时，请稍后重试或检查边缘节点连接" : err instanceof Error ? err.message : "加载日志失败");
          setWarning(timedOut ? "日志查询已超时，页面不会继续等待" : "");
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [item.name, item.namespace, pod?.name]);

  return (
    <div className="fixed inset-0 z-[120]">
      <button type="button" aria-label="关闭日志" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-[520px] flex-col bg-white shadow-[-12px_0_32px_rgba(15,23,42,0.16)]">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#eef2f7] px-6">
          <h2 className="text-base font-semibold text-[#111827]">日志</h2>
          <button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-[#eef2f7] p-5 text-sm text-[var(--color-text-secondary)]">
          <div>Pod：{loading ? "正在查找关联 Pod..." : podName || lookupError || "未找到关联 Pod"}</div>
          <div className="mt-1">Container：{loading ? "正在加载..." : container || "-"}</div>
          {warning && <div className="mt-2 rounded-lg border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[#D25F00]">{warning}</div>}
        </div>
        <div className="min-h-0 flex-1 p-5">
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#1f2937] bg-[#0b1220]">
            <div className="border-b border-[#1f2937] px-4 py-2 font-mono text-xs text-[#94a3b8]">{item.name} / {container || "-"}</div>
            <pre className="flex-1 overflow-y-auto whitespace-pre-wrap p-4 font-mono text-xs leading-6 text-[#d1d5db]">{content}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkloadMonitorDrawer({ item, pod, onClose }: { item: Workload; pod?: DeploymentPodRow; onClose: () => void }) {
  const [summary, setSummary] = useState<ObservabilitySummary | null>(null);
  const [history, setHistory] = useState<Array<{ time: string; cpu: number; memory: number }>>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadMonitor = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    setWarning("");
    try {
      const response = await getResourceObservability(pod ? "pod" : "deployment", item.namespace, pod?.name || item.name, {
        includeMetrics: true,
        includeEvents: false,
        includeLogs: false,
      });
      setSummary(response.item);
      setWarning((response.warnings || []).map((entry) => entry.message).join("；"));
      const cpu = Number(response.item.metrics.cpuUsage || 0);
      const memory = Number(response.item.metrics.memoryUsage || 0) / 1024 / 1024;
      if (response.item.metrics.available) {
        setHistory((current) => [...current, { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), cpu, memory }].slice(-24));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `加载${pod ? "容器组" : "工作负载"}监控失败`);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [item.name, item.namespace, pod?.name]);

  useEffect(() => {
    void loadMonitor(true);
    const timer = window.setInterval(() => void loadMonitor(false), 10_000);
    return () => window.clearInterval(timer);
  }, [loadMonitor]);

  const metrics = summary?.metrics;
  const memoryText = typeof metrics?.memoryUsage === "number"
    ? `${(metrics.memoryUsage / 1024 / 1024).toFixed(1)} MiB`
    : metrics?.memoryUsage ?? "-";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
      <button type="button" aria-label="关闭监控" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[calc(100vh-48px)] w-full max-w-[1040px] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-[#eef2f7] px-7">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">{pod ? "容器组" : "负载"}监控（{pod?.name || item.name}）</h2>
            <p className="mt-0.5 text-xs text-[#94a3b8]">{item.namespace} / {pod?.name || item.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void loadMonitor(true)} disabled={loading} className="action-button" title="刷新监控"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></button>
            <button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-7">
          {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}
          {warning && <div className="mb-4 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">{warning}</div>}
          {loading && !summary ? <DetailEmpty text="正在加载真实监控指标..." /> : metrics?.available ? (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-5"><p className="text-xs text-[#94a3b8]">CPU 使用量</p><p className="mt-2 text-2xl font-semibold text-[#111827]">{metrics.cpuUsage ?? "-"} m</p></div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-5"><p className="text-xs text-[#94a3b8]">内存使用量</p><p className="mt-2 text-2xl font-semibold text-[#111827]">{memoryText}</p></div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-5"><p className="text-xs text-[#94a3b8]">指标 Pod</p><p className="mt-2 text-2xl font-semibold text-[#111827]">{metrics.pods.length}</p></div>
                <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-5"><p className="text-xs text-[#94a3b8]">数据源</p><p className="mt-2 text-base font-semibold text-[#111827]">metrics.k8s.io</p></div>
              </div>
              <div className="grid grid-cols-2 gap-5">
                <MetricHistoryChart title="CPU 指标" unit="m" data={history} dataKey="cpu" color="#2563eb" />
                <MetricHistoryChart title="内存指标" unit="MiB" data={history} dataKey="memory" color="#16a34a" />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-[#111827]">Pod 指标</h3>
                {metrics.pods.length === 0 ? <DetailEmpty text="暂无 Pod 指标" /> : (
                  <Table><TableHeader><TableRow><TableHead>Pod</TableHead><TableHead>CPU (m)</TableHead><TableHead>内存 (MiB)</TableHead></TableRow></TableHeader><TableBody>{metrics.pods.map((pod) => <TableRow key={`${pod.namespace}/${pod.name}`}><TableCell className="font-semibold text-[#1e6bff]">{pod.name}</TableCell><TableCell>{pod.cpuUsage}</TableCell><TableCell>{(pod.memoryUsage / 1024 / 1024).toFixed(1)}</TableCell></TableRow>)}</TableBody></Table>
                )}
              </div>
              <p className="text-xs leading-5 text-[#94a3b8]">曲线由弹窗打开后的真实 metrics-server 采样形成；当前集群未提供工作负载网络与磁盘历史指标，因此不展示原型中的静态网络/磁盘曲线。</p>
            </div>
          ) : <DetailEmpty text={observabilityUnavailableText(metrics?.reason)} />}
        </div>
      </div>
    </div>
  );
}

function MetricHistoryChart({ title, unit, data, dataKey, color }: { title: string; unit: string; data: Array<{ time: string; cpu: number; memory: number }>; dataKey: "cpu" | "memory"; color: string }) {
  return (
    <div className="h-[260px] rounded-2xl border border-[#e2e8f0] p-5">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold text-[#111827]">{title}</h3><span className="text-xs text-[#94a3b8]">{unit}</span></div>
      {data.length < 2 ? <div className="flex h-[190px] items-center justify-center text-sm text-[#94a3b8]">正在积累真实采样点（每 10 秒）</div> : (
        <ResponsiveContainer width="100%" height={190}><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} /><YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} /><Tooltip /><Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} /></LineChart></ResponsiveContainer>
      )}
    </div>
  );
}

function MetadataEditor({
  labels,
  annotations,
  onLabelsChange,
  onAnnotationsChange,
}: {
  labels: KeyValueDraft[];
  annotations: KeyValueDraft[];
  onLabelsChange: (items: KeyValueDraft[]) => void;
  onAnnotationsChange: (items: KeyValueDraft[]) => void;
}) {
  return (
    <div className="space-y-6">
      <KeyValueEditor title="标签 (Labels)" items={labels} onChange={onLabelsChange} addLabel="添加" />
      <KeyValueEditor title="注解 (Annotations)" items={annotations} onChange={onAnnotationsChange} addLabel="添加" />
    </div>
  );
}

function YamlCreateModal({
  open,
  title = "YAML 创建工作负载",
  defaultValue,
  error,
  isSubmitting = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title?: string;
  defaultValue: string;
  error?: string;
  isSubmitting?: boolean;
  onSubmit: (yaml: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [fullscreen, setFullscreen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const lines = value.split("\n");
  const lineCount = Math.max(lines.length, 1);

  if (!open) return null;

  const download = () => {
    const blob = new Blob([value], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workload.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {!fullscreen && <div className="absolute inset-0 bg-black/40" onClick={onCancel} />}
      <div
        className={cn("relative flex flex-col overflow-hidden bg-white", fullscreen ? "fixed inset-0 h-full w-full" : "rounded-[24px] shadow-[0_24px_60px_rgba(16,24,40,0.10)]")}
        style={fullscreen ? undefined : { width: 720, height: "min(800px, calc(100vh - 48px))" }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5">
          <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setValue(String(reader.result || ""));
                reader.readAsText(file);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><Upload className="h-3.5 w-3.5" />上传</button>
            <button type="button" onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><Download className="h-3.5 w-3.5" />下载</button>
            <button type="button" onClick={() => setFullscreen((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{fullscreen ? "退出全屏" : "全屏"}</button>
            <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
            <button type="button" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)]"><X className="h-[18px] w-[18px]" /></button>
          </div>
        </div>

        <div className="mx-5 mt-4 flex shrink-0 items-center gap-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#3b82f6] text-xs font-semibold text-[#3b82f6]">i</span>
          <span>为保证工作负载能被正常调度，请先阅读</span>
          <a href="https://docs.daocloud.io/kant/user-guide/edge-app/create-app.html#yaml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#2563eb] hover:underline">
            YAML 创建须知 <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="mx-5 my-3 min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)]" style={{ backgroundColor: "#1e1e1e" }}>
          <div className="flex h-full min-h-0 overflow-hidden">
            <div className="w-12 shrink-0 select-none overflow-hidden text-right font-mono text-xs leading-6 text-[#858585]" style={{ backgroundColor: "#1e1e1e" }}>
              <div ref={lineGutterRef} className="py-3">
                {Array.from({ length: lineCount }, (_, index) => <div key={index} className="px-2">{index + 1}</div>)}
              </div>
            </div>
            <div className="relative min-w-0 flex-1">
              <pre
                ref={previewRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden p-3 font-mono text-xs leading-6"
                style={{ color: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 1 }}
                dangerouslySetInnerHTML={{ __html: highlightYaml(value) }}
              />
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onScroll={(event) => {
                  if (lineGutterRef.current) lineGutterRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                  if (previewRef.current) {
                    previewRef.current.scrollTop = event.currentTarget.scrollTop;
                    previewRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
                spellCheck={false}
                className="absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-6 outline-none"
                style={{ color: "transparent", caretColor: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 2 }}
              />
            </div>
          </div>
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-[var(--color-border)] px-5">
          <div className="min-w-0 flex-1 text-sm text-[#c2410c]">{error}</div>
          <button type="button" onClick={onCancel} className="h-9 rounded-xl bg-[var(--color-bg-hover)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[#eef2f7]">取消</button>
          <button type="button" onClick={() => onSubmit(value)} disabled={isSubmitting} className="h-9 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033] disabled:cursor-not-allowed disabled:bg-[#9ca3af]">{isSubmitting ? "保存中..." : "确定"}</button>
        </div>
      </div>
    </div>
  );
}

function CreateWorkloadWizard({
  open,
  onOpenChange,
  onCreate,
  editItem = null,
  initialLocation = { step: 0 },
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (form: WorkloadForm) => void;
  editItem?: Workload | null;
  initialLocation?: WorkloadWizardLocation;
  onUpdate?: (item: Workload, form: WorkloadForm) => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(defaultForm);
  const [containers, setContainers] = useState<ContainerDraft[]>([createContainerDraft(0)]);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [edgeNodes, setEdgeNodes] = useState<EdgeNodeView[]>([]);
  const [nodeLoadError, setNodeLoadError] = useState("");
  const clearError = (field: string) => setErrors((current) => ({ ...current, [field]: "" }));

  useEffect(() => {
    if (!open) return;
    const initialValues = editItem ? workloadWizardValues(editItem) : { form: defaultForm, containers: [createContainerDraft(0)] };
    setStep(editItem ? initialLocation.step : 0);
    setForm(initialValues.form);
    setContainers(initialValues.containers);
    setActiveContainerIndex(0);
    setErrors({});
    setTouched(false);
    setNodeLoadError("");
    void listNodes().then((items) => setEdgeNodes(items.filter((item) => item.role === "edge"))).catch((error) => {
      setEdgeNodes([]);
      setNodeLoadError(error instanceof Error ? error.message : "边缘节点加载失败");
    });
  }, [editItem, initialLocation.advancedTab, initialLocation.step, open]);

  const close = () => {
    setStep(0);
    setForm(defaultForm);
    setContainers([createContainerDraft(0)]);
    setActiveContainerIndex(0);
    setErrors({});
    setTouched(false);
    onOpenChange(false);
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "请输入工作负载名称";
    if (!form.namespace.trim()) next.namespace = "请选择命名空间";
    if (Number(form.replicas) < 1) next.replicas = "实例数必须大于 0";
    if (step >= 1 && containers.some((container) => !container.image.trim())) next.image = "请输入镜像地址";
    if (step >= 1 && containers.some((container) => !container.name.trim())) next.containerName = "请输入容器名称";
    if (step >= 2 && form.schedulingMode === "nodeName" && !form.nodeSelectorValue.trim()) next.scheduling = "请选择边缘节点";
    if (step >= 2 && form.schedulingMode === "nodeSelector" && !form.nodeSelectors.some((item) => item.key.trim() && item.value.trim())) next.scheduling = "请填写节点标签选择器";
    setErrors(next);
    let firstErrorId = "";
    if (next.name) firstErrorId = "workload-name";
    else if (next.namespace) firstErrorId = "workload-namespace";
    else if (next.replicas) firstErrorId = "workload-replicas";
    else if (next.containerName || next.image) {
      const invalidIndex = containers.findIndex((container) => !container.name.trim() || !container.image.trim());
      if (invalidIndex >= 0) setActiveContainerIndex(invalidIndex);
      firstErrorId = next.containerName ? "workload-container-name" : "workload-container-image";
    }
    if (firstErrorId) window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.getElementById(firstErrorId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }));
    return Object.keys(next).length === 0;
  };

  const canGoNext = step === 0
    ? form.name.trim().length > 0 && form.namespace.trim().length > 0 && Number(form.replicas) >= 1
    : containers.every((container) => container.name.trim().length > 0 && container.image.trim().length > 0);

  const next = () => {
    setTouched(true);
    if (validate()) setStep((current) => Math.min(current + 1, 2));
  };

  const create = () => {
    setTouched(true);
    if (!validate()) return;
    const primaryContainer = containers[0] || createContainerDraft(0);
    const nextForm = {
      ...form,
      containerName: primaryContainer.name,
      image: primaryContainer.image,
      pullPolicy: primaryContainer.pullPolicy,
      cpuRequest: primaryContainer.cpuRequest,
      cpuLimit: primaryContainer.cpuLimit,
      memoryRequest: primaryContainer.memoryRequest,
      memoryLimit: primaryContainer.memoryLimit,
      privileged: primaryContainer.privileged,
      lifecyclePostStart: primaryContainer.lifecyclePostStart,
      lifecyclePreStop: primaryContainer.lifecyclePreStop,
      startupProbe: primaryContainer.startupProbe,
      readinessProbe: primaryContainer.readinessProbe,
      livenessProbe: primaryContainer.livenessProbe,
      envKey: primaryContainer.envs[0]?.key || "",
      envValue: primaryContainer.envs[0]?.value || "",
      volumeName: primaryContainer.volumes[0]?.name || "",
      volumeMountPath: primaryContainer.volumes[0]?.mountPath || "",
      runAsUser: primaryContainer.runAsUser,
      runAsGroup: primaryContainer.runAsGroup,
      readOnlyRootFilesystem: primaryContainer.readOnlyRootFilesystem,
      allowPrivilegeEscalation: primaryContainer.allowPrivilegeEscalation,
    };
    if (editItem && onUpdate) onUpdate(editItem, nextForm);
    else onCreate(nextForm);
    setStep(0);
    setForm(defaultForm);
    setContainers([createContainerDraft(0)]);
    setActiveContainerIndex(0);
    setErrors({});
    setTouched(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : close()}>
      <DialogContent className="!flex max-h-[min(800px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)] sm:max-w-[600px]" showCloseButton={false}>
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-6 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">{editItem ? "编辑工作负载" : "创建工作负载"}</DialogTitle>
            <button type="button" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e7eb] text-[#64748b] hover:bg-[#f8fafc]">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </DialogHeader>

        <StepIndicator step={step} />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
                工作负载将创建为 Kubernetes Deployment；请在高级配置中按边缘节点或节点标签设置调度对象。
              </div>
              <BasicStep form={form} setForm={setForm} errors={errors} clearError={clearError} />
            </div>
          )}
          {step === 1 && (
            <ContainerStep
              containers={containers}
              setContainers={setContainers}
              activeIndex={activeContainerIndex}
              setActiveIndex={setActiveContainerIndex}
              errors={errors}
              clearError={clearError}
            />
          )}
          {step === 2 && <AdvancedStep key={`${editItem?.id || "create"}-${initialLocation.advancedTab ?? 0}`} form={form} setForm={setForm} edgeNodes={edgeNodes} nodeLoadError={nodeLoadError} schedulingError={errors.scheduling || ""} initialTab={initialLocation.advancedTab ?? 0} />}
        </div>

        <DialogFooter className="h-16 shrink-0 border-t border-[#f0f1f3] bg-white px-6 py-0">
          <div className="flex w-full items-center justify-between">
            <div>
              {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">上一步</button>}
            </div>
            <div className="flex items-center gap-3">
              {touched && !canGoNext && step < 2 && <span className="text-xs text-[#ef4444]">请填写所有必填项</span>}
              <button type="button" onClick={close} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">取消</button>
              {step < 2 ? (
                <button type="button" onClick={next} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">下一步</button>
              ) : (
                <button type="button" onClick={create} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">{editItem ? "保存" : "创建"}</button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: number }) {
  const steps = [
    { label: "基本信息", icon: Settings },
    { label: "容器配置", icon: Box },
    { label: "高级配置", icon: Server },
  ];

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#f0f1f3] px-6 py-4">
      {steps.map((item, index) => (
        <div key={item.label} className="flex flex-1 items-center gap-2 last:flex-none">
          <WizardStep active={index === step} done={index < step} icon={<item.icon className="h-3.5 w-3.5" />} label={item.label} />
          {index < steps.length - 1 && <div className="h-px flex-1" style={{ background: index < step ? "#dcfce7" : "#f3f4f6" }} />}
        </div>
      ))}
    </div>
  );
}

function WizardStep({ active, done, icon, label }: { active: boolean; done: boolean; icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full"
        style={{
          background: active ? "#1a73e8" : done ? "#dcfce7" : "#f3f4f6",
          color: active ? "#fff" : done ? "#16a34a" : "#9ca3af",
        }}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold" style={{ color: active ? "#1a73e8" : done ? "#16a34a" : "#9ca3af" }}>{label}</span>
    </div>
  );
}

function BasicStep({ form, setForm, errors, clearError }: { form: WorkloadForm; setForm: (form: WorkloadForm) => void; errors: Record<string, string>; clearError: (field: string) => void }) {
  const namespaces = useNamespaceOptions();
  const [refreshedNamespaces, setRefreshedNamespaces] = useState<Array<{ value: string; label: string }> | null>(null);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [namespaceError, setNamespaceError] = useState("");
  const namespaceOptions = (refreshedNamespaces || namespaces).filter((item) => item.value !== "all");

  const refreshNamespaces = async () => {
    setRefreshingNamespaces(true);
    setNamespaceError("");
    try {
      const nextNamespaces = (await listNamespaces()).filter((item) => item.value !== "all");
      setRefreshedNamespaces(nextNamespaces);
      if (!nextNamespaces.some((item) => item.value === form.namespace)) {
        setForm({ ...form, namespace: nextNamespaces[0]?.value || "default" });
      }
    } catch (err) {
      setNamespaceError(err instanceof Error ? err.message : "命名空间刷新失败");
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <CreateField label="工作负载名称" required error={errors.name}>
          <Input id="workload-name" value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); clearError("name"); }} placeholder="例如: nginx-deployment" aria-invalid={Boolean(errors.name)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
        <CreateField label="别名">
          <Input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="显示名称（可选）" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CreateField label="命名空间" required error={errors.namespace}>
          <div className="flex gap-2">
            <select id="workload-namespace" value={form.namespace} onChange={(event) => { setForm({ ...form, namespace: event.target.value }); clearError("namespace"); }} aria-invalid={Boolean(errors.namespace)} className="blueedge-native-select h-10 flex-1 rounded-[10px] border-2 text-sm">
              <option value="">请选择命名空间</option>
              {namespaceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" onClick={() => void refreshNamespaces()} disabled={refreshingNamespaces} className="action-button h-10 w-10" title="刷新命名空间"><RefreshCw className={cn("h-[15px] w-[15px]", refreshingNamespaces && "animate-spin")} /></button>
          </div>
          {namespaceError && <p className="mt-1 text-xs text-[var(--color-danger)]">{namespaceError}</p>}
        </CreateField>
        <CreateField label="实例数" required error={errors.replicas}>
          <Input id="workload-replicas" type="number" min={1} value={form.replicas} onChange={(event) => { setForm({ ...form, replicas: event.target.value }); clearError("replicas"); }} aria-invalid={Boolean(errors.replicas)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
      </div>
      <CreateField label="描述">
        <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="工作负载用途描述（可选）" className="h-[120px] min-h-[120px] rounded-[10px] border-2 border-[#e2e8f0] px-3 py-2 text-sm shadow-sm focus-visible:ring-0" />
      </CreateField>
    </div>
  );
}

function ContainerStep({ containers, setContainers, activeIndex, setActiveIndex, errors, clearError }: {
  containers: ContainerDraft[];
  setContainers: (containers: ContainerDraft[]) => void;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  errors: Record<string, string>;
  clearError: (field: string) => void;
}) {
  const container = containers[activeIndex] || containers[0];

  const updateContainer = (patch: Partial<ContainerDraft>) => {
    setContainers(containers.map((item, index) => index === activeIndex ? { ...item, ...patch } : item));
  };

  const addContainer = () => {
    const nextContainer = createContainerDraft(containers.length);
    setContainers([...containers, nextContainer]);
    setActiveIndex(containers.length);
  };

  const removeContainer = (indexToRemove: number) => {
    if (containers.length <= 1) return;
    const nextContainers = containers.filter((_, index) => index !== indexToRemove);
    setContainers(nextContainers);
    setActiveIndex(Math.min(activeIndex, nextContainers.length - 1));
  };

  const updateEnv = (envId: string, patch: Partial<KeyValueDraft>) => {
    updateContainer({ envs: container.envs.map((env) => env.id === envId ? { ...env, ...patch } : env) });
  };

  const addEnv = () => {
    updateContainer({ envs: [...container.envs, { id: `env-${Date.now()}`, key: "", value: "" }] });
  };

  const removeEnv = (envId: string) => {
    updateContainer({ envs: container.envs.filter((env) => env.id !== envId) });
  };

  const updateVolume = (volumeId: string, patch: Partial<VolumeDraft>) => {
    updateContainer({ volumes: container.volumes.map((volume) => volume.id === volumeId ? { ...volume, ...patch } : volume) });
  };

  const addVolume = () => {
    updateContainer({ volumes: [...container.volumes, { id: `volume-${Date.now()}`, name: "", type: "emptyDir", mountPath: "", source: "" }] });
  };

  const removeVolume = (volumeId: string) => {
    updateContainer({ volumes: container.volumes.filter((volume) => volume.id !== volumeId) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {containers.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={cn("inline-flex items-center gap-2 rounded-[10px] border px-4 py-2 text-sm font-semibold", index === activeIndex ? "border-[1.5px] border-[#1a73e8] bg-[#f0f6ff] text-[#1a73e8]" : "border-[#e5e7eb] bg-white text-[#374151]")}
          >
            <Box className="h-3.5 w-3.5" />
            {`容器 ${index + 1}`}
            {containers.length > 1 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  removeContainer(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    removeContainer(index);
                  }
                }}
                className="ml-1 rounded p-0.5 hover:bg-white/70 hover:text-[#ef4444]"
                title="删除容器"
              >
                <Trash2 className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <button type="button" onClick={addContainer} className="inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[#d1d5db] px-3 py-2 text-sm font-medium text-[#6b7280] hover:bg-[#f9fafb]"><Plus className="h-3.5 w-3.5" />添加容器</button>
      </div>
      <Accordion title="基本信息" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="容器名称" required error={errors.containerName} compact>
              <Input id="workload-container-name" value={container.name} onChange={(event) => { updateContainer({ name: event.target.value }); clearError("containerName"); }} placeholder="container-1" aria-invalid={Boolean(errors.containerName)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="容器镜像" required error={errors.image} compact>
              <Input id="workload-container-image" value={container.image} onChange={(event) => { updateContainer({ image: event.target.value }); clearError("image"); }} placeholder="nginx:1.21" aria-invalid={Boolean(errors.image)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="镜像拉取策略" compact>
              <select value={container.pullPolicy} onChange={(event) => updateContainer({ pullPolicy: event.target.value as WorkloadForm["pullPolicy"] })} className="blueedge-native-select h-10 rounded-[10px] border-2 text-sm">
                <option value="IfNotPresent">IfNotPresent</option>
                <option value="Always">Always</option>
                <option value="Never">Never</option>
              </select>
            </CreateField>
            <label className="flex items-end gap-2 pb-2 text-sm text-[#111827]">
              <input type="checkbox" checked={container.privileged} onChange={(event) => updateContainer({ privileged: event.target.checked })} className="h-4 w-4 rounded border-[#d1d5db]" />
              特权容器
            </label>
          </div>
        </div>
      </Accordion>
      <Accordion title="资源配置" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="CPU 请求 (request)" compact>
              <Input value={container.cpuRequest} onChange={(event) => updateContainer({ cpuRequest: event.target.value })} placeholder="100m" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="CPU 限制 (limit)" compact>
              <Input value={container.cpuLimit} onChange={(event) => updateContainer({ cpuLimit: event.target.value })} placeholder="1000m 或 1" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="内存请求 (request)" compact>
              <Input value={container.memoryRequest} onChange={(event) => updateContainer({ memoryRequest: event.target.value })} placeholder="128Mi" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="内存限制 (limit)" compact>
              <Input value={container.memoryLimit} onChange={(event) => updateContainer({ memoryLimit: event.target.value })} placeholder="512Mi" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
          </div>
        </div>
      </Accordion>
      <Accordion title="生命周期">
        <div className="space-y-3">
          <CreateField label="启动后执行 (Post Start)" compact>
            <Input value={container.lifecyclePostStart} onChange={(event) => updateContainer({ lifecyclePostStart: event.target.value })} placeholder="/bin/sh -c 'echo started'" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          </CreateField>
          <CreateField label="停止前执行 (Pre Stop)" compact>
            <Input value={container.lifecyclePreStop} onChange={(event) => updateContainer({ lifecyclePreStop: event.target.value })} placeholder="/bin/sh -c 'sleep 5'" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          </CreateField>
        </div>
      </Accordion>
      <Accordion title="健康检查">
        <div className="divide-y divide-[#eef2f7]">
          <ProbeToggle label="启用启动探针 (Startup)" checked={container.startupProbe} onChange={(checked) => updateContainer({ startupProbe: checked })} />
          <ProbeToggle label="启用就绪探针 (Readiness)" checked={container.readinessProbe} onChange={(checked) => updateContainer({ readinessProbe: checked })} />
          <ProbeToggle label="启用存活探针 (Liveness)" checked={container.livenessProbe} onChange={(checked) => updateContainer({ livenessProbe: checked })} />
        </div>
      </Accordion>
      <Accordion title="环境变量">
        <div className="space-y-3">
          {container.envs.map((env) => (
            <div key={env.id} className="grid grid-cols-[1fr_1fr_40px] gap-2">
              <Input value={env.key} onChange={(event) => updateEnv(env.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
              <Input value={env.value} onChange={(event) => updateEnv(env.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
              <button type="button" onClick={() => removeEnv(env.id)} className="action-button h-10 w-10 text-[#64748b]" title="删除变量"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addEnv} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
            <Plus className="h-4 w-4" />
            添加
          </button>
        </div>
      </Accordion>
      <Accordion title="数据存储">
        <div className="space-y-4">
          {container.volumes.length === 0 && <p className="text-xs text-[var(--color-text-tertiary)]">暂无挂载卷，点击下方按钮添加。</p>}
          {container.volumes.map((volume, index) => (
            <div key={volume.id} className="space-y-3 rounded-xl border border-[#e5e7eb] bg-[#fafbfc] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#111827]">卷 #{index + 1}</span>
                <button type="button" onClick={() => removeVolume(volume.id)} className="action-button h-9 w-9 text-[#64748b]" title="删除卷"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input value={volume.name} onChange={(event) => updateVolume(volume.id, { name: event.target.value })} placeholder="卷名称" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <select value={volume.type} onChange={(event) => updateVolume(volume.id, { type: event.target.value as VolumeDraft["type"] })} className="blueedge-native-select h-10 rounded-[10px] border-2 text-sm">
                  <option value="emptyDir">emptyDir</option>
                  <option value="hostPath">hostPath</option>
                  <option value="configMap">configMap</option>
                  <option value="secret">secret</option>
                </select>
                <Input value={volume.mountPath} onChange={(event) => updateVolume(volume.id, { mountPath: event.target.value })} placeholder="挂载路径" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <Input value={volume.source} onChange={(event) => updateVolume(volume.id, { source: event.target.value })} placeholder="源" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addVolume} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
            <Plus className="h-4 w-4" />
            添加卷
          </button>
        </div>
      </Accordion>
      <Accordion title="安全配置">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="RunAsUser" compact>
              <Input value={container.runAsUser} onChange={(event) => updateContainer({ runAsUser: event.target.value })} placeholder="1000" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="RunAsGroup" compact>
              <Input value={container.runAsGroup} onChange={(event) => updateContainer({ runAsGroup: event.target.value })} placeholder="1000" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#111827]">
            <input type="checkbox" checked={container.readOnlyRootFilesystem} onChange={(event) => updateContainer({ readOnlyRootFilesystem: event.target.checked })} className="h-4 w-4 rounded border-[#d1d5db]" />
            只读根文件系统
          </label>
          <label className="flex items-center gap-2 text-sm text-[#111827]">
            <input type="checkbox" checked={container.allowPrivilegeEscalation} onChange={(event) => updateContainer({ allowPrivilegeEscalation: event.target.checked })} className="h-4 w-4 rounded border-[#d1d5db]" />
            允许特权提升
          </label>
        </div>
      </Accordion>
    </div>
  );
}

function ProbeToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-14 items-center gap-3 text-sm text-[#111827]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-[#9ca3af]" />
      {label}
    </label>
  );
}

function AdvancedStep({ form, setForm, edgeNodes, nodeLoadError, schedulingError, initialTab = 0 }: { form: WorkloadForm; setForm: (form: WorkloadForm) => void; edgeNodes: EdgeNodeView[]; nodeLoadError: string; schedulingError: string; initialTab?: number }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const parseDrafts = (source: string, prefix: string) => source.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const separator = line.indexOf("=");
    return { id: `${prefix}-${index}`, key: separator >= 0 ? line.slice(0, separator) : line, value: separator >= 0 ? line.slice(separator + 1) : "" };
  });
  const [labels, setLabels] = useState<KeyValueDraft[]>(() => parseDrafts(form.workloadLabels, "label"));
  const [annotations, setAnnotations] = useState<KeyValueDraft[]>(() => parseDrafts(form.workloadAnnotations, "annotation"));
  const tabs = ["节点调度", "标签与注解", "访问配置", "升级策略"];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-[#f4f5f7] p-1">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(index)}
            className="flex-1 rounded-md py-1.5 text-sm font-semibold transition-all"
            style={{ background: activeTab === index ? "#fff" : "transparent", color: activeTab === index ? "#1a73e8" : "#6b7280", boxShadow: activeTab === index ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}
          >
            {tab}
          </button>
        ))}
      </div>
      {activeTab === 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-[#111827]">调度策略</h3>
          {schedulingError && <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{schedulingError}</p>}
          <div className="grid grid-cols-2 gap-2">
          {([
            ["all", "自动调度到边缘节点"],
            ["nodeSelector", "节点标签选择"],
            ["nodeName", "指定边缘节点"],
            ["podAntiAffinity", "Pod反亲和性"],
          ] as const).map(([value, title]) => (
            <button key={value} type="button" onClick={() => setForm({ ...form, schedulingMode: value })} className={cn("flex items-center gap-2 rounded-lg border p-3 text-left text-sm text-[#111827]", form.schedulingMode === value ? "border-[#1a73e8] bg-[#f0f6ff]" : "border-[#e5e7eb] bg-white")}>
              <span className={cn("h-3.5 w-3.5 rounded-full border", form.schedulingMode === value ? "border-[5px] border-[#1a73e8]" : "border-[#9ca3af]")} />
              {title}
            </button>
          ))}
        </div>
        {form.schedulingMode === "nodeSelector" && (
          <div className="space-y-3 pt-1">
            <h3 className="text-sm font-medium text-[#111827]">节点标签选择器</h3>
            {form.nodeSelectors.map((selector) => (
              <div key={selector.id} className="grid grid-cols-[1fr_1fr_40px] gap-2">
                <Input
                  value={selector.key}
                  onChange={(event) => setForm({
                    ...form,
                    nodeSelectors: form.nodeSelectors.map((item) => item.id === selector.id ? { ...item, key: event.target.value } : item),
                  })}
                  className="h-11 rounded-xl border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0"
                  placeholder="键"
                />
                <Input
                  value={selector.value}
                  onChange={(event) => setForm({
                    ...form,
                    nodeSelectors: form.nodeSelectors.map((item) => item.id === selector.id ? { ...item, value: event.target.value } : item),
                  })}
                  className="h-11 rounded-xl border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0"
                  placeholder="值"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, nodeSelectors: form.nodeSelectors.filter((item) => item.id !== selector.id) })}
                  className="action-button h-11 w-10 text-[#64748b]"
                  title="删除节点标签"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm({
                ...form,
                nodeSelectors: [...form.nodeSelectors, { id: `node-selector-${Date.now()}`, key: "", value: "" }],
              })}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#374151] hover:text-[#1a73e8]"
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          </div>
        )}
        {form.schedulingMode === "nodeName" && (
          <div className="space-y-2 pt-1">
            <h3 className="text-sm font-medium text-[#111827]">选择边缘节点</h3>
            <select value={form.nodeSelectorValue} onChange={(event) => setForm({ ...form, nodeSelectorValue: event.target.value })} className="blueedge-native-select h-11 w-full rounded-xl border border-[#e2e8f0] px-3 text-sm">
              <option value="">请选择边缘节点</option>
              {edgeNodes.map((node) => <option key={node.name} value={node.name}>{node.name}（{node.status}）</option>)}
            </select>
            {nodeLoadError && <p className="text-xs text-[#dc2626]">{nodeLoadError}</p>}
            {!nodeLoadError && edgeNodes.length === 0 && <p className="text-xs text-[var(--color-text-tertiary)]">当前集群没有识别到边缘节点</p>}
          </div>
        )}
        </section>
      )}
      {activeTab === 1 && (
        <section className="space-y-5">
          <KeyValueEditor
            title="标签 (Labels)"
            items={labels}
            onChange={(items) => {
              setLabels(items);
              setForm({ ...form, workloadLabels: items.filter((item) => item.key.trim()).map((item) => `${item.key.trim()}=${item.value}`).join("\n") });
            }}
            addLabel="添加"
          />
          <KeyValueEditor
            title="注解 (Annotations)"
            items={annotations}
            onChange={(items) => {
              setAnnotations(items);
              setForm({ ...form, workloadAnnotations: items.filter((item) => item.key.trim()).map((item) => `${item.key.trim()}=${item.value}`).join("\n") });
            }}
            addLabel="添加"
          />
        </section>
      )}
      {activeTab === 2 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-[#111827]">网络模式</h3>
          <div className="flex flex-wrap gap-5">
            {([
              ["none", "无"],
              ["portMapping", "端口映射"],
              ["hostNetwork", "Host 网络"],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-[#111827]">
                <input type="radio" checked={form.networkType === value} onChange={() => setForm({ ...form, networkType: value })} className="h-4 w-4" />
                {label}
              </label>
            ))}
          </div>
          {form.networkType === "portMapping" && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <CreateField label="容器端口" compact>
                <Input value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} placeholder="80" className="h-10 rounded-[10px]" />
              </CreateField>
              <CreateField label="服务端口" compact>
                <Input placeholder="30080" className="h-10 rounded-[10px]" />
              </CreateField>
            </div>
          )}
        </section>
      )}
      {activeTab === 3 && <section className="space-y-3">
        <h3 className="text-sm font-medium text-[#111827]">升级策略</h3>
        <div className="flex gap-5">
          {([
            ["RollingUpdate", "滚动更新"],
            ["Recreate", "重建"],
          ] as const).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-[#111827]">
              <input type="radio" checked={form.strategy === value} onChange={() => setForm({ ...form, strategy: value })} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
        {form.strategy === "RollingUpdate" && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <CreateField label="最大峰值 (Max Surge)" compact>
              <Input value={form.maxSurge} onChange={(event) => setForm({ ...form, maxSurge: event.target.value })} className="h-10 rounded-[10px]" />
            </CreateField>
            <CreateField label="最大不可用 (Max Unavailable)" compact>
              <Input value={form.maxUnavailable} onChange={(event) => setForm({ ...form, maxUnavailable: event.target.value })} className="h-10 rounded-[10px]" />
            </CreateField>
            <CreateField label="分区 (Partition)" compact>
              <Input value={form.partition} onChange={(event) => setForm({ ...form, partition: event.target.value })} className="h-10 rounded-[10px]" />
            </CreateField>
            <CreateField label="超时时间 (秒)" compact>
              <Input value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} className="h-10 rounded-[10px]" />
            </CreateField>
          </div>
        )}
      </section>}
    </div>
  );
}

function KeyValueEditor({ title, items, onChange, addLabel }: { title: string; items: KeyValueDraft[]; onChange: (items: KeyValueDraft[]) => void; addLabel: string }) {
  const update = (id: string, patch: Partial<KeyValueDraft>) => {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const add = () => {
    onChange([...items, { id: `${title}-${Date.now()}`, key: "", value: "" }]);
  };

  const remove = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[#111827]">{title}</h3>
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[1fr_1fr_40px] gap-2">
          <Input value={item.key} onChange={(event) => update(item.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          <Input value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          <button type="button" onClick={() => remove(item.id)} className="action-button h-10 w-10 text-[#64748b]" title="删除"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
        <Plus className="h-4 w-4" />
        {addLabel}
      </button>
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-12 w-full items-center justify-between bg-[#fafbfc] px-4 text-left text-sm font-semibold text-[#111827]">
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-[#9ca3af]" /> : <ChevronDown className="h-4 w-4 text-[#9ca3af]" />}
      </button>
      {open && children && <div className="border-t border-[#eef2f7] p-4">{children}</div>}
    </div>
  );
}

function CreateField({ label, required, error, children, compact = false }: { label: string; required?: boolean; error?: string; children: ReactNode; compact?: boolean }) {
  return (
    <div>
      <Label className={cn("block font-medium text-[#111827]", compact ? "mb-1 text-xs text-[var(--color-text-secondary)]" : "mb-1.5 text-sm")}>
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

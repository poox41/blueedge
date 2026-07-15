import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNamespace } from "@/contexts/NamespaceContext";
import type { ReactNode } from "react";
import yaml from "js-yaml";
import {
  Activity,
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  FileText,
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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  createDeploymentResource,
  deleteDeploymentResource,
  getDeployment,
  listDeployments,
  listNamespaces,
  listPods,
  updateDeploymentResource,
} from "@/api/services/resources";
import {
  executeDeploymentCommand,
  getDeploymentAudit,
  getResourceLogs,
  getResourceObservability,
  listDeploymentRevisions,
  rollbackDeploymentRevision,
  runDeploymentAction,
} from "@/api/services/product";
import type { DeploymentAuditRecord, DeploymentRevision } from "@/api/services/product";
import type { ObservabilityEvent, ObservabilitySummary } from "@/api/adapters/observability.adapter";
import type { KubeResource, WorkloadView } from "@/types/kubeedge";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";

type WorkloadStatus = "运行中" | "未就绪" | "异常";

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
  readyContainers: number;
  totalContainers: number;
  podIP: string;
  nodeName: string;
  restartCount: number;
  cpu: string;
  memory: string;
};

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
  schedulingMode: "all",
  nodeSelectors: [{ id: "node-selector-1", key: "", value: "" }],
  nodeSelectorValue: "",
  workloadLabels: "app=my-app",
  podLabels: "app=my-app",
  networkType: "none",
  strategy: "RollingUpdate",
  maxSurge: "25%",
  maxUnavailable: "25%",
  partition: "0",
  timeoutSeconds: "600",
};

const statusConfig: Record<WorkloadStatus, { className: string; dot: string }> = {
  运行中: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  未就绪: { className: "bg-[#fff7ed] text-[#f59e0b]", dot: "#f59e0b" },
  异常: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ef4444" },
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

const deploymentPodRows = (pods: unknown[], item: Workload): DeploymentPodRow[] => {
  const deploymentSpec = asRecord(item.raw?.spec);
  const selector = asStringRecord(asRecord(deploymentSpec.selector).matchLabels);
  return pods.flatMap((pod) => {
    const resource = asRecord(pod);
    const metadata = asRecord(resource.metadata);
    const podLabels = asStringRecord(metadata.labels);
    const ownerReferences = asRecordArray(metadata.ownerReferences);
    const selectorMatches = Object.keys(selector).length > 0 && Object.entries(selector).every(([key, value]) => podLabels[key] === value);
    const ownerMatches = ownerReferences.some((owner) => String(owner.kind || "") === "ReplicaSet" && String(owner.name || "").startsWith(`${item.name}-`));
    if (!selectorMatches && !ownerMatches) return [];
    const spec = asRecord(resource.spec);
    const status = asRecord(resource.status);
    const containerSpecs = asRecordArray(spec.containers);
    const containerStatuses = asRecordArray(status.containerStatuses);
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
      status: String(status.phase || "未知"),
      readyContainers: containerStatuses.filter((entry) => entry.ready === true).length,
      totalContainers: containerSpecs.length,
      podIP: String(status.podIP || "未配置"),
      nodeName: String(spec.nodeName || "未配置"),
      restartCount: containerStatuses.reduce((sum, entry) => sum + Number(entry.restartCount || 0), 0),
      cpu: resourceText("cpu"),
      memory: resourceText("memory"),
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
  const failed = conditions.some((item) => item?.status === "False" && ["Available", "Progressing"].includes(item?.type));
  return failed ? "异常" : "未就绪";
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
    app: name,
    ...parseKeyValueText(form.workloadLabels),
  };
  const podLabels = {
    ...workloadLabels,
    ...parseKeyValueText(form.podLabels),
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
  if (form.schedulingMode === "nodeSelector") {
    const nodeSelector = draftListToRecord(form.nodeSelectors);
    if (Object.keys(nodeSelector).length > 0) podSpec.nodeSelector = nodeSelector;
  }
  if (form.schedulingMode === "nodeName" && form.nodeSelectorValue.trim()) {
    podSpec.nodeName = form.nodeSelectorValue.trim();
  }

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace,
      labels: workloadLabels,
      annotations: {
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

export function Deployments() {
  const { selectedNamespace } = useNamespace();
  const [items, setItems] = useState<Workload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [yamlOpen, setYamlOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
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
      const rows = await listDeployments(selectedNamespace === "all" ? undefined : selectedNamespace);
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
  }, [selectedNamespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => [item.name, item.alias, item.namespace, item.image].some((value) => value.toLowerCase().includes(keyword)));
  }, [items, search]);

  const createFromForm = async (form: WorkloadForm) => {
    setIsLoading(true);
    setError("");
    try {
      await createDeploymentResource(buildDeploymentResource(form));
      setWizardOpen(false);
      await loadData();
      showToast("工作负载创建成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作负载失败");
    } finally {
      setIsLoading(false);
    }
  };

  const createFromYaml = async (source: string) => {
    setIsLoading(true);
    setError("");
    try {
      await createDeploymentResource(ensureDeploymentResource(source));
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
      await updateDeploymentResource(item.namespace, resource);
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
      await updateDeploymentResource(item.namespace, resource);
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
      await updateDeploymentResource(item.namespace, resource);
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
          onDelete={() => setDeleteTarget(selectedWorkload)}
          onReload={() => reloadWorkload(selectedWorkload)}
        />
        <WorkloadActionModal
          panel={actionPanel}
          onClose={() => setActionPanel(null)}
          onUpdate={updateFromForm}
          onYamlUpdate={updateFromYaml}
          onMetadataUpdate={updateFromMetadata}
          onReload={reloadWorkload}
        />
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">确认删除工作负载？</AlertDialogTitle>
              <AlertDialogDescription className="text-sm">
                即将删除工作负载 <span className="font-medium text-[var(--color-text-primary)]">{deleteTarget?.name}</span>，此操作不可恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
              <AlertDialogAction className="h-8 bg-[var(--color-danger)] text-sm hover:bg-[var(--color-danger)]/90" onClick={confirmDelete}>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ToastNotice message={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  return (
    <div className="blueedge-page space-y-5">
      <ToastNotice message={toast} onClose={() => setToast(null)} />

      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">工作负载</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">管理边缘应用部署</p>
      </section>

      <section className="page-toolbar">
        <div className="relative w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入工作负载名称搜索"
            className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-9 text-sm shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void loadData()} className="h-10 rounded-xl border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#111827] shadow-sm hover:bg-[#f8fafc]">
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            {isLoading ? "刷新中" : "刷新"}
          </Button>
          <Button variant="outline" onClick={() => setYamlOpen(true)} className="h-10 rounded-xl bg-white px-5 text-sm font-semibold">
            YAML 创建
          </Button>
          <Button onClick={() => setWizardOpen(true)} className="h-10 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033]">
            <Plus className="h-4 w-4" />
            镜像创建
          </Button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">
          {error}
        </div>
      )}

      <section className="table-card overflow-visible">
        <Table className="[&_td:last-child]:overflow-visible">
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="w-[15%] px-5 text-xs text-[var(--color-text-tertiary)]">工作负载名称</TableHead>
              <TableHead className="w-[14%] px-5 text-xs text-[var(--color-text-tertiary)]">工作负载别名</TableHead>
              <TableHead className="w-[9%] px-5 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="w-[8%] px-5 text-xs text-[var(--color-text-tertiary)]">命名空间</TableHead>
              <TableHead className="w-[7%] px-5 text-xs text-[var(--color-text-tertiary)]">容器组</TableHead>
              <TableHead className="w-[18%] px-5 text-xs text-[var(--color-text-tertiary)]">镜像</TableHead>
              <TableHead className="w-[16%] px-5 text-xs text-[var(--color-text-tertiary)]">创建时间</TableHead>
              <TableHead className="w-[13%] min-w-[150px] px-5 text-right text-xs text-[var(--color-text-tertiary)]">操作</TableHead>
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
              filtered.map((item) => (
                <TableRow key={item.id} className="h-[72px] hover:bg-[var(--color-bg-hover)]">
                  <TableCell className="px-5">
                    <button type="button" onClick={() => setSelectedWorkload(item)} className="text-left text-sm font-semibold text-[#1e6bff] hover:underline">
                      {item.name}
                    </button>
                  </TableCell>
                  <TableCell className="px-5 text-sm text-[var(--color-text-secondary)]">{item.alias || "-"}</TableCell>
                  <TableCell className="px-5"><StatusPill status={item.status} /></TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">{item.namespace}</TableCell>
                  <TableCell className="px-5"><PodCount ready={item.readyReplicas} total={item.replicas} /></TableCell>
                  <TableCell className="px-5"><ImageChip image={item.image} /></TableCell>
                  <TableCell className="px-5 text-sm text-[var(--color-text-tertiary)]">{item.createTime}</TableCell>
                  <TableCell className="overflow-visible px-5 text-right">
                    <WorkloadRowActions
                      open={menuOpenId === item.id}
                      onOpenChange={(open) => setMenuOpenId(open ? item.id : null)}
                      onView={() => setSelectedWorkload(item)}
                      onRefresh={() => void loadData()}
                      refreshing={isLoading}
                      onDelete={() => setDeleteTarget(item)}
                      onAction={(action) => handleMenuAction(action, item)}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <YamlCreateModal open={yamlOpen} defaultValue={defaultYaml} onSubmit={createFromYaml} onCancel={() => setYamlOpen(false)} />
      <CreateWorkloadWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreate={createFromForm} />
      <WorkloadActionModal
        panel={actionPanel}
        onClose={() => setActionPanel(null)}
        onUpdate={updateFromForm}
        onYamlUpdate={updateFromYaml}
        onMetadataUpdate={updateFromMetadata}
        onReload={reloadWorkload}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除工作负载？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除工作负载 <span className="font-medium text-[var(--color-text-primary)]">{deleteTarget?.name}</span>，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 bg-[var(--color-danger)] text-sm hover:bg-[var(--color-danger)]/90" onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusPill({ status }: { status: WorkloadStatus }) {
  const style = statusConfig[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", style.className)}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {status}
    </span>
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
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#3b82f6] text-xs font-semibold text-[#3b82f6]">i</span>
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
  onRefresh,
  refreshing,
  onDelete,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onDelete: () => void;
  onAction: (action: WorkloadMenuAction) => void;
}) {
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const toggleMenu = () => {
    if (!open && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      const menuWidth = 196;
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
        <button type="button" className="action-button" title="刷新" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        <button ref={moreButtonRef} type="button" className="action-button" title="更多" onClick={toggleMenu}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-[70] cursor-default" onClick={() => onOpenChange(false)} />
          <div
            className="fixed z-[90] overflow-hidden rounded-2xl border border-[#eef2f7] bg-white py-1.5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
            style={{ top: menuPosition.top, left: menuPosition.left, width: 196 }}
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
        </>
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
        danger ? "text-[#ef4444]" : "text-[#334155]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className={cn("mr-2 flex w-4 shrink-0 items-center justify-center", danger ? "text-[#ef4444]" : "text-[#94a3b8]")}>{icon}</span>
      <span className="shrink-0">{label}</span>
      {suffix && <span className="ml-auto text-[#94a3b8]">{suffix}</span>}
    </button>
  );
}

function WorkloadDetailPage({
  item,
  onBack,
  onAction,
  onDelete,
  onReload,
}: {
  item: Workload;
  onBack: () => void;
  onAction: (action: WorkloadMenuAction) => void;
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
  const [podsLoading, setPodsLoading] = useState(false);
  const [podsError, setPodsError] = useState("");
  const podsRequestId = useRef(0);
  const eventsRequestId = useRef(0);
  const yaml = buildWorkloadYaml(item);
  const strategy = configuredValue(asRecord(item.raw?.spec).strategy && asRecord(asRecord(item.raw?.spec).strategy).type);

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

  const loadDeploymentPods = useCallback(async () => {
    const requestId = ++podsRequestId.current;
    setPodsLoading(true);
    setPodsError("");
    try {
      const result = await listPods(item.namespace);
      if (requestId === podsRequestId.current) setPods(deploymentPodRows(result, item));
    } catch (err) {
      if (requestId === podsRequestId.current) setPodsError(err instanceof Error ? err.message : "加载关联 Pod 失败");
    } finally {
      if (requestId === podsRequestId.current) setPodsLoading(false);
    }
  }, [item]);

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
    <div className="blueedge-page space-y-5">
      <section className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} className="action-button mt-0.5 h-10 w-10">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-[#111827]">{item.name}</h1>
              <StatusPill status={item.status} />
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.namespace} · {item.image}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onAction("yaml")} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">
            编辑 YAML
          </button>
          <button type="button" onClick={() => onAction("update")} className="h-10 rounded-xl bg-[#0f172a] px-4 text-sm font-semibold text-white hover:bg-[#172033]">
            编辑
          </button>
          <button type="button" onClick={() => onAction("logs")} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">日志</button>
          <button type="button" onClick={() => onAction("console")} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">控制台</button>
          <button type="button" onClick={() => onAction("monitor")} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">监控</button>
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
        <h2 className="mb-6 text-base font-semibold text-[#111827]">基本信息</h2>
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
                <StatusPill status={item.status} />
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
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold",
              activeTab === tab.id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#dfe5ee] bg-white text-[#64748b] hover:bg-[#f8fafc]",
              tab.disabled && "cursor-not-allowed opacity-50 hover:bg-white",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "pods" && (
        <section className="rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#111827]">关联 Pod</h2>
            <button type="button" onClick={() => void loadDeploymentPods()} disabled={podsLoading} className="detail-action-button" title="刷新关联 Pod">
              <RefreshCw className={cn("h-4 w-4", podsLoading && "animate-spin")} />
            </button>
          </div>
          {podsError && <div className="mb-3 rounded-lg border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{podsError}</div>}
          <Table>
            <TableHeader><TableRow><TableHead>名称</TableHead><TableHead>状态</TableHead><TableHead>容器</TableHead><TableHead>Pod IP</TableHead><TableHead>节点</TableHead><TableHead>重启</TableHead><TableHead>CPU 请求/限制</TableHead><TableHead>内存请求/限制</TableHead></TableRow></TableHeader>
            <TableBody>
              {pods.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">{podsLoading ? "正在加载关联 Pod..." : "暂无关联 Pod"}</TableCell></TableRow> : pods.map((pod) => (
                <TableRow key={pod.name}><TableCell className="font-semibold text-[#1e6bff]">{pod.name}</TableCell><TableCell>{pod.status}</TableCell><TableCell>{pod.readyContainers}/{pod.totalContainers}</TableCell><TableCell>{pod.podIP}</TableCell><TableCell>{pod.nodeName}</TableCell><TableCell>{pod.restartCount}</TableCell><TableCell>{pod.cpu}</TableCell><TableCell>{pod.memory}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
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
  onReload: () => Promise<void>;
}) {
  const template = asRecord(asRecord(item.raw?.spec).template);
  const templateMetadata = asRecord(template.metadata);
  const podSpec = asRecord(template.spec);
  const containers = asRecordArray(podSpec.containers);
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
          <button type="button" onClick={() => onAction("update")} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"><Pencil className="h-4 w-4" />编辑</button>
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
      <DetailPanel title="节点调度" action={<button type="button" onClick={() => onAction("yaml")} className="detail-action-button"><Pencil className="mr-1 h-4 w-4" />编辑</button>}>
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
      <DetailPanel title="标签与注解" action={<button type="button" onClick={() => onAction("labels")} className="detail-action-button">编辑标签与注解</button>}>
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
      <DetailPanel title="访问配置" action={<button type="button" onClick={() => onAction("yaml")} className="detail-action-button"><Pencil className="mr-1 h-4 w-4" />编辑</button>}>
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
    <DetailPanel title="YAML" action={<button type="button" onClick={() => onAction("yaml")} className="detail-action-button">编辑 YAML</button>}>
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
        <button type="button" onClick={() => void onRefresh()} disabled={loading} className="detail-action-button"><RefreshCw className={cn("mr-1 h-4 w-4", loading && "animate-spin")} />刷新</button>
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
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
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
    if (!window.confirm(`确认将 ${item.name} 回退到 Revision ${revision}？这会真实更新集群中的 Deployment。`)) return;
    setRollingBack(revision);
    setError("");
    try {
      await rollbackDeploymentRevision(item.namespace, item.name, revision);
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
            <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-lg bg-[#dbeafe] px-3 py-1 text-sm font-semibold text-[#2563eb]">Revision {revision.revision}</span>{revision.current && <span className="text-sm font-semibold text-[#16a34a]">当前版本</span>}</div><div className="flex gap-2"><button type="button" onClick={() => setSelectedRevision(selectedRevision === revision.revision ? null : revision.revision)} className="detail-action-button">{selectedRevision === revision.revision ? "收起 YAML" : "查看 YAML"}</button>{!revision.current && <button type="button" onClick={() => void rollback(revision.revision)} disabled={rollingBack !== null} className="h-9 rounded-xl bg-[#0f172a] px-4 text-sm font-semibold text-white disabled:bg-[#94a3b8]">{rollingBack === revision.revision ? "回退中..." : "回退到此版本"}</button>}</div></div>
            <div className="mt-4 grid grid-cols-4 gap-4 text-sm"><DetailInfoItem label="ReplicaSet" value={revision.replicaSetName} /><DetailInfoItem label="镜像" value={revision.images.join(", ") || "-"} /><DetailInfoItem label="副本" value={`${revision.availableReplicas}/${revision.replicas}`} /><DetailInfoItem label="创建时间" value={formatDateTime(revision.createdAt)} /></div>
            {selectedRevision === revision.revision && <pre className="mt-4 max-h-[360px] overflow-auto rounded-xl bg-[#111827] p-4 text-xs leading-6 text-[#d1d5db]">{yaml.dump(revision.yaml, { lineWidth: -1, noRefs: true })}</pre>}
          </div>
        ))}</div>
      )}
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
          <div key={key} className="grid grid-cols-[160px_1fr] gap-3 rounded-lg bg-white px-3 py-2 text-sm">
            <span className="font-mono text-[#64748b]">{key}</span>
            <span className="truncate font-mono text-[#111827]">{value}</span>
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
  const [output, setOutput] = useState("请选择运行中的 Pod 和容器，然后输入命令。\n命令会通过 Kubernetes Pod Exec 在真实集群中执行。");
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");

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
        const ownerMatches = owners.some((owner) => String(owner.kind || "") === "ReplicaSet" && String(owner.name || "").startsWith(`${item.name}-`));
        if (!selectorMatches && !ownerMatches) return [];
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
      setOutput(`$ ${result.command}\n${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.exitCode === null ? "" : `\n[exit ${result.exitCode}]`}`.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pod 命令执行失败");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[760px] rounded-[24px] p-0" showCloseButton={false}>
        <DialogHeader className="border-b border-[#eef2f7] px-7 py-5"><div className="flex items-center justify-between"><div><DialogTitle>打开控制台 {item.name}</DialogTitle><p className="mt-1 text-xs text-[#94a3b8]">真实 Kubernetes Pod Exec（单次命令执行）</p></div><button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button></div></DialogHeader>
        <div className="space-y-5 p-7">
          {error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <CreateField label="容器组"><select value={podName} disabled={loading} onChange={(event) => { const next = pods.find((pod) => pod.name === event.target.value); setPodName(event.target.value); setContainerName(next?.containers[0] || ""); }} className="h-11 w-full rounded-xl border border-[#dfe5ee] bg-white px-3 text-sm"><option value="">{loading ? "正在加载真实 Pod..." : "请选择 Pod"}</option>{pods.map((pod) => <option key={pod.name} value={pod.name}>{pod.name} ({pod.phase})</option>)}</select></CreateField>
            <CreateField label="容器"><select value={containerName} onChange={(event) => setContainerName(event.target.value)} className="h-11 w-full rounded-xl border border-[#dfe5ee] bg-white px-3 text-sm"><option value="">请选择容器</option>{(selectedPod?.containers || []).map((container) => <option key={container} value={container}>{container}</option>)}</select></CreateField>
          </div>
          <div className="rounded-2xl bg-[#0b1220] p-5">
            <pre className="min-h-[220px] max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#d1d5db]">{output}</pre>
            <div className="mt-4 flex gap-3 border-t border-[#1f2937] pt-4"><span className="pt-2 font-mono text-sm text-[#22c55e]">$</span><Input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void execute(); }} placeholder="例如：uname -a 或 ls -la /" className="h-10 border-[#334155] bg-[#111827] font-mono text-sm text-white placeholder:text-[#64748b]" /><button type="button" onClick={() => void execute()} disabled={executing || !podName || !containerName || !command.trim()} className="h-10 rounded-xl bg-white px-5 text-sm font-semibold text-[#0f172a] disabled:bg-[#64748b]">{executing ? "执行中" : "执行"}</button></div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadStatusDialog({ item, onClose, onReload }: { item: Workload; onClose: () => void; onReload: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState("");
  const execute = async (action: "start" | "stop" | "restart") => {
    const labels = { start: "启动", stop: "停止", restart: "重启" };
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
        <div className="space-y-5 p-6"><div className="grid grid-cols-3 gap-3"><DetailInfoItem label="名称" value={item.name} /><DetailInfoItem label="命名空间" value={item.namespace} /><DetailInfoItem label="副本" value={`${item.readyReplicas}/${item.replicas}`} /></div>{error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{error}</div>}<div className="grid grid-cols-3 gap-3"><button type="button" disabled={item.replicas > 0 || submitting !== null} onClick={() => void execute("start")} className="h-11 rounded-xl border border-[#dfe5ee] font-semibold disabled:opacity-40">启动</button><button type="button" disabled={item.replicas === 0 || submitting !== null} onClick={() => void execute("stop")} className="h-11 rounded-xl border border-[#dfe5ee] font-semibold disabled:opacity-40">停止</button><button type="button" disabled={item.replicas === 0 || submitting !== null} onClick={() => void execute("restart")} className="h-11 rounded-xl bg-[#0f172a] font-semibold text-white disabled:bg-[#94a3b8]">{submitting === "restart" ? "重启中..." : "重启"}</button></div><p className="text-xs leading-5 text-[#94a3b8]">停止会将 replicas 真实缩容为 0；启动会恢复停止前副本数；重启会更新 Pod 模板注解触发滚动重建。</p></div>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadLogsDrawer({ item, onClose }: { item: Workload; onClose: () => void }) {
  const [content, setContent] = useState("正在加载日志...");
  const [warning, setWarning] = useState("");
  const [podName, setPodName] = useState("");
  const [container, setContainer] = useState("");

  useEffect(() => {
    let cancelled = false;
    setContent("正在加载日志...");
    setWarning("");
    getResourceLogs("deployment", item.namespace, item.name, { tailLines: 200 })
      .then((res) => {
        if (cancelled) return;
        const first = res.item.pods.find((pod) => pod.available) || res.item.pods[0];
        setPodName(first?.podName || "");
        setContainer(first?.container || "");
        setContent(first?.content || "未找到关联 Pod 日志");
        setWarning((res.warnings || []).map((warning) => warning.message).join("；"));
      })
      .catch((err) => {
        if (!cancelled) setContent(err instanceof Error ? err.message : "加载日志失败");
      });
    return () => { cancelled = true; };
  }, [item.name, item.namespace]);

  return (
    <div className="fixed inset-0 z-[120]">
      <button type="button" aria-label="关闭日志" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-[520px] flex-col bg-white shadow-[-12px_0_32px_rgba(15,23,42,0.16)]">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#eef2f7] px-6">
          <h2 className="text-base font-semibold text-[#111827]">日志</h2>
          <button type="button" onClick={onClose} className="action-button"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-[#eef2f7] p-5 text-sm text-[var(--color-text-secondary)]">
          <div>Pod：{podName || "未找到关联 Pod"}</div>
          <div className="mt-1">Container：{container || "-"}</div>
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

function WorkloadMonitorDrawer({ item, onClose }: { item: Workload; onClose: () => void }) {
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
      const response = await getResourceObservability("deployment", item.namespace, item.name, {
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
      setError(err instanceof Error ? err.message : "加载工作负载监控失败");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [item.name, item.namespace]);

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
            <h2 className="text-lg font-semibold text-[#111827]">负载监控（{item.name}）</h2>
            <p className="mt-0.5 text-xs text-[#94a3b8]">{item.namespace} / {item.name}</p>
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
          ) : <DetailEmpty text={metrics?.reason || "监控指标当前不可用"} />}
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

function CreateWorkloadWizard({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (form: WorkloadForm) => void }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(defaultForm);
  const [containers, setContainers] = useState<ContainerDraft[]>([createContainerDraft(0)]);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

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
    setErrors(next);
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
    onCreate({
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
    });
    setStep(0);
    setForm(defaultForm);
    setContainers([createContainerDraft(0)]);
    setActiveContainerIndex(0);
    setErrors({});
    setTouched(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : close()}>
      <DialogContent className="!flex max-h-[min(800px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]" showCloseButton={false}>
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-6 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">创建工作负载</DialogTitle>
            <button type="button" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e7eb] text-[#64748b] hover:bg-[#f8fafc]">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </DialogHeader>

        <StepIndicator step={step} />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 0 && <BasicStep form={form} setForm={setForm} errors={errors} />}
          {step === 1 && (
            <ContainerStep
              containers={containers}
              setContainers={setContainers}
              activeIndex={activeContainerIndex}
              setActiveIndex={setActiveContainerIndex}
              errors={errors}
            />
          )}
          {step === 2 && <AdvancedStep form={form} setForm={setForm} />}
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
                <button type="button" onClick={next} disabled={!canGoNext} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033] disabled:cursor-not-allowed disabled:bg-[#9ca3af]">下一步</button>
              ) : (
                <button type="button" onClick={create} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">创建</button>
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

function BasicStep({ form, setForm, errors }: { form: WorkloadForm; setForm: (form: WorkloadForm) => void; errors: Record<string, string> }) {
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
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如: nginx-deployment" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
        <CreateField label="别名">
          <Input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="显示名称（可选）" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CreateField label="命名空间" required error={errors.namespace}>
          <div className="flex gap-2">
            <select value={form.namespace} onChange={(event) => setForm({ ...form, namespace: event.target.value })} className="blueedge-native-select h-10 flex-1 rounded-[10px] border-2 text-sm">
              <option value="">请选择命名空间</option>
              {namespaceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="button" onClick={() => void refreshNamespaces()} disabled={refreshingNamespaces} className="action-button h-10 w-10" title="刷新命名空间"><RefreshCw className={cn("h-[15px] w-[15px]", refreshingNamespaces && "animate-spin")} /></button>
          </div>
          {namespaceError && <p className="mt-1 text-xs text-[var(--color-danger)]">{namespaceError}</p>}
        </CreateField>
        <CreateField label="实例数" required error={errors.replicas}>
          <Input type="number" min={1} value={form.replicas} onChange={(event) => setForm({ ...form, replicas: event.target.value })} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        </CreateField>
      </div>
      <CreateField label="描述">
        <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="工作负载用途描述（可选）" className="h-[120px] min-h-[120px] rounded-[10px] border-2 border-[#e2e8f0] px-3 py-2 text-sm shadow-sm focus-visible:ring-0" />
      </CreateField>
    </div>
  );
}

function ContainerStep({ containers, setContainers, activeIndex, setActiveIndex, errors }: {
  containers: ContainerDraft[];
  setContainers: (containers: ContainerDraft[]) => void;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  errors: Record<string, string>;
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
              <Input value={container.name} onChange={(event) => updateContainer({ name: event.target.value })} placeholder="container-1" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="容器镜像" required error={errors.image} compact>
              <Input value={container.image} onChange={(event) => updateContainer({ image: event.target.value })} placeholder="nginx:1.21" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
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

function AdvancedStep({ form, setForm }: { form: WorkloadForm; setForm: (form: WorkloadForm) => void }) {
  const [activeTab, setActiveTab] = useState(0);
  const [labels, setLabels] = useState<KeyValueDraft[]>([{ id: `label-${Date.now()}`, key: "", value: "" }]);
  const [annotations, setAnnotations] = useState<KeyValueDraft[]>([{ id: `annotation-${Date.now()}`, key: "", value: "" }]);
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
          <div className="grid grid-cols-2 gap-2">
          {([
            ["all", "部署到全部节点"],
            ["nodeSelector", "节点标签选择"],
            ["nodeName", "节点亲和性"],
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
        </section>
      )}
      {activeTab === 1 && (
        <section className="space-y-5">
          <KeyValueEditor
            title="标签 (Labels)"
            items={labels}
            onChange={setLabels}
            addLabel="添加"
          />
          <KeyValueEditor
            title="注解 (Annotations)"
            items={annotations}
            onChange={setAnnotations}
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

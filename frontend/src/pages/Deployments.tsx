import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import yaml from "js-yaml";
import {
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
import {
  createDeploymentResource,
  deleteDeploymentResource,
  listDeployments,
  updateDeploymentResource,
} from "@/api/services/resources";
import { getResourceLogs, getResourceObservability } from "@/api/services/product";
import type { ObservabilityEvent } from "@/api/adapters/observability.adapter";
import type { KubeResource, WorkloadView } from "@/types/kubeedge";

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

type WorkloadMenuAction = "logs" | "yaml" | "update" | "status" | "labels";

type WorkloadActionPanel = {
  type: WorkloadMenuAction;
  item: Workload;
};

type WorkloadUpdateForm = {
  image: string;
  replicas: string;
};

type WorkloadDetailTab = "pods" | "containers" | "scheduling" | "labels" | "access" | "events" | "yaml";

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
  nodeSelectorKey: string;
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
  name: `container-${index + 1}`,
  image: "",
  pullPolicy: "IfNotPresent",
  cpuRequest: "100m",
  cpuLimit: "",
  memoryRequest: "128Mi",
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
  containerName: "main",
  image: "",
  pullPolicy: "IfNotPresent",
  cpuRequest: "100m",
  cpuLimit: "",
  memoryRequest: "128Mi",
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
  nodeSelectorKey: "edge-node",
  nodeSelectorValue: "riscv",
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
    createTime: workload.createdAt,
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
  if (form.schedulingMode === "nodeSelector" && form.nodeSelectorKey.trim()) {
    podSpec.nodeSelector = { [form.nodeSelectorKey.trim()]: form.nodeSelectorValue.trim() };
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

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listDeployments();
      setItems(rows.map(toWorkload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载工作负载失败");
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  if (selectedWorkload) {
    return (
      <>
        <WorkloadDetailPage
          item={selectedWorkload}
          onBack={() => setSelectedWorkload(null)}
          onAction={(action) => handleMenuAction(action, selectedWorkload)}
          onDelete={() => setDeleteTarget(selectedWorkload)}
          onToast={showToast}
        />
        <WorkloadActionModal
          panel={actionPanel}
          onClose={() => setActionPanel(null)}
          onToast={showToast}
          onUpdate={updateFromForm}
          onYamlUpdate={updateFromYaml}
          onMetadataUpdate={updateFromMetadata}
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
          <Button variant="outline" onClick={() => void loadData()} disabled={isLoading} className="h-10 rounded-xl bg-white px-4 text-sm font-semibold">
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            刷新
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
                      onRestart={() => showToast("重启工作负载")}
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
        onToast={showToast}
        onUpdate={updateFromForm}
        onYamlUpdate={updateFromYaml}
        onMetadataUpdate={updateFromMetadata}
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
  onRestart,
  onDelete,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: () => void;
  onRestart: () => void;
  onDelete: () => void;
  onAction: (action: WorkloadMenuAction) => void;
}) {
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const toggleMenu = () => {
    if (!open && moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      const menuWidth = 148;
      const menuHeight = 348;
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
        <button type="button" className="action-button" title="重启工作负载" onClick={onRestart}>
          <RotateCcw className="h-3.5 w-3.5" />
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
            style={{ top: menuPosition.top, left: menuPosition.left, width: 148 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-0.5 px-1.5">
              <WorkloadMenuItem icon={<FileText className="h-3.5 w-3.5" />} label="日志" onClick={() => runAction("logs")} />
            </div>
            <div className="my-1.5 h-px bg-[#eef2f7]" />
            <div className="space-y-0.5 px-1.5">
              <WorkloadMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="编辑 YAML" onClick={() => runAction("yaml")} />
              <WorkloadMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="更新" onClick={() => runAction("update")} />
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  suffix?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center rounded-lg px-2 text-xs font-medium hover:bg-[#f8fafc]",
        danger ? "text-[#ef4444]" : "text-[#334155]",
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
  onToast,
}: {
  item: Workload;
  onBack: () => void;
  onAction: (action: WorkloadMenuAction) => void;
  onDelete: () => void;
  onToast: (message: string) => void;
}) {
  const detailTabs: { id: WorkloadDetailTab; label: string }[] = [
    { id: "pods", label: "容器组" },
    { id: "containers", label: "容器配置" },
    { id: "scheduling", label: "节点调度" },
    { id: "labels", label: "标签与注解" },
    { id: "access", label: "访问配置" },
    { id: "events", label: "事件列表" },
    { id: "yaml", label: "YAML" },
  ];
  const [activeTab, setActiveTab] = useState<WorkloadDetailTab>("pods");
  const [moreOpen, setMoreOpen] = useState(false);
  const [podSearch, setPodSearch] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [observabilityWarning, setObservabilityWarning] = useState("");
  const podName = `${item.name}-7d9f4b8e5a-2xq9k`;
  const yaml = buildWorkloadYaml(item);

  useEffect(() => {
    if (activeTab !== "events") return;
    let cancelled = false;
    setObservabilityWarning("");
    getResourceObservability("deployment", item.namespace, item.name, { includeMetrics: false, includeEvents: true })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.item.events.items);
        setObservabilityWarning((res.warnings || []).map((warning) => warning.message).join("；"));
      })
      .catch((err) => {
        if (!cancelled) setObservabilityWarning(err instanceof Error ? err.message : "加载事件失败");
      });
    return () => { cancelled = true; };
  }, [activeTab, item.name, item.namespace]);

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
          <div className="relative">
            <button type="button" onClick={() => setMoreOpen((current) => !current)} className="action-button h-10 w-10"><MoreHorizontal className="h-4 w-4" /></button>
            {moreOpen && (
              <>
                <button type="button" aria-label="关闭更多菜单" className="fixed inset-0 z-[40] cursor-default" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-12 z-[60] w-[148px] overflow-hidden rounded-2xl border border-[#eef2f7] bg-white py-1.5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
                  <div className="space-y-0.5 px-1.5">
                    <WorkloadMenuItem icon={<Play className="h-3.5 w-3.5" />} label="状态" onClick={() => runMoreAction("status")} />
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
                <span className="inline-flex h-6 items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-white px-2.5 text-xs font-semibold text-[#94a3b8]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#cbd5e1]" /> 等待中
                </span>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-white px-2.5 text-xs font-semibold text-[#94a3b8]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#cbd5e1]" /> 未就绪
                </span>
              </div>
            )}
          />
          <DetailInfoItem label="升级策略" value={<span className="rounded-lg bg-[#f3f4f6] px-2.5 py-1 font-mono text-sm font-semibold text-[#334155]">RollingUpdate</span>} />
          <DetailInfoItem label="正常实例数/全部实例数" value={`${item.readyReplicas}/${item.replicas}`} />
          <DetailInfoItem label="创建时间" value={item.createTime} />
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "h-10 rounded-xl border px-4 text-sm font-semibold",
              activeTab === tab.id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#dfe5ee] bg-white text-[#64748b] hover:bg-[#f8fafc]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "pods" && (
        <section className="rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="relative w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <Input value={podSearch} onChange={(event) => setPodSearch(event.target.value)} placeholder="搜索容器组名称" className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-9 text-sm shadow-sm" />
            </div>
            <div className="relative flex gap-2">
              <button type="button" onClick={() => setColumnsOpen((current) => !current)} className="action-button h-10 w-10"><Settings className="h-4 w-4" /></button>
              <button type="button" onClick={() => onToast("容器组列表已刷新")} className="action-button h-10 w-10"><RotateCcw className="h-4 w-4" /></button>
              {columnsOpen && (
                <div className="absolute right-12 top-12 z-30 w-[170px] rounded-xl border border-[#eef2f7] bg-white p-2 text-xs shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                  {["容器组名称", "状态", "容器", "容器组 IP", "节点", "重启次数", "CPU", "内存"].map((column) => (
                    <label key={column} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[#334155] hover:bg-[#f8fafc]">
                      <input type="checkbox" defaultChecked className="h-3.5 w-3.5" />
                      {column}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">容器组名称</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">容器（正常/总量）</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">容器组 IP</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">节点</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">重启次数</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">CPU 申请值/限制值</TableHead>
                <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">内存申请值/限制值</TableHead>
                <TableHead className="px-5 text-right text-xs text-[var(--color-text-tertiary)]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {podName.includes(podSearch.trim()) || podSearch.trim() === "" ? (
                <TableRow className="h-[72px] hover:bg-[var(--color-bg-hover)]">
                  <TableCell className="max-w-[220px] truncate px-5 text-sm font-semibold text-[#1e6bff]">{podName}</TableCell>
                  <TableCell className="px-5"><StatusPill status={item.status} /></TableCell>
                  <TableCell className="px-5 text-sm font-semibold text-[#111827]">{item.readyReplicas + 1}/{item.replicas + 1}</TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">172.17.0.5</TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">edge-riscv-01</TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">0</TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">100m / 500m</TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">128Mi / 512Mi</TableCell>
                  <TableCell className="px-5 text-right"><span className="text-xs text-[var(--color-text-tertiary)]">控制台暂未开放</span></TableCell>
                </TableRow>
              ) : (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">暂无匹配容器组</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      )}

      {activeTab !== "pods" && (
        <WorkloadDetailTabContent
          tab={activeTab}
          item={item}
          yaml={yaml}
          events={events}
          warning={observabilityWarning}
          onAction={onAction}
          onToast={onToast}
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
  yaml,
  events,
  warning,
  onAction,
  onToast,
}: {
  tab: WorkloadDetailTab;
  item: Workload;
  yaml: string;
  events: ObservabilityEvent[];
  warning: string;
  onAction: (action: WorkloadMenuAction) => void;
  onToast: (message: string) => void;
}) {
  if (tab === "containers") {
    return (
      <section className="rounded-2xl border border-[#eef2f7] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#111827]">容器配置</h2>
          <button type="button" onClick={() => onAction("update")} className="h-9 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">编辑</button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <DetailInfoItem label="容器名称" value="main" />
          <DetailInfoItem label="容器镜像" value={<ImageChip image={item.image} />} />
          <DetailInfoItem label="镜像拉取策略" value="IfNotPresent" />
          <DetailInfoItem label="特权容器" value="否" />
          <DetailInfoItem label="CPU 请求/限制" value="100m / 500m" />
          <DetailInfoItem label="内存请求/限制" value="128Mi / 512Mi" />
          <DetailInfoItem label="启动后执行" value="/bin/sh -c 'echo started'" />
          <DetailInfoItem label="停止前执行" value="/bin/sh -c 'sleep 5'" />
        </div>
        <div className="mt-5 rounded-xl border border-[#eef2f7] bg-[#f8fafc] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#111827]">环境变量</h3>
          <div className="grid grid-cols-2 gap-3 text-sm text-[#334155]">
            <span className="rounded-lg bg-white px-3 py-2 font-mono">NODE_ENV=production</span>
            <span className="rounded-lg bg-white px-3 py-2 font-mono">EDGE_UNIT=edge-131</span>
          </div>
        </div>
      </section>
    );
  }

  if (tab === "scheduling") {
    return (
      <DetailPanel title="节点调度" action={<button type="button" onClick={() => onAction("update")} className="detail-action-button">编辑调度</button>}>
        <div className="grid grid-cols-2 gap-3">
          {["部署到全部节点", "节点标签选择", "节点亲和性", "Pod反亲和性"].map((label, index) => (
            <div key={label} className={cn("flex h-14 items-center gap-3 rounded-xl border px-4 text-sm font-semibold", index === 0 ? "border-[#1e6bff] bg-[#eff6ff] text-[#1e6bff]" : "border-[#e5e7eb] bg-white text-[#334155]")}>
              <span className={cn("h-4 w-4 rounded-full border", index === 0 ? "border-[5px] border-[#1e6bff]" : "border-[#9ca3af]")} />
              {label}
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <DetailInfoItem label="目标节点" value="edge-riscv-01, edge-riscv-02" />
          <DetailInfoItem label="容忍策略" value="edge=true:NoSchedule" />
          <DetailInfoItem label="优先级" value="normal" />
        </div>
      </DetailPanel>
    );
  }

  if (tab === "labels") {
    const rawLabels = asStringRecord(item.raw?.metadata?.labels);
    const rawAnnotations = asStringRecord(item.raw?.metadata?.annotations);
    const labelRows: [string, string][] = Object.entries(rawLabels).length > 0 ? Object.entries(rawLabels) : [["app", item.name]];
    const annotationRows: [string, string][] = Object.entries(rawAnnotations).length > 0 ? Object.entries(rawAnnotations) : [["description", item.description]];

    return (
      <DetailPanel title="标签与注解" action={<button type="button" onClick={() => onAction("labels")} className="detail-action-button">编辑标签与注解</button>}>
        <div className="grid grid-cols-2 gap-5">
          <MetadataList title="标签 (Labels)" rows={labelRows} />
          <MetadataList title="注解 (Annotations)" rows={annotationRows} />
        </div>
      </DetailPanel>
    );
  }

  if (tab === "access") {
    return (
      <DetailPanel title="访问配置">
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-6 text-center text-sm text-[#92400e]">
          当前未接入真实 Service/Ingress 访问地址查询，访问配置暂未开放。
        </div>
      </DetailPanel>
    );
  }

  if (tab === "events") {
    return (
      <DetailPanel title="事件列表" action={<button type="button" onClick={() => onToast("事件列表已刷新")} className="detail-action-button">刷新</button>}>
        {warning && <div className="mb-3 rounded-lg border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{warning}</div>}
        <div className="space-y-3">
          {events.length === 0 ? <div className="rounded-xl bg-[#f8fafc] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">暂无关联事件</div> : events.map((event) => (
            <div key={event.name || `${event.reason}-${event.lastTimestamp}`} className="rounded-xl border border-[#eef2f7] bg-white px-4 py-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#111827]">{event.reason}</span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{event.lastTimestamp || "-"}</span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{event.type} · {event.message}</p>
            </div>
          ))}
        </div>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel title="YAML" action={<button type="button" onClick={() => onAction("yaml")} className="detail-action-button">编辑 YAML</button>}>
      <div className="max-h-[520px] overflow-auto rounded-xl bg-[#1e1e1e] p-5 font-mono text-xs leading-6 text-[#d4d4d4]">
        <pre dangerouslySetInnerHTML={{ __html: highlightYaml(yaml) }} />
      </div>
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

function MetadataList({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-[#eef2f7] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[#111827]">{title}</h3>
      <div className="space-y-2">
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
  onToast,
  onUpdate,
  onYamlUpdate,
  onMetadataUpdate,
}: {
  panel: WorkloadActionPanel | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onUpdate: (item: Workload, form: WorkloadUpdateForm) => Promise<void>;
  onYamlUpdate: (item: Workload, source: string) => Promise<void>;
  onMetadataUpdate: (item: Workload, labels: KeyValueDraft[], annotations: KeyValueDraft[]) => Promise<void>;
}) {
  const [statusAction, setStatusAction] = useState<"停止" | "重启">("重启");
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

  const titles: Record<WorkloadMenuAction, string> = {
    logs: "日志",
    yaml: "编辑 YAML",
    update: "更新工作负载",
    status: "状态操作",
    labels: "标签与注解",
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

          {panel.type === "status" && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">请选择要对工作负载「{panel.item.name}」执行的状态操作。</p>
              <div className="grid grid-cols-2 gap-3">
                {(["停止", "重启"] as const).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setStatusAction(action)}
                    className={cn("h-14 rounded-xl border text-sm font-semibold", statusAction === action ? "border-[#1e6bff] bg-[#eff6ff] text-[#1e6bff]" : "border-[#e5e7eb] bg-white text-[#111827]")}
                  >
                    {action}
                  </button>
                ))}
              </div>
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
                const message = panel.type === "status" ? `${statusAction}工作负载` : `${titles[panel.type]}已提交`;
                onToast(message);
                onClose();
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
              <option value="default">default</option>
              <option value="riscv">riscv</option>
              <option value="kube-system">kube-system</option>
            </select>
            <button type="button" className="action-button h-10 w-10"><RefreshCw className="h-[15px] w-[15px]" /></button>
          </div>
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
              <Input value={container.cpuRequest} onChange={(event) => updateContainer({ cpuRequest: event.target.value })} placeholder="500m 或 0.5" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
            <CreateField label="CPU 限制 (limit)" compact>
              <Input value={container.cpuLimit} onChange={(event) => updateContainer({ cpuLimit: event.target.value })} placeholder="1000m 或 1" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
            </CreateField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CreateField label="内存请求 (request)" compact>
              <Input value={container.memoryRequest} onChange={(event) => updateContainer({ memoryRequest: event.target.value })} placeholder="256Mi" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
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
          <div className="grid grid-cols-2 gap-3">
            <Input value={form.nodeSelectorKey} onChange={(event) => setForm({ ...form, nodeSelectorKey: event.target.value })} className="h-11 rounded-xl" placeholder="标签键" />
            <Input value={form.nodeSelectorValue} onChange={(event) => setForm({ ...form, nodeSelectorValue: event.target.value })} className="h-11 rounded-xl" placeholder="标签值" />
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

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Settings2,
  Terminal,
  Eye,
  Copy,
} from "lucide-react";
import yaml from "js-yaml";
import { StatusBadge } from "@/components/common/StatusBadge";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { formatMemory, listPodMetrics, type PodMetric } from "@/api/services/metrics";
import { getPodLogs, listClusterEvents, type ClusterEvent } from "@/api/services/product";
import {
  createDeploymentResource,
  deleteDeploymentResource,
  getDeployment,
  listDeploymentPage,
  listNodes,
  listPods,
  updateDeploymentResource,
} from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, WorkloadView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface PodSummary {
  name: string;
  status: string;
  node: string;
  images: string[];
  restartCount: number;
  cpuMillicores: number;
  memoryBytes: number;
}

interface Deployment {
  namespace: string;
  name: string;
  raw: KubeResource;
  status: string;
  statusColor: string;
  pods: string;
  desiredReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  cpu: string;
  memory: string;
  cpuLimit: string;
  memoryLimit: string;
  cpuRequest: string;
  memoryRequest: string;
  createdAt: string;
  node: string;
  images: string[];
  strategy: string;
  selector: Record<string, string>;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  restartCount: number;
  ports: Array<{ name?: string; containerPort?: number; hostPort?: number; protocol?: string }>;
  hostNetwork: boolean;
  dnsPolicy: string;
  imagePullSecrets: string[];
  tolerations: string[];
  podItems: PodSummary[];
}

function eventMatchesDeployment(event: ClusterEvent, deployment: Deployment): boolean {
  if (event.namespace !== deployment.namespace) return false;
  const objectName = event.involvedObject?.name || "";
  return objectName === deployment.name ||
    objectName.startsWith(`${deployment.name}-`) ||
    deployment.podItems.some((pod) => pod.name === objectName);
}

function getPodName(pod: any): string {
  return pod?.metadata?.name || pod?.name || "-";
}

function getPodNamespace(pod: any): string {
  return pod?.metadata?.namespace || pod?.namespace || pod?.podNamespace || "default";
}

function getPodLabels(pod: any): Record<string, string> {
  return pod?.metadata?.labels || pod?.labels || pod?.spec?.template?.metadata?.labels || {};
}

function getPodImages(pod: any): string[] {
  const containers = pod?.spec?.containers || pod?.containers || [];
  const statuses = pod?.status?.containerStatuses || pod?.containerStatuses || [];
  const images = [
    ...(Array.isArray(containers) ? containers.map((container: any) => container.image) : []),
    ...(Array.isArray(statuses) ? statuses.map((status: any) => status.image) : []),
  ].filter(Boolean);
  return Array.from(new Set(images));
}

function getPodRestartCount(pod: any): number {
  const statuses = pod?.status?.containerStatuses || pod?.containerStatuses || [];
  return Array.isArray(statuses)
    ? statuses.reduce((sum: number, status: any) => sum + Number(status?.restartCount || 0), 0)
    : Number(pod?.restartCount || 0);
}

function getPodStatus(pod: any): string {
  return pod?.status?.phase || pod?.phase || pod?.status || "-";
}

function getPodNode(pod: any): string {
  return pod?.spec?.nodeName || pod?.nodeName || pod?.node || pod?.host || "-";
}

function getObjectRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)]),
  );
}

function parseSimpleYaml(input: string): KubeResource {
  const jsonLike = input.trim();
  if (!jsonLike) throw new Error("请粘贴 Deployment YAML");
  return (jsonLike.startsWith("{") ? JSON.parse(jsonLike) : yaml.load(input)) as KubeResource;
}

function validateDeploymentResource(resource: KubeResource): KubeResource {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error("YAML 内容必须是 Kubernetes 资源对象");
  }
  if (resource.kind !== "Deployment") {
    throw new Error("当前入口只支持创建 kind: Deployment");
  }
  if (!resource.metadata?.name) {
    throw new Error("Deployment YAML 缺少 metadata.name");
  }
  return {
    ...resource,
    metadata: {
      ...(resource.metadata || {}),
      namespace: resource.metadata?.namespace || "default",
    },
  };
}

function getDeploymentSelector(raw: Record<string, any>): Record<string, string> {
  const matchLabels = getObjectRecord(raw.spec?.selector?.matchLabels || raw.selector);
  if (Object.keys(matchLabels).length > 0) return matchLabels;

  const templateLabels = getObjectRecord(raw.spec?.template?.metadata?.labels);
  if (Object.keys(templateLabels).length > 0) return templateLabels;

  return getObjectRecord(raw.metadata?.labels || raw.labels);
}

function podMatchesDeployment(pod: any, deployment: WorkloadView, selector: Record<string, string>): boolean {
  if (getPodNamespace(pod) !== deployment.namespace) return false;

  const labels = getPodLabels(pod);
  const selectorEntries = Object.entries(selector || {});
  if (selectorEntries.length > 0 && selectorEntries.every(([key, value]) => labels[key] === value)) {
    return true;
  }

  const podName = getPodName(pod);
  const owners = pod?.metadata?.ownerReferences || pod?.ownerReferences || [];
  return (
    podName.startsWith(`${deployment.name}-`) ||
    (Array.isArray(owners) && owners.some((owner: any) => String(owner?.name || "").startsWith(deployment.name)))
  );
}

function formatToleration(toleration: Record<string, any>): string {
  const parts = [
    toleration.key || "(empty key)",
    toleration.operator ? `op=${toleration.operator}` : "",
    toleration.value ? `value=${toleration.value}` : "",
    toleration.effect ? `effect=${toleration.effect}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function toDeploymentRow(item: WorkloadView, pods: any[] = [], metricsByPod: Map<string, PodMetric> = new Map()): Deployment {
  const raw = item.raw as Record<string, any>;
  const podSpec = raw.spec?.template?.spec || {};
  const containers = podSpec.containers || raw.containers || [];
  const rawImages = raw.images || raw.image || raw.containerImages;
  const images = Array.isArray(containers)
    ? containers.map((container: any) => container.image).filter(Boolean)
    : Array.isArray(rawImages)
      ? rawImages
      : typeof rawImages === "string"
        ? [rawImages]
        : [];
  const labels = raw.metadata?.labels || raw.labels || {};
  const selector = getDeploymentSelector(raw);
  const ports = Array.isArray(containers) ? containers.flatMap((container: any) => container.ports || []) : [];
  const imagePullSecrets = Array.isArray(podSpec.imagePullSecrets)
    ? podSpec.imagePullSecrets.map((secret: any) => secret?.name).filter(Boolean)
    : [];
  const tolerations = Array.isArray(podSpec.tolerations)
    ? podSpec.tolerations.map(formatToleration)
    : [];
  const matchedPods = pods.filter((pod) => podMatchesDeployment(pod, item, selector));
  const runningPods = matchedPods.filter((pod) => getPodStatus(pod) === "Running").length;
  const podImages = Array.from(new Set(matchedPods.flatMap(getPodImages)));
  const podNodes = Array.from(new Set(matchedPods.map(getPodNode).filter((node) => node && node !== "-")));
  const podSummaries = matchedPods.map((pod) => {
    const name = getPodName(pod);
    const metric = metricsByPod.get(`${getPodNamespace(pod)}/${name}`);
    return {
      name,
      status: getPodStatus(pod),
      node: getPodNode(pod),
      images: getPodImages(pod),
      restartCount: getPodRestartCount(pod),
      cpuMillicores: metric?.cpuMillicores || 0,
      memoryBytes: metric?.memoryBytes || 0,
    };
  });
  const cpuMillicores = podSummaries.reduce((sum, pod) => sum + pod.cpuMillicores, 0);
  const memoryBytes = podSummaries.reduce((sum, pod) => sum + pod.memoryBytes, 0);
  const rawStatus = typeof raw.status === "string" ? raw.status : typeof raw.phase === "string" ? raw.phase : "";
  const desiredReplicas = item.replicas || matchedPods.length;
  const availableReplicas = item.availableReplicas || runningPods;
  const isReady =
    desiredReplicas > 0 && availableReplicas >= desiredReplicas ||
    ["Running", "Available", "Ready", "运行中"].includes(rawStatus);

  return {
    namespace: item.namespace,
    name: item.name,
    raw: item.raw,
    status: isReady ? "运行中" : desiredReplicas === 0 ? "已停止" : "未就绪",
    statusColor: isReady ? "success" : desiredReplicas === 0 ? "default" : "warning",
    pods: `${availableReplicas}/${desiredReplicas}`,
    desiredReplicas,
    availableReplicas,
    updatedReplicas: item.updatedReplicas,
    cpu: cpuMillicores ? String(cpuMillicores) : "-",
    memory: formatMemory(memoryBytes),
    cpuLimit: "-",
    memoryLimit: "-",
    cpuRequest: "-",
    memoryRequest: "-",
    createdAt: item.createdAt,
    node: podNodes.length > 0 ? podNodes.join(", ") : "-",
    images: images.length > 0 ? images : podImages.length > 0 ? podImages : ["-"],
    strategy: raw.spec?.strategy?.type || "-",
    selector,
    labels,
    annotations: raw.metadata?.annotations || {},
    restartCount: podSummaries.reduce((sum, pod) => sum + pod.restartCount, 0),
    ports,
    hostNetwork: Boolean(podSpec.hostNetwork),
    dnsPolicy: podSpec.dnsPolicy || "-",
    imagePullSecrets,
    tolerations,
    podItems: podSummaries,
  };
}

function yamlTemplate(d: Deployment) {
  return yaml.dump(d.raw, { noRefs: true });
}

function buildDeploymentResource(form: {
  name: string;
  namespace: string;
  replicas: number;
  image: string;
  cpuLimit: string;
  memoryLimit: string;
  cpuRequest: string;
  memoryRequest: string;
  port: number;
  hostPortEnabled: boolean;
  hostPort: number;
  hostNetwork: boolean;
  imagePullSecret: string;
  tolerationEnabled: boolean;
  tolerationKey: string;
  tolerationOperator: string;
  tolerationEffect: string;
  schedulingMode: string;
  targetNode: string;
  nodeSelectorKey: string;
  nodeSelectorValue: string;
  storageEnabled: boolean;
  volumeName: string;
  claimName: string;
  mountPath: string;
  subPath: string;
  readOnly: boolean;
}): KubeResource {
  const labels = { app: form.name };
  const volumeName = form.volumeName.trim() || `${form.name}-data`;
  const claimName = form.claimName.trim();
  const mountPath = form.mountPath.trim();
  const targetNode = form.targetNode.trim();
  const nodeSelectorKey = form.nodeSelectorKey.trim();
  const nodeSelectorValue = form.nodeSelectorValue.trim();
  const volumeMounts = form.storageEnabled && claimName && mountPath
    ? [{
        name: volumeName,
        mountPath,
        subPath: form.subPath.trim() || undefined,
        readOnly: form.readOnly || undefined,
      }]
    : undefined;
  const volumes = form.storageEnabled && claimName
    ? [{
        name: volumeName,
        persistentVolumeClaim: {
          claimName,
          readOnly: form.readOnly || undefined,
        },
      }]
    : undefined;
  const podScheduling =
    form.schedulingMode === "nodeName" && targetNode
      ? { nodeName: targetNode }
      : form.schedulingMode === "nodeSelector" && nodeSelectorKey && nodeSelectorValue
        ? { nodeSelector: { [nodeSelectorKey]: nodeSelectorValue } }
        : {};
  const hostPort = Number(form.hostPort);
  const imagePullSecrets = form.imagePullSecret.trim()
    ? form.imagePullSecret
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name }))
    : undefined;
  const tolerations = form.tolerationEnabled && form.tolerationKey.trim()
    ? [{
        key: form.tolerationKey.trim(),
        operator: form.tolerationOperator || "Exists",
        effect: form.tolerationEffect || "NoSchedule",
      }]
    : undefined;
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels,
    },
    spec: {
      replicas: form.replicas,
      selector: {
        matchLabels: labels,
      },
      template: {
        metadata: {
          labels,
        },
        spec: {
          ...podScheduling,
          hostNetwork: form.hostNetwork || undefined,
          dnsPolicy: form.hostNetwork ? "ClusterFirstWithHostNet" : undefined,
          imagePullSecrets,
          tolerations,
          containers: [
            {
              name: form.name,
              image: form.image,
              ports: form.port ? [{
                containerPort: form.port,
                hostPort: form.hostPortEnabled && hostPort > 0 ? hostPort : undefined,
                protocol: "TCP",
              }] : undefined,
              volumeMounts,
              resources: {
                limits: {
                  cpu: form.cpuLimit,
                  memory: form.memoryLimit,
                },
                requests: {
                  cpu: form.cpuRequest,
                  memory: form.memoryRequest,
                },
              },
            },
          ],
          volumes,
        },
      },
    },
  };
}

async function getCurrentDeploymentResource(namespace: string, name: string): Promise<KubeResource> {
  const current = await getDeployment(namespace, name);
  return current.raw;
}

export function Deployments() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<Deployment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Deployment | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<ClusterEvent[]>([]);
  const [selectedLogPod, setSelectedLogPod] = useState("");
  const [podLogs, setPodLogs] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleValue, setScaleValue] = useState(1);
  const [deleteItem, setDeleteItem] = useState<Deployment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createMode, setCreateMode] = useState("form");
  const [nodeOptions, setNodeOptions] = useState<Array<{ name: string; role: string }>>([]);
  const [yamlText, setYamlText] = useState(`apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
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
      # 可选：指定节点时使用 nodeName；不填则由 Kubernetes 调度器自动选择
      # nodeName: k8s-worker01
      containers:
      - name: my-app
        image: nginx:latest
        ports:
        - containerPort: 80`);

  const [form, setForm] = useState({
    name: "",
    namespace: "default",
    replicas: 1,
    image: "nginx:latest",
    cpuLimit: "100m",
    memoryLimit: "128Mi",
    cpuRequest: "50m",
    memoryRequest: "64Mi",
    port: 80,
    hostPortEnabled: false,
    hostPort: 80,
    hostNetwork: false,
    imagePullSecret: "",
    tolerationEnabled: false,
    tolerationKey: "node-role.kubernetes.io/edge",
    tolerationOperator: "Exists",
    tolerationEffect: "NoSchedule",
    schedulingMode: "auto",
    targetNode: "",
    nodeSelectorKey: "kubernetes.io/hostname",
    nodeSelectorValue: "",
    storageEnabled: false,
    volumeName: "data",
    claimName: "",
    mountPath: "/data",
    subPath: "",
    readOnly: false,
  });

  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const ns = namespace === "all" ? undefined : namespace;
      const [pageResult, pods, metrics] = await Promise.all([
        listDeploymentPage(ns, { page: currentPage, pageSize, search }),
        listPods(ns),
        listPodMetrics(ns),
      ]);
      const metricsByPod = new Map(metrics.map((item) => [`${item.namespace}/${item.name}`, item]));
      const detailRows = await Promise.all(
        pageResult.items.map(async (row) => {
          try {
            return await getDeployment(row.namespace, row.name);
          } catch {
            return row;
          }
        }),
      );
      setData(detailRows.map((row) => toDeploymentRow(row, pods, metricsByPod)));
      setTotalCount(pageResult.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "部署数据加载失败");
      setData([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, namespace, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let mounted = true;
    listNodes()
      .then((nodes) => {
        if (!mounted) return;
        setNodeOptions(nodes.map((node) => ({ name: node.name, role: node.role })));
      })
      .catch(() => {
        if (mounted) setNodeOptions([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = (currentPage - 1) * pageSize;
  const paginated = data;

  const openDetail = async (d: Deployment) => {
    setSelected(d);
    setSelectedEvents([]);
    setSelectedLogPod("");
    setPodLogs("");
    setDetailOpen(true);
    try {
      const events = await listClusterEvents(d.namespace);
      setSelectedEvents(events.filter((event) => eventMatchesDeployment(event, d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载部署事件失败");
    }
  };

  const loadLogs = async (pod: PodSummary) => {
    if (!selected) return;
    setSelectedLogPod(pod.name);
    setPodLogs("正在加载日志...");
    try {
      setPodLogs(await getPodLogs(selected.namespace, pod.name, 200));
    } catch (err) {
      setPodLogs(err instanceof Error ? err.message : "加载 Pod 日志失败");
    }
  };

  const openDelete = (d: Deployment) => {
    setDeleteItem(d);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeploymentResource(deleteItem.namespace, deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除部署失败");
    } finally {
      setIsLoading(false);
    }
  };

  const openScale = (d: Deployment) => {
    setSelected(d);
    setScaleValue(d.desiredReplicas);
    setScaleOpen(true);
  };

  const confirmScale = async () => {
    if (!selected) return;
    setIsLoading(true);
    setError("");
    try {
      const resource = await getCurrentDeploymentResource(selected.namespace, selected.name);
      resource.spec = {
        ...(resource.spec || {}),
        replicas: scaleValue,
      };
      await updateDeploymentResource(selected.namespace, resource);
      setScaleOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "扩缩容失败");
    } finally {
      setIsLoading(false);
    }
  };

  const togglePause = async (d: Deployment) => {
    setIsLoading(true);
    setError("");
    try {
      const resource = await getCurrentDeploymentResource(d.namespace, d.name);
      const isPaused = Boolean((resource.spec as Record<string, unknown> | undefined)?.paused);
      resource.spec = {
        ...(resource.spec || {}),
        paused: !isPaused,
      };
      await updateDeploymentResource(d.namespace, resource);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新部署状态失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      if (createMode === "form" && form.storageEnabled && (!form.claimName.trim() || !form.mountPath.trim())) {
        throw new Error("启用存储挂载时需要填写 PVC 名称和挂载路径");
      }
      if (createMode === "form" && form.schedulingMode === "nodeName" && !form.targetNode.trim()) {
        throw new Error("指定节点时需要选择目标节点");
      }
      if (
        createMode === "form" &&
        form.schedulingMode === "nodeSelector" &&
        (!form.nodeSelectorKey.trim() || !form.nodeSelectorValue.trim())
      ) {
        throw new Error("使用节点选择器时需要填写标签键和值");
      }
      if (createMode === "form" && form.hostPortEnabled && (!form.hostPort || form.hostPort < 1 || form.hostPort > 65535)) {
        throw new Error("启用主机端口时需要填写 1-65535 范围内的端口");
      }
      if (createMode === "form" && form.tolerationEnabled && !form.tolerationKey.trim()) {
        throw new Error("启用容忍配置时需要填写污点键");
      }
      const resource = createMode === "yaml"
        ? validateDeploymentResource(parseSimpleYaml(yamlText))
        : buildDeploymentResource(form);
      await createDeploymentResource(resource);
      setCreateOpen(false);
      setForm({
        name: "",
        namespace: "default",
        replicas: 1,
        image: "nginx:latest",
        cpuLimit: "100m",
        memoryLimit: "128Mi",
        cpuRequest: "50m",
        memoryRequest: "64Mi",
        port: 80,
        hostPortEnabled: false,
        hostPort: 80,
        hostNetwork: false,
        imagePullSecret: "",
        tolerationEnabled: false,
        tolerationKey: "node-role.kubernetes.io/edge",
        tolerationOperator: "Exists",
        tolerationEffect: "NoSchedule",
        schedulingMode: "auto",
        targetNode: "",
        nodeSelectorKey: "kubernetes.io/hostname",
        nodeSelectorValue: "",
        storageEnabled: false,
        volumeName: "data",
        claimName: "",
        mountPath: "/data",
        subPath: "",
        readOnly: false,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建部署失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">部署</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]"
            onClick={loadData}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                创建部署
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[88vh] grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 overflow-hidden">
              <DialogHeader className="px-6 pt-6 pb-3">
                <DialogTitle className="text-base">创建部署</DialogTitle>
              </DialogHeader>
              <Tabs value={createMode} onValueChange={setCreateMode} className="min-h-0 overflow-hidden px-6">
                <TabsList className="bg-[#F7F8FA] h-9">
                  <TabsTrigger value="form" className="text-xs h-7">表单</TabsTrigger>
                  <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
                </TabsList>
                <TabsContent value="form" className="space-y-4 mt-4 max-h-[62vh] overflow-y-auto pr-1 pb-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">名称</Label>
                      <Input
                        placeholder="如 my-app"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">命名空间</Label>
                      <Select
                        value={form.namespace}
                        onValueChange={(v) => setForm({ ...form, namespace: v })}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {namespaces.filter(n=>n.value!=="all").map((ns) => (
                            <SelectItem key={ns.value} value={ns.value} className="text-sm">
                              {ns.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">副本数</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.replicas}
                        onChange={(e) => setForm({ ...form, replicas: Number(e.target.value) })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">容器端口</Label>
                      <Input
                        type="number"
                        value={form.port}
                        onChange={(e) => {
                          const port = Number(e.target.value);
                          setForm({ ...form, port, hostPort: form.hostPortEnabled ? form.hostPort : port });
                        }}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">镜像</Label>
                    <Input
                      placeholder="如 nginx:latest"
                      value={form.image}
                      onChange={(e) => setForm({ ...form, image: e.target.value })}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="rounded-md border border-[#E5E6EB] bg-[#F7F8FA] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-xs text-[#4E5969]">访问与原生字段</Label>
                        <div className="mt-1 text-xs text-[#86909C]">用于 hostPort、hostNetwork、imagePullSecrets 和 tolerations</div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-[#1D2129]">
                        <input
                          type="checkbox"
                          checked={form.hostNetwork}
                          onChange={(e) => setForm({ ...form, hostNetwork: e.target.checked })}
                          className="h-4 w-4 accent-[#165DFF]"
                        />
                        主机网络
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center gap-2 text-sm text-[#1D2129]">
                        <input
                          type="checkbox"
                          checked={form.hostPortEnabled}
                          onChange={(e) => setForm({ ...form, hostPortEnabled: e.target.checked, hostPort: e.target.checked ? form.port : form.hostPort })}
                          className="h-4 w-4 accent-[#165DFF]"
                        />
                        映射主机端口
                      </label>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-[#4E5969]">主机端口</Label>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={form.hostPort}
                          onChange={(e) => setForm({ ...form, hostPort: Number(e.target.value) })}
                          disabled={!form.hostPortEnabled}
                          className="h-9 bg-white text-sm disabled:opacity-60"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">镜像拉取 Secret</Label>
                      <Input
                        value={form.imagePullSecret}
                        onChange={(e) => setForm({ ...form, imagePullSecret: e.target.value })}
                        className="h-9 bg-white text-sm"
                        placeholder="如 my-registry-secret，多个用英文逗号分隔"
                      />
                    </div>
                    <div className="space-y-3 rounded-md border border-[#E5E6EB] bg-white p-3">
                      <label className="flex items-center gap-2 text-sm text-[#1D2129]">
                        <input
                          type="checkbox"
                          checked={form.tolerationEnabled}
                          onChange={(e) => setForm({ ...form, tolerationEnabled: e.target.checked })}
                          className="h-4 w-4 accent-[#165DFF]"
                        />
                        添加容忍配置
                      </label>
                      {form.tolerationEnabled && (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-[#4E5969]">污点键</Label>
                            <Input
                              value={form.tolerationKey}
                              onChange={(e) => setForm({ ...form, tolerationKey: e.target.value })}
                              className="h-9 text-sm"
                              placeholder="node-role.kubernetes.io/edge"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-[#4E5969]">操作符</Label>
                            <Select value={form.tolerationOperator} onValueChange={(v) => setForm({ ...form, tolerationOperator: v })}>
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Exists" className="text-sm">Exists</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-[#4E5969]">效果</Label>
                            <Select value={form.tolerationEffect} onValueChange={(v) => setForm({ ...form, tolerationEffect: v })}>
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NoSchedule" className="text-sm">NoSchedule</SelectItem>
                                <SelectItem value="PreferNoSchedule" className="text-sm">PreferNoSchedule</SelectItem>
                                <SelectItem value="NoExecute" className="text-sm">NoExecute</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">CPU 限制</Label>
                      <Input
                        value={form.cpuLimit}
                        onChange={(e) => setForm({ ...form, cpuLimit: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">内存限制</Label>
                      <Input
                        value={form.memoryLimit}
                        onChange={(e) => setForm({ ...form, memoryLimit: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">CPU 请求</Label>
                      <Input
                        value={form.cpuRequest}
                        onChange={(e) => setForm({ ...form, cpuRequest: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">内存请求</Label>
                      <Input
                        value={form.memoryRequest}
                        onChange={(e) => setForm({ ...form, memoryRequest: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E5E6EB] bg-[#F7F8FA] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-xs text-[#4E5969]">调度节点</Label>
                        <div className="mt-1 text-xs text-[#86909C]">不指定时由 Kubernetes 调度器自动选择节点</div>
                      </div>
                      <Select
                        value={form.schedulingMode}
                        onValueChange={(v) => setForm({
                          ...form,
                          schedulingMode: v,
                          nodeSelectorValue: v === "nodeSelector" && form.targetNode ? form.targetNode : form.nodeSelectorValue,
                        })}
                      >
                        <SelectTrigger className="h-9 w-[180px] bg-white text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto" className="text-sm">自动调度</SelectItem>
                          <SelectItem value="nodeName" className="text-sm">指定节点</SelectItem>
                          <SelectItem value="nodeSelector" className="text-sm">节点选择器</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.schedulingMode !== "auto" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">目标节点</Label>
                          <Select
                            value={form.targetNode || "__manual__"}
                            onValueChange={(v) => setForm({
                              ...form,
                              targetNode: v === "__manual__" ? "" : v,
                              nodeSelectorValue: form.schedulingMode === "nodeSelector" && v !== "__manual__" ? v : form.nodeSelectorValue,
                            })}
                          >
                            <SelectTrigger className="h-9 bg-white text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__manual__" className="text-sm">
                                {nodeOptions.length > 0 ? "手动输入" : "暂无节点数据"}
                              </SelectItem>
                              {nodeOptions.map((node) => (
                                <SelectItem key={node.name} value={node.name} className="text-sm">
                                  {node.name}{node.role !== "unknown" ? ` (${node.role})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">节点名称</Label>
                          <Input
                            value={form.targetNode}
                            onChange={(e) => setForm({
                              ...form,
                              targetNode: e.target.value,
                              nodeSelectorValue: form.schedulingMode === "nodeSelector" ? e.target.value : form.nodeSelectorValue,
                            })}
                            className="h-9 bg-white text-sm"
                            placeholder="如 k8s-worker01"
                          />
                        </div>
                        {form.schedulingMode === "nodeSelector" && (
                          <>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-[#4E5969]">标签键</Label>
                              <Input
                                value={form.nodeSelectorKey}
                                onChange={(e) => setForm({ ...form, nodeSelectorKey: e.target.value })}
                                className="h-9 bg-white text-sm"
                                placeholder="kubernetes.io/hostname"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-[#4E5969]">标签值</Label>
                              <Input
                                value={form.nodeSelectorValue}
                                onChange={(e) => setForm({ ...form, nodeSelectorValue: e.target.value })}
                                className="h-9 bg-white text-sm"
                                placeholder="如 k8s-worker01"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-[#E5E6EB] bg-[#F7F8FA] p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm text-[#1D2129]">
                      <input
                        type="checkbox"
                        checked={form.storageEnabled}
                        onChange={(e) => setForm({ ...form, storageEnabled: e.target.checked })}
                        className="h-4 w-4 accent-[#165DFF]"
                      />
                      挂载持久卷声明（PVC）
                    </label>
                    {form.storageEnabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">PVC 名称</Label>
                          <Input value={form.claimName} onChange={(e) => setForm({ ...form, claimName: e.target.value })} className="h-9 text-sm" placeholder="如 my-app-data" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">卷名称</Label>
                          <Input value={form.volumeName} onChange={(e) => setForm({ ...form, volumeName: e.target.value })} className="h-9 text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">挂载路径</Label>
                          <Input value={form.mountPath} onChange={(e) => setForm({ ...form, mountPath: e.target.value })} className="h-9 text-sm" placeholder="/data" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-[#4E5969]">子路径</Label>
                          <Input value={form.subPath} onChange={(e) => setForm({ ...form, subPath: e.target.value })} className="h-9 text-sm" placeholder="可选" />
                        </div>
                        <label className="col-span-2 flex items-center gap-2 text-sm text-[#4E5969]">
                          <input
                            type="checkbox"
                            checked={form.readOnly}
                            onChange={(e) => setForm({ ...form, readOnly: e.target.checked })}
                            className="h-4 w-4 accent-[#165DFF]"
                          />
                          只读挂载
                        </label>
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="yaml" className="mt-4 max-h-[62vh] overflow-y-auto pb-2">
                  <Textarea
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                    className="min-h-[440px] text-xs font-mono leading-relaxed"
                    spellCheck={false}
                  />
                </TabsContent>
              </Tabs>
              <DialogFooter className="border-t border-[#E5E6EB] px-6 py-4">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={createMode === "form" ? !form.name : !yamlText.trim()}>创建</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" />
          <Input
            placeholder="请输入名称搜索"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-9 h-9 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF] bg-white"
          />
        </div>
        <div className="flex items-center gap-3">
          <NamespaceSelector value={namespace} onChange={(v) => { setNamespace(v); setCurrentPage(1); }} />
          <span className="text-sm text-[#86909C]">共 {totalCount} 条</span>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[#F77234]/20 bg-[#FFF7E8] px-3 py-2 text-sm text-[#D25F00]">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">Pods</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">CPU / 内存</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">所在节点</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">镜像</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[180px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">
                  正在加载部署数据...
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">
                  暂无部署数据
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((row) => (
                <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
                  <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
                  <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>
                    {row.name}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusBadge status={row.status} color={row.statusColor} />
                  </TableCell>
                  <TableCell className="text-sm text-[#4E5969] px-4 py-3">
                    <span className="font-medium">{row.availableReplicas}</span>
                    <span className="text-[#86909C]"> / {row.desiredReplicas}</span>
                  </TableCell>
                  <TableCell className="text-sm text-[#4E5969] px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span>{row.cpu} m</span>
                      <span className="text-[#86909C]">{row.memory}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[#4E5969] px-4 py-3">
                    <Badge variant="outline" className="text-xs font-normal border-[#E5E6EB] text-[#4E5969]">
                      {row.node}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-[#4E5969] px-4 py-3 max-w-[200px] truncate" title={row.images[0]}>
                    {row.images[0].split("/").pop() || row.images[0]}
                  </TableCell>
                  <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}>
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        详情
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#4E5969] hover:text-[#1D2129] hover:bg-[#F2F3F5]" onClick={() => togglePause(row)}>
                        {row.status === "已暂停" ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
                        {row.status === "已暂停" ? "恢复" : "暂停"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => openDelete(row)}>
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalCount > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#86909C]">
            显示 {start + 1}-{Math.min(start + data.length, totalCount)}，共 {totalCount} 条
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-7 w-7 p-0 border-[#C9CDD4]">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <Button
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className={cn("h-7 w-7 p-0 text-xs", currentPage === page ? "bg-[#165DFF] text-white hover:bg-[#165DFF]/90" : "border-[#C9CDD4] text-[#4E5969]")}
                  >
                    {page}
                  </Button>
                </PaginationItem>
              ))}
              <PaginationItem>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-7 w-7 p-0 border-[#C9CDD4]">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} />
              <Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[#F7F8FA] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="pods" className="text-xs h-7">Pods</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-7">日志</TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
                <TabsTrigger value="events" className="text-xs h-7">事件</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <InfoCard label="名称" value={selected.name} />
                  <InfoCard label="命名空间" value={selected.namespace} />
                  <InfoCard label="副本数" value={`${selected.availableReplicas} / ${selected.desiredReplicas}`} />
                  <InfoCard label="更新策略" value={selected.strategy} />
                  <InfoCard label="所在节点" value={selected.node} />
                  <InfoCard label="重启次数" value={String(selected.restartCount)} />
                  <InfoCard label="主机网络" value={selected.hostNetwork ? "启用" : "未启用"} />
                  <InfoCard label="DNS 策略" value={selected.dnsPolicy} />
                  <InfoCard label="CPU 限制" value={selected.cpuLimit} />
                  <InfoCard label="内存限制" value={selected.memoryLimit} />
                  <InfoCard label="CPU 请求" value={selected.cpuRequest} />
                  <InfoCard label="内存请求" value={selected.memoryRequest} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[#86909C] uppercase">镜像</h4>
                  <div className="bg-[#F7F8FA] rounded-md px-3 py-2 text-sm text-[#4E5969] font-mono">{selected.images[0]}</div>
                </div>
                {selected.ports.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-[#86909C] uppercase">端口</h4>
                    <div className="flex flex-wrap gap-2">
                      {selected.ports.map((p, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">
                          {p.name ? `${p.name}: ` : ""}
                          container {p.containerPort ?? "-"}
                          {p.hostPort ? ` -> host ${p.hostPort}` : ""}
                          /{p.protocol || "TCP"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {selected.imagePullSecrets.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-[#86909C] uppercase">镜像拉取 Secret</h4>
                    <div className="flex flex-wrap gap-2">
                      {selected.imagePullSecrets.map((name) => (
                        <Badge key={name} variant="outline" className="text-xs font-normal">{name}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {selected.tolerations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-[#86909C] uppercase">容忍配置</h4>
                    <div className="flex flex-wrap gap-2">
                      {selected.tolerations.map((item, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal max-w-full whitespace-normal text-left">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[#86909C] uppercase">标签</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selected.labels).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-xs font-normal bg-[#E8F3FF] text-[#165DFF]">{k}: {v}</Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[#86909C] uppercase">选择器</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selected.selector).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-xs font-normal">{k}: {v}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openScale(selected)}>
                    <Settings2 className="w-3.5 h-3.5 mr-1" />
                    扩缩容
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => togglePause(selected)}>
                    {selected.status === "已暂停" ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
                    {selected.status === "已暂停" ? "恢复" : "暂停"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setDetailOpen(false); openDelete(selected); }}>
                    <Trash2 className="w-3.5 h-3.5 mr-1 text-[#F53F3F]" />
                    <span className="text-[#F53F3F]">删除</span>
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="pods" className="mt-3">
                <div className="space-y-2">
                  {selected.podItems.length === 0 ? (
                    <div className="bg-[#F7F8FA] rounded-lg p-4 text-center text-sm text-[#86909C]">暂无关联 Pod</div>
                  ) : selected.podItems.map((pod) => (
                    <div key={pod.name} className="bg-[#F7F8FA] rounded-lg p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-2 h-2 rounded-full", pod.status === "Running" ? "bg-[#00B42A]" : "bg-[#FF7D00]")} />
                        <div>
                          <span className="text-sm font-medium">{pod.name}</span>
                          <p className="text-xs text-[#86909C] truncate max-w-[320px]">{pod.images.join(", ") || "-"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-normal">{pod.status}</Badge>
                        <span className="text-xs text-[#86909C]">{pod.node}</span>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => loadLogs(pod)}><Terminal className="w-3 h-3 mr-1" />日志</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="logs" className="mt-3">
                <div className="mb-2 flex flex-wrap gap-2">
                  {selected.podItems.map((pod) => (
                    <Button key={pod.name} variant={selectedLogPod === pod.name ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => loadLogs(pod)}>
                      {pod.name}
                    </Button>
                  ))}
                </div>
                <pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-auto min-h-[260px] max-h-[420px] whitespace-pre-wrap">
                  {podLogs || (selected.podItems.length === 0 ? "暂无关联 Pod" : "请选择一个 Pod 查看日志")}
                </pre>
              </TabsContent>
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">{yamlTemplate(selected)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlTemplate(selected))}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="events" className="mt-3 space-y-2">
                {selectedEvents.length === 0 ? (
                  <div className="bg-[#F7F8FA] rounded-lg p-4 text-center text-sm text-[#86909C]">暂无关联事件</div>
                ) : selectedEvents.map((e, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[#F7F8FA]">
                    <Badge className={cn("text-xs font-normal flex-shrink-0", e.type === "Normal" ? "bg-[#E8FFEA] text-[#00B42A]" : "bg-[#FFECE8] text-[#F53F3F]")}>{e.type}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1D2129] font-medium">{e.reason}</p>
                      <p className="text-xs text-[#4E5969] mt-0.5">{e.message}</p>
                      <p className="text-xs text-[#86909C] mt-1">{e.lastTimestamp || "-"}</p>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      {/* Scale Dialog */}
      <Dialog open={scaleOpen} onOpenChange={setScaleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">扩缩容 - {selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-xs text-[#4E5969]">期望副本数</Label>
            <div className="flex items-center gap-3 mt-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setScaleValue(Math.max(0, scaleValue - 1))}>-</Button>
              <Input type="number" value={scaleValue} onChange={(e) => setScaleValue(Number(e.target.value))} className="h-8 text-center text-sm w-20" />
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setScaleValue(scaleValue + 1)}>+</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setScaleOpen(false)}>取消</Button>
            <Button size="sm" className="bg-[#165DFF] text-white" onClick={confirmScale}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除部署？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除部署 <span className="font-medium text-[#1D2129]">{deleteItem?.name}</span>（命名空间：{deleteItem?.namespace}），此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F7F8FA] rounded-md px-3 py-2">
      <p className="text-xs text-[#86909C] mb-0.5">{label}</p>
      <p className="text-sm text-[#1D2129] font-medium truncate">{value}</p>
    </div>
  );
}

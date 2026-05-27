import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StatusBadge } from "@/components/common/StatusBadge";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { formatMemory, listPodMetrics, type PodMetric } from "@/api/services/metrics";
import { getDeployment, listDeployments, listPods } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { WorkloadView } from "@/types/kubeedge";
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
  ports: Array<{ name: string; containerPort: number; protocol: string }>;
  podItems: PodSummary[];
}

function getPodName(pod: any): string {
  return pod?.metadata?.name || pod?.name || "-";
}

function getPodNamespace(pod: any): string {
  return pod?.metadata?.namespace || pod?.namespace || "default";
}

function getPodLabels(pod: any): Record<string, string> {
  return pod?.metadata?.labels || pod?.labels || {};
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
  return pod?.spec?.nodeName || pod?.nodeName || pod?.node || "-";
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

function toDeploymentRow(item: WorkloadView, pods: any[] = [], metricsByPod: Map<string, PodMetric> = new Map()): Deployment {
  const raw = item.raw as Record<string, any>;
  const containers = raw.spec?.template?.spec?.containers || raw.containers || [];
  const rawImages = raw.images || raw.image || raw.containerImages;
  const images = Array.isArray(containers)
    ? containers.map((container: any) => container.image).filter(Boolean)
    : Array.isArray(rawImages)
      ? rawImages
      : typeof rawImages === "string"
        ? [rawImages]
        : [];
  const labels = raw.metadata?.labels || raw.labels || {};
  const selector = raw.spec?.selector?.matchLabels || raw.selector || labels;
  const ports = Array.isArray(containers) ? containers.flatMap((container: any) => container.ports || []) : [];
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
    podItems: podSummaries,
  };
}

function yamlTemplate(d: Deployment) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${d.name}
  namespace: ${d.namespace}
  labels:
${Object.entries(d.labels).map(([k, v]) => `    ${k}: ${v}`).join("\n")}
spec:
  replicas: ${d.desiredReplicas}
  strategy:
    type: ${d.strategy}
  selector:
    matchLabels:
${Object.entries(d.selector).map(([k, v]) => `      ${k}: ${v}`).join("\n")}
  template:
    metadata:
      labels:
${Object.entries(d.labels).map(([k, v]) => `        ${k}: ${v}`).join("\n")}
    spec:
      containers:
      - name: ${d.name}
        image: ${d.images[0]}
        ports:
${d.ports.map(p => `        - containerPort: ${p.containerPort}`).join("\n") || "        []"}
        resources:
          limits:
            cpu: ${d.cpuLimit}
            memory: ${d.memoryLimit}
          requests:
            cpu: ${d.cpuRequest}
            memory: ${d.memoryRequest}`;
}

export function Deployments() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Deployment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleValue, setScaleValue] = useState(1);
  const [deleteItem, setDeleteItem] = useState<Deployment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  });

  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const ns = namespace === "all" ? undefined : namespace;
      const [rows, pods, metrics] = await Promise.all([listDeployments(ns), listPods(ns), listPodMetrics(ns)]);
      const metricsByPod = new Map(metrics.map((item) => [`${item.namespace}/${item.name}`, item]));
      const detailRows = await Promise.all(
        rows.map(async (row) => {
          try {
            return await getDeployment(row.namespace, row.name);
          } catch {
            return row;
          }
        }),
      );
      setData(detailRows.map((row) => toDeploymentRow(row, pods, metricsByPod)));
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "部署数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    let result = data;
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.namespace.toLowerCase().includes(s) ||
          d.images.some((img) => img.toLowerCase().includes(s))
      );
    }
    return result;
  }, [data, namespace, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: Deployment) => {
    setSelected(d);
    setDetailOpen(true);
  };

  const openDelete = (d: Deployment) => {
    setDeleteItem(d);
    setDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (deleteItem) {
      setData((prev) => prev.filter((d) => d.name !== deleteItem.name));
      setDeleteOpen(false);
      setDeleteItem(null);
    }
  };

  const openScale = (d: Deployment) => {
    setSelected(d);
    setScaleValue(d.desiredReplicas);
    setScaleOpen(true);
  };

  const confirmScale = () => {
    if (selected) {
      setData((prev) =>
        prev.map((d) =>
          d.name === selected.name ? { ...d, desiredReplicas: scaleValue, pods: `${d.availableReplicas}/${scaleValue}` } : d
        )
      );
      setScaleOpen(false);
    }
  };

  const togglePause = (d: Deployment) => {
    const isPaused = d.status === "已暂停";
    setData((prev) =>
      prev.map((item) =>
        item.name === d.name
          ? { ...item, status: isPaused ? "活跃" : "已暂停", statusColor: isPaused ? "success" : "warning" }
          : item
      )
    );
  };

  const handleCreate = () => {
    const newItem: Deployment = {
      namespace: form.namespace,
      name: form.name,
      status: "活跃",
      statusColor: "success",
      pods: `0/${form.replicas}`,
      desiredReplicas: form.replicas,
      availableReplicas: 0,
      updatedReplicas: 0,
      cpu: "0",
      memory: "0Mi",
      cpuLimit: form.cpuLimit,
      memoryLimit: form.memoryLimit,
      cpuRequest: form.cpuRequest,
      memoryRequest: form.memoryRequest,
      createdAt: new Date().toLocaleString("zh-CN"),
      node: "-",
      images: [form.image],
      strategy: "RollingUpdate",
      selector: { app: form.name },
      labels: { app: form.name, version: "v1" },
      annotations: { "deployment.kubernetes.io/revision": "1" },
      restartCount: 0,
      ports: form.port ? [{ name: "http", containerPort: form.port, protocol: "TCP" }] : [],
      podItems: [],
    };
    setData((prev) => [newItem, ...prev]);
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
    });
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
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-base">创建部署</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
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
                      onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
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
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button>
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
            placeholder="请输入名称或镜像搜索"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-9 h-9 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF] bg-white"
          />
        </div>
        <div className="flex items-center gap-3">
          <NamespaceSelector value={namespace} onChange={(v) => { setNamespace(v); setCurrentPage(1); }} />
          <span className="text-sm text-[#86909C]">共 {filtered.length} 条</span>
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
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#86909C]">
            显示 {start + 1}-{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 条
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
                        <Badge key={i} variant="outline" className="text-xs font-normal">{p.name}: {p.containerPort}/{p.protocol}</Badge>
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
                        <Button variant="ghost" size="sm" className="h-6 text-xs"><Terminal className="w-3 h-3 mr-1" />日志</Button>
                      </div>
                    </div>
                  ))}
                </div>
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
                {[
                  { time: "2026/4/23 16:35", type: "Normal", reason: "Created", message: `Created pod: ${selected.name}-xxxxxx` },
                  { time: "2026/4/23 16:34", type: "Normal", reason: "Scaling", message: `Scaled up replica set ${selected.name}-xxxxxx to ${selected.desiredReplicas}` },
                  { time: "2026/4/20 16:55", type: "Normal", reason: "SuccessfulCreate", message: `Created pod: ${selected.name}-xxxxxx` },
                ].map((e, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[#F7F8FA]">
                    <Badge className={cn("text-xs font-normal flex-shrink-0", e.type === "Normal" ? "bg-[#E8FFEA] text-[#00B42A]" : "bg-[#FFECE8] text-[#F53F3F]")}>{e.type}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1D2129] font-medium">{e.reason}</p>
                      <p className="text-xs text-[#4E5969] mt-0.5">{e.message}</p>
                      <p className="text-xs text-[#86909C] mt-1">{e.time}</p>
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

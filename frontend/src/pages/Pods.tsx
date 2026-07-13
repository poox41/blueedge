import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Eye, Terminal, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { PageHeader } from "@/components/common/PageHeader";
import { formatMemory, listPodMetrics, type PodMetric } from "@/api/services/metrics";
import { getPodSummary, getResourceLogs, type ClusterEvent } from "@/api/services/product";
import { deletePodResource, listPods } from "@/api/services/resources";
import { cn } from "@/lib/utils";
import type { KubeResource } from "@/types/kubeedge";

interface ContainerSummary {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: string;
}

interface PodRow {
  namespace: string;
  name: string;
  status: string;
  statusColor: string;
  ready: string;
  restarts: number;
  node: string;
  podIP: string;
  hostIP: string;
  qosClass: string;
  cpu: string;
  memory: string;
  images: string[];
  containers: ContainerSummary[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
  createdAt: string;
  raw: KubeResource;
}

function getPodName(pod: KubeResource): string {
  return pod.metadata?.name || (typeof pod.name === "string" ? pod.name : "-");
}

function getPodNamespace(pod: KubeResource): string {
  return pod.metadata?.namespace || (typeof pod.namespace === "string" ? pod.namespace : "default");
}

function getPodPhase(pod: KubeResource): string {
  const deletionTimestamp = (pod.metadata as Record<string, unknown> | undefined)?.deletionTimestamp;
  if (deletionTimestamp) return "Terminating";
  return typeof pod.status?.phase === "string"
    ? pod.status.phase
    : typeof pod.phase === "string"
      ? pod.phase
      : "-";
}

function getStateName(status: Record<string, any> | undefined): string {
  const state = status?.state;
  if (state?.waiting?.reason) return String(state.waiting.reason);
  if (state?.terminated?.reason) return String(state.terminated.reason);
  if (state?.running) return "Running";
  return "-";
}

function getStatusColor(status: string): string {
  if (status === "Running" || status === "Succeeded") return "success";
  if (status === "Pending" || status === "Terminating") return "warning";
  if (status === "Failed" || status === "CrashLoopBackOff" || status === "Error") return "error";
  return "default";
}

function getContainers(pod: KubeResource): ContainerSummary[] {
  const specContainers = Array.isArray(pod.spec?.containers) ? pod.spec.containers as Array<Record<string, any>> : [];
  const statuses = Array.isArray(pod.status?.containerStatuses)
    ? pod.status.containerStatuses as Array<Record<string, any>>
    : [];

  return specContainers.map((container) => {
    const status = statuses.find((item) => item.name === container.name);
    return {
      name: String(container.name || "-"),
      image: String(container.image || status?.image || "-"),
      ready: Boolean(status?.ready),
      restartCount: Number(status?.restartCount || 0),
      state: getStateName(status),
    };
  });
}

function toRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)]),
  );
}

function toPodRow(pod: KubeResource, metricsByPod: Map<string, PodMetric>): PodRow {
  const namespace = getPodNamespace(pod);
  const name = getPodName(pod);
  const containers = getContainers(pod);
  const readyCount = containers.filter((container) => container.ready).length;
  const status = containers.find((container) => container.state !== "-" && container.state !== "Running")?.state || getPodPhase(pod);
  const metric = metricsByPod.get(`${namespace}/${name}`);

  return {
    namespace,
    name,
    status,
    statusColor: getStatusColor(status),
    ready: `${readyCount}/${containers.length}`,
    restarts: containers.reduce((sum, container) => sum + container.restartCount, 0),
    node: typeof pod.spec?.nodeName === "string" ? pod.spec.nodeName : "-",
    podIP: typeof pod.status?.podIP === "string" ? pod.status.podIP : "-",
    hostIP: typeof pod.status?.hostIP === "string" ? pod.status.hostIP : "-",
    qosClass: typeof pod.status?.qosClass === "string" ? pod.status.qosClass : "-",
    cpu: metric?.cpuMillicores ? `${metric.cpuMillicores} m` : "-",
    memory: formatMemory(metric?.memoryBytes || 0),
    images: Array.from(new Set(containers.map((container) => container.image).filter(Boolean))),
    containers,
    labels: toRecord(pod.metadata?.labels),
    annotations: toRecord(pod.metadata?.annotations),
    createdAt: pod.metadata?.creationTimestamp || (typeof pod.creationTimestamp === "string" ? pod.creationTimestamp : "-"),
    raw: pod,
  };
}

function toYaml(value: unknown, indent = 0): string {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((item) => {
      if (item && typeof item === "object") {
        const rendered = toYaml(item, indent + 2);
        return `${padding}- ${rendered.trimStart()}`;
      }
      return `${padding}- ${String(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return "{}";
    return entries.map(([key, item]) => {
      if (item && typeof item === "object") {
        return `${padding}${key}:\n${toYaml(item, indent + 2)}`;
      }
      return `${padding}${key}: ${String(item)}`;
    }).join("\n");
  }
  return String(value ?? "");
}

export function Pods() {
  const [data, setData] = useState<PodRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<PodRow | null>(null);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [logs, setLogs] = useState("");
  const [deleteItem, setDeleteItem] = useState<PodRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const ns = namespace === "all" ? undefined : namespace;
      const [pods, metrics] = await Promise.allSettled([listPods(ns), listPodMetrics(ns)]);
      if (pods.status === "rejected") throw pods.reason;
      const metricRows = metrics.status === "fulfilled" ? metrics.value : [];
      const metricsByPod = new Map(metricRows.map((item) => [`${item.namespace}/${item.name}`, item]));
      setData((pods.value as KubeResource[]).map((pod) => toPodRow(pod, metricsByPod)));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pod 数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return data;
    return data.filter((pod) =>
      pod.name.toLowerCase().includes(keyword) ||
      pod.namespace.toLowerCase().includes(keyword) ||
      pod.node.toLowerCase().includes(keyword) ||
      pod.images.some((image) => image.toLowerCase().includes(keyword)),
    );
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (pod: PodRow) => {
    setSelected(pod);
    setEvents([]);
    setLogs("");
    setDetailOpen(true);
    try {
      const { item, warnings } = await getPodSummary(pod.namespace, pod.name, { tailLines: 100 });
      if (warnings?.length) setError(warnings.map((warning) => warning.message).join("；"));
      const metricContainers = item.metrics.available ? item.metrics.containers : [];
      const cpuMillicores = metricContainers.reduce((sum, container) => sum + Number(container.cpuUsage || 0), 0);
      const memoryBytes = metricContainers.reduce((sum, container) => sum + Number(container.memoryUsage || 0), 0);
      const next = toPodRow(item.raw as KubeResource, new Map([[`${item.namespace}/${item.name}`, {
        namespace: item.namespace,
        name: item.name,
        cpuMillicores,
        memoryBytes,
      }]]));
      setSelected(next);
      setEvents(item.events as ClusterEvent[]);
      setLogs(item.recentLogs.available ? item.recentLogs.content : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Pod 详情失败");
    }
  };

  const loadLogs = async (pod: PodRow) => {
    setLogs("正在加载日志...");
    try {
      const res = await getResourceLogs("pod", pod.namespace, pod.name, { tailLines: 200 });
      const first = res.item.pods.find((item) => item.available);
      setLogs(first?.content || res.warnings?.map((item) => item.message).join("\n") || "暂无可用日志");
    } catch (err) {
      setLogs(err instanceof Error ? err.message : "加载 Pod 日志失败");
    }
  };

  const openDelete = (pod: PodRow) => {
    setDeleteItem(pod);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deletePodResource(deleteItem.namespace, deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Pod 失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="blueedge-page space-y-4">
      <PageHeader
        title="Pods"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onRefresh={loadData}
      />

      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-3">
          <NamespaceSelector value={namespace} onChange={(value) => { setNamespace(value); setPage(1); }} />
          <span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span>
        </div>
      </div>

      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}

      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">名称</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">Ready</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">重启</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">CPU / 内存</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">所在节点</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">Pod IP</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
              <TableHead className="w-[160px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">正在加载 Pod 数据...</span></div></TableCell></TableRow>
            ) : paginated.length === 0 ? (
              <TableRow><TableCell colSpan={10}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">暂无 Pod 数据</span></div></TableCell></TableRow>
            ) : paginated.map((pod) => (
              <TableRow key={`${pod.namespace}/${pod.name}`} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{pod.namespace}</TableCell>
                <TableCell className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-brand)] hover:underline" onClick={() => openDetail(pod)}>{pod.name}</TableCell>
                <TableCell className="px-4 py-3"><StatusBadge status={pod.status} color={pod.statusColor} /></TableCell>
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{pod.ready}</TableCell>
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{pod.restarts}</TableCell>
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3"><div className="flex flex-col gap-0.5"><span>{pod.cpu}</span><span className="text-[var(--color-text-tertiary)]">{pod.memory}</span></div></TableCell>
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3"><Badge variant="outline" className="text-xs font-normal border-[var(--color-border-strong)] text-[var(--color-text-secondary)]">{pod.node}</Badge></TableCell>
                <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3 font-mono">{pod.podIP}</TableCell>
                <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{pod.createdAt}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="action-group">
                    <button type="button" className="action-button" title="查看详情" onClick={() => openDetail(pod)}><Eye className="h-3.5 w-3.5" /></button>
                    <button type="button" className="action-button is-danger" title="删除" onClick={() => openDelete(pod)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-tertiary)]">显示 {start + 1}-{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 条</span>
          <Pagination><PaginationContent>
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="h-7 w-7 p-0"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (
              <PaginationItem key={item}><Button variant={page === item ? "default" : "outline"} size="sm" onClick={() => setPage(item)} className={cn("h-7 w-7 p-0 text-xs", page === item ? "bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] text-[var(--color-text-secondary)]")}>{item}</Button></PaginationItem>
            ))}
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="h-7 w-7 p-0"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
          </PaginationContent></Pagination>
        </div>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]">
            <SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} />
              <Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[var(--color-bg-soft)] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="containers" className="text-xs h-7">容器</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-7">日志</TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
                <TabsTrigger value="events" className="text-xs h-7">事件</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Info label="名称" value={selected.name} />
                  <Info label="命名空间" value={selected.namespace} />
                  <Info label="Ready" value={selected.ready} />
                  <Info label="重启次数" value={String(selected.restarts)} />
                  <Info label="所在节点" value={selected.node} />
                  <Info label="Pod IP" value={selected.podIP} />
                  <Info label="Host IP" value={selected.hostIP} />
                  <Info label="QoS" value={selected.qosClass} />
                  <Info label="CPU" value={selected.cpu} />
                  <Info label="内存" value={selected.memory} />
                </div>
                <TagGroup title="镜像" items={selected.images.map((image) => [image, image])} />
                <TagGroup title="标签" items={Object.entries(selected.labels)} />
                <TagGroup title="注解" items={Object.entries(selected.annotations)} />
              </TabsContent>
              <TabsContent value="containers" className="mt-3 space-y-2">
                {selected.containers.map((container) => (
                  <div key={container.name} className="bg-[var(--color-bg-soft)] rounded-md p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">{container.name}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)] truncate">{container.image}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-normal">{container.state}</Badge>
                        <span className="text-xs text-[var(--color-text-tertiary)]">重启 {container.restartCount}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="logs" className="mt-3">
                <Button variant="outline" size="sm" className="h-7 text-xs mb-2" onClick={() => loadLogs(selected)}>
                  <Terminal className="w-3.5 h-3.5 mr-1" />
                  加载日志
                </Button>
                <pre className="blueedge-code-block p-4 overflow-auto min-h-[260px] max-h-[420px] whitespace-pre-wrap">{logs || "点击加载日志查看最近 200 行"}</pre>
              </TabsContent>
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="blueedge-code-block p-4 overflow-x-auto leading-relaxed">{toYaml(selected.raw)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(toYaml(selected.raw))}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="events" className="mt-3 space-y-2">
                {events.length === 0 ? (
                  <div className="bg-[var(--color-bg-soft)] rounded-lg p-4 text-center text-sm text-[var(--color-text-tertiary)]">暂无关联事件</div>
                ) : events.map((event) => (
                  <div key={event.name} className="flex items-start gap-3 p-3 rounded-md bg-[var(--color-bg-soft)]">
                    <Badge className={cn("text-xs font-normal flex-shrink-0", event.type === "Normal" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]")}>{event.type}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-text-primary)] font-medium">{event.reason}</p>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{event.message}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{event.lastTimestamp || "-"}</p>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除 Pod？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除 Pod <span className="font-medium text-[var(--color-text-primary)]">{deleteItem?.name}</span>（命名空间：{deleteItem?.namespace}），由控制器管理的 Pod 可能会被自动重建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-sm" onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="blueedge-info-card">
      <p className="blueedge-info-card-label">{label}</p>
      <p className="blueedge-info-card-value">{value}</p>
    </div>
  );
}

function TagGroup({ title, items }: { title: string; items: Array<[string, string]> }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase">{title}</h4>
      {items.length === 0 ? (
        <div className="bg-[var(--color-bg-soft)] rounded-md px-3 py-2 text-sm text-[var(--color-text-tertiary)]">-</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(([key, value]) => (
            <Badge key={`${key}-${value}`} variant="secondary" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)] max-w-full truncate">
              {key === value ? value : `${key}: ${value}`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

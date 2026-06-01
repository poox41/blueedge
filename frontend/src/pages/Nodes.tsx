import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Search, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight, Eye, Copy, Ban, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatMemory, listNodeMetrics } from "@/api/services/metrics";
import { deleteNodeResource, getNode, listNodes, listPods, updateNodeResource } from "@/api/services/resources";
import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface Node {
  name: string; role: string; status: string; statusColor: string; labels: number;
  cpu: string; memory: string; ip: string; taints: number; pods: number; createdAt: string;
  raw: KubeResource; unschedulable: boolean;
  os?: string; kernel?: string; kubelet?: string; containerRuntime?: string;
  architecture?: string; capacity?: { cpu: string; memory: string; storage: string };
  conditions?: Array<{ type: string; status: string; message: string }>;
}

const DEFAULT_CLOUDCORE_ADDRESS = import.meta.env.VITE_DEFAULT_CLOUDCORE_ADDRESS || "14.103.163.121:10000";

function statusText(status: EdgeNodeView["status"]) {
  if (status === "Ready") return "就绪";
  if (status === "NotReady") return "未就绪";
  return "未知";
}

function statusColor(status: EdgeNodeView["status"]) {
  if (status === "Ready") return "success";
  if (status === "NotReady") return "warning";
  return "default";
}

function getPodNodeName(pod: any): string {
  return pod?.spec?.nodeName || pod?.nodeName || pod?.node || "-";
}

function formatCapacityCpu(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  return value.endsWith("m") ? value : `${value}核`;
}

function formatCapacityMemory(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const match = value.match(/^(\d+)(Ki|Mi|Gi|Ti)?$/);
  if (!match) return value;
  const amount = Number(match[1]);
  const unit = match[2] || "";
  if (!Number.isFinite(amount)) return value;
  if (unit === "Ki") return formatMemory(amount * 1024);
  if (unit === "Mi") return formatMemory(amount * 1024 ** 2);
  if (unit === "Gi") return `${amount}Gi`;
  if (unit === "Ti") return `${amount}Ti`;
  return formatMemory(amount);
}

function toPageNode(
  node: EdgeNodeView,
  metricsByName: Map<string, { cpuMillicores: number; memoryBytes: number }>,
  podCountByNode: Map<string, number> = new Map(),
): Node {
  const raw = node.raw as Record<string, any>;
  const nodeInfo = raw.status?.nodeInfo || {};
  const capacity = raw.status?.capacity || {};
  const allocatable = raw.status?.allocatable || {};
  const conditions = Array.isArray(raw.status?.conditions) ? raw.status.conditions : [];
  const metrics = metricsByName.get(node.name);
  return {
    name: node.name,
    role: node.role === "unknown" ? "cloud" : node.role,
    status: statusText(node.status),
    statusColor: statusColor(node.status),
    labels: Object.keys(raw.metadata?.labels || {}).length,
    cpu: metrics ? `${metrics.cpuMillicores}m` : formatCapacityCpu(allocatable.cpu || capacity.cpu),
    memory: metrics ? formatMemory(metrics.memoryBytes) : formatCapacityMemory(allocatable.memory || capacity.memory),
    ip: node.internalIP,
    taints: Array.isArray(raw.spec?.taints) ? raw.spec.taints.length : 0,
    pods: podCountByNode.get(node.name) ?? Number(raw.podCount || raw.pods || 0),
    createdAt: node.createdAt,
    raw: node.raw,
    unschedulable: Boolean(raw.spec?.unschedulable),
    os: node.osImage,
    kernel: nodeInfo.kernelVersion || "-",
    kubelet: node.kubeletVersion,
    containerRuntime: nodeInfo.containerRuntimeVersion || "-",
    architecture: nodeInfo.architecture || "-",
    capacity: { cpu: capacity.cpu || "-", memory: capacity.memory || "-", storage: capacity["ephemeral-storage"] || "-" },
    conditions: conditions.length > 0
      ? conditions.map((item: any) => ({
        type: item.type || "-",
        status: item.status || "-",
        message: item.message || item.reason || "-",
      }))
      : [
        {
          type: "Ready",
          status: node.status === "Ready" ? "True" : "False",
          message: node.status === "Ready" ? "节点已就绪" : "节点未就绪",
        },
      ],
  };
}

function yamlNode(n: Node) {
  return `apiVersion: v1
kind: Node
metadata:
  name: ${n.name}
  labels:
    kubernetes.io/arch: ${n.architecture}
    kubernetes.io/os: ${n.os?.split(" ")[0] || "linux"}
spec:
  taints:
  - key: node-role.kubernetes.io/${n.role}
    effect: NoSchedule
status:
  capacity:
    cpu: "${n.capacity?.cpu || "4"}"
    memory: ${n.capacity?.memory || "8Gi"}
    storage: ${n.capacity?.storage || "100Gi"}
  conditions:
${(n.conditions || []).map(c => `  - type: ${c.type}\n    status: "${c.status}"`).join("\n")}`;
}

export function Nodes() {
  const [data, setData] = useState<Node[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<Node | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [joinForm, setJoinForm] = useState({
    mode: "edge",
    cloudCoreAddress: DEFAULT_CLOUDCORE_ADDRESS,
    token: "",
    nodeName: "",
    kubeadmCommand: "",
  });
  const pageSize = 10;

  const loadNodes = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [nodes, metrics, pods] = await Promise.allSettled([listNodes(), listNodeMetrics(), listPods()]);
      const nodeRows = nodes.status === "fulfilled" ? nodes.value : [];
      const metricsRows = metrics.status === "fulfilled" ? metrics.value : [];
      const podRows = pods.status === "fulfilled" ? pods.value : [];
      const metricsByName = new Map(metricsRows.map((item) => [item.name, item]));
      const podCountByNode = podRows.reduce((acc, pod) => {
        const nodeName = getPodNodeName(pod);
        if (nodeName && nodeName !== "-") {
          acc.set(nodeName, (acc.get(nodeName) || 0) + 1);
        }
        return acc;
      }, new Map<string, number>());
      setData(nodeRows.map((node) => toPageNode(node, metricsByName, podCountByNode)));
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  const filtered = useMemo(() => {
    let result = data;
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(n => n.name.toLowerCase().includes(s) || n.ip.toLowerCase().includes(s));
    }
    return result;
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDelete = (n: Node) => { setDeleteItem(n); setDeleteOpen(true); };
  const openDetailWithFreshData = async (n: Node) => {
    setSelected(n);
    setDetailOpen(true);
    try {
      const detail = await getNode(n.name);
      setSelected({ ...toPageNode(detail, new Map()), cpu: n.cpu, memory: n.memory, pods: n.pods });
    } catch {
      setSelected(n);
    }
  };

  const edgeJoinCommand = [
    "sudo keadm join",
    joinForm.cloudCoreAddress.trim() ? `--cloudcore-ipport=${joinForm.cloudCoreAddress.trim()}` : "--cloudcore-ipport=<cloudcore-ip:10000>",
    joinForm.token.trim() ? `--token=${joinForm.token.trim()}` : "--token=<cloudcore-token>",
    joinForm.nodeName.trim() ? `--edgenode-name=${joinForm.nodeName.trim()}` : "",
  ].filter(Boolean).join(" \\\n  ");
  const kubeadmJoinCommand = joinForm.kubeadmCommand.trim() || "sudo kubeadm join <apiserver:6443> --token <token> --discovery-token-ca-cert-hash sha256:<hash>";
  const currentJoinCommand = joinForm.mode === "edge" ? edgeJoinCommand : kubeadmJoinCommand;
  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteNodeResource(deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      if (selected?.name === deleteItem.name) {
        setDetailOpen(false);
        setSelected(null);
      }
      await loadNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除节点失败");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleScheduling = async (node: Node) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = await getNode(node.name);
      const resource = detail.raw;
      resource.spec = {
        ...(resource.spec || {}),
        unschedulable: !Boolean((resource.spec as Record<string, unknown> | undefined)?.unschedulable),
      };
      await updateNodeResource(resource);
      await loadNodes();
      const refreshed = await getNode(node.name);
      setSelected({ ...toPageNode(refreshed, new Map()), cpu: node.cpu, memory: node.memory, pods: node.pods });
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新节点调度状态失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">节点</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadNodes} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />接入节点</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle className="text-base">接入节点</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2 text-sm text-[#4E5969]">
                <div className="rounded-md border border-[#E5E6EB] bg-[#F7F8FA] p-3">
                  当前 API 不支持通过表单创建真实 Node。节点需要在目标机器上运行 kubelet 或 edgecore，向集群注册成功后自动出现在列表中。
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={joinForm.mode === "edge" ? "default" : "outline"} size="sm" onClick={() => setJoinForm({ ...joinForm, mode: "edge" })} className={cn("h-9", joinForm.mode === "edge" && "bg-[#165DFF] text-white")}>边缘节点</Button>
                  <Button variant={joinForm.mode === "worker" ? "default" : "outline"} size="sm" onClick={() => setJoinForm({ ...joinForm, mode: "worker" })} className={cn("h-9", joinForm.mode === "worker" && "bg-[#165DFF] text-white")}>云端 / 工作节点</Button>
                </div>
                {joinForm.mode === "edge" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><p className="text-xs text-[#4E5969]">CloudCore 地址</p><Input placeholder={`如 ${DEFAULT_CLOUDCORE_ADDRESS}`} value={joinForm.cloudCoreAddress} onChange={(e) => setJoinForm({ ...joinForm, cloudCoreAddress: e.target.value })} className="h-9 text-sm" /></div>
                    <div className="space-y-1.5"><p className="text-xs text-[#4E5969]">边缘节点名称</p><Input placeholder="可选，如 k8s-laptop-edge" value={joinForm.nodeName} onChange={(e) => setJoinForm({ ...joinForm, nodeName: e.target.value })} className="h-9 text-sm" /></div>
                    <div className="col-span-2 space-y-1.5"><p className="text-xs text-[#4E5969]">CloudCore Token</p><Input placeholder="keadm gettoken 获取的 token" value={joinForm.token} onChange={(e) => setJoinForm({ ...joinForm, token: e.target.value })} className="h-9 text-sm" /></div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-[#4E5969]">kubeadm join 命令</p>
                    <Input placeholder="粘贴 kubeadm token create --print-join-command 输出" value={joinForm.kubeadmCommand} onChange={(e) => setJoinForm({ ...joinForm, kubeadmCommand: e.target.value })} className="h-9 text-sm" />
                  </div>
                )}
                <div className="space-y-2">
                  <p className="font-medium text-[#1D2129]">{joinForm.mode === "edge" ? "在边缘节点执行" : "在工作节点执行"}</p>
                  <div className="relative">
                    <pre className="min-h-24 whitespace-pre-wrap break-all rounded-md bg-[#0A1628] p-3 pr-12 text-xs text-[#C9CDD4]">{currentJoinCommand}</pre>
                    <Button variant="ghost" size="sm" className="absolute right-2 top-2 h-7 text-white/70 hover:text-white" onClick={() => navigator.clipboard.writeText(currentJoinCommand)}><Copy className="w-3.5 h-3.5" /></Button>
                  </div>
                  <p className="text-xs text-[#86909C]">执行完成并注册成功后，点击刷新查看新节点。</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button size="sm" className="bg-[#165DFF] text-white" onClick={() => navigator.clipboard.writeText(currentJoinCommand)}>复制命令</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" />
          <Input placeholder="请输入名称或IP搜索" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-9 h-9 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF] bg-white" />
        </div>
        <span className="text-sm text-[#86909C]">共 {filtered.length} 条</span>
      </div>
      {error && (
        <div className="rounded-md border border-[#F77234]/20 bg-[#FFF7E8] px-3 py-2 text-sm text-[#D25F00]">
          {error}
        </div>
      )}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">角色</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">CPU</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">内存</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">IP 地址</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">Pod 数</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">正在加载节点数据...</TableCell></TableRow>
            ) : paginated.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">暂无节点数据</TableCell></TableRow>
            ) : paginated.map(row => (
              <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
                <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetailWithFreshData(row)}>{row.name}</TableCell>
                <TableCell className="px-4 py-3"><Badge variant="outline" className={cn("text-xs font-normal", row.role === "cloud" ? "border-[#E8F3FF] text-[#165DFF] bg-[#E8F3FF]" : "border-[#E8FFEA] text-[#00B42A] bg-[#E8FFEA]")}>{row.role}</Badge></TableCell>
                <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.cpu}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.memory}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3 font-mono">{row.ip}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.pods}</TableCell>
                <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetailWithFreshData(row)}><Eye className="w-3.5 h-3.5 mr-1" />详情</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => openDelete(row)}><Trash2 className="w-3.5 h-3.5 mr-1" />删除</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#86909C]">显示 {start + 1}-{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 条</span>
          <Pagination><PaginationContent>
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <PaginationItem key={page}><Button variant={currentPage === page ? "default" : "outline"} size="sm" onClick={() => setCurrentPage(page)} className={cn("h-7 w-7 p-0 text-xs", currentPage === page ? "bg-[#165DFF] text-white hover:bg-[#165DFF]/90" : "border-[#C9CDD4] text-[#4E5969]")}>{page}</Button></PaginationItem>
            ))}
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
          </PaginationContent></Pagination>
        </div>
      )}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]">
            <SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} />
              <Badge variant="outline" className="text-xs font-normal capitalize">{selected?.role}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[#F7F8FA] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="resource" className="text-xs h-7">资源</TabsTrigger>
                <TabsTrigger value="conditions" className="text-xs h-7">状态条件</TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Info label="名称" value={selected.name} />
                  <Info label="角色" value={selected.role} />
                  <Info label="状态" value={selected.status} />
                  <Info label="IP 地址" value={selected.ip} />
                  <Info label="OS" value={selected.os || "-"} />
                  <Info label="内核" value={selected.kernel || "-"} />
                  <Info label="Kubelet 版本" value={selected.kubelet || "-"} />
                  <Info label="容器运行时" value={selected.containerRuntime || "-"} />
                  <Info label="架构" value={selected.architecture || "-"} />
                  <Info label="Pod 数量" value={String(selected.pods)} />
                  <Info label="标签数" value={String(selected.labels)} />
                  <Info label="污点" value={String(selected.taints)} />
                  <Info label="调度状态" value={selected.unschedulable ? "不可调度" : "可调度"} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toggleScheduling(selected)} disabled={isLoading}>
                    {selected.unschedulable ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Ban className="w-3.5 h-3.5 mr-1" />}
                    {selected.unschedulable ? "恢复调度" : "设为不可调度"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openDelete(selected)}><Trash2 className="w-3.5 h-3.5 mr-1 text-[#F53F3F]" /><span className="text-[#F53F3F]">删除</span></Button>
                </div>
              </TabsContent>
              <TabsContent value="resource" className="mt-3 space-y-3">
                <Info label="CPU 容量" value={selected.capacity?.cpu || "-"} />
                <Info label="内存容量" value={selected.capacity?.memory || "-"} />
                <Info label="存储容量" value={selected.capacity?.storage || "-"} />
                <Info label="CPU 使用" value={selected.cpu} />
                <Info label="内存使用" value={selected.memory} />
                <div className="bg-[#F7F8FA] rounded-md p-3"><p className="text-xs text-[#86909C] mb-1">CPU 使用率</p><div className="h-2 bg-[#E5E6EB] rounded-full"><div className="h-full bg-[#165DFF] rounded-full" style={{ width: "30%" }} /></div></div>
                <div className="bg-[#F7F8FA] rounded-md p-3"><p className="text-xs text-[#86909C] mb-1">内存使用率</p><div className="h-2 bg-[#E5E6EB] rounded-full"><div className="h-full bg-[#00B42A] rounded-full" style={{ width: "25%" }} /></div></div>
              </TabsContent>
              <TabsContent value="conditions" className="mt-3 space-y-2">
                {(selected.conditions || []).map((c, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[#F7F8FA]">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", c.status === "True" ? "bg-[#00B42A]" : "bg-[#F53F3F]")} />
                    <div className="flex-1"><p className="text-sm font-medium text-[#1D2129]">{c.type}</p><p className="text-xs text-[#4E5969] mt-0.5">{c.message}</p></div>
                    <Badge className={cn("text-xs font-normal flex-shrink-0", c.status === "True" ? "bg-[#E8FFEA] text-[#00B42A]" : "bg-[#FFECE8] text-[#F53F3F]")}>{c.status}</Badge>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yamlNode(selected)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlNode(selected))}><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="text-base">确认删除节点？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除节点 <span className="font-medium text-[#1D2129]">{deleteItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDelete}>确认删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

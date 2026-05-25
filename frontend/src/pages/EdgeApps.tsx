import { useState, useMemo } from "react";
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
  RotateCcw,
  Eye,
  Copy,
  Server,
  Cpu,
  MemoryStick,
  Activity,
  Filter,
} from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { edgeAppsData, namespaces } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface EdgeApp {
  namespace: string;
  name: string;
  type: string;
  status: string;
  statusColor: string;
  node: string;
  nodeRole: string;
  images: string[];
  cpu: string;
  memory: string;
  cpuLimit: string;
  memoryLimit: string;
  restartCount: number;
  pods: string;
  ports: string[];
  createdAt: string;
  age: string;
  labels: Record<string, string>;
  selector?: Record<string, string>;
  strategy?: string;
  desiredReplicas?: number;
  availableReplicas?: number;
  completion?: string;
  duration?: string;
  desired?: number;
  current?: number;
  ready?: number;
  ip?: string;
}

const typeColors: Record<string, string> = {
  Deployment: "bg-[#E8F3FF] text-[#165DFF]",
  Job: "bg-[#FFF7E8] text-[#FF7D00]",
  Pod: "bg-[#E8FFEA] text-[#00B42A]",
  DaemonSet: "bg-[#F5E8FF] text-[#722ED1]",
};

const typeIcons: Record<string, React.ElementType> = {
  Deployment: Server,
  Job: Activity,
  Pod: Cpu,
  DaemonSet: MemoryStick,
};

function yamlTemplateEdge(a: EdgeApp) {
  const kind = a.type;
  let spec = "";
  if (kind === "Deployment" || kind === "DaemonSet") {
    spec = `spec:
  selector:
    matchLabels:
${Object.entries(a.labels).map(([k, v]) => `      ${k}: ${v}`).join("\n")}
  template:
    metadata:
      labels:
${Object.entries(a.labels).map(([k, v]) => `        ${k}: ${v}`).join("\n")}
    spec:
      containers:
      - name: ${a.name}
        image: ${a.images[0]}`;
  } else if (kind === "Job") {
    spec = `spec:
  template:
    spec:
      containers:
      - name: ${a.name}
        image: ${a.images[0]}
      restartPolicy: OnFailure`;
  } else {
    spec = `spec:
  containers:
  - name: ${a.name}
    image: ${a.images[0]}`;
  }
  return `apiVersion: ${kind === "Deployment" ? "apps/v1" : kind === "DaemonSet" ? "apps/v1" : kind === "Job" ? "batch/v1" : "v1"}
kind: ${kind}
metadata:
  name: ${a.name}
  namespace: ${a.namespace}
  labels:
${Object.entries(a.labels).map(([k, v]) => `    ${k}: ${v}`).join("\n")}
${spec}`;
}

export function EdgeApps() {
  const [data, setData] = useState<EdgeApp[]>(edgeAppsData as unknown as EdgeApp[]);
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<EdgeApp | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<EdgeApp | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    namespace: "default",
    type: "Deployment",
    image: "nginx:latest",
    cpuLimit: "100m",
    memoryLimit: "128Mi",
    replicas: 1,
  });

  const pageSize = 10;

  const filtered = useMemo(() => {
    let result = data;
    if (namespace !== "all") {
      result = result.filter((d) => d.namespace === namespace);
    }
    if (typeFilter !== "all") {
      result = result.filter((d) => d.type === typeFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.namespace.toLowerCase().includes(s) ||
          d.type.toLowerCase().includes(s) ||
          d.images.some((img) => img.toLowerCase().includes(s))
      );
    }
    return result;
  }, [data, namespace, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (a: EdgeApp) => {
    setSelected(a);
    setDetailOpen(true);
  };

  const openDelete = (a: EdgeApp) => {
    setDeleteItem(a);
    setDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (deleteItem) {
      setData((prev) => prev.filter((d) => d.name !== deleteItem.name));
      setDeleteOpen(false);
      setDeleteItem(null);
    }
  };

  const togglePause = (a: EdgeApp) => {
    const isPaused = a.status === "已暂停";
    setData((prev) =>
      prev.map((item) =>
        item.name === a.name
          ? { ...item, status: isPaused ? "运行中" : "已暂停", statusColor: isPaused ? "success" : "warning" }
          : item
      )
    );
  };

  const handleRestart = (a: EdgeApp) => {
    setData((prev) =>
      prev.map((item) =>
        item.name === a.name ? { ...item, restartCount: item.restartCount + 1, status: "运行中", statusColor: "success" } : item
      )
    );
  };

  const handleCreate = () => {
    const newItem: EdgeApp = {
      namespace: form.namespace,
      name: form.name,
      type: form.type,
      status: "运行中",
      statusColor: "success",
      node: "edge-node",
      nodeRole: "edge",
      images: [form.image],
      cpu: "0",
      memory: "0Mi",
      cpuLimit: form.cpuLimit,
      memoryLimit: form.memoryLimit,
      restartCount: 0,
      pods: form.type === "Deployment" ? `0/${form.replicas}` : "1/1",
      ports: [],
      createdAt: new Date().toLocaleString("zh-CN"),
      age: "刚刚",
      labels: { app: form.name },
    };
    if (form.type === "Deployment") {
      newItem.selector = { app: form.name };
      newItem.strategy = "RollingUpdate";
      newItem.desiredReplicas = form.replicas;
      newItem.availableReplicas = 0;
    }
    setData((prev) => [newItem, ...prev]);
    setCreateOpen(false);
    setForm({ name: "", namespace: "default", type: "Deployment", image: "nginx:latest", cpuLimit: "100m", memoryLimit: "128Mi", replicas: 1 });
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">边缘应用</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]"
            onClick={() => setData(edgeAppsData as unknown as EdgeApp[])}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white">
                <Plus className="w-3.5 h-3.5 mr-1" />
                创建边缘应用
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-base">创建边缘应用</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">名称</Label>
                    <Input placeholder="如 edge-app" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">类型</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Deployment" className="text-sm">Deployment</SelectItem>
                        <SelectItem value="Job" className="text-sm">Job</SelectItem>
                        <SelectItem value="Pod" className="text-sm">Pod</SelectItem>
                        <SelectItem value="DaemonSet" className="text-sm">DaemonSet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">命名空间</Label>
                    <Select value={form.namespace} onValueChange={(v) => setForm({ ...form, namespace: v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {namespaces.filter(n=>n.value!=="all").map((ns) => (
                          <SelectItem key={ns.value} value={ns.value} className="text-sm">{ns.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.type === "Deployment" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[#4E5969]">副本数</Label>
                      <Input type="number" min={1} value={form.replicas} onChange={(e) => setForm({ ...form, replicas: Number(e.target.value) })} className="h-9 text-sm" />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[#4E5969]">镜像</Label>
                  <Input placeholder="如 nginx:latest" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">CPU 限制</Label>
                    <Input value={form.cpuLimit} onChange={(e) => setForm({ ...form, cpuLimit: e.target.value })} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#4E5969]">内存限制</Label>
                    <Input value={form.memoryLimit} onChange={(e) => setForm({ ...form, memoryLimit: e.target.value })} className="h-9 text-sm" />
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
        <div className="flex items-center gap-3 flex-1">
          <div className="relative w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" />
            <Input
              placeholder="请输入名称搜索"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="pl-9 h-9 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF] bg-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#86909C]" />
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="h-9 w-[140px] text-sm border-[#C9CDD4]">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-sm">全部类型</SelectItem>
                <SelectItem value="Deployment" className="text-sm">Deployment</SelectItem>
                <SelectItem value="Job" className="text-sm">Job</SelectItem>
                <SelectItem value="Pod" className="text-sm">Pod</SelectItem>
                <SelectItem value="DaemonSet" className="text-sm">DaemonSet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NamespaceSelector value={namespace} onChange={(v) => { setNamespace(v); setCurrentPage(1); }} />
          <span className="text-sm text-[#86909C]">共 {filtered.length} 条</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">类型</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">边缘节点</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">CPU / 内存</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">镜像</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">重启</TableHead>
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[180px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">
                  暂无边缘应用数据
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((row) => {
                const TypeIcon = typeIcons[row.type] || Server;
                return (
                  <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
                    <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
                    <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>
                      {row.name}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={cn("text-xs font-normal border-0", typeColors[row.type] || "bg-[#F2F3F5] text-[#4E5969]")}>
                        <TypeIcon className="w-3 h-3 mr-1" />
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={row.status} color={row.statusColor} />
                    </TableCell>
                    <TableCell className="text-sm text-[#4E5969] px-4 py-3">
                      <Badge variant="outline" className="text-xs font-normal border-[#E5E6EB] text-[#4E5969]">
                        {row.node}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-[#4E5969] px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.cpu} m</span>
                        <span className="text-[#86909C]">{row.memory}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-[#4E5969] px-4 py-3 max-w-[180px] truncate" title={row.images[0]}>
                      {row.images[0].split("/").pop() || row.images[0]}
                    </TableCell>
                    <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.restartCount}</TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          详情
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#4E5969] hover:text-[#1D2129] hover:bg-[#F2F3F5]" onClick={() => handleRestart(row)}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          重启
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => openDelete(row)}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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
              <Badge className={cn("text-xs font-normal border-0", typeColors[selected?.type || ""] || "")}>
                {selected?.type}
              </Badge>
              <Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[#F7F8FA] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="resource" className="text-xs h-7">资源</TabsTrigger>
                {selected.type === "Pod" && <TabsTrigger value="logs" className="text-xs h-7">日志</TabsTrigger>}
                <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <InfoCard label="名称" value={selected.name} />
                  <InfoCard label="类型" value={selected.type} />
                  <InfoCard label="命名空间" value={selected.namespace} />
                  <InfoCard label="边缘节点" value={selected.node} />
                  {selected.desiredReplicas !== undefined && (
                    <InfoCard label="副本数" value={`${selected.availableReplicas || 0} / ${selected.desiredReplicas}`} />
                  )}
                  {selected.completion && (
                    <InfoCard label="完成度" value={selected.completion} />
                  )}
                  {selected.desired !== undefined && (
                    <InfoCard label="期望/当前/就绪" value={`${selected.desired}/${selected.current}/${selected.ready}`} />
                  )}
                  <InfoCard label="重启次数" value={String(selected.restartCount)} />
                  <InfoCard label="运行时长" value={selected.age} />
                  {selected.ip && <InfoCard label="Pod IP" value={selected.ip} />}
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
                        <Badge key={i} variant="outline" className="text-xs font-normal">{p}</Badge>
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
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleRestart(selected)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    重启
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
              <TabsContent value="resource" className="mt-3 space-y-3">
                <InfoCard label="CPU 使用" value={`${selected.cpu} m`} />
                <InfoCard label="内存使用" value={selected.memory} />
                <InfoCard label="CPU 限制" value={selected.cpuLimit} />
                <InfoCard label="内存限制" value={selected.memoryLimit} />
                <div className="bg-[#F7F8FA] rounded-md p-3">
                  <h4 className="text-xs text-[#86909C] mb-2">资源使用趋势</h4>
                  <div className="h-2 bg-[#E5E6EB] rounded-full overflow-hidden">
                    <div className="h-full bg-[#165DFF] rounded-full" style={{ width: `${Math.min(100, Number(selected.cpu) * 2)}%` }} />
                  </div>
                  <p className="text-xs text-[#86909C] mt-1">CPU 使用率: {selected.cpu} m / {selected.cpuLimit}</p>
                </div>
                <div className="bg-[#F7F8FA] rounded-md p-3">
                  <div className="h-2 bg-[#E5E6EB] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00B42A] rounded-full" style={{ width: `${Math.min(100, Number(selected.memory.replace(/[^0-9]/g, "")) / 2)}%` }} />
                  </div>
                  <p className="text-xs text-[#86909C] mt-1">内存使用率: {selected.memory} / {selected.memoryLimit}</p>
                </div>
              </TabsContent>
              {selected.type === "Pod" && (
                <TabsContent value="logs" className="mt-3">
                  <div className="bg-[#0A1628] rounded-lg p-4 text-xs font-mono text-[#C9CDD4] h-[400px] overflow-y-auto leading-relaxed">
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 10:23:15 Starting container {selected.name}</p>
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 10:23:16 Container started successfully</p>
                    <p><span className="text-[#165DFF]">[DEBUG]</span> 2026/04/23 10:23:18 Listening on port {selected.ports[0]?.split("/")[0] || "80"}</p>
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 10:25:42 Health check passed</p>
                    <p><span className="text-[#86909C]">[ACCESS]</span> 2026/04/23 10:30:11 GET /health 200 OK</p>
                    <p><span className="text-[#86909C]">[ACCESS]</span> 2026/04/23 10:32:05 GET /metrics 200 OK</p>
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 10:35:22 Scheduled task executed</p>
                    <p><span className="text-[#86909C]">[ACCESS]</span> 2026/04/23 10:40:18 POST /api/data 201 Created</p>
                    <p><span className="text-[#FF7D00]">[WARN]</span> 2026/04/23 10:45:33 High memory usage detected: {selected.memory}</p>
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 10:50:01 Garbage collection completed</p>
                    <p><span className="text-[#86909C]">[ACCESS]</span> 2026/04/23 10:55:47 GET /status 200 OK</p>
                    <p><span className="text-[#00B42A]">[INFO]</span> 2026/04/23 11:00:00 Heartbeat sent to cloud</p>
                  </div>
                </TabsContent>
              )}
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed">{yamlTemplateEdge(selected)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlTemplateEdge(selected))}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Alert */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除边缘应用？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除应用 <span className="font-medium text-[#1D2129]">{deleteItem?.name}</span>（类型：{deleteItem?.type}，命名空间：{deleteItem?.namespace}），此操作不可恢复。
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

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Search, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight, Eye, Copy } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { nodesData } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface Node {
  name: string; role: string; status: string; statusColor: string; labels: number;
  cpu: string; memory: string; ip: string; taints: number; pods: number; createdAt: string;
  os?: string; kernel?: string; kubelet?: string; containerRuntime?: string;
  architecture?: string; capacity?: { cpu: string; memory: string; storage: string };
  conditions?: Array<{ type: string; status: string; message: string }>;
}

const fullNodes: Node[] = (nodesData as any[]).map(n => ({
  ...n, os: "Linux 5.15.0", kernel: "5.15.0-105-generic", kubelet: "v1.28.0",
  containerRuntime: "containerd://1.7.0", architecture: "amd64",
  capacity: { cpu: "4", memory: "8Gi", storage: "100Gi" },
  conditions: [
    { type: "Ready", status: "True", message: "kubelet is posting ready status" },
    { type: "MemoryPressure", status: "False", message: "kubelet has sufficient memory available" },
    { type: "DiskPressure", status: "False", message: "kubelet has no disk pressure" },
    { type: "PIDPressure", status: "False", message: "kubelet has sufficient PID available" },
  ],
}));

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
  const [data, setData] = useState<Node[]>(fullNodes);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<Node | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", role: "edge", ip: "", cpu: "2", memory: "4Gi" });
  const pageSize = 10;

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

  const openDetail = (n: Node) => { setSelected(n); setDetailOpen(true); };
  const openDelete = (n: Node) => { setDeleteItem(n); setDeleteOpen(true); };
  const confirmDelete = () => { if (deleteItem) { setData(p => p.filter(n => n.name !== deleteItem.name)); setDeleteOpen(false); } };

  const handleCreate = () => {
    const newNode: Node = {
      name: form.name, role: form.role, status: "未就绪", statusColor: "warning", labels: 5,
      cpu: "0", memory: "0Mi", ip: form.ip, taints: 0, pods: 0,
      createdAt: new Date().toLocaleString("zh-CN"),
      os: "Linux 5.15.0", kernel: "5.15.0-105-generic", kubelet: "v1.28.0",
      containerRuntime: "containerd://1.7.0", architecture: "amd64",
      capacity: { cpu: form.cpu, memory: form.memory, storage: "100Gi" },
    };
    setData(p => [newNode, ...p]);
    setCreateOpen(false);
    setForm({ name: "", role: "edge", ip: "", cpu: "2", memory: "4Gi" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">节点</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={() => setData(fullNodes)}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />添加节点</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">添加节点</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">节点名称</Label><Input placeholder="如 edge-node-02" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">角色</Label>
                    <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">
                      <option value="cloud">cloud</option><option value="edge">edge</option>
                    </select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">IP 地址</Label><Input placeholder="192.168.1.100" value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} className="h-9 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">CPU 核数</Label><Input value={form.cpu} onChange={e => setForm({ ...form, cpu: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">内存</Label><Input value={form.memory} onChange={e => setForm({ ...form, memory: e.target.value })} className="h-9 text-sm" /></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>添加</Button>
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
            {paginated.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">暂无节点数据</TableCell></TableRow>
            ) : paginated.map(row => (
              <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
                <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
                <TableCell className="px-4 py-3"><Badge variant="outline" className={cn("text-xs font-normal", row.role === "cloud" ? "border-[#E8F3FF] text-[#165DFF] bg-[#E8F3FF]" : "border-[#E8FFEA] text-[#00B42A] bg-[#E8FFEA]")}>{row.role}</Badge></TableCell>
                <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.cpu}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.memory}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3 font-mono">{row.ip}</TableCell>
                <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.pods}</TableCell>
                <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}><Eye className="w-3.5 h-3.5 mr-1" />详情</Button>
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
                </div>
                <div className="flex gap-2 pt-2">
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

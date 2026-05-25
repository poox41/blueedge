import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { namespaces } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface DI { namespace: string; name: string; model: string; node: string; status: string; statusColor: string; twins: number; createdAt: string; protocol?: string; }

const initialData: DI[] = [
  { namespace: "default", name: "sensor-01", model: "test-model", node: "edge-node", status: "在线", statusColor: "success", twins: 3, createdAt: "2026年4月20日 10:00:00", protocol: "MQTT" },
  { namespace: "default", name: "actuator-01", model: "test-model", node: "edge-node", status: "离线", statusColor: "error", twins: 2, createdAt: "2026年4月18日 14:30:00", protocol: "Modbus" },
];

function yaml(n: DI) {
  return `apiVersion: devices.kubeedge.io/v1alpha2
kind: Device
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  deviceModelRef:
    name: ${n.model}
  nodeSelector:
    nodeSelectorTerms:
      - matchExpressions:
          - key: ""
            operator: In
            values:
              - ${n.node}
  protocol:
    mqtt:
      client-id: ${n.name}`;
}

export function DeviceInstances() {
  const [data, setData] = useState<DI[]>(initialData);
  const [search, setSearch] = useState("");
  const [ns, setNs] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<DI | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DI | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", model: "test-model", node: "edge-node", protocol: "MQTT" });
  const pageSize = 10;

  const filtered = useMemo(() => {
    let r = data;
    if (ns !== "all") r = r.filter(d => d.namespace === ns);
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, ns, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: DI) => { setSelected(d); setDetailOpen(true); };
  const openDel = (d: DI) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = () => { if (delItem) { setData(p => p.filter(d => d.name !== delItem.name)); setDelOpen(false); } };
  const handleCreate = () => {
    const d: DI = { name: form.name, namespace: form.namespace, model: form.model, node: form.node, status: "在线", statusColor: "success", twins: 0, createdAt: new Date().toLocaleString("zh-CN"), protocol: form.protocol };
    setData(p => [d, ...p]); setCreateOpen(false); setForm({ name: "", namespace: "default", model: "test-model", node: "edge-node", protocol: "MQTT" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">设备实例</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={() => setData(initialData)}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建设备实例</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建设备实例</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 sensor-02" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">设备模型</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">目标节点</Label><Input value={form.node} onChange={e => setForm({ ...form, node: e.target.value })} className="h-9 text-sm" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">协议</Label>
                  <select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>MQTT</option><option>Modbus</option><option>OPC UA</option><option>Bluetooth</option></select>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm border-[#C9CDD4] bg-white" /></div>
        <div className="flex items-center gap-3"><NamespaceSelector value={ns} onChange={v => { setNs(v); setPage(1); }} /><span className="text-sm text-[#86909C]">共 {filtered.length} 条</span></div>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">设备模型</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">边缘节点</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">协议</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">Twin 数</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{paginated.length === 0 ? (<TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">暂无设备实例数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.model}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.node}</TableCell>
            <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal">{row.protocol || "-"}</Badge></TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.twins}</TableCell>
            <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}><Eye className="w-3.5 h-3.5 mr-1" />详情</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => openDel(row)}><Trash2 className="w-3.5 h-3.5 mr-1" />删除</Button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
      </div>
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#86909C]">显示 {start + 1}-{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 条</span>
          <Pagination><PaginationContent>
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (<PaginationItem key={p}><Button variant={page === p ? "default" : "outline"} size="sm" onClick={() => setPage(p)} className={cn("h-7 w-7 p-0 text-xs", page === p ? "bg-[#165DFF] text-white" : "border-[#C9CDD4] text-[#4E5969]")}>{p}</Button></PaginationItem>))}
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
          </PaginationContent></Pagination>
        </div>
      )}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /><Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="twins" className="text-xs h-7">设备孪生</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="设备模型" value={selected.model} /><Info label="边缘节点" value={selected.node} />
                <Info label="状态" value={selected.status} /><Info label="协议" value={selected.protocol || "-"} />
                <Info label="Twin 数" value={String(selected.twins)} />
              </div>
            </TabsContent>
            <TabsContent value="twins" className="mt-3 space-y-2">
              {[{ name: "temperature", desired: "25.0", reported: "25.3" }, { name: "humidity", desired: "60", reported: "58" }, { name: "status", desired: "running", reported: "running" }].map((t, i) => (
                <div key={i} className="bg-[#F7F8FA] rounded-md p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">{t.name}</span><Badge className="text-xs font-normal bg-[#E8FFEA] text-[#00B42A]">已同步</Badge></div><div className="grid grid-cols-2 gap-2 mt-2"><Info label="期望值" value={t.desired} /><Info label="上报值" value={t.reported} /></div></div>
              ))}
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除设备实例 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

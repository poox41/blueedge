import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { persistentVolumesData } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface PV {
  name: string; status: string; statusColor: string; capacity: string;
  accessModes: string; reclaimPolicy: string; storageClass: string; createdAt: string;
  volumeMode?: string; persistentVolumeReclaimPolicy?: string;
  nodeAffinity?: string; phase?: string;
}

const fullData: PV[] = (persistentVolumesData as any[]).map(n => ({
  ...n, volumeMode: "Filesystem", persistentVolumeReclaimPolicy: n.reclaimPolicy,
  nodeAffinity: "Required", phase: n.status === "已绑定" ? "Bound" : "Available",
}));

function yaml(n: PV) {
  return `apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${n.name}
spec:
  capacity:
    storage: ${n.capacity}
  accessModes:
    - ${n.accessModes}
  persistentVolumeReclaimPolicy: ${n.reclaimPolicy}
  storageClassName: ${n.storageClass}
  volumeMode: ${n.volumeMode}
status:
  phase: ${n.phase}`;
}

export function PersistentVolumes() {
  const [data, setData] = useState<PV[]>(fullData);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<PV | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<PV | null>(null);
  const [form, setForm] = useState({ name: "", capacity: "10Gi", accessMode: "ReadWriteOnce", reclaim: "Retain", storageClass: "local-path" });
  const pageSize = 10;

  const filtered = useMemo(() => {
    let r = data;
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (n: PV) => { setSelected(n); setDetailOpen(true); };
  const openDel = (n: PV) => { setDelItem(n); setDelOpen(true); };
  const confirmDel = () => { if (delItem) { setData(p => p.filter(d => d.name !== delItem.name)); setDelOpen(false); } };
  const handleCreate = () => {
    const pv: PV = { name: form.name, status: "可用", statusColor: "warning", capacity: form.capacity, accessModes: form.accessMode, reclaimPolicy: form.reclaim, storageClass: form.storageClass, createdAt: new Date().toLocaleString("zh-CN"), volumeMode: "Filesystem", phase: "Available" };
    setData(p => [pv, ...p]); setCreateOpen(false); setForm({ name: "", capacity: "10Gi", accessMode: "ReadWriteOnce", reclaim: "Retain", storageClass: "local-path" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">持久卷</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={() => setData(fullData)}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建持久卷</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建持久卷</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 pv-001" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">容量</Label><Input value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">存储类</Label><Input value={form.storageClass} onChange={e => setForm({ ...form, storageClass: e.target.value })} className="h-9 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">访问模式</Label>
                    <select value={form.accessMode} onChange={e => setForm({ ...form, accessMode: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>ReadWriteOnce</option><option>ReadOnlyMany</option><option>ReadWriteMany</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">回收策略</Label>
                    <select value={form.reclaim} onChange={e => setForm({ ...form, reclaim: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>Retain</option><option>Delete</option><option>Recycle</option></select>
                  </div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm border-[#C9CDD4] bg-white" /></div>
        <span className="text-sm text-[#86909C]">共 {filtered.length} 条</span>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">容量</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">访问模式</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">回收策略</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">存储类</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{paginated.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[#86909C] text-sm">暂无持久卷数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.capacity}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.accessModes}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.reclaimPolicy}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.storageClass}</TableCell>
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
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="状态" value={selected.status} />
                <Info label="容量" value={selected.capacity} /><Info label="访问模式" value={selected.accessModes} />
                <Info label="回收策略" value={selected.reclaimPolicy} /><Info label="存储类" value={selected.storageClass} />
                <Info label="卷模式" value={selected.volumeMode || "-"} /><Info label="阶段" value={selected.phase || "-"} />
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除持久卷？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除持久卷 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

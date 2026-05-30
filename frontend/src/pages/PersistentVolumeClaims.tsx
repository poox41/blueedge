import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import { getResourceCreatedAt, getResourceName, getResourceNamespace } from "@/api/adapters/kube-resource.adapter";
import { createPersistentVolumeClaim, deletePersistentVolumeClaim, listPersistentVolumeClaims } from "@/api/services/storage";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface PVC {
  namespace: string; name: string; status: string; statusColor: string;
  capacity: string; accessModes: string; storageClass: string; volume: string; createdAt: string;
}

function toPersistentVolumeClaim(item: any): PVC {
  const phase = item?.status?.phase || "-";
  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    status: phase === "Bound" ? "已绑定" : phase === "Pending" ? "待处理" : phase,
    statusColor: phase === "Bound" ? "success" : phase === "Pending" ? "warning" : "default",
    capacity: item?.status?.capacity?.storage || item?.spec?.resources?.requests?.storage || "-",
    accessModes: Array.isArray(item?.spec?.accessModes) ? item.spec.accessModes.join(", ") : "-",
    storageClass: item?.spec?.storageClassName || "-",
    volume: item?.spec?.volumeName || "-",
    createdAt: getResourceCreatedAt(item),
  };
}

function yaml(n: PVC) {
  return `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  accessModes:
    - ${n.accessModes}
  resources:
    requests:
      storage: ${n.capacity}
  storageClassName: ${n.storageClass}
  volumeName: ${n.volume}
status:
  phase: ${n.status === "已绑定" ? "Bound" : "Pending"}`;
}

function buildPersistentVolumeClaimResource(form: {
  name: string;
  namespace: string;
  capacity: string;
  accessMode: string;
  storageClass: string;
}): KubeResource {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: form.name,
      namespace: form.namespace,
    },
    spec: {
      accessModes: [form.accessMode],
      resources: {
        requests: {
          storage: form.capacity,
        },
      },
      storageClassName: form.storageClass,
    },
  };
}

export function PersistentVolumeClaims() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<PVC[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ns, setNs] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<PVC | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<PVC | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", capacity: "10Gi", accessMode: "ReadWriteOnce", storageClass: "local-path" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listPersistentVolumeClaims(ns === "all" ? undefined : ns);
      setData(items.map(toPersistentVolumeClaim));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载持久卷声明失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [ns]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    let r = data;
    if (ns !== "all") r = r.filter(d => d.namespace === ns);
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, ns, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (n: PVC) => { setSelected(n); setDetailOpen(true); };
  const openDel = (n: PVC) => { setDelItem(n); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deletePersistentVolumeClaim(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除持久卷声明失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      await createPersistentVolumeClaim(buildPersistentVolumeClaimResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", capacity: "10Gi", accessMode: "ReadWriteOnce", storageClass: "local-path" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建持久卷声明失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">持久卷声明</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建声明</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建持久卷声明</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 my-pvc" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">容量</Label><Input value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">存储类</Label><Input value={form.storageClass} onChange={e => setForm({ ...form, storageClass: e.target.value })} className="h-9 text-sm" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">访问模式</Label>
                  <select value={form.accessMode} onChange={e => setForm({ ...form, accessMode: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>ReadWriteOnce</option><option>ReadOnlyMany</option><option>ReadWriteMany</option></select>
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
      {error && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">{error}</div>}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">容量</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">访问模式</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">存储类</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">卷</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">加载中...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={9} className="text-center py-16 text-[#86909C] text-sm">暂无持久卷声明数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.capacity}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.accessModes}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.storageClass}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3 font-mono">{row.volume}</TableCell>
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
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="状态" value={selected.status} /><Info label="容量" value={selected.capacity} />
                <Info label="访问模式" value={selected.accessModes} /><Info label="存储类" value={selected.storageClass} />
                <Info label="绑定卷" value={selected.volume} />
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>（命名空间：{delItem?.namespace}），此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

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
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import { createPersistentVolumeClaim, deletePersistentVolumeClaim } from "@/api/services/storage";
import { pvcStatusColor, pvcStatusText, type PersistentVolumeClaimSummary } from "@/api/adapters/pvc-summary.adapter";
import { getPersistentVolumeClaimSummary, listPersistentVolumeClaimSummaries, listStorageClasses } from "@/api/services/product";
import type { StorageClassSummary } from "@/api/adapters/storage-class.adapter";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { validateRequiredDomFields } from "@/lib/form-validation";
import { useNamespace } from "@/contexts/NamespaceContext";

interface PVC {
  namespace: string; name: string; status: string; statusColor: string;
  capacity: string; accessModes: string; storageClass: string; volume: string; createdAt: string;
  requestedCapacity?: string;
  actualCapacity?: string;
  volumeMode?: string;
  usedByCount?: number;
  usedBy?: Array<{ kind: string; namespace: string; name: string; path: string }>;
  rawSummary?: PersistentVolumeClaimSummary;
}

function toPersistentVolumeClaim(item: PersistentVolumeClaimSummary): PVC {
  return {
    namespace: item.namespace,
    name: item.name,
    status: pvcStatusText(item.status, item.phase),
    statusColor: pvcStatusColor(item.status),
    capacity: item.actualCapacity || item.requestedCapacity || "-",
    requestedCapacity: item.requestedCapacity || "-",
    actualCapacity: item.actualCapacity || "-",
    accessModes: item.accessModes.join(", ") || "-",
    storageClass: item.storageClass || "-",
    volume: item.volume || "-",
    volumeMode: item.volumeMode || "-",
    usedByCount: item.usedByCount,
    usedBy: item.usedBy,
    createdAt: item.createdAt || "-",
    rawSummary: item,
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
  const { selectedNamespace: ns } = useNamespace();
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<PVC | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<PVC | null>(null);
  const [storageClasses, setStorageClasses] = useState<StorageClassSummary[]>([]);
  const [form, setForm] = useState({ name: "", namespace: "default", capacity: "10Gi", accessMode: "ReadWriteOnce", storageClass: "local-path" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [summary, classes] = await Promise.all([
        listPersistentVolumeClaimSummaries(ns === "all" ? undefined : ns),
        listStorageClasses().catch(() => ({ items: [] })),
      ]);
      if (summary.warnings?.length) setError(summary.warnings.map((warning) => warning.message).join("；"));
      setData(summary.items.map(toPersistentVolumeClaim));
      setStorageClasses(classes.items);
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

  const openDetail = async (n: PVC) => {
    setSelected(n);
    setDetailOpen(true);
    try {
      const { item, warnings } = await getPersistentVolumeClaimSummary(n.namespace, n.name);
      if (warnings?.length) setError(warnings.map((warning) => warning.message).join("；"));
      setSelected(toPersistentVolumeClaim(item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载持久卷声明详情失败");
    }
  };
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
    if (!validateRequiredDomFields([
      { elementId: "persistent-volume-claim-create-name", valid: Boolean(form.name.trim()), message: "请输入持久卷声明名称" },
    ])) return;
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
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">持久卷声明</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[var(--color-text-primary)] hover:bg-[var(--color-brand-dark)] text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建声明</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建持久卷声明</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input id="persistent-volume-claim-create-name" placeholder="如 my-pvc" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">容量</Label><Input value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">存储类</Label><select value={form.storageClass} onChange={e => setForm({ ...form, storageClass: e.target.value })} className="blueedge-native-select">{storageClasses.length === 0 && <option value={form.storageClass}>{form.storageClass || "-"}</option>}{storageClasses.map((item) => <option key={item.name} value={item.name}>{item.name}{item.isDefault ? "（默认）" : ""}</option>)}</select></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">访问模式</Label>
                  <select value={form.accessMode} onChange={e => setForm({ ...form, accessMode: e.target.value })} className="blueedge-native-select"><option>ReadWriteOnce</option><option>ReadOnlyMany</option><option>ReadWriteMany</option></select>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" onClick={handleCreate} disabled={isLoading}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="toolbar-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm bg-white" /></div>
        <div className="flex items-center gap-3"><span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span></div>
      </div>
      {error && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">{error}</div>}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
        <Table><TableHeader><TableRow className="bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">状态</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">容量</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">访问模式</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">存储类</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">卷</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={9} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">加载中...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={9} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无持久卷声明数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.capacity}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.accessModes}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.storageClass}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3 font-mono">{row.volume}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="action-group"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
      </div>
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-tertiary)]">显示 {start + 1}-{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 条</span>
          <Pagination><PaginationContent>
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (<PaginationItem key={p}><Button variant={page === p ? "default" : "outline"} size="sm" onClick={() => setPage(p)} className={cn("h-7 w-7 p-0 text-xs", page === p ? "bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] text-[var(--color-text-secondary)]")}>{p}</Button></PaginationItem>))}
            <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-7 w-7 p-0"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
          </PaginationContent></Pagination>
        </div>
      )}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /><Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="状态" value={selected.status} /><Info label="容量" value={selected.capacity} />
                <Info label="访问模式" value={selected.accessModes} /><Info label="存储类" value={selected.storageClass} />
                <Info label="绑定卷" value={selected.volume} />
                <Info label="请求容量" value={selected.requestedCapacity || "-"} /><Info label="实际容量" value={selected.actualCapacity || "-"} />
                <Info label="卷模式" value={selected.volumeMode || "-"} /><Info label="引用数量" value={String(selected.usedByCount || 0)} />
              </div>
              {selected.usedBy && selected.usedBy.length > 0 && <div className="space-y-2"><h4 className="text-xs text-[var(--color-text-tertiary)]">引用关系</h4>{selected.usedBy.map((item) => <div key={`${item.kind}/${item.namespace}/${item.name}/${item.path}`} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{item.kind} / {item.namespace} / {item.name} · {item.path}</div>)}</div>}
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>（命名空间：{delItem?.namespace}），此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

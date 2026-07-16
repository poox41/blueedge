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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { getResourceCreatedAt, getResourceName, getResourceNamespace } from "@/api/adapters/kube-resource.adapter";
import { createServiceAccountResource, deleteServiceAccountResource, listServiceAccounts, updateServiceAccountResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { validateRequiredDomFields } from "@/lib/form-validation";
import { useNamespace } from "@/contexts/NamespaceContext";

interface SA { namespace: string; name: string; secrets: string; createdAt: string; automount?: boolean; raw: KubeResource; }

function toServiceAccount(item: any): SA {
  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    secrets: Array.isArray(item?.secrets) ? String(item.secrets.length) : "-",
    createdAt: getResourceCreatedAt(item),
    automount: item?.automountServiceAccountToken ?? true,
    raw: item,
  };
}

function yaml(n: SA) {
  return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
automountServiceAccountToken: ${n.automount ?? true}`;
}

function buildServiceAccountResource(form: { name: string; namespace: string; automount: boolean }, base?: KubeResource): KubeResource {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      ...base?.metadata,
      name: form.name,
      namespace: form.namespace,
    },
    automountServiceAccountToken: form.automount,
  };
}

export function ServiceAccounts() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<SA[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { selectedNamespace: ns } = useNamespace();
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<SA | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<SA | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", automount: true });
  const [editForm, setEditForm] = useState({ name: "", namespace: "default", automount: true });
  const [editItem, setEditItem] = useState<SA | null>(null);
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listServiceAccounts(ns === "all" ? undefined : ns);
      setData(items.map(toServiceAccount));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载服务账户失败");
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

  const openDetail = (d: SA) => { setSelected(d); setDetailOpen(true); };
  const openEdit = (d: SA) => {
    setEditItem(d);
    setEditForm({ name: d.name, namespace: d.namespace, automount: d.automount ?? true });
    setEditOpen(true);
  };
  const openDel = (d: SA) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteServiceAccountResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除服务账户失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    if (!validateRequiredDomFields([
      { elementId: "service-account-create-name", valid: Boolean(form.name.trim()), message: "请输入服务账户名称" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await createServiceAccountResource(buildServiceAccountResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", automount: true });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建服务账户失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleUpdate = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      await updateServiceAccountResource(editItem.namespace, buildServiceAccountResource(editForm, editItem.raw));
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新服务账户失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">服务账户</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[var(--color-text-primary)] hover:bg-[var(--color-brand-dark)] text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建账户</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建服务账户</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input id="service-account-create-name" placeholder="如 my-sa" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={form.automount} onChange={e => setForm({ ...form, automount: e.target.checked })} className="rounded" /><Label className="text-xs text-[var(--color-text-secondary)]">自动挂载 Token</Label></div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" onClick={handleCreate} disabled={isLoading}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑服务账户</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input value={editForm.name} disabled className="h-9 text-sm bg-[var(--color-bg-soft)]" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label><Input value={editForm.namespace} disabled className="h-9 text-sm bg-[var(--color-bg-soft)]" /></div>
                </div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={editForm.automount} onChange={e => setEditForm({ ...editForm, automount: e.target.checked })} className="rounded" /><Label className="text-xs text-[var(--color-text-secondary)]">自动挂载 Token</Label></div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm"  onClick={handleUpdate}>保存</Button></DialogFooter>
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
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">密钥</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={5} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">加载中...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={5} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无服务账户数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.secrets}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="action-group"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="action-button" title="编辑" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
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
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><Badge variant="outline" className="text-xs font-normal w-fit mt-2">{selected?.namespace}</Badge></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4"><div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="密钥" value={selected.secrets} /><Info label="自动挂载 Token" value={selected.automount ? "是" : "否"} /></div></TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除服务账户 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

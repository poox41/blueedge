import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { formatLabels, getResourceCreatedAt, getResourceName } from "@/api/adapters/kube-resource.adapter";
import { createClusterRoleResource, deleteClusterRoleResource, listClusterRoles, updateClusterRoleResource } from "@/api/services/resources";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { validateRequiredDomFields } from "@/lib/form-validation";

interface CR { name: string; labels: string; createdAt: string; rules?: Array<{ apiGroups: string[]; resources: string[]; verbs: string[] }>; raw: KubeResource; }

function toClusterRole(item: any): CR {
  return {
    name: getResourceName(item),
    labels: formatLabels(item?.metadata?.labels),
    createdAt: getResourceCreatedAt(item),
    rules: Array.isArray(item?.rules) ? item.rules : [],
    raw: item,
  };
}

function yaml(n: CR) {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${n.name}
${n.labels !== "-" ? `  labels:
    ${n.labels}` : ""}
rules:
${(n.rules || []).map(rule => `  - apiGroups: ["${rule.apiGroups.join('", "')}"]\n    resources: ["${rule.resources.join('", "')}"]\n    verbs: ["${rule.verbs.join('", "')}"]`).join("\n")}`;
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildRules(resources: string, verbs: string) {
  const resourceLines = resources.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const verbLines = verbs.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  return resourceLines.map((resourceLine, index) => ({
    apiGroups: [""],
    resources: splitCsv(resourceLine),
    verbs: splitCsv(verbLines[index] || verbLines[0] || "get,list,watch"),
  }));
}

function buildClusterRoleResource(form: { name: string; resources: string; verbs: string }, base?: KubeResource): KubeResource {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
    metadata: {
      ...base?.metadata,
      name: form.name,
    },
    rules: buildRules(form.resources, form.verbs),
  };
}

export function ClusterRoles() {
  const [data, setData] = useState<CR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<CR | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<CR | null>(null);
  const [form, setForm] = useState({ name: "", resources: "pods,nodes", verbs: "get,list,watch" });
  const [editForm, setEditForm] = useState({ name: "", resources: "pods,nodes", verbs: "get,list,watch" });
  const [editItem, setEditItem] = useState<CR | null>(null);
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listClusterRoles();
      setData(items.map(toClusterRole));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载集群角色失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => { let r = data; if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase())); return r; }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: CR) => { setSelected(d); setDetailOpen(true); };
  const openEdit = (d: CR) => {
    const firstRule = d.rules?.[0];
    setEditItem(d);
    setEditForm({
      name: d.name,
      resources: d.rules?.map((rule) => rule.resources?.join(",")).join("\n") || firstRule?.resources?.join(",") || "pods,nodes",
      verbs: d.rules?.map((rule) => rule.verbs?.join(",")).join("\n") || firstRule?.verbs?.join(",") || "get,list,watch",
    });
    setEditOpen(true);
  };
  const openDel = (d: CR) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteClusterRoleResource(delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除集群角色失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    if (!validateRequiredDomFields([
      { elementId: "cluster-role-create-name", valid: Boolean(form.name.trim()), message: "请输入集群角色名称" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await createClusterRoleResource(buildClusterRoleResource(form));
      setCreateOpen(false);
      setForm({ name: "", resources: "pods,nodes", verbs: "get,list,watch" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建集群角色失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleUpdate = async () => {
    if (!editItem) return;
    if (!validateRequiredDomFields([
      { elementId: "cluster-role-edit-resources", valid: Boolean(editForm.resources.trim()), message: "请输入资源规则" },
      { elementId: "cluster-role-edit-verbs", valid: Boolean(editForm.verbs.trim()), message: "请输入操作动词" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await updateClusterRoleResource(buildClusterRoleResource(editForm, editItem.raw));
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新集群角色失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">集群角色</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[var(--color-text-primary)] hover:bg-[var(--color-brand-dark)] text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建集群角色</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建集群角色</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input id="cluster-role-create-name" placeholder="如 cluster-reader" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">资源（每行一条规则，逗号分隔）</Label><Textarea value={form.resources} onChange={e => setForm({ ...form, resources: e.target.value })} className="min-h-20 text-sm" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">动词（每行对应一条规则，逗号分隔）</Label><Textarea value={form.verbs} onChange={e => setForm({ ...form, verbs: e.target.value })} className="min-h-20 text-sm" /></div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" onClick={handleCreate} disabled={isLoading}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑集群角色</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input value={editForm.name} disabled className="h-9 text-sm bg-[var(--color-bg-soft)]" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">资源（每行一条规则，逗号分隔）</Label><Textarea id="cluster-role-edit-resources" value={editForm.resources} onChange={e => setEditForm({ ...editForm, resources: e.target.value })} className="min-h-20 text-sm" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">动词（每行对应一条规则，逗号分隔）</Label><Textarea id="cluster-role-edit-verbs" value={editForm.verbs} onChange={e => setEditForm({ ...editForm, verbs: e.target.value })} className="min-h-20 text-sm" /></div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" onClick={handleUpdate} disabled={isLoading}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="toolbar-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm bg-white" /></div>
        <span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span>
      </div>
      {error && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">{error}</div>}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
        <Table><TableHeader><TableRow className="bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">标签</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={4} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">加载中...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无集群角色数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.labels}</TableCell>
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
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="rules" className="text-xs h-7">权限规则</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4"><div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="标签" value={selected.labels} /></div></TabsContent>
            <TabsContent value="rules" className="mt-3 space-y-2">{(selected.rules || []).map((r, i) => (<div key={i} className="bg-[var(--color-bg-soft)] rounded-md p-3"><p className="text-xs text-[var(--color-text-tertiary)] mb-1">API 组: {r.apiGroups.join(", ") || "core"}</p><p className="text-sm text-[var(--color-text-primary)] font-medium">资源: {r.resources.join(", ")}</p><div className="flex flex-wrap gap-1 mt-1">{r.verbs.map(v => (<Badge key={v} variant="secondary" className="text-xs font-normal bg-[var(--color-success-soft)] text-[var(--color-success)]">{v}</Badge>))}</div></div>))}</TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除集群角色？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

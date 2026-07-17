import { ListPagination } from "@/components/common/ListPagination";
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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, Link2, Pencil } from "lucide-react";
import { formatLabels, getResourceCreatedAt, getResourceName, getResourceNamespace, mapSubjects } from "@/api/adapters/kube-resource.adapter";
import { createRoleBindingResource, deleteRoleBindingResource, listRoleBindings, updateRoleBindingResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource } from "@/types/kubeedge";
import { validateRequiredDomFields } from "@/lib/form-validation";
import { useNamespace } from "@/contexts/NamespaceContext";

interface RB { namespace: string; name: string; roleRef: string; labels: string; createdAt: string; subjects?: Array<{ kind: string; name: string; namespace: string }>; raw: KubeResource; }

function toRoleBinding(item: any): RB {
  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    roleRef: item?.roleRef?.name || "-",
    labels: formatLabels(item?.metadata?.labels),
    createdAt: getResourceCreatedAt(item),
    subjects: mapSubjects(item?.subjects),
    raw: item,
  };
}

function yaml(n: RB) {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${n.roleRef}
subjects:
${(n.subjects || []).map(s => `  - kind: ${s.kind}\n    name: ${s.name}\n    namespace: ${s.namespace}`).join("\n")}`;
}

function parseSubjects(value: string, fallbackNamespace: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [kind = "ServiceAccount", name = "default", namespace = fallbackNamespace] = line.split(",").map((item) => item.trim());
    return { kind, name, namespace };
  });
}

function formatSubjects(subjects: RB["subjects"], fallbackNamespace: string) {
  const rows = subjects && subjects.length > 0 ? subjects : [{ kind: "ServiceAccount", name: "default", namespace: fallbackNamespace }];
  return rows.map((item) => `${item.kind},${item.name},${item.namespace || fallbackNamespace}`).join("\n");
}

function buildRoleBindingResource(form: { name: string; namespace: string; role: string; subject: string }, base?: KubeResource): KubeResource {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      ...base?.metadata,
      name: form.name,
      namespace: form.namespace,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: form.role,
    },
    subjects: parseSubjects(form.subject, form.namespace),
  };
}

export function RoleBindings() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<RB[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { selectedNamespace: ns } = useNamespace();
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<RB | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<RB | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", role: "", subject: "default" });
  const [editForm, setEditForm] = useState({ name: "", namespace: "default", role: "", subject: "default" });
  const [editItem, setEditItem] = useState<RB | null>(null);
  const [pageSize, setPageSize] = useState(10);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listRoleBindings(ns === "all" ? undefined : ns);
      setData(items.map(toRoleBinding));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载角色绑定失败");
    } finally {
      setIsLoading(false);
    }
  }, [ns]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => { let r = data; if (ns !== "all") r = r.filter(d => d.namespace === ns); if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase())); return r; }, [data, ns, search]);
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: RB) => { setSelected(d); setDetailOpen(true); };
  const openEdit = (d: RB) => {
    setEditItem(d);
    setEditForm({
      name: d.name,
      namespace: d.namespace,
      role: d.roleRef === "-" ? "" : d.roleRef,
      subject: formatSubjects(d.subjects, d.namespace),
    });
    setEditOpen(true);
  };
  const openDel = (d: RB) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteRoleBindingResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除角色绑定失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    if (!validateRequiredDomFields([
      { elementId: "role-binding-create-name", valid: Boolean(form.name.trim()), message: "请输入角色绑定名称" },
      { elementId: "role-binding-create-role", valid: Boolean(form.role.trim()), message: "请输入角色引用" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await createRoleBindingResource(buildRoleBindingResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", role: "", subject: "default" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建角色绑定失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleUpdate = async () => {
    if (!editItem) return;
    if (!validateRequiredDomFields([
      { elementId: "role-binding-edit-role", valid: Boolean(editForm.role.trim()), message: "请输入角色引用" },
      { elementId: "role-binding-edit-subject", valid: Boolean(editForm.subject.trim()), message: "请输入绑定主体" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await updateRoleBindingResource(editItem.namespace, buildRoleBindingResource(editForm, editItem.raw));
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新角色绑定失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">角色绑定</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className="w-3.5 h-3.5 mr-1" />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[var(--color-text-primary)] hover:bg-[var(--color-brand-dark)] text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建绑定</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建角色绑定</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input id="role-binding-create-name" placeholder="如 my-binding" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">角色引用</Label><Input id="role-binding-create-role" placeholder="角色名称" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">绑定主体</Label><Textarea value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="min-h-20 text-sm" placeholder="ServiceAccount,default,default" /></div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" onClick={handleCreate} disabled={isLoading}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑角色绑定</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input value={editForm.name} disabled className="h-9 text-sm bg-[var(--color-bg-soft)]" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label><Input value={editForm.namespace} disabled className="h-9 text-sm bg-[var(--color-bg-soft)]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">角色引用</Label><Input id="role-binding-edit-role" value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">绑定主体</Label><Textarea id="role-binding-edit-subject" value={editForm.subject} onChange={e => setEditForm({ ...editForm, subject: e.target.value })} className="min-h-20 text-sm" /></div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" onClick={handleUpdate} disabled={isLoading}>保存</Button></DialogFooter>
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
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">角色引用</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">标签</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">加载中...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无角色绑定数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)]">{row.roleRef}</Badge></TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.labels}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="action-group"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="action-button" title="编辑" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <ListPagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><Badge variant="outline" className="text-xs font-normal w-fit mt-2">{selected?.namespace}</Badge></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="subjects" className="text-xs h-7">绑定主体</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4"><div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="角色引用" value={selected.roleRef} /><Info label="标签" value={selected.labels} /></div></TabsContent>
            <TabsContent value="subjects" className="mt-3 space-y-2">{(selected.subjects || []).map((s, i) => (<div key={i} className="bg-[var(--color-bg-soft)] rounded-md p-3 flex items-center gap-3"><Link2 className="w-4 h-4 text-[var(--color-brand)]" /><div><p className="text-sm font-medium">{s.name}</p><p className="text-xs text-[var(--color-text-tertiary)]">{s.kind} / {s.namespace}</p></div></div>))}</TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除角色绑定 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

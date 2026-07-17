import { ListPagination } from "@/components/common/ListPagination";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, Pencil } from "lucide-react";
import { createServiceResource, deleteServiceResource, getService, listServices, updateServiceResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, ServiceView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { validateRequiredDomFields } from "@/lib/form-validation";
import { useNamespace } from "@/contexts/NamespaceContext";

interface Svc { namespace: string; name: string; type: string; clusterIP: string; externalIP: string; ports: string; createdAt: string; selector?: Record<string, string>; sessionAffinity?: string; raw: KubeResource; }

function toServiceRow(item: ServiceView): Svc {
  const raw = item.raw as Record<string, any>;
  return {
    namespace: item.namespace,
    name: item.name,
    type: item.type,
    clusterIP: item.clusterIP,
    externalIP: item.externalIP,
    ports: item.ports,
    createdAt: item.createdAt,
    selector: raw.spec?.selector || raw.selector || {},
    sessionAffinity: raw.spec?.sessionAffinity || "None",
    raw: item.raw,
  };
}

function getFirstServicePort(raw: KubeResource): { port: number; targetPort: number } {
  const ports = (raw.spec?.ports || []) as Array<{ port?: number; targetPort?: number | string }>;
  const first = Array.isArray(ports) ? ports[0] : undefined;
  return {
    port: Number(first?.port || 80),
    targetPort: Number(first?.targetPort || first?.port || 80),
  };
}

function yaml(n: Svc) {
  return `apiVersion: v1
kind: Service
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  type: ${n.type}
  clusterIP: ${n.clusterIP}
  selector:
${Object.entries(n.selector || {}).map(([k, v]) => `    ${k}: ${v}`).join("\n")}
  sessionAffinity: ${n.sessionAffinity || "None"}`;
}

function buildServiceResource(form: {
  name: string;
  namespace: string;
  type: string;
  port: number;
  targetPort: number;
}): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { app: form.name },
    },
    spec: {
      type: form.type,
      selector: { app: form.name },
      ports: [
        {
          name: "http",
          port: form.port,
          targetPort: form.targetPort,
          protocol: "TCP",
        },
      ],
      sessionAffinity: "None",
    },
  };
}

export function Services() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<Svc[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { selectedNamespace: ns } = useNamespace();
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Svc | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<Svc | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", type: "ClusterIP", port: 80, targetPort: 80 });
  const [editItem, setEditItem] = useState<Svc | null>(null);
  const [editForm, setEditForm] = useState({ type: "ClusterIP", port: 80, targetPort: 80 });
  const [pageSize, setPageSize] = useState(10);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listServices(ns === "all" ? undefined : ns);
      setData(rows.map(toServiceRow));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "服务数据加载失败");
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
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, ns, search]);
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (d: Svc) => {
    setSelected(d);
    setDetailOpen(true);
    try {
      setSelected(toServiceRow(await getService(d.namespace, d.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载服务详情失败");
    }
  };
  const openEdit = async (d: Svc) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toServiceRow(await getService(d.namespace, d.name));
      const firstPort = getFirstServicePort(detail.raw);
      setEditItem(detail);
      setEditForm({ type: detail.type, port: firstPort.port, targetPort: firstPort.targetPort });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载服务详情失败");
    } finally {
      setIsLoading(false);
    }
  };
  const openDel = (d: Svc) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteServiceResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除服务失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    if (!validateRequiredDomFields([
      { elementId: "service-create-name", valid: Boolean(form.name.trim()), message: "请输入服务名称" },
      { elementId: "service-create-port", valid: form.port > 0, message: "请输入大于 0 的服务端口" },
      { elementId: "service-create-target-port", valid: form.targetPort > 0, message: "请输入大于 0 的目标端口" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      await createServiceResource(buildServiceResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", type: "ClusterIP", port: 80, targetPort: 80 });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建服务失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleEdit = async () => {
    if (!editItem) return;
    if (!validateRequiredDomFields([
      { elementId: "service-edit-port", valid: editForm.port > 0, message: "请输入大于 0 的服务端口" },
      { elementId: "service-edit-target-port", valid: editForm.targetPort > 0, message: "请输入大于 0 的目标端口" },
    ])) return;
    setIsLoading(true);
    setError("");
    try {
      const currentPorts = (editItem.raw.spec?.ports || []) as Array<Record<string, unknown>>;
      const firstPort = currentPorts[0] || {};
      const nextPort: Record<string, unknown> = {
        ...firstPort,
        name: firstPort.name || "http",
        protocol: firstPort.protocol || "TCP",
        port: editForm.port,
        targetPort: editForm.targetPort,
      };
      if (editForm.type === "ClusterIP") {
        delete nextPort.nodePort;
      }
      const updated: KubeResource = {
        ...editItem.raw,
        spec: {
          ...(editItem.raw.spec || {}),
          type: editForm.type,
          ports: [
            nextPort,
            ...currentPorts.slice(1),
          ],
        },
      };
      await updateServiceResource(editItem.namespace, updated);
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新服务失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">服务</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[var(--color-text-primary)] hover:bg-[var(--color-brand-dark)] text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建服务</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建服务</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input id="service-create-name" placeholder="如 my-service" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">类型</Label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="blueedge-native-select"><option>ClusterIP</option><option>NodePort</option><option>LoadBalancer</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">端口</Label><Input id="service-create-port" type="number" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">目标端口</Label><Input id="service-create-target-port" type="number" value={form.targetPort} onChange={e => setForm({ ...form, targetPort: Number(e.target.value) })} className="h-9 text-sm" /></div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" onClick={handleCreate} disabled={isLoading}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑服务</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <Info label="名称" value={editItem?.name || "-"} />
                  <Info label="命名空间" value={editItem?.namespace || "-"} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">类型</Label>
                    <select value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })} className="blueedge-native-select"><option>ClusterIP</option><option>NodePort</option><option>LoadBalancer</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">端口</Label><Input id="service-edit-port" type="number" value={editForm.port} onChange={e => setEditForm({ ...editForm, port: Number(e.target.value) })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">目标端口</Label><Input id="service-edit-target-port" type="number" value={editForm.targetPort} onChange={e => setEditForm({ ...editForm, targetPort: Number(e.target.value) })} className="h-9 text-sm" /></div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" onClick={handleEdit} disabled={isLoading}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="toolbar-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm bg-white" /></div>
        <div className="flex items-center gap-3"><span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span></div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
        <Table><TableHeader><TableRow className="bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">类型</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">集群 IP</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">外部 IP</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">端口</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载服务数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无服务数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className={cn("text-xs font-normal", row.type === "NodePort" ? "border-[var(--color-warning-soft)] text-[var(--color-warning)] bg-[var(--color-warning-soft)]" : "border-[var(--color-brand-light)] text-[var(--color-brand)] bg-[var(--color-brand-light)]")}>{row.type}</Badge></TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3 font-mono">{row.clusterIP}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.externalIP}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.ports}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="action-group"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="action-button" title="编辑" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <ListPagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge><Badge variant="outline" className="text-xs font-normal">{selected?.type}</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="类型" value={selected.type} /><Info label="集群 IP" value={selected.clusterIP} /><Info label="外部 IP" value={selected.externalIP} /><Info label="端口" value={selected.ports} /><Info label="会话亲和性" value={selected.sessionAffinity || "None"} /></div>
              <div className="space-y-2"><h4 className="text-xs text-[var(--color-text-tertiary)]">选择器</h4><div className="flex flex-wrap gap-2">{Object.entries(selected.selector || {}).map(([k, v]) => (<Badge key={k} variant="secondary" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)]">{k}: {v}</Badge>))}</div></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除服务？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除服务 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>（命名空间：{delItem?.namespace}），此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

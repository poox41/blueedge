import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { createRuleEndpointResource, deleteRuleEndpointResource, listRuleEndpoints } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface RE { namespace: string; name: string; ruleEndpointType: string; targetResource: string; description: string; createdAt: string; }

function toRuleEndpointRow(item: RuleEndpointView): RE {
  const raw = item.raw as Record<string, any>;
  return {
    namespace: item.namespace,
    name: item.name,
    ruleEndpointType: item.type,
    targetResource: item.targetResource,
    description: raw.spec?.description || raw.description || "",
    createdAt: item.createdAt,
  };
}

function yaml(n: RE) {
  return `apiVersion: rules.kubeedge.io/v1
kind: RuleEndpoint
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  ruleEndpointType: ${n.ruleEndpointType}
  targetResource: ${n.targetResource || '""'}`;
}

function buildRuleEndpointResource(form: { name: string; namespace: string; type: string; targetResource: string }): KubeResource {
  return {
    apiVersion: "rules.kubeedge.io/v1",
    kind: "RuleEndpoint",
    metadata: {
      name: form.name,
      namespace: form.namespace,
    },
    spec: {
      ruleEndpointType: form.type,
      properties: form.targetResource ? { targetResource: form.targetResource } : {},
    },
  };
}

export function RuleEndpoints() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<RE[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ns, setNs] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<RE | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<RE | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", type: "EventBus", targetResource: "" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listRuleEndpoints(ns === "all" ? undefined : ns);
      setData(rows.map(toRuleEndpointRow));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "规则端点数据加载失败");
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: RE) => { setSelected(d); setDetailOpen(true); };
  const openDel = (d: RE) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteRuleEndpointResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除规则端点失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      await createRuleEndpointResource(buildRuleEndpointResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", type: "EventBus", targetResource: "" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建规则端点失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">规则端点</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建端点</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建规则端点</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 my-endpoint" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">端点类型</Label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>EventBus</option><option>Rest</option><option>ServiceBus</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">目标资源</Label><Input placeholder="如 topic-name" value={form.targetResource} onChange={e => setForm({ ...form, targetResource: e.target.value })} className="h-9 text-sm" /></div>
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
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[#FFF7E8] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">类型</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">目标资源</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">正在加载规则端点数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">暂无规则端点数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className={cn("text-xs font-normal", row.ruleEndpointType === "EventBus" ? "border-[#E8FFEA] text-[#00B42A] bg-[#E8FFEA]" : "border-[#E8F3FF] text-[#165DFF] bg-[#E8F3FF]")}>{row.ruleEndpointType}</Badge></TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.targetResource || "-"}</TableCell>
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
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><Badge variant="outline" className="text-xs font-normal w-fit mt-2">{selected?.namespace}</Badge></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="类型" value={selected.ruleEndpointType} /><Info label="目标资源" value={selected.targetResource || "-"} /></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除规则端点 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

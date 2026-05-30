import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo, useEffect, useCallback } from "react";
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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight, ArrowRight, Pencil } from "lucide-react";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { createRuleResource, deleteRuleResource, getRule, listRuleEndpoints, listRules, updateRuleResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView, RuleView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface Rule { namespace: string; name: string; source: string; sourceResource: string; target: string; targetResource: string; createdAt: string; raw: KubeResource; }
type RouteKind = "rest-eventbus" | "eventbus-rest" | "rest-servicebus";
type EndpointKind = "rest" | "eventbus" | "servicebus";

const routeOptions: Array<{ value: RouteKind; label: string; sourceType: EndpointKind; targetType: EndpointKind }> = [
  { value: "rest-eventbus", label: "Rest -> EventBus", sourceType: "rest", targetType: "eventbus" },
  { value: "eventbus-rest", label: "EventBus -> Rest", sourceType: "eventbus", targetType: "rest" },
  { value: "rest-servicebus", label: "Rest -> ServiceBus", sourceType: "rest", targetType: "servicebus" },
];

function normalizeEndpointType(type: string): EndpointKind {
  const normalized = type.toLowerCase();
  if (normalized === "rest") return "rest";
  if (normalized === "servicebus") return "servicebus";
  return "eventbus";
}

function endpointTypeText(type: string): string {
  const normalized = normalizeEndpointType(type);
  if (normalized === "rest") return "云端 rest";
  if (normalized === "servicebus") return "边端 servicebus";
  return "边端 eventbus";
}

function endpointTypeClass(type: string): string {
  const normalized = normalizeEndpointType(type);
  if (normalized === "rest") return "bg-[#E8F3FF] text-[#165DFF]";
  if (normalized === "servicebus") return "bg-[#FFF7E8] text-[#D25F00]";
  return "bg-[#E8FFEA] text-[#00B42A]";
}

function endpointMatchesNamespace(endpoint: RuleEndpointView, namespace: string): boolean {
  return endpoint.namespace === namespace || !endpoint.namespace;
}

function endpointMatchesType(endpoint: RuleEndpointView, type: EndpointKind): boolean {
  return normalizeEndpointType(endpoint.type) === type;
}

function findEndpoint(endpoints: RuleEndpointView[], name: string): RuleEndpointView | undefined {
  return endpoints.find((endpoint) => endpoint.name === name);
}

function resourceValue(raw: KubeResource, key: "sourceResource" | "targetResource"): string {
  const value = raw.spec?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const resource = value as Record<string, unknown>;
  if (typeof resource.path === "string") return resource.path;
  if (typeof resource.topic === "string") return resource.topic;
  if (typeof resource.resource === "string") return resource.resource;
  return "";
}

function resourceNodeName(raw: KubeResource, key: "sourceResource" | "targetResource", fallback: string): string {
  const value = raw.spec?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const resource = value as Record<string, unknown>;
  return typeof resource.node_name === "string" ? resource.node_name : fallback;
}

function buildRuleResourceMap(
  type: EndpointKind,
  role: "source" | "target",
  value: string,
  nodeName?: string,
): Record<string, string> {
  const trimmed = value.trim();
  if (type === "eventbus") {
    return {
      ...(role === "source" && nodeName ? { node_name: nodeName } : {}),
      ...(trimmed ? { topic: trimmed } : {}),
    };
  }
  if (type === "rest") {
    return trimmed ? { [role === "source" ? "path" : "resource"]: trimmed } : {};
  }
  return trimmed ? { path: trimmed } : {};
}

function toRuleRow(item: RuleView): Rule {
  return {
    namespace: item.namespace,
    name: item.name,
    source: item.source,
    sourceResource: item.sourceResource || "",
    target: item.target,
    targetResource: item.targetResource || "",
    createdAt: item.createdAt,
    raw: item.raw,
  };
}

function yaml(n: Rule) {
  return `apiVersion: rules.kubeedge.io/v1
kind: Rule
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  source: ${n.source}
  sourceResource: ${n.sourceResource || '""'}
  target: ${n.target}
  targetResource: ${n.targetResource || '""'}`;
}

function buildRuleResource(form: {
  name: string;
  namespace: string;
  routeKind: RouteKind;
  source: string;
  sourceResource: string;
  sourceNodeName: string;
  target: string;
  targetResource: string;
  description: string;
}): KubeResource {
  const route = routeOptions.find((item) => item.value === form.routeKind) || routeOptions[0];
  return {
    apiVersion: "rules.kubeedge.io/v1",
    kind: "Rule",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: form.description.trim() ? { description: form.description.trim() } : undefined,
    },
    spec: {
      source: form.source,
      sourceResource: buildRuleResourceMap(route.sourceType, "source", form.sourceResource, form.sourceNodeName),
      target: form.target,
      targetResource: buildRuleResourceMap(route.targetType, "target", form.targetResource),
    },
  };
}

export function Rules() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<Rule[]>([]);
  const [endpointOptions, setEndpointOptions] = useState<RuleEndpointView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ns, setNs] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Rule | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<Rule | null>(null);
  const [form, setForm] = useState({
    name: "",
    namespace: "default",
    routeKind: "rest-eventbus" as RouteKind,
    source: "",
    sourceResource: "",
    sourceNodeName: "",
    target: "",
    targetResource: "",
    description: "",
  });
  const [editItem, setEditItem] = useState<Rule | null>(null);
  const [editForm, setEditForm] = useState({ source: "", sourceResource: "", sourceNodeName: "", target: "", targetResource: "", description: "" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [rules, endpoints] = await Promise.all([
        listRules(ns === "all" ? undefined : ns),
        listRuleEndpoints(ns === "all" ? undefined : ns).catch(() => []),
      ]);
      setData(rules.map(toRuleRow));
      setEndpointOptions(endpoints);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "规则数据加载失败");
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

  const openDetail = async (d: Rule) => {
    setSelected(d);
    setDetailOpen(true);
    try {
      setSelected(toRuleRow(await getRule(d.namespace, d.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载规则详情失败");
    }
  };
  const openEdit = async (d: Rule) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toRuleRow(await getRule(d.namespace, d.name));
      setEditItem(detail);
      setEditForm({
        source: detail.source,
        sourceResource: resourceValue(detail.raw, "sourceResource") || detail.sourceResource || "",
        sourceNodeName: resourceNodeName(detail.raw, "sourceResource", ""),
        target: detail.target,
        targetResource: resourceValue(detail.raw, "targetResource") || detail.targetResource || "",
        description: detail.raw.metadata?.labels?.description || "",
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载规则详情失败");
    } finally {
      setIsLoading(false);
    }
  };
  const openDel = (d: Rule) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteRuleResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除规则失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      const source = findEndpoint(endpointOptions, form.source);
      const target = findEndpoint(endpointOptions, form.target);
      const route = routeOptions.find((item) => item.value === form.routeKind) || routeOptions[0];
      if (!source || !target) throw new Error("请选择源端点和目的端点");
      if (!endpointMatchesType(source, route.sourceType) || !endpointMatchesType(target, route.targetType)) {
        throw new Error(`当前转发路径需要 ${route.label} 类型的端点`);
      }
      await createRuleResource(buildRuleResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", routeKind: "rest-eventbus", source: "", sourceResource: "", sourceNodeName: "", target: "", targetResource: "", description: "" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建规则失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleEdit = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      const sourceEndpoint = findEndpoint(endpointOptions, editForm.source);
      const targetEndpoint = findEndpoint(endpointOptions, editForm.target);
      const sourceType = sourceEndpoint ? normalizeEndpointType(sourceEndpoint.type) : "rest";
      const targetType = targetEndpoint ? normalizeEndpointType(targetEndpoint.type) : "rest";
      const updated: KubeResource = {
        ...editItem.raw,
        metadata: {
          ...(editItem.raw.metadata || {}),
          labels: {
            ...(editItem.raw.metadata?.labels || {}),
            ...(editForm.description.trim() ? { description: editForm.description.trim() } : {}),
          },
        },
        spec: {
          ...(editItem.raw.spec || {}),
          source: editForm.source,
          sourceResource: buildRuleResourceMap(sourceType, "source", editForm.sourceResource, editForm.sourceNodeName),
          target: editForm.target,
          targetResource: buildRuleResourceMap(targetType, "target", editForm.targetResource),
        },
      };
      await updateRuleResource(editItem.namespace, updated);
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新规则失败");
    } finally {
      setIsLoading(false);
    }
  };

  const currentRoute = routeOptions.find((item) => item.value === form.routeKind) || routeOptions[0];
  const namespaceEndpoints = endpointOptions.filter((endpoint) => endpointMatchesNamespace(endpoint, form.namespace));
  const sourceEndpointOptions = namespaceEndpoints.filter((endpoint) => endpointMatchesType(endpoint, currentRoute.sourceType));
  const targetEndpointOptions = namespaceEndpoints.filter((endpoint) => endpointMatchesType(endpoint, currentRoute.targetType));
  const sourceEndpoint = findEndpoint(endpointOptions, form.source);
  const targetEndpoint = findEndpoint(endpointOptions, form.target);
  const editSourceEndpoint = findEndpoint(endpointOptions, editForm.source);
  const editSourceType = editSourceEndpoint ? normalizeEndpointType(editSourceEndpoint.type) : "rest";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">规则</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建规则</Button></DialogTrigger>
            <DialogContent className="max-w-[720px] max-h-[88vh] grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
              <DialogHeader className="px-6 py-4 border-b border-[#E5E6EB]"><DialogTitle className="text-base">创建消息路由</DialogTitle></DialogHeader>
              <div className="min-h-0 overflow-y-auto px-6 py-4 space-y-4">
                <div className="rounded-md border border-[#94BFFF] bg-[#E8F3FF] px-4 py-3 text-sm leading-6 text-[#1D2129]">
                  <p className="font-medium mb-1">当前支持如下三种消息转发路径</p>
                  <p>1.Rest &gt; EventBus：用户应用调用云端的 REST API 发送消息，最终消息发送到边缘中的 MQTT broker。</p>
                  <p>2.EventBus &gt; Rest：用户向边缘中的 MQTT broker 发布消息，最终将消息发送到云端的 REST API。</p>
                  <p>3.Rest &gt; ServiceBus：用户应用调用云端 REST API 发送消息，最终消息发送到边缘应用。</p>
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3">
                  <Label className="text-sm text-right text-[#4E5969]">转发路径</Label>
                  <select value={form.routeKind} onChange={e => {
                    const routeKind = e.target.value as RouteKind;
                    setForm({ ...form, routeKind, source: "", sourceResource: "", sourceNodeName: "", target: "", targetResource: "" });
                  }} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">
                    {routeOptions.map((route) => (<option key={route.value} value={route.value}>{route.label}</option>))}
                  </select>
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3">
                  <Label className="text-sm text-right text-[#4E5969]">消息路由名称 <span className="text-[#F53F3F]">*</span></Label><Input placeholder="请输入消息路由名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3">
                  <Label className="text-sm text-right text-[#4E5969]">命名空间 <span className="text-[#F53F3F]">*</span></Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value, source: "", target: "" })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3"><Label className="text-sm text-right text-[#4E5969]">源端点 <span className="text-[#F53F3F]">*</span></Label>
                  <div className="relative">
                    <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 pr-28 border-[#C9CDD4]"><option value="">选择端点</option>{sourceEndpointOptions.map(e => (<option key={e.name} value={e.name}>{e.name}</option>))}</select>
                    {sourceEndpoint && <Badge className={cn("absolute right-8 top-1/2 -translate-y-1/2 text-xs font-normal", endpointTypeClass(sourceEndpoint.type))}>{endpointTypeText(sourceEndpoint.type)}</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3"><Label className="text-sm text-right text-[#4E5969]">源端点资源 <span className="text-[#F53F3F]">*</span></Label>
                  {currentRoute.sourceType === "eventbus" ? (
                    <div className="grid grid-cols-[180px_1fr] gap-2">
                      <Input placeholder="请输入 node_name，如 aipc-31" value={form.sourceNodeName} onChange={e => setForm({ ...form, sourceNodeName: e.target.value })} className="h-9 text-sm" />
                      <Input placeholder="请输入一个 topic" value={form.sourceResource} onChange={e => setForm({ ...form, sourceResource: e.target.value })} className="h-9 text-sm" />
                    </div>
                  ) : (
                    <Input placeholder="请输入 Rest 路径，如 /abc/bc" value={form.sourceResource} onChange={e => setForm({ ...form, sourceResource: e.target.value })} className="h-9 text-sm" />
                  )}
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3"><Label className="text-sm text-right text-[#4E5969]">目的端点 <span className="text-[#F53F3F]">*</span></Label>
                  <div className="relative">
                    <select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 pr-28 border-[#C9CDD4]"><option value="">选择端点</option>{targetEndpointOptions.map(e => (<option key={e.name} value={e.name}>{e.name}</option>))}</select>
                    {targetEndpoint && <Badge className={cn("absolute right-8 top-1/2 -translate-y-1/2 text-xs font-normal", endpointTypeClass(targetEndpoint.type))}>{endpointTypeText(targetEndpoint.type)}</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-[128px_1fr] items-center gap-3"><Label className="text-sm text-right text-[#4E5969]">目的端点资源 <span className="text-[#F53F3F]">*</span></Label>
                  <Input
                    placeholder={currentRoute.targetType === "eventbus" ? "请输入 EventBus Topic" : currentRoute.targetType === "rest" ? "请输入 Rest 地址，如 http://abc.com/bc" : "请输入 ServiceBus 路径，如 /request_path"}
                    value={form.targetResource}
                    onChange={e => setForm({ ...form, targetResource: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-[128px_1fr] items-start gap-3"><Label className="pt-2 text-sm text-right text-[#4E5969]">描述</Label><Textarea placeholder="请输入消息路由描述" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="min-h-20 text-sm" /></div>
              </div>
              <DialogFooter className="px-6 py-4 border-t border-[#E5E6EB] bg-white"><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name || !form.source || !form.target || !form.sourceResource || !form.targetResource || (currentRoute.sourceType === "eventbus" && !form.sourceNodeName)}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑规则</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4"><Info label="名称" value={editItem?.name || "-"} /><Info label="命名空间" value={editItem?.namespace || "-"} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">源端点</Label>
                    <select value={editForm.source} onChange={e => setEditForm({ ...editForm, source: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option value="">选择端点</option>{endpointOptions.map(e => (<option key={e.name} value={e.name}>{e.name}</option>))}</select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">目标端点</Label>
                    <select value={editForm.target} onChange={e => setEditForm({ ...editForm, target: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option value="">选择端点</option>{endpointOptions.map(e => (<option key={e.name} value={e.name}>{e.name}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">源资源</Label><Input value={editForm.sourceResource} onChange={e => setEditForm({ ...editForm, sourceResource: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">目标资源</Label><Input value={editForm.targetResource} onChange={e => setEditForm({ ...editForm, targetResource: e.target.value })} className="h-9 text-sm" /></div>
                </div>
                {editSourceType === "eventbus" && (
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">源节点 node_name</Label><Input value={editForm.sourceNodeName} onChange={e => setEditForm({ ...editForm, sourceNodeName: e.target.value })} className="h-9 text-sm" /></div>
                )}
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleEdit} disabled={!editItem || !editForm.source || !editForm.target}>保存</Button></DialogFooter>
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
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">源端点</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">目标端点</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">正在加载规则数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">暂无规则数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal bg-[#E8F3FF] text-[#165DFF]">{row.source}</Badge></TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal bg-[#E8FFEA] text-[#00B42A]">{row.target}</Badge></TableCell>
            <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}><Eye className="w-3.5 h-3.5 mr-1" />详情</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openEdit(row)}><Pencil className="w-3.5 h-3.5 mr-1" />编辑</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => openDel(row)}><Trash2 className="w-3.5 h-3.5 mr-1" />删除</Button></div></TableCell>
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
              <div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="源端点" value={selected.source} /><Info label="目标端点" value={selected.target} /><Info label="源资源" value={selected.sourceResource || "-"} /><Info label="目标资源" value={selected.targetResource || "-"} /></div>
              <div className="bg-[#F7F8FA] rounded-lg p-4"><div className="flex items-center justify-center gap-4"><Badge variant="outline" className="text-xs bg-[#E8F3FF] text-[#165DFF]">{selected.source}</Badge><ArrowRight className="w-5 h-5 text-[#86909C]" /><Badge variant="outline" className="text-xs bg-[#E8FFEA] text-[#00B42A]">{selected.target}</Badge></div><p className="text-center text-xs text-[#86909C] mt-2">数据流向</p></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除规则？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除规则 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

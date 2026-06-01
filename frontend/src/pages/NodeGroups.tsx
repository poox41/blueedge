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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { createNodeGroupResource, deleteNodeGroupResource, getNodeGroup, listNodeGroups, listNodes, updateNodeGroupResource } from "@/api/services/resources";
import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface NodeGroup {
  name: string; namespace: string; nodes: string[];
  nodeSelector: Record<string, string>; status: string; statusColor: string; createdAt: string;
  allocationPolicy?: string; spreadConstraints?: boolean;
  raw: KubeResource;
}

interface LabelRow {
  key: string;
  value: string;
}

interface NodeGroupForm {
  name: string;
  node: string;
  matchLabels: LabelRow[];
}

const emptyLabelRow: LabelRow = { key: "", value: "" };

function compactObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null && item !== "")
      .map(([key, item]) => [key, String(item)]),
  );
}

function extractSelector(item: any): Record<string, string> {
  return compactObject(
    item?.spec?.matchLabels ||
    item?.spec?.nodeSelector ||
    item?.spec?.selector?.matchLabels ||
    item?.spec?.selector ||
    item?.matchLabels ||
    item?.nodeSelector ||
    item?.selector,
  );
}

function extractNodes(item: any): string[] {
  const rawNodes =
    item?.status?.nodes ||
    item?.status?.nodeNames ||
    item?.spec?.nodes ||
    item?.spec?.nodeNames ||
    item?.nodes ||
    item?.nodeNames;

  if (!Array.isArray(rawNodes)) return [];
  return rawNodes
    .map((node: any) => typeof node === "string" ? node : node?.name || node?.nodeName)
    .filter(Boolean);
}

function selectorMatchesNode(selector: Record<string, string>, node: EdgeNodeView): boolean {
  const labels = node.raw?.metadata?.labels || {};
  const entries = Object.entries(selector);
  if (entries.length === 0) return false;

  return entries.every(([key, value]) => {
    if (labels[key] === value) return true;
    if (key === "nodeType" && value === node.role) return true;
    if (key === "role" && value === node.role) return true;
    if (key === "kubeedge" && value === node.role) return true;
    return false;
  });
}

function toNodeGroup(item: any, allNodes: EdgeNodeView[] = []): NodeGroup {
  const selector = extractSelector(item);
  const rawNodes = extractNodes(item);
  const matchedNodes = rawNodes.length > 0 ? rawNodes : allNodes.filter((node) => selectorMatchesNode(selector, node)).map((node) => node.name);
  const statusValue = typeof item?.status === "string" ? item.status : item?.status?.phase || item?.phase || "Ready";
  return {
    name: item?.metadata?.name || item?.name || "-",
    namespace: item?.metadata?.namespace || item?.namespace || "default",
    nodes: matchedNodes,
    nodeSelector: selector,
    status: statusValue === "Ready" || statusValue === "就绪" ? "就绪" : String(statusValue),
    statusColor: statusValue === "Ready" || statusValue === "就绪" ? "success" : "warning",
    createdAt: item?.metadata?.creationTimestamp || item?.creationTimestamp || item?.createdAt || "-",
    allocationPolicy: item?.spec?.allocationPolicy || item?.spec?.type || item?.allocationPolicy || "Spread",
    spreadConstraints: item?.spec?.spreadConstraints ?? item?.spreadConstraints ?? true,
    raw: item,
  };
}

function yamlNg(n: NodeGroup) {
  return `apiVersion: apps.kubeedge.io/v1alpha1
kind: NodeGroup
metadata:
  name: ${n.name}
spec:
  nodes:
${n.nodes.map((node) => `  - ${node}`).join("\n") || "  []"}
  matchLabels:
${Object.entries(n.nodeSelector).map(([k, v]) => `    ${k}: ${v}`).join("\n") || "    {}"}`;
}

function labelsToRows(labels: Record<string, string>): LabelRow[] {
  const rows = Object.entries(labels).map(([key, value]) => ({ key, value }));
  return rows.length > 0 ? rows : [{ ...emptyLabelRow }];
}

function rowsToLabels(rows: LabelRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((labels, row) => {
    const key = row.key.trim();
    if (key) labels[key] = row.value.trim();
    return labels;
  }, {});
}

function buildNodeGroupResource(form: NodeGroupForm): KubeResource {
  const matchLabels = rowsToLabels(form.matchLabels);
  return {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "NodeGroup",
    metadata: {
      name: form.name.trim(),
    },
    spec: {
      nodes: form.node ? [form.node] : [],
      ...(Object.keys(matchLabels).length ? { matchLabels } : {}),
    },
  };
}

export function NodeGroups() {
  const [data, setData] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<NodeGroup | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<NodeGroup | null>(null);
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [form, setForm] = useState<NodeGroupForm>({ name: "", node: "", matchLabels: [{ ...emptyLabelRow }] });
  const [editItem, setEditItem] = useState<NodeGroup | null>(null);
  const [editForm, setEditForm] = useState<NodeGroupForm>({ name: "", node: "", matchLabels: [{ ...emptyLabelRow }] });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [rows, allNodes] = await Promise.all([listNodeGroups(), listNodes()]);
      setNodeOptions(allNodes.map((node) => node.name).filter(Boolean));
      const details = await Promise.all(
        rows.map(async (row) => {
          const name = row?.metadata?.name || row?.name;
          if (!name) return row;
          try {
            return await getNodeGroup(name);
          } catch {
            return row;
          }
        }),
      );
      setData(details.map((row) => toNodeGroup(row, allNodes)));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点组数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    let r = data;
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (n: NodeGroup) => {
    setSelected(n);
    setDetailOpen(true);
    try {
      const [detail, allNodes] = await Promise.all([getNodeGroup(n.name), listNodes()]);
      setSelected(toNodeGroup(detail, allNodes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点组详情失败");
    }
  };
  const openEdit = async (n: NodeGroup) => {
    setIsLoading(true);
    setError("");
    try {
      const [detail, allNodes] = await Promise.all([getNodeGroup(n.name), listNodes()]);
      const row = toNodeGroup(detail, allNodes);
      setNodeOptions(allNodes.map((node) => node.name).filter(Boolean));
      setEditItem(row);
      setEditForm({
        name: row.name,
        node: row.nodes[0] || "",
        matchLabels: labelsToRows(row.nodeSelector),
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点组详情失败");
    } finally {
      setIsLoading(false);
    }
  };
  const openDel = (n: NodeGroup) => { setDelItem(n); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteNodeGroupResource(delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除节点组失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      const name = form.name.trim();
      if (data.some((item) => item.name === name)) {
        setError(`节点组 ${name} 已存在。NodeGroup 是集群级资源，不能通过选择不同命名空间创建同名节点组。`);
        return;
      }
      await createNodeGroupResource(buildNodeGroupResource({ ...form, name }));
      setCreateOpen(false);
      setForm({ name: "", node: "", matchLabels: [{ ...emptyLabelRow }] });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建节点组失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleEdit = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      const updated: KubeResource = {
        ...editItem.raw,
        spec: {
          ...(editItem.raw.spec || {}),
          nodes: editForm.node ? [editForm.node] : [],
          matchLabels: rowsToLabels(editForm.matchLabels),
        },
      };
      await updateNodeGroupResource(updated);
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新节点组失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">节点组</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建节点组</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建节点组</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 workergroup" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[#4E5969]">节点</Label>
                  <Select value={form.node || "none"} onValueChange={v => setForm({ ...form, node: v === "none" ? "" : v })}>
                    <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="请选择节点" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-sm">不指定节点</SelectItem>
                      {nodeOptions.map((node) => <SelectItem key={node} value={node} className="text-sm">{node}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {form.matchLabels.map((row, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_36px] gap-2 items-end">
                      <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">标签键</Label><Input value={row.key} onChange={e => setForm({ ...form, matchLabels: form.matchLabels.map((item, i) => i === index ? { ...item, key: e.target.value } : item) })} className="h-9 text-sm" /></div>
                      <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">标签值</Label><Input value={row.value} onChange={e => setForm({ ...form, matchLabels: form.matchLabels.map((item, i) => i === index ? { ...item, value: e.target.value } : item) })} className="h-9 text-sm" /></div>
                      <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-[#4E5969] hover:text-[#F53F3F]" onClick={() => setForm({ ...form, matchLabels: form.matchLabels.length > 1 ? form.matchLabels.filter((_, i) => i !== index) : [{ ...emptyLabelRow }] })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-sm text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => setForm({ ...form, matchLabels: [...form.matchLabels, { ...emptyLabelRow }] })}>添加匹配标签</Button>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑节点组</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4"><Info label="名称" value={editItem?.name || "-"} /><Info label="作用域" value="集群级" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[#4E5969]">节点</Label>
                  <Select value={editForm.node || "none"} onValueChange={v => setEditForm({ ...editForm, node: v === "none" ? "" : v })}>
                    <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="请选择节点" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-sm">不指定节点</SelectItem>
                      {nodeOptions.map((node) => <SelectItem key={node} value={node} className="text-sm">{node}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {editForm.matchLabels.map((row, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_36px] gap-2 items-end">
                      <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">标签键</Label><Input value={row.key} onChange={e => setEditForm({ ...editForm, matchLabels: editForm.matchLabels.map((item, i) => i === index ? { ...item, key: e.target.value } : item) })} className="h-9 text-sm" /></div>
                      <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">标签值</Label><Input value={row.value} onChange={e => setEditForm({ ...editForm, matchLabels: editForm.matchLabels.map((item, i) => i === index ? { ...item, value: e.target.value } : item) })} className="h-9 text-sm" /></div>
                      <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-[#4E5969] hover:text-[#F53F3F]" onClick={() => setEditForm({ ...editForm, matchLabels: editForm.matchLabels.length > 1 ? editForm.matchLabels.filter((_, i) => i !== index) : [{ ...emptyLabelRow }] })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-sm text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => setEditForm({ ...editForm, matchLabels: [...editForm.matchLabels, { ...emptyLabelRow }] })}>添加匹配标签</Button>
                </div>
              </div>
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleEdit} disabled={!editItem}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm border-[#C9CDD4] bg-white" /></div>
        <div className="flex items-center gap-3"><span className="text-sm text-[#86909C]">共 {filtered.length} 条</span></div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[#FFF7E8] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">作用域</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">节点</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">节点选择器</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">状态</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">分配策略</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[#86909C] text-sm">正在加载节点组数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[#86909C] text-sm">暂无节点组数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">集群级</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.nodes.join(", ") || "-"}</TableCell>
            <TableCell className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {Object.entries(row.nodeSelector).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="text-xs font-normal bg-[#E8F3FF] text-[#165DFF]">{k}: {v}</Badge>
                ))}
                {Object.keys(row.nodeSelector).length === 0 && <span className="text-sm text-[#86909C]">-</span>}
              </div>
            </TableCell>
            <TableCell className="px-4 py-3"><StatusBadge status={row.status} color={row.statusColor} /></TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.allocationPolicy || "-"}</TableCell>
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
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /><Badge variant="outline" className="text-xs font-normal">集群级</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="作用域" value="集群级" />
                <Info label="节点数" value={String(selected.nodes.length)} /><Info label="分配策略" value={selected.allocationPolicy || "-"} />
                <Info label="分散约束" value={selected.spreadConstraints ? "开启" : "关闭"} /><Info label="状态" value={selected.status} />
              </div>
              <div className="space-y-2"><h4 className="text-xs text-[#86909C]">节点选择器</h4><div className="flex flex-wrap gap-2">{Object.entries(selected.nodeSelector).map(([k, v]) => (<Badge key={k} variant="secondary" className="text-xs font-normal bg-[#E8F3FF] text-[#165DFF]">{k}: {v}</Badge>))}{Object.keys(selected.nodeSelector).length === 0 && <span className="text-sm text-[#86909C]">-</span>}</div></div>
              <div className="space-y-2"><h4 className="text-xs text-[#86909C]">包含节点</h4><div className="flex flex-wrap gap-2">{selected.nodes.map(n => (<Badge key={n} variant="outline" className="text-xs font-normal">{n}</Badge>))}{selected.nodes.length === 0 && <span className="text-sm text-[#86909C]">无节点</span>}</div></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yamlNg(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlNg(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除节点组？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除节点组 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

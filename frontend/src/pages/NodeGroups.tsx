import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Trash2, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { createNodeGroupResource, deleteNodeGroupResource, getNodeGroup, listNodeGroups, listNodes } from "@/api/services/resources";
import { getNodeGroupSummary } from "@/api/services/product";
import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface NodeGroup {
  name: string; namespace: string; nodes: string[];
  nodeSelector: Record<string, string>; status: string; statusColor: string; createdAt: string;
  allocationPolicy?: string; spreadConstraints?: boolean;
  selectorType: "标签匹配" | "指定节点";
  description: string;
  raw: KubeResource;
}

interface LabelRow {
  key: string;
  value: string;
}

interface NodeGroupForm {
  name: string;
  nodes: string[];
  matchLabels: LabelRow[];
  selectorType: "labels" | "nodes" | "";
  description: string;
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
    selectorType: matchedNodes.length > 0 && Object.keys(selector).length === 0 ? "指定节点" : "标签匹配",
    description: item?.metadata?.annotations?.description || item?.description || item?.spec?.description || "-",
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
      annotations: form.description.trim() ? { description: form.description.trim() } : undefined,
    },
    spec: {
      nodes: form.selectorType === "nodes" ? form.nodes : [],
      ...(form.selectorType === "labels" && Object.keys(matchLabels).length ? { matchLabels } : {}),
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
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<NodeGroup | null>(null);
  const [form, setForm] = useState<NodeGroupForm>({ name: "", nodes: [], matchLabels: [{ ...emptyLabelRow }], selectorType: "", description: "" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [rows, allNodes] = await Promise.all([listNodeGroups(), listNodes()]);
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
      const { item, warnings } = await getNodeGroupSummary(n.name);
      if (warnings?.length) setError(warnings.map((warning) => warning.message).join("；"));
      setSelected({
        ...n,
        name: item.name,
        nodes: item.matchedNodes,
        nodeSelector: item.matchLabels,
        status: item.nodes.total === 0 ? "未知" : item.nodes.ready === item.nodes.total ? "就绪" : "异常",
        statusColor: item.nodes.total > 0 && item.nodes.ready === item.nodes.total ? "success" : "warning",
        createdAt: item.createdAt || n.createdAt,
        allocationPolicy: item.selectorType === "nodes" ? "指定节点" : "标签匹配",
        selectorType: item.selectorType === "nodes" ? "指定节点" : "标签匹配",
        description: item.description || n.description,
        raw: item.raw,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点组详情失败");
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
      setForm({ name: "", nodes: [], matchLabels: [{ ...emptyLabelRow }], selectorType: "", description: "" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建节点组失败");
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="blueedge-page space-y-4">
      <div>
        <PageHeader
          title="边缘节点组"
          description="将多个边缘节点组织为可调度目标"
          searchPlaceholder="搜索节点组名称..."
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          onRefresh={loadData}
          onAdd={() => setCreateOpen(true)}
          addLabel="创建节点组"
        />
        <div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="!flex max-h-[92vh] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton>
              <DialogHeader className="shrink-0 border-b border-[#eef1f5] px-7 py-6">
                <DialogTitle className="text-base font-bold">创建边缘节点组</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-7 py-7">
                <div className="space-y-6">
                  <div>
                    <Label className="form-label mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                      节点组名称 <span className="text-[var(--color-danger)]">*</span>
                    </Label>
                    <Input
                      placeholder="production-nodes"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      className="h-10 rounded-xl text-sm"
                    />
                    <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
                      最长 253 字符，仅支持小写字母、数字、中划线(-)、点(.)
                    </p>
                  </div>

                  <div>
                    <Label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                      选择方式 <span className="text-[var(--color-danger)]">*</span>
                    </Label>
                    <div className="space-y-4">
                      <SelectorOption
                        active={form.selectorType === "labels"}
                        title="标签匹配"
                        description="通过标签选择器自动匹配节点"
                        onClick={() => setForm({ ...form, selectorType: form.selectorType === "labels" ? "" : "labels" })}
                      />
                      <SelectorOption
                        active={form.selectorType === "nodes"}
                        title="指定节点"
                        description="手动选择特定节点"
                        onClick={() => setForm({ ...form, selectorType: form.selectorType === "nodes" ? "" : "nodes" })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">描述</Label>
                    <Textarea
                      placeholder="请输入描述"
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      className="min-h-[70px] rounded-xl text-sm"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="shrink-0 border-t border-[#eef1f5] px-7 py-5">
                <Button variant="outline" onClick={() => setCreateOpen(false)} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                <Button onClick={handleCreate} disabled={!form.name || !form.selectorType} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">确定</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-end gap-4">
        <span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="table-card">
        <Table><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">节点组名称</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">选择方式</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">节点数</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">描述</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[96px] px-4 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">正在加载节点组数据...</span></div></TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">暂无节点组数据</span></div></TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
            <TableCell className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-brand)] hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3">
              <Badge variant="secondary" className={cn("text-xs font-normal", row.selectorType === "标签匹配" ? "bg-[var(--color-brand-light)] text-[var(--color-brand)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]")}>{row.selectorType}</Badge>
            </TableCell>
            <TableCell className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{row.nodes.length}</TableCell>
            <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{row.description}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3 text-right"><div className="action-group justify-end"><button type="button" className="action-button is-danger" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
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
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /><Badge variant="outline" className="text-xs font-normal">集群级</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="作用域" value="集群级" />
                <Info label="节点数" value={String(selected.nodes.length)} /><Info label="分配策略" value={selected.allocationPolicy || "-"} />
                <Info label="分散约束" value={selected.spreadConstraints ? "开启" : "关闭"} /><Info label="状态" value={selected.status} />
              </div>
              <div className="space-y-2"><h4 className="text-xs text-[var(--color-text-tertiary)]">节点选择器</h4><div className="flex flex-wrap gap-2">{Object.entries(selected.nodeSelector).map(([k, v]) => (<Badge key={k} variant="secondary" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)]">{k}: {v}</Badge>))}{Object.keys(selected.nodeSelector).length === 0 && <span className="text-sm text-[var(--color-text-tertiary)]">-</span>}</div></div>
              <div className="space-y-2"><h4 className="text-xs text-[var(--color-text-tertiary)]">包含节点</h4><div className="flex flex-wrap gap-2">{selected.nodes.map(n => (<Badge key={n} variant="outline" className="text-xs font-normal">{n}</Badge>))}{selected.nodes.length === 0 && <span className="text-sm text-[var(--color-text-tertiary)]">无节点</span>}</div></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yamlNg(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlNg(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除节点组？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除节点组 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

function SelectorOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
        active ? "border-[var(--color-text-primary)] bg-[#fafbfc]" : "border-[var(--color-input-border)] bg-white hover:border-[var(--color-input-border-hover)]"
      )}
    >
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          active ? "bg-[var(--color-text-primary)]" : "bg-[#d1d5db]"
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-all",
            active ? "left-[18px]" : "left-[3px]"
          )}
        />
      </span>
      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
      <span className="text-xs text-[var(--color-text-tertiary)]">{description}</span>
    </button>
  );
}

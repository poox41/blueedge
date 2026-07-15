import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertTriangle, Check, Copy, Trash2, ChevronLeft, ChevronRight, Plus, RefreshCw, Search, ArrowLeft, Edit3, Server, X } from "lucide-react";
import { createNodeGroupResource, deleteNodeGroupResource, getNodeGroup, listNodeGroups, listNodes, updateNodeGroupResource } from "@/api/services/resources";
import { getNodeGroupSummary } from "@/api/services/product";
import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useNavigate, useParams } from "react-router-dom";

interface NodeGroup {
  name: string; namespace: string; nodes: string[];
  nodeSelector: Record<string, string>; status: string; statusColor: string; createdAt: string;
  allocationPolicy?: string; spreadConstraints?: boolean;
  selectorType: "标签匹配" | "指定节点" | "标签匹配+指定节点";
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
  selectorType: "labels" | "nodes" | "both" | "";
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
  const explicitNodes = Array.isArray(item?.spec?.nodes) ? item.spec.nodes.filter(Boolean) : [];
  const hasLabels = Object.keys(selector).length > 0;
  const hasExplicitNodes = explicitNodes.length > 0;
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
    selectorType: hasLabels && hasExplicitNodes ? "标签匹配+指定节点" : hasExplicitNodes || (matchedNodes.length > 0 && !hasLabels) ? "指定节点" : "标签匹配",
    description: item?.metadata?.annotations?.description || item?.description || item?.spec?.description || "-",
    raw: item,
  };
}

function rowsToLabels(rows: LabelRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((labels, row) => {
    const key = row.key.trim();
    if (key) labels[key] = row.value.trim();
    return labels;
  }, {});
}

function buildNodeGroupResource(form: NodeGroupForm, base?: KubeResource): KubeResource {
  const matchLabels = rowsToLabels(form.matchLabels);
  const usesNodes = form.selectorType === "nodes" || form.selectorType === "both";
  const usesLabels = form.selectorType === "labels" || form.selectorType === "both";
  return {
    ...base,
    apiVersion: base?.apiVersion || "apps.kubeedge.io/v1alpha1",
    kind: base?.kind || "NodeGroup",
    metadata: {
      ...(base?.metadata || {}),
      name: form.name.trim(),
      annotations: {
        ...((base?.metadata?.annotations as Record<string, string> | undefined) || {}),
        description: form.description.trim(),
      },
    },
    spec: {
      ...((base?.spec as Record<string, unknown> | undefined) || {}),
      nodes: usesNodes ? form.nodes : [],
      matchLabels: usesLabels ? matchLabels : {},
    },
  };
}

export function NodeGroups() {
  const navigate = useNavigate();
  const { name: detailNameParam } = useParams<{ name?: string }>();
  const detailName = detailNameParam ? decodeURIComponent(detailNameParam) : "";
  const [data, setData] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<NodeGroup | null>(null);
  const [nodeOptions, setNodeOptions] = useState<EdgeNodeView[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<NodeGroup | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<NodeGroup | null>(null);
  const [delConfirmText, setDelConfirmText] = useState("");
  const [delNameCopied, setDelNameCopied] = useState(false);
  const [form, setForm] = useState<NodeGroupForm>({ name: "", nodes: [], matchLabels: [{ ...emptyLabelRow }], selectorType: "", description: "" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [rows, allNodes] = await Promise.all([listNodeGroups(), listNodes()]);
      setNodeOptions(allNodes);
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
      const groups = details.map((row) => toNodeGroup(row, allNodes));
      setData(groups);
      if (detailName) setSelected(groups.find((group) => group.name === detailName) || null);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点组数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [detailName]);

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
    navigate(`/nodegroups/${encodeURIComponent(n.name)}`);
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
        selectorType: item.selectorType === "nodes" ? "指定节点" : n.selectorType === "标签匹配+指定节点" ? "标签匹配+指定节点" : "标签匹配",
        description: item.description || n.description,
        raw: item.raw,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点组详情失败");
    }
  };
  const closeDeleteDialog = () => {
    setDelOpen(false);
    setDelItem(null);
    setDelConfirmText("");
    setDelNameCopied(false);
  };
  const openDel = (n: NodeGroup) => {
    setDelItem(n);
    setDelConfirmText("");
    setDelNameCopied(false);
    setDelOpen(true);
  };
  const copyDeleteName = async () => {
    if (!delItem) return;
    try {
      await navigator.clipboard.writeText(delItem.name);
      setDelNameCopied(true);
      window.setTimeout(() => setDelNameCopied(false), 2000);
    } catch {
      setDelConfirmText(delItem.name);
    }
  };
  const confirmDel = async () => {
    if (!delItem || delConfirmText !== delItem.name) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteNodeGroupResource(delItem.name);
      closeDeleteDialog();
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
      if (name.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name)) {
        setError("节点组名称格式不正确：只能使用小写字母、数字、中划线和点，并且必须以字母或数字开头和结尾。");
        return;
      }
      if (!editingGroup && data.some((item) => item.name === name)) {
        setError(`节点组 ${name} 已存在。NodeGroup 是集群级资源，不能通过选择不同命名空间创建同名节点组。`);
        return;
      }
      if (editingGroup) await updateNodeGroupResource(buildNodeGroupResource({ ...form, name }, editingGroup.raw));
      else await createNodeGroupResource(buildNodeGroupResource({ ...form, name }));
      setCreateOpen(false);
      setEditingGroup(null);
      setForm({ name: "", nodes: [], matchLabels: [{ ...emptyLabelRow }], selectorType: "", description: "" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建节点组失败");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelector = (type: "labels" | "nodes") => {
    setForm((current) => {
      const labelsActive = current.selectorType === "labels" || current.selectorType === "both";
      const nodesActive = current.selectorType === "nodes" || current.selectorType === "both";
      const nextLabels = type === "labels" ? !labelsActive : labelsActive;
      const nextNodes = type === "nodes" ? !nodesActive : nodesActive;
      return { ...current, selectorType: nextLabels && nextNodes ? "both" : nextLabels ? "labels" : nextNodes ? "nodes" : "" };
    });
  };

  const openCreate = () => {
    setEditingGroup(null);
    setForm({ name: "", nodes: [], matchLabels: [{ ...emptyLabelRow }], selectorType: "", description: "" });
    setCreateOpen(true);
  };

  const openEdit = (group: NodeGroup) => {
    const hasLabels = Object.keys(group.nodeSelector).length > 0;
    const explicitNodes = Array.isArray((group.raw.spec as Record<string, unknown> | undefined)?.nodes)
      ? ((group.raw.spec as Record<string, unknown>).nodes as string[])
      : [];
    setEditingGroup(group);
    setForm({
      name: group.name,
      nodes: explicitNodes,
      matchLabels: hasLabels ? Object.entries(group.nodeSelector).map(([key, value]) => ({ key, value })) : [{ ...emptyLabelRow }],
      selectorType: hasLabels && explicitNodes.length ? "both" : hasLabels ? "labels" : "nodes",
      description: group.description === "-" ? "" : group.description,
    });
    setCreateOpen(true);
  };
  const labelsActive = form.selectorType === "labels" || form.selectorType === "both";
  const nodesActive = form.selectorType === "nodes" || form.selectorType === "both";

  if (detailName && !selected) {
    return <div className="blueedge-page"><div className="blueedge-empty-state min-h-[320px]"><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">正在加载节点组详情...</span></div></div>;
  }

  const detailPage = detailName && selected ? (
      <NodeGroupDetailPage
        group={selected}
        nodeOptions={nodeOptions}
        onBack={() => navigate("/nodegroups")}
        onEdit={() => {
          openEdit(selected);
        }}
      />
  ) : null;
  return (
    <>
    {detailPage}
    <div className={cn("blueedge-page space-y-6", Boolean(detailPage) && "hidden")}>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-[#111827]">边缘节点组</h1>
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">将多个边缘节点组织为可调度目标</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[240px] transition-[width] focus-within:w-[300px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            placeholder="搜索节点组名称..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-11 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData()} className="blueedge-muted-button h-10 w-10 rounded-xl border-[var(--color-border-strong)] p-0" title="刷新">
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button onClick={openCreate} className="blueedge-primary-button h-10 rounded-xl px-4 text-sm">
            <Plus className="h-4 w-4" />
            创建节点组
          </Button>
        </div>
      </div>
      <div>
        <div>
          <Dialog open={createOpen} onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setEditingGroup(null);
          }}>
            <DialogContent className="!flex max-h-[92vh] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)]" showCloseButton>
              <DialogHeader className="h-[72px] shrink-0 justify-center border-b border-[#eef1f5] px-7 py-0">
                <DialogTitle className="text-base font-bold">{editingGroup ? "编辑边缘节点组" : "创建边缘节点组"}</DialogTitle>
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
                      <div className={cn("overflow-hidden rounded-xl border-[1.5px] transition-colors", labelsActive ? "border-[#0f172a] bg-[#fafbfc]" : "border-[#e2e8f0] bg-white")}>
                        <SelectorOption
                          active={labelsActive}
                          title="标签匹配"
                          description="通过标签选择器自动匹配节点"
                          onClick={() => toggleSelector("labels")}
                        />
                        {labelsActive && <div className="space-y-3 border-t border-[#f0f1f3] px-4 pb-4 pt-3">
                          <Label className="text-sm font-semibold text-[#111827]">标签选择器 <span className="text-[var(--color-danger)]">*</span></Label>
                          {form.matchLabels.map((row, index) => (
                            <div key={index} className="grid grid-cols-[1fr_20px_1fr_36px] items-center gap-2">
                              <Input value={row.key} onChange={(event) => setForm({ ...form, matchLabels: form.matchLabels.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })} placeholder="键" className="h-10 rounded-xl text-sm" />
                              <span className="text-center text-[var(--color-text-tertiary)]">=</span>
                              <Input value={row.value} onChange={(event) => setForm({ ...form, matchLabels: form.matchLabels.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} placeholder="值" className="h-10 rounded-xl text-sm" />
                              <button type="button" onClick={() => setForm({ ...form, matchLabels: form.matchLabels.length > 1 ? form.matchLabels.filter((_, itemIndex) => itemIndex !== index) : [{ ...emptyLabelRow }] })} className="action-button is-danger h-9 w-9" aria-label="删除标签"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setForm({ ...form, matchLabels: [...form.matchLabels, { ...emptyLabelRow }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand)]"><Plus className="h-3.5 w-3.5" />添加标签</button>
                        </div>}
                      </div>
                      <div className={cn("overflow-hidden rounded-xl border-[1.5px] transition-colors", nodesActive ? "border-[#0f172a] bg-[#fafbfc]" : "border-[#e2e8f0] bg-white")}>
                        <SelectorOption
                          active={nodesActive}
                          title="指定节点"
                          description="手动选择特定节点"
                          badge={form.nodes.length > 0 ? `已选 ${form.nodes.length} 个` : undefined}
                          onClick={() => toggleSelector("nodes")}
                        />
                        {nodesActive && <div className="border-t border-[#f0f1f3] px-4 pb-4 pt-3">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-[#111827]">已选节点</p>
                            <Button type="button" onClick={() => setNodePickerOpen(true)} className="h-7 rounded-lg bg-[#0f172a] px-2.5 text-xs text-white"><ChevronRight className="mr-1 h-3 w-3" />选择边缘节点</Button>
                          </div>
                          {form.nodes.length === 0 ? (
                            <div className="flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d8e1ec] bg-white text-[var(--color-text-tertiary)]"><Server className="mb-2 h-5 w-5" /><span className="text-xs">暂无数据</span></div>
                          ) : (
                            <div className="table-card overflow-x-auto">
                              <Table className="min-w-[500px] table-fixed">
                                <TableHeader><TableRow className="h-10 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]"><TableHead className="w-[130px] px-3 text-xs">名称</TableHead><TableHead className="w-[76px] px-3 text-xs">状态</TableHead><TableHead className="w-[70px] px-3 text-xs">架构</TableHead><TableHead className="w-[160px] px-3 text-xs">标签</TableHead><TableHead className="w-[52px] px-2 text-right text-xs">操作</TableHead></TableRow></TableHeader>
                                <TableBody>{form.nodes.map((nodeName) => {
                                  const node = nodeOptions.find((item) => item.name === nodeName);
                                  const labels = Object.entries(node?.raw.metadata?.labels || {});
                                  const nodeInfo = node?.raw.status?.nodeInfo as Record<string, unknown> | undefined;
                                  const arch = String(node?.raw.metadata?.labels?.["kubernetes.io/arch"] || nodeInfo?.architecture || "-");
                                  return <TableRow key={nodeName} className="h-12"><TableCell className="px-3 text-sm font-medium text-[var(--color-brand)]">{nodeName}</TableCell><TableCell className="px-3"><span className={cn("inline-flex items-center gap-1 text-xs", node?.status === "Ready" ? "text-[var(--color-success)]" : "text-[var(--color-warning)]")}><span className="h-1.5 w-1.5 rounded-full bg-current" />{node?.status === "Ready" ? "健康" : "异常"}</span></TableCell><TableCell className="px-3 text-xs">{arch}</TableCell><TableCell className="px-3">{labels.length ? <div className="flex items-center gap-1"><span className="max-w-[112px] truncate rounded bg-[#f0f1f3] px-1.5 py-0.5 text-xs text-[#5f6368]">{labels[0][0]}={String(labels[0][1])}</span>{labels.length > 1 && <span className="rounded bg-[#eef4ff] px-1.5 py-0.5 text-xs text-[var(--color-brand)]">+{labels.length - 1}</span>}</div> : <span className="text-xs text-[var(--color-text-tertiary)]">-</span>}</TableCell><TableCell className="px-2 text-right"><button type="button" onClick={() => setForm({ ...form, nodes: form.nodes.filter((item) => item !== nodeName) })} className="action-button is-danger" title="移除节点"><Trash2 className="h-3.5 w-3.5" /></button></TableCell></TableRow>;
                                })}</TableBody>
                              </Table>
                            </div>
                          )}
                        </div>}
                      </div>
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
              <DialogFooter className="h-[72px] shrink-0 items-center border-t border-[#eef1f5] px-7 py-0">
                <Button variant="outline" onClick={() => setCreateOpen(false)} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                <Button onClick={handleCreate} disabled={!form.name.trim() || !form.selectorType || (labelsActive && Object.keys(rowsToLabels(form.matchLabels)).length === 0) || (nodesActive && form.nodes.length === 0)} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">{editingGroup ? "保存" : "确定"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={nodePickerOpen} onOpenChange={setNodePickerOpen}>
            <DialogContent className="!flex max-h-[78vh] max-w-[720px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton>
              <DialogHeader className="shrink-0 border-b border-[#eef1f5] px-7 py-6">
                <DialogTitle className="text-base font-bold">选择边缘节点</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <Table>
                    <TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)]"><TableHead className="w-[70px] px-4">选择</TableHead><TableHead className="px-4">节点名称</TableHead><TableHead className="px-4">状态</TableHead><TableHead className="px-4">架构</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {nodeOptions.length === 0 ? <TableRow><TableCell colSpan={4} className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">暂无可选边缘节点</TableCell></TableRow> : nodeOptions.map((node) => {
                        const checked = form.nodes.includes(node.name);
                        return <TableRow key={node.name} className="h-14"><TableCell className="px-4"><input type="checkbox" checked={checked} onChange={() => setForm({ ...form, nodes: checked ? form.nodes.filter((item) => item !== node.name) : [...form.nodes, node.name] })} className="h-4 w-4 accent-[#0f172a]" /></TableCell><TableCell className="px-4 text-sm font-semibold text-[var(--color-brand)]">{node.name}</TableCell><TableCell className="px-4 text-sm text-[var(--color-text-secondary)]">{node.status === "Ready" ? "健康" : "异常"}</TableCell><TableCell className="px-4 text-sm text-[var(--color-text-secondary)]">{(node.raw as Record<string, any>)?.status?.nodeInfo?.architecture || "-"}</TableCell></TableRow>;
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <DialogFooter className="shrink-0 border-t border-[#eef1f5] px-7 py-5">
                <span className="mr-auto text-xs text-[var(--color-text-tertiary)]">已选择 {form.nodes.length} 个节点</span>
                <Button onClick={() => setNodePickerOpen(false)} className="h-9 rounded-[10px] bg-[#0f172a] px-5 text-sm text-white">确定</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="table-card overflow-x-auto">
        <Table className="min-w-[700px] table-fixed"><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="w-[200px] px-4 text-left text-xs font-medium text-[var(--color-text-tertiary)]">节点组名称</TableHead>
          <TableHead className="w-[120px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">选择方式</TableHead>
          <TableHead className="w-[80px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">节点数</TableHead>
          <TableHead className="w-[40%] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">描述</TableHead>
          <TableHead className="w-[150px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[80px] px-4 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
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
      <AlertDialog open={delOpen} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <AlertDialogContent className="max-w-[480px] gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]">
          <AlertDialogHeader className="border-b border-[#f0f1f3] px-6 py-4 text-left">
            <div className="flex items-center justify-between gap-4">
              <AlertDialogTitle className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-[#111827]">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff4d4f]/10 text-[#ff4d4f]">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <span className="truncate">确认删除「{delItem?.name}」吗？</span>
              </AlertDialogTitle>
              <button type="button" onClick={closeDeleteDialog} className="action-button shrink-0" aria-label="关闭删除确认弹窗">
                <X className="h-4 w-4" />
              </button>
            </div>
          </AlertDialogHeader>

          <div className="space-y-4 px-6 py-5">
            <AlertDialogDescription className="flex items-start gap-2 rounded-lg border border-[#ffd591] bg-[#fff7e6] p-3 text-xs leading-5 text-[#ad6800]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fa8c16]" />
              <span>此操作不可恢复。删除后相关资源将被永久移除。</span>
            </AlertDialogDescription>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="node-group-delete-confirm" className="text-xs font-medium text-[#111827]">
                  请输入 <strong className="text-[#ff4d4f]">{delItem?.name}</strong> 以确认删除
                </label>
                <button type="button" onClick={() => void copyDeleteName()} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#1a73e8] hover:text-[#1557b0]">
                  {delNameCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {delNameCopied ? "已复制" : "复制名称"}
                </button>
              </div>
              <Input
                id="node-group-delete-confirm"
                autoFocus
                value={delConfirmText}
                onChange={(event) => setDelConfirmText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && delItem && delConfirmText === delItem.name) void confirmDel();
                }}
                placeholder={delItem?.name || ""}
                className="h-10 rounded-[10px] border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:border-[#111827] focus-visible:ring-2 focus-visible:ring-[#111827]/10"
              />
            </div>
          </div>

          <AlertDialogFooter className="border-t border-[#f0f1f3] px-6 py-4">
            <AlertDialogCancel className="h-9 rounded-[10px] px-4 text-sm" onClick={closeDeleteDialog}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!delItem || delConfirmText !== delItem.name || isLoading}
              className="h-9 rounded-[10px] bg-[#ff4d4f] px-5 text-sm font-medium text-white hover:bg-[#ff7875] disabled:cursor-not-allowed disabled:bg-[#ffccc7] disabled:text-white disabled:opacity-70"
              onClick={(event) => {
                event.preventDefault();
                void confirmDel();
              }}
            >
              {isLoading ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}

function NodeGroupDetailPage({ group, nodeOptions, onBack, onEdit }: { group: NodeGroup; nodeOptions: EdgeNodeView[]; onBack: () => void; onEdit: () => void }) {
  const nodeByName = new Map(nodeOptions.map((node) => [node.name, node]));
  const healthyCount = group.nodes.filter((name) => nodeByName.get(name)?.status === "Ready").length;
  const abnormalCount = Math.max(group.nodes.length - healthyCount, 0);
  return (
    <div className="blueedge-page space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button h-10 w-10 rounded-xl" aria-label="返回节点组列表"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <div className="mb-0.5 flex items-center gap-3">
              <h1 className="text-lg font-semibold text-[#111827]">{group.name}</h1>
              <SelectorTag type={group.selectorType} />
              <span className="rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]">{group.nodes.length} 个节点</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">创建于 {group.createdAt}</p>
          </div>
        </div>
        <Button onClick={onEdit} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-xs text-white"><Edit3 className="mr-1.5 h-3.5 w-3.5" />编辑</Button>
      </div>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[#111827]">基本信息</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <DetailField label="节点组名称" value={group.name} />
          <DetailField label="选择方式" value={<SelectorTag type={group.selectorType} />} />
          <DetailField label="节点总数" value={`${group.nodes.length} 个`} />
          <DetailField label="创建时间" value={group.createdAt} />
        </div>
        <div className="my-5 border-t border-[#f0f1f3]" />
        <DetailField label="标签选择器" value={Object.keys(group.nodeSelector).length ? <div className="flex flex-wrap gap-1.5">{Object.entries(group.nodeSelector).map(([key, value]) => <span key={key} className="rounded-md bg-[#f0f1f3] px-2 py-0.5 text-xs text-[#5f6368]">{key}={value}</span>)}</div> : "—"} />
        {group.description && group.description !== "-" && <><div className="my-5 border-t border-[#f0f1f3]" /><DetailField label="描述" value={group.description} /></>}
      </section>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#111827]">成员节点</h2>
          <div className="flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]"><span className="text-[var(--color-success)]">● 健康 {healthyCount}</span><span className="text-[var(--color-danger)]">● 异常 {abnormalCount}</span></div>
        </div>
        <div className="table-card overflow-x-auto">
          <Table className="min-w-[500px] table-fixed"><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)]"><TableHead className="w-[200px] px-4 text-xs">节点名称</TableHead><TableHead className="w-[100px] px-4 text-xs">状态</TableHead><TableHead className="w-[120px] px-4 text-xs">接入状态</TableHead></TableRow></TableHeader>
            <TableBody>{group.nodes.length === 0 ? <TableRow><TableCell colSpan={3} className="py-12 text-center"><Server className="mx-auto mb-2 h-6 w-6 text-[var(--color-text-tertiary)]" /><span className="text-sm text-[var(--color-text-secondary)]">暂无成员节点</span></TableCell></TableRow> : group.nodes.map((name) => {
              const node = nodeByName.get(name);
              const ready = node?.status === "Ready";
              return <TableRow key={name} className="h-[60px]"><TableCell className="px-4 text-sm font-medium text-[var(--color-brand)]">{name}</TableCell><TableCell className="px-4"><span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs", ready ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]")}><span className="h-1.5 w-1.5 rounded-full bg-current" />{ready ? "健康" : "异常"}</span></TableCell><TableCell className="px-4 text-xs text-[var(--color-text-tertiary)]">已加入</TableCell></TableRow>;
            })}</TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p><div className="text-sm font-medium text-[#111827]">{value}</div></div>;
}

function SelectorTag({ type }: { type: NodeGroup["selectorType"] }) {
  const classes = type === "标签匹配" ? "bg-[#e3f2fd] text-[#1e88e5]" : type === "指定节点" ? "bg-[#fff3e0] text-[#e65100]" : "bg-[#f3e8ff] text-[#7c3aed]";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", classes)}>{type}</span>;
}

function SelectorOption({
  active,
  title,
  description,
  badge,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "relative h-[22px] w-10 shrink-0 rounded-full transition-colors",
            active ? "bg-[var(--color-text-primary)]" : "bg-[#d1d5db]"
          )}
        >
          <span className={cn("absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all", active ? "left-[21px]" : "left-[3px]")} />
        </span>
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
        <span className="truncate text-xs text-[var(--color-text-tertiary)]">{description}</span>
      </span>
      {badge && <span className="shrink-0 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-xs font-medium text-[#43a047]">{badge}</span>}
    </button>
  );
}

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Copy, Eye, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { formatLabels, getResourceCreatedAt, getResourceName, getResourceNamespace } from "@/api/adapters/kube-resource.adapter";
import {
  createConfigMapResource,
  deleteConfigMapResource,
  getConfigMap,
  listConfigMaps,
  updateConfigMapResource,
} from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import { cn } from "@/lib/utils";
import type { KubeResource } from "@/types/kubeedge";

interface ConfigMapRow {
  namespace: string;
  name: string;
  keys: string[];
  labels: string;
  createdAt: string;
  raw: KubeResource;
}

function toRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)]),
  );
}

function parseKeyValues(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1)];
      })
      .filter(([key]) => key),
  );
}

function formatKeyValues(data: Record<string, string>): string {
  return Object.entries(data).map(([key, value]) => `${key}=${value}`).join("\n");
}

function toConfigMap(item: any): ConfigMapRow {
  const data = toRecord(item?.data);
  const binaryData = toRecord(item?.binaryData);
  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    keys: [...Object.keys(data), ...Object.keys(binaryData)],
    labels: formatLabels(item?.metadata?.labels),
    createdAt: getResourceCreatedAt(item),
    raw: item,
  };
}

function buildConfigMapResource(form: { name: string; namespace: string; dataText: string }, base?: KubeResource): KubeResource {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      ...base?.metadata,
      name: form.name,
      namespace: form.namespace,
    },
    data: parseKeyValues(form.dataText),
  };
}

function yaml(row: ConfigMapRow) {
  const data = toRecord(row.raw.data);
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${row.name}
  namespace: ${row.namespace}
${row.labels !== "-" ? `  labels:\n    ${row.labels}` : ""}
data:
${Object.entries(data).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join("\n") || "  {}"}`;
}

export function ConfigMaps() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<ConfigMapRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ConfigMapRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ConfigMapRow | null>(null);
  const [editItem, setEditItem] = useState<ConfigMapRow | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", dataText: "key=value" });
  const [editForm, setEditForm] = useState({ name: "", namespace: "default", dataText: "" });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listConfigMaps(namespace === "all" ? undefined : namespace);
      setData(items.map(toConfigMap));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置字典失败");
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return data;
    return data.filter((item) =>
      item.name.toLowerCase().includes(keyword) ||
      item.namespace.toLowerCase().includes(keyword) ||
      item.keys.some((key) => key.toLowerCase().includes(keyword)),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (row: ConfigMapRow) => {
    setSelected(row);
    setDetailOpen(true);
    try {
      setSelected(toConfigMap(await getConfigMap(row.namespace, row.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置字典详情失败");
    }
  };

  const openEdit = async (row: ConfigMapRow) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toConfigMap(await getConfigMap(row.namespace, row.name));
      setEditItem(detail);
      setEditForm({
        name: detail.name,
        namespace: detail.namespace,
        dataText: formatKeyValues(toRecord(detail.raw.data)),
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置字典详情失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      await createConfigMapResource(buildConfigMapResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", dataText: "key=value" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建配置字典失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      await updateConfigMapResource(editItem.namespace, buildConfigMapResource(editForm, editItem.raw));
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新配置字典失败");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteConfigMapResource(deleteItem.namespace, deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除配置字典失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">配置字典</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建配置</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建配置字典</DialogTitle></DialogHeader>
              <ConfigMapForm form={form} setForm={setForm} namespaces={namespaces} />
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑配置字典</DialogTitle></DialogHeader>
              <ConfigMapForm form={editForm} setForm={setEditForm} namespaces={namespaces} readonly />
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleUpdate}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" /><Input placeholder="请输入名称或 Key 搜索" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm border-[#C9CDD4] bg-white" /></div>
        <div className="flex items-center gap-3"><NamespaceSelector value={namespace} onChange={(value) => { setNamespace(value); setPage(1); }} /><span className="text-sm text-[#86909C]">共 {filtered.length} 条</span></div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[#FFF7E8] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table><TableHeader><TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">命名空间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">Key 数</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">标签</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[150px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">正在加载配置字典...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[#86909C] text-sm">暂无配置字典数据</TableCell></TableRow>) : paginated.map((row) => (
          <TableRow key={`${row.namespace}/${row.name}`} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.keys.length}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3 max-w-[260px] truncate">{row.labels}</TableCell>
            <TableCell className="text-sm text-[#86909C] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openDetail(row)}><Eye className="w-3.5 h-3.5 mr-1" />详情</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#165DFF] hover:bg-[#E8F3FF]" onClick={() => openEdit(row)}><Pencil className="w-3.5 h-3.5 mr-1" />编辑</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#F53F3F] hover:bg-[#FFECE8]" onClick={() => { setDeleteItem(row); setDeleteOpen(true); }}><Trash2 className="w-3.5 h-3.5 mr-1" />删除</Button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
      </div>
      {filtered.length > pageSize && <Pager page={page} totalPages={totalPages} start={start} pageSize={pageSize} total={filtered.length} setPage={setPage} />}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[620px] sm:max-w-[620px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[#E5E6EB]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><Badge variant="outline" className="text-xs font-normal w-fit mt-2">{selected?.namespace}</Badge></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[#F7F8FA] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="data" className="text-xs h-7">数据</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3"><div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="Key 数" value={String(selected.keys.length)} /><Info label="标签" value={selected.labels} /></div></TabsContent>
            <TabsContent value="data" className="mt-3 space-y-2">{Object.entries(toRecord(selected.raw.data)).map(([key, value]) => (<div key={key} className="bg-[#F7F8FA] rounded-md p-3"><p className="text-sm font-medium text-[#1D2129]">{key}</p><pre className="mt-2 text-xs text-[#4E5969] whitespace-pre-wrap break-words">{value}</pre></div>)) || null}</TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除配置字典？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除配置字典 <span className="font-medium text-[#1D2129]">{deleteItem?.name}</span>（命名空间：{deleteItem?.namespace}），此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDelete}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConfigMapForm({ form, setForm, namespaces, readonly = false }: { form: { name: string; namespace: string; dataText: string }; setForm: (form: { name: string; namespace: string; dataText: string }) => void; namespaces: Array<{ value: string; label: string }>; readonly?: boolean }) {
  return (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 app-config" value={form.name} disabled={readonly} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cn("h-9 text-sm", readonly && "bg-[#F7F8FA]")} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">命名空间</Label><select value={form.namespace} disabled={readonly} onChange={(e) => setForm({ ...form, namespace: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4] disabled:bg-[#F7F8FA]">{namespaces.filter((item) => item.value !== "all").map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}</select></div>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">数据（每行一组 key=value）</Label><Textarea value={form.dataText} onChange={(e) => setForm({ ...form, dataText: e.target.value })} className="min-h-40 text-sm font-mono" /></div>
    </div>
  );
}

function Pager({ page, totalPages, start, pageSize, total, setPage }: { page: number; totalPages: number; start: number; pageSize: number; total: number; setPage: Dispatch<SetStateAction<number>> }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#86909C]">显示 {start + 1}-{Math.min(start + pageSize, total)}，共 {total} 条</span>
      <Pagination><PaginationContent>
        <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (<PaginationItem key={item}><Button variant={page === item ? "default" : "outline"} size="sm" onClick={() => setPage(item)} className={cn("h-7 w-7 p-0 text-xs", page === item ? "bg-[#165DFF] text-white" : "border-[#C9CDD4] text-[#4E5969]")}>{item}</Button></PaginationItem>))}
        <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="h-7 w-7 p-0 border-[#C9CDD4]"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
      </PaginationContent></Pagination>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

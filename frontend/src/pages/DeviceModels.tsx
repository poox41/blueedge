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
import { Search, Plus, RefreshCw, Trash2, Eye, Copy, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { NamespaceSelector } from "@/components/common/NamespaceSelector";
import { createDeviceModelResource, deleteDeviceModelResource, getDeviceModel, listDeviceModels, updateDeviceModelResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { DeviceModelView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface DM { namespace: string; name: string; labels: number; properties: number; createdAt: string; description?: string; protocol?: string; raw: KubeResource; }
type DeviceModelProperty = {
  name: string;
  description?: string;
  type: string;
  accessMode?: string;
  defaultValue?: string;
  minimum?: string;
  maximum?: string;
  unit?: string;
};

function defaultProperties(count = 1): DeviceModelProperty[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    name: index === 0 ? "temperature" : `property-${index + 1}`,
    description: index === 0 ? "Temperature sensor" : `Property ${index + 1}`,
    type: "STRING",
    accessMode: "ReadWrite",
  }));
}

function normalizeProperties(value: unknown, fallbackCount = 1): DeviceModelProperty[] {
  if (!Array.isArray(value)) return defaultProperties(fallbackCount);
  const properties = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => ({
      name: typeof item.name === "string" && item.name ? item.name : `property-${index + 1}`,
      description: typeof item.description === "string" ? item.description : "",
      type: typeof item.type === "string" && item.type ? item.type : "STRING",
      accessMode: typeof item.accessMode === "string" && item.accessMode ? item.accessMode : "ReadWrite",
      ...(typeof item.defaultValue === "string" ? { defaultValue: item.defaultValue } : {}),
      ...(typeof item.minimum === "string" ? { minimum: item.minimum } : {}),
      ...(typeof item.maximum === "string" ? { maximum: item.maximum } : {}),
      ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
    }));
  return properties.length > 0 ? properties : defaultProperties(fallbackCount);
}

function formatProperties(value: unknown, fallbackCount = 1): string {
  return JSON.stringify(normalizeProperties(value, fallbackCount), null, 2);
}

function parseProperties(text: string, fallbackCount: number): DeviceModelProperty[] {
  const trimmed = text.trim();
  if (!trimmed) return defaultProperties(fallbackCount);
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) throw new Error("属性定义必须是 JSON 数组");
  return normalizeProperties(parsed, fallbackCount);
}

function toDeviceModelRow(item: DeviceModelView): DM {
  const raw = item.raw as Record<string, any>;
  const labels = raw.metadata?.labels || raw.labels || {};
  return {
    namespace: item.namespace,
    name: item.name,
    labels: Object.keys(labels).length,
    properties: item.propertiesCount,
    createdAt: item.createdAt,
    description: raw.metadata?.annotations?.description || raw.description || "-",
    protocol: raw.spec?.protocol || raw.spec?.protocol?.protocolName || labels.protocol || raw.protocol || "-",
    raw: item.raw,
  };
}

function yaml(n: DM) {
  return `apiVersion: devices.kubeedge.io/v1beta1
kind: DeviceModel
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  protocol: ${n.protocol || "MQTT"}
  properties:
    - name: temperature
      description: Temperature sensor
      type: STRING
      accessMode: ReadWrite`;
}

function buildDeviceModelResource(form: { name: string; namespace: string; properties: number; protocol: string; description: string; propertiesText: string }): KubeResource {
  const properties = parseProperties(form.propertiesText, form.properties);
  return {
    apiVersion: "devices.kubeedge.io/v1beta1",
    kind: "DeviceModel",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { protocol: form.protocol.toLowerCase().replace(/\s+/g, "-") },
      annotations: form.description.trim() ? { description: form.description.trim() } : undefined,
    },
    spec: {
      protocol: form.protocol,
      properties,
    },
  };
}

export function DeviceModels() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<DM[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [ns, setNs] = useState("all");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<DM | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DM | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", properties: 2, protocol: "MQTT", description: "", propertiesText: formatProperties(defaultProperties(2)) });
  const [editItem, setEditItem] = useState<DM | null>(null);
  const [editForm, setEditForm] = useState({ properties: 1, protocol: "MQTT", description: "", propertiesText: formatProperties(defaultProperties(1)) });
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listDeviceModels(ns === "all" ? undefined : ns);
      setData(rows.map(toDeviceModelRow));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "设备模型数据加载失败");
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

  const openDetail = async (d: DM) => {
    setSelected(d);
    setDetailOpen(true);
    try {
      const detail = await getDeviceModel(d.namespace, d.name);
      setSelected(toDeviceModelRow(detail));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型详情失败");
    }
  };
  const openEdit = async (d: DM) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toDeviceModelRow(await getDeviceModel(d.namespace, d.name));
      setEditItem(detail);
      setEditForm({
        properties: detail.properties || 1,
        protocol: detail.protocol || "MQTT",
        description: detail.description === "-" ? "" : detail.description || "",
        propertiesText: formatProperties(detail.raw.spec?.properties, detail.properties || 1),
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型详情失败");
    } finally {
      setIsLoading(false);
    }
  };
  const openDel = (d: DM) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeviceModelResource(delItem.namespace, delItem.name);
      setDelOpen(false);
      setDelItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除设备模型失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      await createDeviceModelResource(buildDeviceModelResource(form));
      setCreateOpen(false);
      setForm({ name: "", namespace: "default", properties: 2, protocol: "MQTT", description: "", propertiesText: formatProperties(defaultProperties(2)) });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建设备模型失败");
    } finally {
      setIsLoading(false);
    }
  };
  const handleEdit = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      const { description: _description, ...baseSpec } = editItem.raw.spec || {};
      const properties = parseProperties(editForm.propertiesText, editForm.properties);
      const updated: KubeResource = {
        ...editItem.raw,
        metadata: {
          ...(editItem.raw.metadata || {}),
          annotations: {
            ...(editItem.raw.metadata?.annotations || {}),
            description: editForm.description,
          },
          labels: {
            ...(editItem.raw.metadata?.labels || {}),
            protocol: editForm.protocol.toLowerCase().replace(/\s+/g, "-"),
          },
        },
        spec: {
          ...baseSpec,
          protocol: editForm.protocol,
          properties,
        },
      };
      await updateDeviceModelResource(editItem.namespace, updated);
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新设备模型失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">设备模型</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm" className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"><Plus className="w-3.5 h-3.5 mr-1" />创建设备模型</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[88vh] grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
              <DialogHeader className="px-6 py-4 border-b border-[#E5E6EB]"><DialogTitle className="text-base">创建设备模型</DialogTitle></DialogHeader>
              <div className="min-h-0 overflow-y-auto px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">名称</Label><Input placeholder="如 temperature-model" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">命名空间</Label>
                    <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">属性数量</Label><Input type="number" value={form.properties} onChange={e => {
                    const properties = Number(e.target.value);
                    setForm({ ...form, properties, propertiesText: formatProperties(defaultProperties(properties)) });
                  }} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">协议</Label>
                    <select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>MQTT</option><option>Modbus</option><option>OPC UA</option><option>Bluetooth</option></select>
                  </div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">描述</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="h-9 text-sm" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">属性定义（JSON 数组）</Label><Textarea value={form.propertiesText} onChange={e => setForm({ ...form, propertiesText: e.target.value })} className="min-h-52 text-xs font-mono" spellCheck={false} /></div>
              </div>
              <DialogFooter className="px-6 py-4 border-t border-[#E5E6EB] bg-white"><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-2xl max-h-[88vh] grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
              <DialogHeader className="px-6 py-4 border-b border-[#E5E6EB]"><DialogTitle className="text-base">编辑设备模型</DialogTitle></DialogHeader>
              <div className="min-h-0 overflow-y-auto px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4"><Info label="名称" value={editItem?.name || "-"} /><Info label="命名空间" value={editItem?.namespace || "-"} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">属性数量</Label><Input type="number" value={editForm.properties} onChange={e => {
                    const properties = Number(e.target.value);
                    setEditForm({ ...editForm, properties, propertiesText: formatProperties(defaultProperties(properties)) });
                  }} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">协议</Label>
                    <select value={editForm.protocol} onChange={e => setEditForm({ ...editForm, protocol: e.target.value })} className="w-full h-9 text-sm border rounded-md px-2 border-[#C9CDD4]"><option>MQTT</option><option>Modbus</option><option>OPC UA</option><option>Bluetooth</option></select>
                  </div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">描述</Label><Input value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className="h-9 text-sm" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-[#4E5969]">属性定义（JSON 数组）</Label><Textarea value={editForm.propertiesText} onChange={e => setEditForm({ ...editForm, propertiesText: e.target.value })} className="min-h-52 text-xs font-mono" spellCheck={false} /></div>
              </div>
              <DialogFooter className="px-6 py-4 border-t border-[#E5E6EB] bg-white"><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm" className="bg-[#165DFF] text-white" onClick={handleEdit} disabled={!editItem || editForm.properties <= 0}>保存</Button></DialogFooter>
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
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">标签数</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">属性数</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">协议</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[140px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[#86909C] text-sm">正在加载设备模型数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[#86909C] text-sm">暂无设备模型数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]">
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="text-sm text-[#165DFF] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.labels}</TableCell>
            <TableCell className="text-sm text-[#4E5969] px-4 py-3">{row.properties}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal">{row.protocol || "-"}</Badge></TableCell>
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
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="标签数" value={String(selected.labels)} /><Info label="属性数" value={String(selected.properties)} />
                <Info label="协议" value={selected.protocol || "-"} /><Info label="描述" value={selected.description || "-"} />
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="bg-[#0A1628] text-[#C9CDD4] rounded-lg p-4 text-xs font-mono overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除设备模型？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 <span className="font-medium text-[#1D2129]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm bg-[#F53F3F] text-white hover:bg-[#F53F3F]/90" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="bg-[#F7F8FA] rounded-md px-3 py-2"><p className="text-xs text-[#86909C] mb-0.5">{label}</p><p className="text-sm text-[#1D2129] font-medium truncate">{value}</p></div>);
}

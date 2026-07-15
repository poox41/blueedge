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
import { Search, Plus, RefreshCw, Trash2, Copy, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createDeviceModelResource, deleteDeviceModelResource, listNamespaces } from "@/api/services/resources";
import { getDeviceModelSummary, listDeviceModelSummaries } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { DeviceModelSummary } from "@/api/adapters/device-model-summary.adapter";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useNamespace } from "@/contexts/NamespaceContext";

interface DM { namespace: string; name: string; properties: number; createdAt: string; description?: string; protocol?: string; raw: KubeResource | any; devices?: DeviceModelSummary["devices"]; }
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

type LabelRule = {
  id: string;
  key: string;
  value: string;
};

type TwinPropertyForm = {
  name: string;
  type: string;
  accessMode: string;
  minimum: string;
  maximum: string;
  unit: string;
};

function defaultProperties(count = 1): DeviceModelProperty[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => ({
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

function parseProperties(text: string, fallbackCount: number): DeviceModelProperty[] {
  const trimmed = text.trim();
  if (!trimmed) return defaultProperties(fallbackCount);
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) throw new Error("属性定义必须是 JSON 数组");
  return normalizeProperties(parsed, fallbackCount);
}

function toDeviceModelRow(item: DeviceModelSummary): DM {
  return {
    namespace: item.namespace,
    name: item.name,
    properties: item.properties.length,
    createdAt: item.createdAt,
    description: item.description || "-",
    protocol: item.protocol || "-",
    devices: item.devices,
    raw: item.raw || item,
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

function buildDeviceModelResource(form: { name: string; namespace: string; properties: number; protocol: string; description: string; propertiesText: string; labels?: LabelRule[] }): KubeResource {
  const properties = parseProperties(form.propertiesText, form.properties);
  const customLabels = Object.fromEntries((form.labels || []).filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
  return {
    apiVersion: "devices.kubeedge.io/v1beta1",
    kind: "DeviceModel",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { protocol: form.protocol.toLowerCase().replace(/\s+/g, "-"), ...customLabels },
      annotations: form.description.trim() ? { description: form.description.trim() } : undefined,
    },
    spec: {
      protocol: form.protocol,
      properties,
    },
  };
}

export function DeviceModels() {
  const { selectedNamespace } = useNamespace();
  const namespaces = useNamespaceOptions();
  const [refreshedNamespaces, setRefreshedNamespaces] = useState<ReturnType<typeof useNamespaceOptions> | null>(null);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [data, setData] = useState<DM[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<DM | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [cancelCreateOpen, setCancelCreateOpen] = useState(false);
  const [addTwinOpen, setAddTwinOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DM | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
  const [twinForm, setTwinForm] = useState<TwinPropertyForm>({ name: "", type: "string", accessMode: "ReadOnly", minimum: "", maximum: "", unit: "" });
  const pageSize = 10;
  const twinProperties = useMemo(() => normalizeProperties(JSON.parse(form.propertiesText || "[]"), 0), [form.propertiesText]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setWarnings([]);
    try {
      const res = await listDeviceModelSummaries();
      setData(res.items.map(toDeviceModelRow));
      setWarnings((res.warnings || []).map((item) => item.message));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型数据失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshNamespaces = async () => {
    setRefreshingNamespaces(true);
    try {
      const items = (await listNamespaces()).filter((item) => item.value !== "all");
      if (items.length > 0) {
        setRefreshedNamespaces(items);
        if (!items.some((item) => item.value === form.namespace)) {
          setForm((current) => ({ ...current, namespace: items[0].value }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "命名空间刷新失败");
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  const filtered = useMemo(() => {
    let r = data;
    if (selectedNamespace !== "all") r = r.filter(d => d.namespace === selectedNamespace);
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, search, selectedNamespace]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (d: DM) => {
    setSelected(d);
    setDetailOpen(true);
    try {
      const detail = await getDeviceModelSummary(d.namespace, d.name);
      setSelected(toDeviceModelRow(detail.item));
      setWarnings((detail.warnings || []).map((item) => item.message));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型详情失败");
    }
  };
  const openDel = (d: DM) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeviceModelResource(delItem.namespace, delItem.name);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除设备模型失败");
    } finally {
      setDelOpen(false);
      setDelItem(null);
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    const resource = buildDeviceModelResource(form);
    try {
      await createDeviceModelResource(resource);
      await loadData();
      setCreateOpen(false);
      setCreateStep(1);
      setForm({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建设备模型失败");
    } finally {
      setIsLoading(false);
    }
  };
  const requestCancelCreate = () => setCancelCreateOpen(true);
  const confirmCancelCreate = () => {
    setCancelCreateOpen(false);
    setCreateOpen(false);
    setCreateStep(1);
    setForm({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
  };
  const addLabelRule = () => setForm((prev) => ({ ...prev, labels: [...prev.labels, { id: `label-${Date.now()}`, key: "", value: "" }] }));
  const updateLabelRule = (id: string, patch: Partial<LabelRule>) => setForm((prev) => ({ ...prev, labels: prev.labels.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const removeLabelRule = (id: string) => setForm((prev) => ({ ...prev, labels: prev.labels.length > 1 ? prev.labels.filter((item) => item.id !== id) : [{ id: "label-1", key: "", value: "" }] }));
  const resetTwinForm = () => setTwinForm({ name: "", type: "string", accessMode: "ReadOnly", minimum: "", maximum: "", unit: "" });
  const confirmAddTwin = () => {
    if (!twinForm.name.trim()) return;
    const nextProperty: DeviceModelProperty = {
      name: twinForm.name.trim(),
      type: twinForm.type.toUpperCase(),
      accessMode: twinForm.accessMode,
      ...(twinForm.minimum.trim() ? { minimum: twinForm.minimum.trim() } : {}),
      ...(twinForm.maximum.trim() ? { maximum: twinForm.maximum.trim() } : {}),
      ...(twinForm.unit.trim() ? { unit: twinForm.unit.trim() } : {}),
    };
    const nextProperties = [...twinProperties, nextProperty];
    setForm((prev) => ({ ...prev, properties: nextProperties.length, propertiesText: JSON.stringify(nextProperties, null, 2) }));
    resetTwinForm();
    setAddTwinOpen(false);
  };
  return (
    <div className="blueedge-page space-y-6">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">设备模型</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">定义终端设备的协议和数字孪生属性</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="toolbar-search relative w-[340px]">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input placeholder="搜索设备模型名称..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-12 rounded-xl bg-white pl-12 text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-[var(--color-border-strong)] bg-white" onClick={loadData} disabled={isLoading}>
              <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
            </Button>
          <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : requestCancelCreate()}>
            <DialogTrigger asChild><Button className="h-12 rounded-xl bg-[var(--color-text-primary)] px-6 text-sm font-semibold text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-2 h-5 w-5" />创建设备模型</Button></DialogTrigger>
            <DialogContent className="!flex max-h-[92vh] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
              {createStep === 2 && (
                <button type="button" onClick={() => setCreateStep(1)} className="absolute left-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" aria-label="返回基础信息">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <button type="button" onClick={requestCancelCreate} className="absolute right-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-2xl leading-none text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">×</button>
              <DialogHeader className={cn("shrink-0 border-b border-[#eef1f5] px-7 py-6", createStep === 2 && "pl-20")}><DialogTitle className="text-base font-bold">{createStep === 1 ? "创建设备模型" : "设备配置"}</DialogTitle></DialogHeader>
              <div className="shrink-0 border-b border-[#eef1f5] px-7 py-5">
                <CreateStepper current={createStep} steps={["基础信息", "设备配置"]} />
              </div>
              {error && <div className="mx-7 mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{error}</div>}
              <div className="min-h-0 flex-1 overflow-y-auto px-7 py-7">
                {createStep === 1 ? (
                  <div className="space-y-6">
                    <PrototypeField label="模型名称" required>
                      <Input placeholder="temp-sensor-v1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-10 rounded-xl text-sm" />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">最长 253 个字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号</p>
                    </PrototypeField>
                    <PrototypeField label="访问协议" required>
                      <Input placeholder="MQTT / Modbus TCP / OPC UA" value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })} className="h-10 rounded-xl text-sm" />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">默认 MQTT，也支持 Modbus TCP / OPC UA</p>
                    </PrototypeField>
                    <PrototypeField label="命名空间" required>
                      <div className="grid grid-cols-[1fr_48px] gap-3">
                        <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select !h-10 !rounded-xl !text-sm">{(refreshedNamespaces || namespaces.filter(n => n.value !== "all")).map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                        <Button type="button" variant="outline" className="h-10 rounded-xl px-0" onClick={() => void refreshNamespaces()} disabled={refreshingNamespaces} title="刷新命名空间"><RefreshCw className={cn("h-4 w-4", refreshingNamespaces && "animate-spin")} /></Button>
                      </div>
                      <button type="button" disabled className="mt-2 cursor-not-allowed text-sm font-semibold text-[var(--color-text-tertiary)]" title="当前版本暂未开放">+ 创建命名空间（暂未开放）</button>
                    </PrototypeField>
                    <PrototypeField label="描述">
                      <Textarea placeholder="请输入模型描述（内容无限制，长度限制为 63 个字符）" value={form.description} maxLength={63} onChange={e => setForm({ ...form, description: e.target.value })} className="min-h-[82px] rounded-xl text-sm" />
                      <p className="mt-1.5 text-right text-xs text-[var(--color-text-tertiary)]">{form.description.length}/63</p>
                    </PrototypeField>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">孪生属性</h3>
                      <Button type="button" onClick={() => setAddTwinOpen(true)} className="h-9 rounded-xl bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">
                        <Plus className="mr-1.5 h-4 w-4" />
                        新增孪生
                      </Button>
                    </div>
                    {twinProperties.length === 0 ? (
                      <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8e1ec] bg-[#fbfcfe] text-center">
                        <p className="text-sm font-medium text-[var(--color-text-secondary)]">暂无孪生属性</p>
                        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">点击“新增孪生”按钮添加</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {twinProperties.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
                            <div>
                              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.name}</p>
                              <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{item.type.toLowerCase()} / {item.accessMode === "ReadOnly" ? "只读" : "读/写"}{item.unit ? ` / ${item.unit}` : ""}</p>
                            </div>
                            <button type="button" className="action-button is-danger" onClick={() => {
                              const nextProperties = twinProperties.filter((current) => current.name !== item.name);
                              setForm((prev) => ({ ...prev, properties: nextProperties.length, propertiesText: JSON.stringify(nextProperties, null, 2) }));
                            }} aria-label={`删除 ${item.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">标签</h3>
                      {form.labels.map((label) => (
                        <div key={label.id} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                          <Input value={label.key} onChange={(event) => updateLabelRule(label.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-xl text-sm" />
                          <Input value={label.value} onChange={(event) => updateLabelRule(label.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-xl text-sm" />
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-danger)]" onClick={() => removeLabelRule(label.id)} aria-label="删除标签">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={addLabelRule} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]">
                        <Plus className="h-4 w-4" />
                        添加标签
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="shrink-0 border-t border-[#eef1f5] bg-white px-7 py-5">
                <Button variant="outline" onClick={requestCancelCreate} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                <Button onClick={() => createStep === 1 ? setCreateStep(2) : handleCreate()} disabled={!form.name || !form.protocol || !form.namespace} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">{createStep === 1 ? "下一步" : "创建"} <ChevronRight className="ml-1 h-4 w-4" /></Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={addTwinOpen} onOpenChange={setAddTwinOpen}>
            <DialogContent className="!flex max-w-[520px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
              <button type="button" onClick={() => setAddTwinOpen(false)} className="absolute right-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-2xl leading-none text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">×</button>
              <DialogHeader className="shrink-0 border-b border-[#eef1f5] px-7 py-6"><DialogTitle className="text-base font-bold">新增孪生属性</DialogTitle></DialogHeader>
              <div className="space-y-5 px-7 py-7">
                <PrototypeField label="属性名称" required>
                  <Input placeholder="temperature" value={twinForm.name} onChange={(event) => setTwinForm({ ...twinForm, name: event.target.value })} className="h-10 rounded-xl text-sm" />
                </PrototypeField>
                <PrototypeField label="属性值类型" required>
                  <select value={twinForm.type} onChange={(event) => setTwinForm({ ...twinForm, type: event.target.value })} className="blueedge-native-select !h-10 !rounded-xl !text-sm">
                    <option value="string">string</option>
                    <option value="int">int</option>
                    <option value="double">double</option>
                    <option value="bool">bool</option>
                  </select>
                </PrototypeField>
                <PrototypeField label="访问权限" required>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setTwinForm({ ...twinForm, accessMode: "ReadOnly" })} className={cn("h-10 rounded-xl border text-sm font-semibold", twinForm.accessMode === "ReadOnly" ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)]")}>只读</button>
                    <button type="button" onClick={() => setTwinForm({ ...twinForm, accessMode: "ReadWrite" })} className={cn("h-10 rounded-xl border text-sm font-semibold", twinForm.accessMode === "ReadWrite" ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)]")}>读/写</button>
                  </div>
                </PrototypeField>
                <div className="grid grid-cols-3 gap-3">
                  <PrototypeField label="最小值">
                    <Input placeholder="请输入最小值" value={twinForm.minimum} onChange={(event) => setTwinForm({ ...twinForm, minimum: event.target.value })} className="h-10 rounded-xl text-sm" />
                  </PrototypeField>
                  <PrototypeField label="最大值">
                    <Input placeholder="请输入最大值" value={twinForm.maximum} onChange={(event) => setTwinForm({ ...twinForm, maximum: event.target.value })} className="h-10 rounded-xl text-sm" />
                  </PrototypeField>
                  <PrototypeField label="单位">
                    <Input placeholder="请输入单位" value={twinForm.unit} onChange={(event) => setTwinForm({ ...twinForm, unit: event.target.value })} className="h-10 rounded-xl text-sm" />
                  </PrototypeField>
                </div>
              </div>
              <DialogFooter className="shrink-0 border-t border-[#eef1f5] bg-white px-7 py-5">
                <Button variant="outline" onClick={() => setAddTwinOpen(false)} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                <Button onClick={confirmAddTwin} disabled={!twinForm.name.trim()} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">确定</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog open={cancelCreateOpen} onOpenChange={setCancelCreateOpen}>
            <AlertDialogContent className="z-[120] max-w-[560px] rounded-[24px] p-0">
              <AlertDialogHeader className="border-b border-[var(--color-border)] px-8 py-6">
                <AlertDialogTitle className="text-xl">确认取消创建</AlertDialogTitle>
                <AlertDialogDescription className="pt-4 text-base">取消后，当前创建设备模型内容将不会保存。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="px-8 py-6">
                <AlertDialogCancel className="h-11 rounded-xl px-8">取消</AlertDialogCancel>
                <AlertDialogAction onClick={confirmCancelCreate} className="h-11 rounded-xl bg-[var(--color-danger)] px-8 text-white hover:bg-[var(--color-danger)]/90">确认取消</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </div>
        </div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      {warnings.length > 0 && <div className="rounded-md border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{warnings.slice(0, 3).join("；")}</div>}
      <div className="table-card">
        <Table><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="w-[18%] px-6 text-xs font-medium text-[var(--color-text-tertiary)]">模型名称</TableHead>
          <TableHead className="w-[9%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">协议</TableHead>
          <TableHead className="w-[10%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
          <TableHead className="px-5 text-xs font-medium text-[var(--color-text-tertiary)]">描述</TableHead>
          <TableHead className="w-[10%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">孪生属性</TableHead>
          <TableHead className="w-[15%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[8%] px-5 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载设备模型数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无设备模型数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
            <TableCell className="cursor-pointer px-6 py-3 text-sm font-semibold text-[var(--color-brand)] hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-5 py-3"><ProtocolBadge value={row.protocol || "-"} /></TableCell>
            <TableCell className="px-5 py-3 text-sm font-medium text-[var(--color-text-primary)]">{row.namespace}</TableCell>
            <TableCell className="max-w-[280px] truncate px-5 py-3 text-sm text-[var(--color-text-secondary)]">{row.description}</TableCell>
            <TableCell className="px-5 py-3 text-sm text-[var(--color-text-primary)]">{row.properties} 个</TableCell>
            <TableCell className="px-5 py-3 text-sm text-[var(--color-text-tertiary)]">{row.createdAt}</TableCell>
            <TableCell className="px-5 py-3 text-right"><button type="button" className="action-button is-danger ml-auto" title="删除" onClick={() => openDel(row)}><Trash2 className="h-3.5 w-3.5" /></button></TableCell>
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
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><Badge variant="outline" className="text-xs font-normal w-fit mt-2">{selected?.namespace}</Badge></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="孪生属性" value={`${selected.properties} 个`} />
                <Info label="协议" value={selected.protocol || "-"} /><Info label="描述" value={selected.description || "-"} />
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除设备模型？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

function ProtocolBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const isMqtt = normalized.includes("mqtt");
  return (
    <span className={cn(
      "inline-flex max-w-[120px] items-center rounded-lg px-3 py-1 text-xs font-semibold",
      isMqtt ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-brand-light)] text-[var(--color-brand)]"
    )}>
      <span className="truncate">{value}</span>
    </span>
  );
}

function CreateStepper({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {steps.map((step, index) => {
        const active = index + 1 === current;
        return (
          <div key={step} className="flex items-center gap-3">
            {index > 0 && <span className="h-px w-12 bg-[var(--color-border-strong)]" />}
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", active ? "bg-[var(--color-text-primary)] text-white" : "bg-[#e5eaf1] text-[#94a3b8]")}>
              <span className="h-2.5 w-2.5 rounded-full bg-current ring-[5px] ring-white" />
            </span>
            <span className={cn("text-sm font-bold", active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function PrototypeField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </Label>
      {children}
    </div>
  );
}

import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
import { Check, ChevronLeft, ChevronRight, Copy, Download, Maximize2, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { createDeviceResource, deleteDeviceResource } from "@/api/services/resources";
import { getDeviceSummary, getResourceObservability, listDeviceModelSummaries, listDeviceSummaries } from "@/api/services/product";
import { deviceStatusColor, deviceStatusText, twinStatusText } from "@/api/adapters/device-summary.adapter";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { ObservabilityEvent } from "@/api/adapters/observability.adapter";
import type { DeviceSummary } from "@/api/adapters/device-summary.adapter";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";

interface DI { namespace: string; name: string; model: string; node: string; edgeUnitRef?: string; nodeGroupRef?: string; status: string; statusColor: string; twins: number; createdAt: string; lastReport: string; protocol?: string; raw: KubeResource | any; }
interface LabelRule { id: string; key: string; value: string; }
interface DeviceTwin { name: string; expected: string; sampleInterval: string; reportInterval: string; yaml: string; }
interface TwinForm { name: string; expected: string; sampleInterval: string; reportInterval: string; yaml: string; }

function toDeviceRow(item: DeviceSummary): DI {
  const status = deviceStatusText(item.status);
  return {
    namespace: item.namespace,
    name: item.name,
    model: item.deviceModelRef || "-",
    node: item.nodeName || "-",
    edgeUnitRef: item.edgeUnitRef,
    nodeGroupRef: item.nodeGroupRef,
    status,
    statusColor: deviceStatusColor(item.status),
    twins: item.twins.total,
    createdAt: item.createdAt,
    lastReport: item.twins.items.find((t) => t.lastUpdatedAt)?.lastUpdatedAt || "-",
    protocol: item.protocol || "-",
    raw: item.raw || item,
  };
}

function getTwins(raw: KubeResource | any): Array<{ name: string; desired: string; reported: string; status: string }> {
  if (Array.isArray(raw?.twins?.items)) {
    return raw.twins.items.map((item: any) => ({
      name: item?.propertyName || item?.name || "-",
      desired: String(item?.desiredValue || "-"),
      reported: String(item?.reportedValue || "-"),
      status: item?.status || "unknown",
    }));
  }
  const twins = Array.isArray(raw.status?.twins) ? raw.status.twins : [];
  if (twins.length > 0) {
    return twins.map((item: any) => ({
      name: item?.propertyName || item?.name || "-",
      desired: String(item?.desired?.value ?? item?.desired ?? "-"),
      reported: String(item?.reported?.value ?? item?.reported ?? "-"),
      status: "unknown",
    }));
  }
  const properties = Array.isArray(raw.spec?.properties) ? raw.spec.properties : [];
  return properties.map((item: any) => ({
    name: item?.name || item?.propertyName || "-",
    desired: "-",
    reported: "-",
    status: "unknown",
  }));
}

function yaml(n: DI) {
  return `apiVersion: devices.kubeedge.io/v1beta1
kind: Device
metadata:
  name: ${n.name}
  namespace: ${n.namespace}
spec:
  deviceModelRef:
    name: ${n.model}
  nodeSelector:
    nodeSelectorTerms:
      - matchExpressions:
          - key: ""
            operator: In
            values:
              - ${n.node}
  protocol:
    mqtt:
      client-id: ${n.name}`;
}

function buildDeviceResource(form: { name: string; namespace: string; model: string; node: string; protocol: string; description?: string }, labels: LabelRule[] = [], twins: DeviceTwin[] = []): KubeResource {
  const customLabels = Object.fromEntries(labels.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
  return {
    apiVersion: "devices.kubeedge.io/v1beta1",
    kind: "Device",
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { model: form.model, ...customLabels },
      annotations: form.description?.trim() ? { description: form.description.trim() } : undefined,
    },
    spec: {
      deviceModelRef: {
        name: form.model,
      },
      nodeName: form.node,
      protocol: {
          protocolName: form.protocol || "MQTT",
      },
      properties: twins.map((item) => ({ name: item.name, expected: item.expected, collectCycle: item.sampleInterval, reportCycle: item.reportInterval })),
    },
  };
}

const defaultAccessYaml = `# 访问配置示例
protocol: MQTT
broker: tcp://mqtt.example.com:1883
clientId: device-001
username: ""
password: ""
tls:
  enabled: false
  certFile: ""
  keyFile: ""`;
const defaultTwinYaml = `collect:
  register: HoldingRegister
  address: 0
  quantity: 1
  slaveId: 1
report:
  topic: device/data
  qos: 0`;

export function DeviceInstances() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<DI[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<DI | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4>(1);
  const [cancelCreateOpen, setCancelCreateOpen] = useState(false);
  const [addTwinOpen, setAddTwinOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DI | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", model: "temp-sensor-v1", node: "edge-riscv-01", protocol: "", description: "" });
  const [labels, setLabels] = useState<LabelRule[]>([{ id: "label-1", key: "", value: "" }]);
  const [twins, setTwins] = useState<DeviceTwin[]>([]);
  const [twinForm, setTwinForm] = useState<TwinForm>({ name: "", expected: "", sampleInterval: "10", reportInterval: "60", yaml: defaultTwinYaml });
  const [accessYaml, setAccessYaml] = useState(defaultAccessYaml);
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setWarnings([]);
    try {
      const [rows, models] = await Promise.all([
        listDeviceSummaries(),
        listDeviceModelSummaries().catch(() => ({ items: [], warnings: [] })),
      ]);
      setData(rows.items.map(toDeviceRow));
      setWarnings([...(rows.warnings || []), ...(models.warnings || [])].map((item) => item.message));
      setModelOptions(Array.from(new Set(models.items.map((item) => item.name))));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载终端设备数据失败");
      setData([]);
      setModelOptions([]);
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

  const openDetail = async (d: DI) => {
    setSelected(d);
    setDetailOpen(true);
    setEvents([]);
    try {
      const [detail, observability] = await Promise.all([
        getDeviceSummary(d.namespace, d.name),
        getResourceObservability("device", d.namespace, d.name, { includeMetrics: false, includeEvents: true }),
      ]);
      setSelected(toDeviceRow(detail.item));
      setEvents(observability.item.events.items);
      setWarnings([...(detail.warnings || []), ...(observability.warnings || [])].map((item) => item.message));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载终端设备详情失败");
    }
  };
  const openDel = (d: DI) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeviceResource(delItem.namespace, delItem.name);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除终端设备失败");
    } finally {
      setDelOpen(false);
      setDelItem(null);
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    const resource = buildDeviceResource(form, labels, twins);
    try {
      await createDeviceResource(resource);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建终端设备失败");
    } finally {
      setCreateOpen(false);
      setCreateStep(1);
      setForm({ name: "", namespace: "default", model: "temp-sensor-v1", node: "edge-riscv-01", protocol: "", description: "" });
      setLabels([{ id: "label-1", key: "", value: "" }]);
      setTwins([]);
      setTwinForm({ name: "", expected: "", sampleInterval: "10", reportInterval: "60", yaml: defaultTwinYaml });
      setAccessYaml(defaultAccessYaml);
      setIsLoading(false);
    }
  };
  const requestCancelCreate = () => setCancelCreateOpen(true);
  const confirmCancelCreate = () => {
    setCancelCreateOpen(false);
    setCreateOpen(false);
    setCreateStep(1);
    setForm({ name: "", namespace: "default", model: "temp-sensor-v1", node: "edge-riscv-01", protocol: "", description: "" });
    setLabels([{ id: "label-1", key: "", value: "" }]);
    setTwins([]);
    setTwinForm({ name: "", expected: "", sampleInterval: "10", reportInterval: "60", yaml: defaultTwinYaml });
    setAccessYaml(defaultAccessYaml);
  };
  const addLabelRule = () => setLabels((prev) => [...prev, { id: `label-${Date.now()}`, key: "", value: "" }]);
  const updateLabelRule = (id: string, patch: Partial<LabelRule>) => setLabels((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeLabelRule = (id: string) => setLabels((prev) => prev.length > 1 ? prev.filter((item) => item.id !== id) : [{ id: "label-1", key: "", value: "" }]);
  const confirmAddTwin = () => {
    if (!twinForm.name.trim()) return;
    setTwins((prev) => [
      ...prev,
      {
        name: twinForm.name.trim(),
        expected: twinForm.expected.trim() || "-",
        sampleInterval: twinForm.sampleInterval.trim() || "10",
        reportInterval: twinForm.reportInterval.trim() || "60",
        yaml: twinForm.yaml,
      },
    ]);
    setTwinForm({ name: "", expected: "", sampleInterval: "10", reportInterval: "60", yaml: defaultTwinYaml });
    setAddTwinOpen(false);
  };
  return (
    <div className="blueedge-page space-y-6">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">终端设备</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">创建并管理现场设备实例</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="toolbar-search relative w-[340px]">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input placeholder="搜索设备名称..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-12 rounded-xl bg-white pl-12 text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl border-[var(--color-border-strong)] bg-white" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} /></Button>
            <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : requestCancelCreate()}>
              <DialogTrigger asChild><Button className="h-12 rounded-xl bg-[var(--color-text-primary)] px-6 text-sm font-semibold text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-2 h-5 w-5" />创建设备</Button></DialogTrigger>
              <DialogContent className={cn("!flex !max-w-none max-h-[92vh] flex-col gap-0 overflow-hidden rounded-[24px] p-0", createStep <= 2 ? "!w-[min(860px,calc(100vw-48px))]" : "!w-[min(1040px,calc(100vw-48px))]")} showCloseButton={false}>
                {createStep > 1 && (
                  <button type="button" onClick={() => setCreateStep((createStep - 1) as 1 | 2 | 3 | 4)} className="absolute left-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" aria-label="返回上一步">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <button type="button" onClick={requestCancelCreate} className="absolute right-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-5 w-5" /></button>
                <DialogHeader className={cn("shrink-0 border-b border-[#eef1f5] px-7 py-6", createStep > 1 && "pl-20")}><DialogTitle className="text-base font-bold">创建设备</DialogTitle></DialogHeader>
                <div className="shrink-0 border-b border-[#eef1f5] px-7 py-5">
                  <CreateStepper current={createStep} steps={["基础信息", "设备配置", "访问配置", "信息确认"]} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
                  {createStep === 1 && (
                    <div className="space-y-6">
                      <PrototypeField label="设备名称" required>
                        <Input placeholder="temp-sensor-01" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-10 rounded-xl text-sm" />
                        <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">最长 253 字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号</p>
                      </PrototypeField>
                      <PrototypeField label="命名空间" required>
                        <div className="grid grid-cols-[1fr_48px] gap-3">
                          <select value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select !h-10 !rounded-xl !text-sm">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                          <Button type="button" variant="outline" className="h-10 rounded-xl px-0"><RefreshCw className="h-4 w-4" /></Button>
                        </div>
                        <button type="button" className="mt-2 text-sm font-semibold text-[var(--color-brand)]">+ 创建命名空间</button>
                      </PrototypeField>
                      <PrototypeField label="设备模型" required>
                        <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="blueedge-native-select !h-10 !rounded-xl !text-sm">{modelOptions.length === 0 && <option value={form.model}>{form.model}</option>}{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select>
                      </PrototypeField>
                      <PrototypeField label="访问协议" required>
                        <Input placeholder="MQTT / Modbus TCP / OPC UA" value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })} className="h-10 rounded-xl text-sm" />
                      </PrototypeField>
                      <PrototypeField label="描述">
                        <Textarea placeholder="请输入设备描述" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="min-h-[82px] rounded-xl text-sm" />
                      </PrototypeField>
                    </div>
                  )}
                  {createStep === 2 && (
                    <div className="space-y-7">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">孪生属性</h3>
                        <Button type="button" onClick={() => setAddTwinOpen(true)} className="h-9 rounded-xl bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-1.5 h-4 w-4" />新增孪生</Button>
                      </div>
                      {twins.length === 0 ? (
                        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8e1ec] bg-[#fbfcfe] text-center">
                          <p className="text-sm font-medium text-[var(--color-text-secondary)]">暂无孪生属性</p>
                          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">点击“新增孪生”按钮添加</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {twins.map((item) => (
                            <div key={item.name} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
                              <div>
                                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.name}</p>
                                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">期望值 {item.expected} / 采样 {item.sampleInterval}s / 上报 {item.reportInterval}s</p>
                              </div>
                              <button type="button" className="action-button is-danger" onClick={() => setTwins((prev) => prev.filter((current) => current.name !== item.name))} aria-label={`删除 ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">标签</h3>
                        {labels.map((label) => (
                          <div key={label.id} className="grid grid-cols-[1fr_1fr_32px] items-center gap-3">
                            <Input value={label.key} onChange={(event) => updateLabelRule(label.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-xl text-sm" />
                            <Input value={label.value} onChange={(event) => updateLabelRule(label.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-xl text-sm" />
                            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-danger)]" onClick={() => removeLabelRule(label.id)} aria-label="删除标签"><X className="h-4 w-4" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={addLabelRule} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]"><Plus className="h-4 w-4" />添加标签</button>
                      </div>
                    </div>
                  )}
                  {createStep === 3 && (
                    <div className="space-y-5">
                      <PrototypeField label="参数配置 YAML" required>
                        <div className="grid grid-cols-2 gap-5">
                          <YamlPanel title="YAML 配置" actions value={accessYaml} onChange={setAccessYaml} />
                          <YamlPanel title="YAML 示例" readonly value={defaultAccessYaml} />
                        </div>
                      </PrototypeField>
                    </div>
                  )}
                  {createStep === 4 && (
                    <div className="space-y-6">
                      <ConfirmSection title="基础信息">
                        <div className="grid grid-cols-2 gap-x-14 gap-y-4 text-sm">
                          <ConfirmItem label="设备名称" value={form.name || "-"} />
                          <ConfirmItem label="命名空间" value={form.namespace} />
                          <ConfirmItem label="设备模型" value={form.model} />
                          <ConfirmItem label="访问协议" value={form.protocol || "-"} />
                          <ConfirmItem label="描述" value={form.description || "-"} />
                        </div>
                      </ConfirmSection>
                      <ConfirmSection title="设备配置">
                        <div className="mb-3 flex items-center justify-between text-sm font-semibold text-[var(--color-text-primary)]"><span>孪生属性列表</span><span className="text-[var(--color-text-tertiary)]">{twins.length} 个</span></div>
                        {twins.length === 0 ? <div className="flex min-h-[72px] items-center justify-center rounded-xl border border-dashed border-[#d8e1ec] bg-white text-sm text-[var(--color-text-tertiary)]">暂无孪生属性</div> : <div className="space-y-2">{twins.map((item) => <div key={item.name} className="rounded-xl bg-white px-4 py-3 text-sm font-medium">{item.name}</div>)}</div>}
                        <p className="mt-4 text-sm text-[var(--color-text-tertiary)]">标签：{labels.some((item) => item.key.trim()) ? labels.filter((item) => item.key.trim()).map((item) => `${item.key}:${item.value || "-"}`).join("，") : "-"}</p>
                      </ConfirmSection>
                      <ConfirmSection title="访问配置">
                        <YamlPanel title="YAML 预览" readonly readonlyActions value={accessYaml} compact />
                      </ConfirmSection>
                    </div>
                  )}
                </div>
                <DialogFooter className="shrink-0 border-t border-[#eef1f5] bg-white px-7 py-5">
                  {createStep > 1 && <Button variant="outline" onClick={() => setCreateStep((createStep - 1) as 1 | 2 | 3 | 4)} className="mr-auto h-9 rounded-[10px] px-4 text-sm"><ChevronLeft className="mr-1 h-4 w-4" />上一步</Button>}
                  <Button variant="outline" onClick={requestCancelCreate} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                  <Button onClick={() => createStep === 4 ? handleCreate() : setCreateStep((createStep + 1) as 1 | 2 | 3 | 4)} disabled={!form.name || !form.namespace || !form.model || !form.protocol} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">{createStep === 4 ? "创建" : "下一步"} <ChevronRight className="ml-1 h-4 w-4" /></Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={addTwinOpen} onOpenChange={setAddTwinOpen}>
              <DialogContent className="!flex !w-[min(1080px,calc(100vw-48px))] !max-w-none max-h-[88vh] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
                <button type="button" onClick={() => setAddTwinOpen(false)} className="absolute right-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-5 w-5" /></button>
                <DialogHeader className="shrink-0 border-b border-[#eef1f5] px-7 py-6"><DialogTitle className="text-base font-bold">新增孪生属性</DialogTitle></DialogHeader>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-7">
                  <PrototypeField label="属性名" required><Input placeholder="temperature" value={twinForm.name} onChange={(event) => setTwinForm({ ...twinForm, name: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                  <PrototypeField label="期望值"><Input placeholder="请输入期望值" value={twinForm.expected} onChange={(event) => setTwinForm({ ...twinForm, expected: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                  <div className="grid grid-cols-2 gap-5">
                    <PrototypeField label="采样间隔（秒）"><Input value={twinForm.sampleInterval} onChange={(event) => setTwinForm({ ...twinForm, sampleInterval: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                    <PrototypeField label="上报间隔（秒）"><Input value={twinForm.reportInterval} onChange={(event) => setTwinForm({ ...twinForm, reportInterval: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                  </div>
                  <PrototypeField label="属性访问方式（YAML）">
                    <div className="grid grid-cols-2 gap-5">
                      <YamlPanel title="YAML 配置" actions value={twinForm.yaml} onChange={(value) => setTwinForm({ ...twinForm, yaml: value })} />
                      <YamlPanel title="YAML 示例" readonly value={defaultTwinYaml} />
                    </div>
                  </PrototypeField>
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
                <AlertDialogDescription className="pt-4 text-base">取消后，当前创建设备内容将不会保存。</AlertDialogDescription>
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
          <TableHead className="w-[19%] px-6 text-xs font-medium text-[var(--color-text-tertiary)]">设备名称</TableHead>
          <TableHead className="w-[14%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">绑定节点</TableHead>
          <TableHead className="w-[15%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">设备模型</TableHead>
          <TableHead className="w-[9%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">协议</TableHead>
          <TableHead className="w-[9%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">状态</TableHead>
          <TableHead className="w-[15%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">最后上报</TableHead>
          <TableHead className="w-[15%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[8%] px-5 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载终端设备数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无终端设备数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
            <TableCell className="cursor-pointer px-6 py-3 text-sm font-semibold text-[var(--color-brand)] hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-5 py-3 text-sm font-medium text-[var(--color-text-primary)]">{row.node}</TableCell>
            <TableCell className="px-5 py-3 text-sm text-[var(--color-text-primary)]">{row.model}</TableCell>
            <TableCell className="px-5 py-3"><ProtocolBadge value={row.protocol || "-"} /></TableCell>
            <TableCell className="px-5 py-3"><StatusPill status={row.status} /></TableCell>
            <TableCell className="px-5 py-3 text-sm text-[var(--color-text-tertiary)]">{row.lastReport}</TableCell>
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
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} /><Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="twins" className="text-xs h-7">设备孪生</TabsTrigger><TabsTrigger value="events" className="text-xs h-7">事件</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} />
                <Info label="设备模型" value={selected.model} /><Info label="边缘节点" value={selected.node} />
                <Info label="状态" value={selected.status} /><Info label="协议" value={selected.protocol || "-"} />
                <Info label="Twin 数" value={String(selected.twins)} />
              </div>
            </TabsContent>
            <TabsContent value="twins" className="mt-3 space-y-2">
              {getTwins(selected.raw).map((t, i) => (
                <div key={i} className="bg-[var(--color-bg-soft)] rounded-md p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">{t.name}</span><Badge className="text-xs font-normal bg-[var(--color-success-soft)] text-[var(--color-success)]">{twinStatusText(t.status)}</Badge></div><div className="grid grid-cols-2 gap-2 mt-2"><Info label="期望值" value={t.desired} /><Info label="上报值" value={t.reported} /></div></div>
              ))}
              {getTwins(selected.raw).length === 0 && <div className="text-sm text-[var(--color-text-tertiary)] py-6 text-center">暂无设备孪生数据</div>}
            </TabsContent>
            <TabsContent value="events" className="mt-3 space-y-2">
              {events.length === 0 ? <div className="text-sm text-[var(--color-text-tertiary)] py-6 text-center">暂无关联事件</div> : events.map((event) => (
                <div key={event.name || `${event.reason}-${event.lastTimestamp}`} className="rounded-md bg-[var(--color-bg-soft)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{event.reason}</span>
                    <Badge variant="outline" className="text-xs font-normal">{event.type}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{event.message}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{event.lastTimestamp || "-"}</p>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除终端设备 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
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

function StatusPill({ status }: { status: string }) {
  const online = status === "在线" || status.toLowerCase() === "online";
  const unknown = status === "未知" || status.toLowerCase() === "unknown";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold",
      online ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[#f2f4f7] text-[var(--color-text-tertiary)]"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-[var(--color-success)]" : "bg-[#9ca3af]")} />
      {online ? "在线" : unknown ? "未知" : "离线"}
    </span>
  );
}

function CreateStepper({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex w-full items-center justify-center gap-3 overflow-visible">
      {steps.map((step, index) => {
        const active = index + 1 === current;
        const done = index + 1 < current;
        return (
          <div key={step} className="flex shrink-0 items-center gap-3">
            {index > 0 && <span className={cn("h-px w-9 shrink-0", done || active ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />}
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", active || done ? "bg-[var(--color-text-primary)] text-white" : "bg-[#e5eaf1] text-[#94a3b8]")}>
              {done ? <Check className="h-4 w-4" /> : <span className="h-2.5 w-2.5 rounded-full bg-current ring-[5px] ring-white" />}
            </span>
            <span className={cn("whitespace-nowrap text-sm font-bold", active || done ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function YamlPanel({ title, value, onChange, readonly, actions, readonlyActions, compact }: { title: string; value: string; onChange?: (value: string) => void; readonly?: boolean; actions?: boolean; readonlyActions?: boolean; compact?: boolean; }) {
  const lines = value.split("\n");
  const showActions = actions || readonlyActions;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const downloadYaml = () => {
    const blob = new Blob([value], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, "-").toLowerCase() || "config"}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const uploadYaml = (file?: File) => {
    if (!file || !onChange) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result ?? ""));
    reader.readAsText(file);
  };
  const renderPanel = (isFullscreen = false) => (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
      <div className="flex h-10 items-center justify-between gap-4 bg-[#f8fafc] px-4 text-sm font-semibold text-[var(--color-text-secondary)]">
        <span className="shrink-0 whitespace-nowrap">{title}</span>
        {readonly && !readonlyActions ? <span className="text-xs font-medium text-[var(--color-text-tertiary)]">只读参考</span> : showActions ? (
          <div className="flex shrink-0 items-center gap-4 whitespace-nowrap text-xs font-medium text-[var(--color-text-tertiary)]">
            {actions && (
              <>
                <input ref={fileInputRef} type="file" accept=".yaml,.yml,.txt,text/yaml,text/plain" className="hidden" onChange={(event) => { uploadYaml(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-brand)]"><Upload className="h-3.5 w-3.5" />上传</button>
              </>
            )}
            <button type="button" onClick={downloadYaml} className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-brand)]"><Download className="h-3.5 w-3.5" />下载</button>
            <button type="button" onClick={() => setFullscreen(true)} className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-brand)]"><Maximize2 className="h-3.5 w-3.5" />全屏</button>
          </div>
        ) : null}
      </div>
      <div className={cn("grid grid-cols-[44px_1fr] bg-[#1f1f1f] font-mono text-[13px] leading-6", compact ? "h-[220px]" : "h-[300px]", isFullscreen && "h-[calc(88vh-132px)]")}>
        <div className="select-none border-r border-white/5 py-3 text-right text-[#858585]">
          {lines.map((_, index) => <div key={index} className="px-3">{index + 1}</div>)}
        </div>
        {readonly || !onChange ? (
          <pre className="overflow-auto whitespace-pre py-3 pl-4 pr-5"><code><HighlightedYaml value={value} /></code></pre>
        ) : (
          <Textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="h-full resize-none overflow-auto rounded-none border-0 bg-transparent py-3 pl-4 pr-5 font-mono text-[13px] leading-6 text-[#d4d4d4] caret-white shadow-none outline-none selection:bg-white/20 focus-visible:ring-0" />
        )}
      </div>
    </div>
  );
  return (
    <>
      {renderPanel()}
      {fullscreen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-6">
          <div className="flex h-[88vh] w-[min(1180px,calc(100vw-48px))] flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">{title}</h3>
              <button type="button" onClick={() => setFullscreen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 p-5">
              {renderPanel(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HighlightedYaml({ value }: { value: string }) {
  return (
    <>
      {value.split("\n").map((line, index) => {
        const commentIndex = line.indexOf("#");
        if (commentIndex >= 0 && line.trimStart().startsWith("#")) {
          return <span key={index} className="block text-[#6A9955]">{line || " "}</span>;
        }
        const keyMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)(:)(.*)$/);
        if (!keyMatch) {
          return <span key={index} className="block text-[#d4d4d4]">{line || " "}</span>;
        }
        const [, indent, key, colon, rest] = keyMatch;
        const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
        const valuePart = commentIndex >= 0 ? rest.slice(0, Math.max(0, rest.length - comment.length)) : rest;
        return (
          <span key={index} className="block">
            <span className="text-[#d4d4d4]">{indent}</span>
            <span className="text-[#9CDCFE]">{key}</span>
            <span className="text-[#d4d4d4]">{colon}</span>
            <span className="text-[#CE9178]">{valuePart}</span>
            {comment && <span className="text-[#6A9955]">{comment}</span>}
          </span>
        );
      })}
    </>
  );
}

function ConfirmSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[#fbfcfe] p-5">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">{title}</h3>
        <ChevronLeft className="h-4 w-4 rotate-90 text-[var(--color-text-secondary)]" />
      </div>
      {children}
    </section>
  );
}

function ConfirmItem({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-[var(--color-text-primary)]">
      <span className="text-[var(--color-text-tertiary)]">{label}：</span>
      <span className="font-semibold">{value}</span>
    </p>
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

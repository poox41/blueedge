import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Maximize2, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X, ArrowLeft, Settings, Tag, FileCode2, Bug, ClipboardList } from "lucide-react";
import { createDeviceConfig, deleteDeviceConfig, getDeviceSummary, getResourceObservability, listDeviceModelSummaries, listDeviceSummaries, updateDeviceConfig } from "@/api/services/product";
import { deviceStatusColor, deviceStatusText } from "@/api/adapters/device-summary.adapter";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { ObservabilityEvent } from "@/api/adapters/observability.adapter";
import type { DeviceSummary } from "@/api/adapters/device-summary.adapter";
import type { DeviceModelSummary } from "@/api/adapters/device-model-summary.adapter";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useNamespace } from "@/contexts/NamespaceContext";
import { validateAccessConfigYaml, validateDeviceTwin, type DeviceTwinFormValue } from "@/lib/device-config";
import { useNavigate, useParams } from "react-router-dom";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

interface DI { namespace: string; name: string; model: string; node: string; edgeUnitRef?: string; nodeGroupRef?: string; status: string; statusColor: string; twins: number; createdAt: string; lastReport: string; protocol?: string; description: string; labels: Record<string, string>; raw: KubeResource | any; }
interface LabelRule { id: string; key: string; value: string; }
type DeviceTwin = DeviceTwinFormValue;
interface TwinForm { propertyName: string; desiredValue: string; collectIntervalSeconds: string; reportIntervalSeconds: string; accessConfigYaml: string; }

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
    description: item.annotations?.description || item.annotations?.["blueedge.io/description"] || "-",
    labels: item.labels || {},
    raw: { ...(item.raw || {}), extension: item.extension, twins: item.twins },
  };
}

function getTwins(raw: KubeResource | any): Array<{ name: string; desired: string; reported: string; status: string; syncTime: string }> {
  if (Array.isArray(raw?.twins?.items)) {
    return raw.twins.items.map((item: any) => ({
      name: item?.propertyName || item?.name || "-",
      desired: String(item?.desiredValue || "-"),
      reported: String(item?.reportedValue || "-"),
      status: item?.status || "unknown",
      syncTime: item?.lastUpdatedAt || "-",
    }));
  }
  const twins = Array.isArray(raw.status?.twins) ? raw.status.twins : [];
  if (twins.length > 0) {
    return twins.map((item: any) => ({
      name: item?.propertyName || item?.name || "-",
      desired: String(item?.desired?.value ?? item?.desired ?? "-"),
      reported: String(item?.reported?.value ?? item?.reported ?? "-"),
      status: "unknown",
      syncTime: item?.lastUpdatedAt || "-",
    }));
  }
  const properties = Array.isArray(raw.spec?.properties) ? raw.spec.properties : [];
  return properties.map((item: any) => ({
    name: item?.name || item?.propertyName || "-",
    desired: "-",
    reported: "-",
    status: "unknown",
    syncTime: "-",
  }));
}

function getEditableTwins(device: DI): DeviceTwin[] {
  const extension = device.raw?.extension || {};
  const items = Array.isArray(device.raw?.twins?.items) ? device.raw.twins.items : [];
  if (items.length > 0) {
    return items.map((item: any) => ({
      propertyName: item.propertyName || item.name || "",
      desiredValue: String(item.desiredValue ?? item.desired?.value ?? ""),
      collectIntervalSeconds: Number(item.collectIntervalSeconds || 10),
      reportIntervalSeconds: Number(item.reportIntervalSeconds || 60),
      accessConfigYaml: extension.twinAccessConfigs?.[item.propertyName || item.name] || defaultTwinYaml,
    })).filter((item: DeviceTwin) => item.propertyName);
  }
  return getTwins(device.raw).filter((item) => item.name !== "-").map((item) => ({
    propertyName: item.name,
    desiredValue: item.desired === "-" ? "" : item.desired,
    collectIntervalSeconds: 10,
    reportIntervalSeconds: 60,
    accessConfigYaml: extension.twinAccessConfigs?.[item.name] || defaultTwinYaml,
  }));
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
  const deviceValidation = useRequiredFieldValidation<"name" | "namespace" | "model" | "protocol" | "twins" | "yaml">();
  const twinValidation = useRequiredFieldValidation<"propertyName">();
  const navigate = useNavigate();
  const { namespace: detailNamespaceParam, name: detailNameParam } = useParams<{ namespace?: string; name?: string }>();
  const detailNamespace = detailNamespaceParam ? decodeURIComponent(detailNamespaceParam) : "";
  const detailName = detailNameParam ? decodeURIComponent(detailNameParam) : "";
  const isDetailRoute = Boolean(detailNamespace && detailName);
  const { selectedNamespace } = useNamespace();
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<DI[]>([]);
  const [modelOptions, setModelOptions] = useState<DeviceModelSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [events, setEvents] = useState<ObservabilityEvent[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DI | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DI | null>(null);
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4>(1);
  const [cancelCreateOpen, setCancelCreateOpen] = useState(false);
  const [addTwinOpen, setAddTwinOpen] = useState(false);
  const [editingTwinName, setEditingTwinName] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DI | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", model: "", node: "", protocol: "", description: "" });
  const [labels, setLabels] = useState<LabelRule[]>([{ id: "label-1", key: "", value: "" }]);
  const [twins, setTwins] = useState<DeviceTwin[]>([]);
  const [accessConfigYaml, setAccessConfigYaml] = useState(defaultAccessYaml);
  const [twinForm, setTwinForm] = useState<TwinForm>({ propertyName: "", desiredValue: "", collectIntervalSeconds: "10", reportIntervalSeconds: "60", accessConfigYaml: defaultTwinYaml });
  const pageSize = 10;

  const selectedModel = useMemo(
    () => modelOptions.find((item) => item.namespace === form.namespace && item.name === form.model) || null,
    [form.model, form.namespace, modelOptions],
  );
  const availableModels = useMemo(() => modelOptions.filter((item) => item.namespace === form.namespace), [form.namespace, modelOptions]);

  const loadData = useCallback(async (preserveCurrentRows = false) => {
    if (preserveCurrentRows) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    setWarnings([]);
    try {
      const [rows, models] = await Promise.all([
        listDeviceSummaries(),
        listDeviceModelSummaries().catch(() => ({ items: [], warnings: [] })),
      ]);
      setData(rows.items.map(toDeviceRow));
      setWarnings([...(rows.warnings || []), ...(models.warnings || [])].map((item) => item.message));
      setModelOptions(models.items);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载终端设备数据失败");
      if (!preserveCurrentRows) {
        setData([]);
        setModelOptions([]);
      }
    } finally {
      if (preserveCurrentRows) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!detailNamespace || !detailName) return;
    let active = true;
    setEvents([]);
    Promise.all([
      getDeviceSummary(detailNamespace, detailName),
      getResourceObservability("device", detailNamespace, detailName, { includeMetrics: false, includeEvents: true }),
    ]).then(([detail, observability]) => {
      if (!active) return;
      setSelected(toDeviceRow(detail.item));
      setEvents(observability.item.events.items);
      setWarnings([...(detail.warnings || []), ...(observability.warnings || [])].map((item) => item.message));
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : "加载终端设备详情失败");
    });
    return () => { active = false; };
  }, [detailName, detailNamespace]);

  const filtered = useMemo(() => {
    let r = data;
    if (selectedNamespace !== "all") r = r.filter(d => d.namespace === selectedNamespace);
    if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [data, search, selectedNamespace]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = (d: DI) => {
    setSelected(d);
    navigate(`/deviceinstances/${encodeURIComponent(d.namespace)}/${encodeURIComponent(d.name)}`);
  };
  const openDel = (d: DI) => { setDelItem(d); setDelOpen(true); };
  const confirmDel = async () => {
    if (!delItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteDeviceConfig(delItem.namespace, delItem.name);
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
    try {
      validateAccessConfigYaml(accessConfigYaml, form.protocol);
      const payload = {
        name: form.name.trim(),
        namespace: form.namespace,
        deviceModelRef: form.model,
        nodeName: form.node || undefined,
        protocol: form.protocol.trim(),
        description: form.description.trim() || undefined,
        labels: Object.fromEntries(labels.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()])),
        accessConfigYaml,
        properties: twins,
      };
      if (editingDevice) {
        await updateDeviceConfig(editingDevice.namespace, editingDevice.name, payload);
        const detail = await getDeviceSummary(editingDevice.namespace, editingDevice.name);
        setSelected(toDeviceRow(detail.item));
      } else {
        await createDeviceConfig(payload);
      }
      await loadData();
      setCreateOpen(false);
      setEditingDevice(null);
      setCreateStep(1);
      setForm({ name: "", namespace: "default", model: "", node: "", protocol: "", description: "" });
      setLabels([{ id: "label-1", key: "", value: "" }]);
      setTwins([]);
      setAccessConfigYaml(defaultAccessYaml);
      setTwinForm({ propertyName: "", desiredValue: "", collectIntervalSeconds: "10", reportIntervalSeconds: "60", accessConfigYaml: defaultTwinYaml });
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建终端设备失败");
    } finally {
      setIsLoading(false);
    }
  };
  const requestCancelCreate = () => setCancelCreateOpen(true);
  const confirmCancelCreate = () => {
    setCancelCreateOpen(false);
    setCreateOpen(false);
    setEditingDevice(null);
    setCreateStep(1);
    setForm({ name: "", namespace: "default", model: "", node: "", protocol: "", description: "" });
    setLabels([{ id: "label-1", key: "", value: "" }]);
    setTwins([]);
    setAccessConfigYaml(defaultAccessYaml);
    setTwinForm({ propertyName: "", desiredValue: "", collectIntervalSeconds: "10", reportIntervalSeconds: "60", accessConfigYaml: defaultTwinYaml });
    setEditingTwinName(null);
  };
  const addLabelRule = () => setLabels((prev) => [...prev, { id: `label-${Date.now()}`, key: "", value: "" }]);
  const updateLabelRule = (id: string, patch: Partial<LabelRule>) => setLabels((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  const removeLabelRule = (id: string) => setLabels((prev) => prev.length > 1 ? prev.filter((item) => item.id !== id) : [{ id: "label-1", key: "", value: "" }]);
  const openAddTwin = () => {
    setEditingTwinName(null);
    setTwinForm({ propertyName: "", desiredValue: "", collectIntervalSeconds: "10", reportIntervalSeconds: "60", accessConfigYaml: defaultTwinYaml });
    setAddTwinOpen(true);
  };
  const openEditTwin = (twin: DeviceTwin) => {
    setEditingTwinName(twin.propertyName);
    setTwinForm({
      propertyName: twin.propertyName,
      desiredValue: twin.desiredValue,
      collectIntervalSeconds: String(twin.collectIntervalSeconds),
      reportIntervalSeconds: String(twin.reportIntervalSeconds),
      accessConfigYaml: twin.accessConfigYaml,
    });
    setAddTwinOpen(true);
  };
  const confirmAddTwin = () => {
    setError("");
    if (!twinValidation.validate([{ field: "propertyName", valid: Boolean(twinForm.propertyName.trim()), message: "请输入属性名", elementId: "device-twin-property-name" }])) return;
    try {
      const next: DeviceTwin = {
        propertyName: twinForm.propertyName.trim(),
        desiredValue: twinForm.desiredValue.trim(),
        collectIntervalSeconds: Number(twinForm.collectIntervalSeconds),
        reportIntervalSeconds: Number(twinForm.reportIntervalSeconds),
        accessConfigYaml: twinForm.accessConfigYaml,
      };
      validateDeviceTwin(next, selectedModel?.properties || [], twins.filter((item) => item.propertyName !== editingTwinName).map((item) => item.propertyName));
      setTwins((prev) => editingTwinName
        ? prev.map((item) => item.propertyName === editingTwinName ? next : item)
        : [...prev, next]);
      setTwinForm({ propertyName: "", desiredValue: "", collectIntervalSeconds: "10", reportIntervalSeconds: "60", accessConfigYaml: defaultTwinYaml });
      setEditingTwinName(null);
      setAddTwinOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "孪生属性配置不合法");
    }
  };

  const openCreate = () => {
    setEditingDevice(null);
    setCreateStep(1);
    setForm({ name: "", namespace: selectedNamespace === "all" ? "default" : selectedNamespace, model: "", node: "", protocol: "", description: "" });
    setLabels([{ id: "label-1", key: "", value: "" }]);
    setTwins([]);
    setAccessConfigYaml(defaultAccessYaml);
    setCreateOpen(true);
  };

  const openEdit = (device: DI) => {
    const extension = device.raw?.extension || {};
    const nextTwins = getEditableTwins(device);
    const nextLabels = Object.entries(device.labels).map(([key, value], index) => ({ id: `label-${index + 1}`, key, value }));
    setEditingDevice(device);
    setCreateStep(1);
    setForm({ name: device.name, namespace: device.namespace, model: device.model, node: device.node === "-" ? "" : device.node, protocol: device.protocol === "-" ? "" : device.protocol || "", description: device.description === "-" ? "" : device.description });
    setLabels(nextLabels.length ? nextLabels : [{ id: "label-1", key: "", value: "" }]);
    setTwins(nextTwins);
    setAccessConfigYaml(extension.accessConfigYaml || defaultAccessYaml);
    setCreateOpen(true);
  };

  const persistDetailDevice = async (device: DI, nextTwins: DeviceTwin[], nextLabels: Record<string, string>) => {
    setIsLoading(true);
    setError("");
    try {
      const extension = device.raw?.extension || {};
      await updateDeviceConfig(device.namespace, device.name, {
        name: device.name,
        namespace: device.namespace,
        deviceModelRef: device.model,
        nodeName: device.node === "-" ? undefined : device.node,
        protocol: device.protocol === "-" ? "" : device.protocol || "",
        description: device.description === "-" ? undefined : device.description,
        labels: nextLabels,
        accessConfigYaml: extension.accessConfigYaml || defaultAccessYaml,
        properties: nextTwins,
      });
      const detail = await getDeviceSummary(device.namespace, device.name);
      const nextDevice = toDeviceRow(detail.item);
      setSelected(nextDevice);
      setData((current) => current.map((item) => item.namespace === nextDevice.namespace && item.name === nextDevice.name ? nextDevice : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新终端设备详情失败");
    } finally {
      setIsLoading(false);
    }
  };

  const persistDetailTwins = (device: DI, nextTwins: DeviceTwin[]) => persistDetailDevice(device, nextTwins, device.labels);

  const updateDetailTwinDesired = (device: DI, propertyName: string, desiredValue: string) => {
    const nextTwins = getEditableTwins(device).map((item) => item.propertyName === propertyName ? { ...item, desiredValue } : item);
    void persistDetailTwins(device, nextTwins);
  };

  const deleteDetailTwin = (device: DI, propertyName: string) => {
    const nextTwins = getEditableTwins(device).filter((item) => item.propertyName !== propertyName);
    void persistDetailTwins(device, nextTwins);
  };

  const addDetailLabel = (device: DI, key: string, value: string) => {
    void persistDetailDevice(device, getEditableTwins(device), { ...device.labels, [key]: value });
  };

  const deleteDetailLabel = (device: DI, key: string) => {
    const nextLabels = { ...device.labels };
    delete nextLabels[key];
    void persistDetailDevice(device, getEditableTwins(device), nextLabels);
  };

  const goNext = () => {
    setError("");
    try {
      if (createStep === 1) {
        if (!deviceValidation.validate([
          { field: "name", valid: Boolean(form.name.trim()), message: "请输入设备名称", elementId: "device-name" },
          { field: "namespace", valid: Boolean(form.namespace), message: "请选择命名空间", elementId: "device-namespace" },
          { field: "model", valid: Boolean(form.model), message: "请选择设备模型", elementId: "device-model" },
          { field: "protocol", valid: Boolean(form.protocol.trim()), message: "请输入访问协议", elementId: "device-protocol" },
        ])) return;
      }
      if (createStep === 2 && !deviceValidation.validate([{ field: "twins", valid: twins.length > 0, message: "至少需要配置一个孪生属性", elementId: "device-add-twin" }])) return;
      if (createStep === 3) {
        const yamlValid = Boolean(accessConfigYaml.trim());
        if (!deviceValidation.validate([{ field: "yaml", valid: yamlValid, message: "请输入参数配置 YAML", elementId: "device-access-yaml" }])) return;
        validateAccessConfigYaml(accessConfigYaml, form.protocol);
      }
      setCreateStep((createStep + 1) as 1 | 2 | 3 | 4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "当前步骤校验失败");
    }
  };
  const detailDevice = selected?.namespace === detailNamespace && selected?.name === detailName
    ? selected
    : data.find((item) => item.namespace === detailNamespace && item.name === detailName) || null;
  return (
    <>
      {isDetailRoute && detailDevice && <TerminalDeviceDetailPage device={detailDevice} events={events} error={error} onBack={() => navigate("/deviceinstances")} onEdit={() => openEdit(detailDevice)} onUpdateTwin={(propertyName, desiredValue) => updateDetailTwinDesired(detailDevice, propertyName, desiredValue)} onDeleteTwin={(propertyName) => deleteDetailTwin(detailDevice, propertyName)} onAddLabel={(key, value) => addDetailLabel(detailDevice, key, value)} onDeleteLabel={(key) => deleteDetailLabel(detailDevice, key)} saving={isLoading} />}
      {isDetailRoute && !detailDevice && <div className="blueedge-page"><div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white text-sm text-[var(--color-text-secondary)]">{isLoading ? "正在加载终端设备详情..." : error || "未找到该终端设备"}</div></div>}
    <div className={cn("blueedge-page space-y-6", isDetailRoute && "hidden")}>
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#111827]">终端设备</h1>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">创建并管理现场设备实例</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="toolbar-search relative w-[240px] transition-[width] focus-within:w-[300px]">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input placeholder="搜索设备名称..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-10 rounded-xl bg-white pl-11 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-[10px] border-[var(--color-border-strong)] bg-white" onClick={() => void loadData(true)} disabled={isLoading || isRefreshing} aria-label="刷新终端设备列表"><RefreshCw className={cn("h-4 w-4", (isLoading || isRefreshing) && "animate-spin")} /></Button>
            <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : requestCancelCreate()}>
              <DialogTrigger asChild><Button onClick={openCreate} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-xs font-medium text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-1.5 h-4 w-4" />创建设备</Button></DialogTrigger>
              <DialogContent className="!flex !w-[min(600px,calc(100vw-48px))] !max-w-none max-h-[min(720px,calc(100vh-48px))] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
                {!editingDevice && createStep > 1 && (
                  <button type="button" onClick={() => setCreateStep((createStep - 1) as 1 | 2 | 3 | 4)} className="absolute left-7 top-[18px] flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" aria-label="返回上一步">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <button type="button" onClick={requestCancelCreate} className="absolute right-7 top-[18px] flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-4 w-4" /></button>
                <DialogHeader className={cn("h-[72px] shrink-0 justify-center border-b border-[#eef1f5] px-7", !editingDevice && createStep > 1 && "pl-20")}><DialogTitle className="text-base font-semibold">{editingDevice ? "编辑设备" : "创建设备"}</DialogTitle></DialogHeader>
                {!editingDevice && <div className="shrink-0 px-7 pt-4"><CreateStepper current={createStep} steps={["基础信息", "设备配置", "访问配置", "信息确认"]} /></div>}
                {error && <div className="mx-8 mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{error}</div>}
                <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
                  {createStep === 1 && (
                    <div className="space-y-5">
                      <PrototypeField label="设备名称" required error={deviceValidation.errors.name} errorId="device-name-error">
                        <Input id="device-name" disabled={Boolean(editingDevice)} placeholder="temp-sensor-01" value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); deviceValidation.clearError("name"); }} aria-invalid={Boolean(deviceValidation.errors.name)} aria-describedby={deviceValidation.errors.name ? "device-name-error" : undefined} className="h-10 rounded-xl text-sm disabled:bg-[var(--color-bg-soft)] disabled:text-[var(--color-text-tertiary)]" />
                        <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">最长 253 字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号</p>
                      </PrototypeField>
                      <PrototypeField label="命名空间" required error={deviceValidation.errors.namespace} errorId="device-namespace-error">
                        {editingDevice ? <Input disabled value={form.namespace} className="h-10 rounded-xl bg-[var(--color-bg-soft)] text-sm text-[var(--color-text-tertiary)]" /> : <select id="device-namespace" value={form.namespace} onChange={e => { setForm({ ...form, namespace: e.target.value, model: "", protocol: "" }); setTwins([]); deviceValidation.clearError("namespace"); }} aria-invalid={Boolean(deviceValidation.errors.namespace)} aria-describedby={deviceValidation.errors.namespace ? "device-namespace-error" : undefined} className="blueedge-native-select !h-10 !rounded-xl !text-sm">{namespaces.filter(n=>n.value!=="all").map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>}
                      </PrototypeField>
                      <PrototypeField label="设备模型" required error={deviceValidation.errors.model} errorId="device-model-error">
                        {editingDevice ? <Input disabled value={form.model} className="h-10 rounded-xl bg-[var(--color-bg-soft)] text-sm text-[var(--color-text-tertiary)]" /> : <select id="device-model" value={form.model} onChange={e => { const model = availableModels.find((item) => item.name === e.target.value); setForm({ ...form, model: e.target.value, protocol: model?.protocol || form.protocol }); setTwins([]); deviceValidation.clearError("model"); if (model?.protocol) deviceValidation.clearError("protocol"); }} aria-invalid={Boolean(deviceValidation.errors.model)} aria-describedby={deviceValidation.errors.model ? "device-model-error" : undefined} className="blueedge-native-select !h-10 !rounded-xl !text-sm"><option value="">请选择真实设备模型</option>{availableModels.map(model => <option key={`${model.namespace}/${model.name}`} value={model.name}>{model.name}</option>)}</select>}
                      </PrototypeField>
                      <PrototypeField label="访问协议" required error={deviceValidation.errors.protocol} errorId="device-protocol-error">
                        <Input id="device-protocol" disabled={Boolean(editingDevice)} placeholder="MQTT / Modbus TCP / OPC UA" value={form.protocol} onChange={e => { setForm({ ...form, protocol: e.target.value }); deviceValidation.clearError("protocol"); }} aria-invalid={Boolean(deviceValidation.errors.protocol)} aria-describedby={deviceValidation.errors.protocol ? "device-protocol-error" : undefined} className="h-10 rounded-xl text-sm disabled:bg-[var(--color-bg-soft)] disabled:text-[var(--color-text-tertiary)]" />
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
                        <Button id="device-add-twin" type="button" onClick={openAddTwin} disabled={!selectedModel} className="h-9 rounded-xl bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-1.5 h-4 w-4" />新增孪生</Button>
                      </div>
                      {twins.length === 0 ? (
                        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8e1ec] bg-[#fbfcfe] text-center">
                          <p className="text-sm font-medium text-[var(--color-text-secondary)]">暂无孪生属性</p>
                          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">点击“新增孪生”按钮添加</p>
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
                          <Table><TableHeader><TableRow className="bg-white hover:bg-white"><TableHead>属性名称</TableHead><TableHead>期望值</TableHead><TableHead>采样间隔</TableHead><TableHead>上报间隔</TableHead><TableHead>访问 YAML</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
                            <TableBody>{twins.map((item) => <TableRow key={item.propertyName}><TableCell className="font-semibold">{item.propertyName}</TableCell><TableCell>{item.desiredValue || "-"}</TableCell><TableCell>{item.collectIntervalSeconds}s</TableCell><TableCell>{item.reportIntervalSeconds}s</TableCell><TableCell>{item.accessConfigYaml.trim() ? "已配置" : "-"}</TableCell><TableCell><div className="flex justify-end gap-2"><button type="button" className="action-button" onClick={() => openEditTwin(item)} aria-label={`编辑 ${item.propertyName}`}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" onClick={() => setTwins((prev) => prev.filter((current) => current.propertyName !== item.propertyName))} aria-label={`删除 ${item.propertyName}`}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell></TableRow>)}</TableBody>
                          </Table>
                        </div>
                      )}
                      <RequiredFieldError id="device-twins-error" message={deviceValidation.errors.twins} />
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">标签</h3>
                        {labels.map((label) => (
                          <div key={label.id} className="grid grid-cols-[1fr_1fr_32px] items-center gap-3">
                            <Input value={label.key} onChange={(event) => updateLabelRule(label.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-xl text-sm" />
                            <Input value={label.value} onChange={(event) => updateLabelRule(label.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-xl text-sm" />
                            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" onClick={() => removeLabelRule(label.id)} aria-label="删除标签"><X className="h-4 w-4" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={addLabelRule} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]"><Plus className="h-4 w-4" />添加标签</button>
                      </div>
                    </div>
                  )}
                  {createStep === 3 && (
                    <div className="space-y-5">
                      <PrototypeField label="参数配置 YAML" required error={deviceValidation.errors.yaml} errorId="device-access-yaml-error">
                        <div id="device-access-yaml" tabIndex={-1}><YamlPanel title="YAML 配置" value={accessConfigYaml} onChange={(value) => { setAccessConfigYaml(value); deviceValidation.clearError("yaml"); }} actions downloadName={`${form.name || "device"}-access-config.yaml`} /></div>
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
                        {twins.length === 0 ? <div className="flex min-h-[72px] items-center justify-center rounded-xl border border-dashed border-[#d8e1ec] bg-white text-sm text-[var(--color-text-tertiary)]">暂无孪生属性</div> : <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"><Table><TableHeader><TableRow><TableHead>属性名称</TableHead><TableHead>期望值</TableHead><TableHead>采样间隔</TableHead><TableHead>上报间隔</TableHead><TableHead>属性访问方式</TableHead></TableRow></TableHeader><TableBody>{twins.map((item) => <TableRow key={item.propertyName}><TableCell>{item.propertyName}</TableCell><TableCell>{item.desiredValue || "-"}</TableCell><TableCell>{item.collectIntervalSeconds}s</TableCell><TableCell>{item.reportIntervalSeconds}s</TableCell><TableCell>{item.accessConfigYaml.trim() ? "已配置" : "-"}</TableCell></TableRow>)}</TableBody></Table></div>}
                        <p className="mt-4 text-sm text-[var(--color-text-tertiary)]">标签：{labels.some((item) => item.key.trim()) ? labels.filter((item) => item.key.trim()).map((item) => `${item.key}:${item.value || "-"}`).join("，") : "-"}</p>
                      </ConfirmSection>
                      <ConfirmSection title="访问配置">
                        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">结构化配置写入 Device CRD，原始 YAML 写入关联扩展 ConfigMap。</p>
                        <YamlPanel title="YAML 预览" readonly readonlyActions compact value={accessConfigYaml} downloadName={`${form.name || "device"}-access-config.yaml`} />
                      </ConfirmSection>
                    </div>
                  )}
                </div>
                <DialogFooter className="shrink-0 border-t border-[#eef1f5] bg-white px-7 py-5">
                  {!editingDevice && createStep > 1 && <Button variant="outline" onClick={() => setCreateStep((createStep - 1) as 1 | 2 | 3 | 4)} className="mr-auto h-9 rounded-[10px] px-4 text-sm"><ChevronLeft className="mr-1 h-4 w-4" />上一步</Button>}
                  <Button variant="outline" onClick={requestCancelCreate} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                  <Button onClick={() => editingDevice ? handleCreate() : createStep === 4 ? handleCreate() : goNext()} disabled={isLoading} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">{editingDevice ? (isLoading ? "保存中..." : "保存") : createStep === 4 ? (isLoading ? "创建中..." : "创建") : "下一步"}{!editingDevice && createStep < 4 && <ChevronRight className="ml-1 h-4 w-4" />}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={addTwinOpen} onOpenChange={setAddTwinOpen}>
              <DialogContent className="!flex !w-[min(600px,calc(100vw-48px))] !max-w-none max-h-[90vh] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
                <button type="button" onClick={() => setAddTwinOpen(false)} className="absolute right-7 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-5 w-5" /></button>
                <DialogHeader className="shrink-0 border-b border-[#eef1f5] px-7 py-6"><DialogTitle className="text-base font-bold">{editingTwinName ? "编辑孪生属性" : "新增孪生属性"}</DialogTitle></DialogHeader>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-7">
                  <PrototypeField label="属性名" required error={twinValidation.errors.propertyName} errorId="device-twin-property-name-error">
                    <Input id="device-twin-property-name" list="device-model-property-options" placeholder="请输入属性名" value={twinForm.propertyName} onChange={(event) => { setTwinForm({ ...twinForm, propertyName: event.target.value }); twinValidation.clearError("propertyName"); }} aria-invalid={Boolean(twinValidation.errors.propertyName)} aria-describedby={twinValidation.errors.propertyName ? "device-twin-property-name-error" : undefined} className="h-10 rounded-xl text-sm" />
                    <datalist id="device-model-property-options">{(selectedModel?.properties || []).filter((property) => property.name === editingTwinName || !twins.some((item) => item.propertyName === property.name)).map((property) => <option key={property.name} value={property.name}>{property.type}</option>)}</datalist>
                    <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">可直接输入或从设备模型属性建议中选择；名称必须存在于当前设备模型。</p>
                  </PrototypeField>
                  <PrototypeField label="期望值"><Input placeholder="请输入期望值" value={twinForm.desiredValue} onChange={(event) => setTwinForm({ ...twinForm, desiredValue: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                  <div className="grid grid-cols-2 gap-5">
                    <PrototypeField label="采样间隔（秒）"><Input type="number" min="1" value={twinForm.collectIntervalSeconds} onChange={(event) => setTwinForm({ ...twinForm, collectIntervalSeconds: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                    <PrototypeField label="上报间隔（秒）"><Input type="number" min="1" value={twinForm.reportIntervalSeconds} onChange={(event) => setTwinForm({ ...twinForm, reportIntervalSeconds: event.target.value })} className="h-10 rounded-xl text-sm" /></PrototypeField>
                  </div>
                  <PrototypeField label="属性访问方式（YAML）" required>
                    <YamlPanel title="YAML 配置" value={twinForm.accessConfigYaml} onChange={(value) => setTwinForm({ ...twinForm, accessConfigYaml: value })} actions compact downloadName={`${twinForm.propertyName || "property"}-visitor.yaml`} />
                  </PrototypeField>
                </div>
                <DialogFooter className="shrink-0 border-t border-[#eef1f5] bg-white px-7 py-5">
                  <Button variant="outline" onClick={() => setAddTwinOpen(false)} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                  <Button onClick={confirmAddTwin} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">确定</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog open={cancelCreateOpen} onOpenChange={setCancelCreateOpen}>
            <AlertDialogContent className="z-[140] !w-[calc(100%-2rem)] !max-w-[440px] gap-0 overflow-hidden rounded-2xl p-0 sm:!max-w-[440px]">
              <AlertDialogHeader className="flex-row items-center justify-between border-b border-[var(--color-border)] px-6 py-4 text-left">
                <AlertDialogTitle className="text-base font-semibold">确认取消{editingDevice ? "编辑" : "创建"}</AlertDialogTitle>
                <AlertDialogCancel className="m-0 h-8 w-8 rounded-lg p-0"><X className="h-4 w-4" /></AlertDialogCancel>
              </AlertDialogHeader>
              <div className="px-6 py-5"><AlertDialogDescription className="text-sm">取消后，当前{editingDevice ? "编辑" : "创建"}设备内容将不会保存。</AlertDialogDescription></div>
              <AlertDialogFooter className="border-t border-[var(--color-border)] px-6 py-4">
                <AlertDialogCancel className="h-9 rounded-[10px] px-5 text-sm">继续填写</AlertDialogCancel>
                <AlertDialogAction onClick={confirmCancelCreate} className="h-9 rounded-[10px] bg-[var(--color-danger)] px-5 text-sm text-white hover:bg-[var(--color-danger)]/90">确认取消</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
          </div>
      </div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      {warnings.length > 0 && <div className="rounded-md border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{warnings.slice(0, 3).join("；")}</div>}
      <div className="table-card overflow-x-auto">
        <Table className="min-w-[1040px] table-fixed"><TableHeader><TableRow className="h-12 bg-white hover:bg-white">
          <TableHead className="w-[180px] px-6 text-xs font-medium text-[var(--color-text-tertiary)]">设备名称</TableHead>
          <TableHead className="w-[120px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">绑定节点</TableHead>
          <TableHead className="w-[150px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">设备模型</TableHead>
          <TableHead className="w-[80px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">协议</TableHead>
          <TableHead className="w-[90px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">状态</TableHead>
          <TableHead className="w-[140px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">最后上报</TableHead>
          <TableHead className="w-[160px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[80px] px-5 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载终端设备数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无终端设备数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={`${row.namespace}/${row.name}`} className="group h-[69px] cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]" onClick={() => openDetail(row)}>
            <TableCell className="truncate px-6 py-3 text-sm font-medium text-[var(--color-brand)] group-hover:underline">{row.name}</TableCell>
            <TableCell className="truncate px-5 py-3 text-xs font-medium text-[var(--color-text-primary)]">{row.node}</TableCell>
            <TableCell className="truncate px-5 py-3 text-xs text-[var(--color-text-primary)]">{row.model}</TableCell>
            <TableCell className="px-5 py-3"><ProtocolBadge value={row.protocol || "-"} /></TableCell>
            <TableCell className="px-5 py-3"><StatusPill status={row.status} /></TableCell>
            <TableCell className="truncate px-5 py-3 text-xs text-[var(--color-text-tertiary)]">{row.lastReport}</TableCell>
            <TableCell className="truncate px-5 py-3 text-xs text-[var(--color-text-tertiary)]">{row.createdAt}</TableCell>
            <TableCell className="px-5 py-3 text-right"><button type="button" className="action-button is-danger ml-auto" title="删除" onClick={(event) => { event.stopPropagation(); openDel(row); }}><Trash2 className="h-3.5 w-3.5" /></button></TableCell>
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
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除终端设备 <span className="font-medium text-[var(--color-text-primary)]">{delItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDel}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}

type TerminalDetailTab = "twins" | "labels" | "access" | "events" | "audit";

function TerminalDeviceDetailPage({ device, events, error, onBack, onEdit, onUpdateTwin, onDeleteTwin, onAddLabel, onDeleteLabel, saving }: { device: DI; events: ObservabilityEvent[]; error: string; onBack: () => void; onEdit: () => void; onUpdateTwin: (propertyName: string, desiredValue: string) => void; onDeleteTwin: (propertyName: string) => void; onAddLabel: (key: string, value: string) => void; onDeleteLabel: (key: string) => void; saving: boolean }) {
  const [activeTab, setActiveTab] = useState<TerminalDetailTab>("twins");
  const [labelInput, setLabelInput] = useState({ key: "", value: "" });
  const [labelInputError, setLabelInputError] = useState("");
  const twinItems = getTwins(device.raw);
  const accessYaml = device.raw?.extension?.accessConfigYaml || defaultAccessYaml;
  const handleAddLabel = () => {
    const key = labelInput.key.trim();
    if (saving) return;
    if (!key) {
      setLabelInputError("请输入标签键");
      window.requestAnimationFrame(() => document.getElementById("device-label-key")?.focus());
      return;
    }
    onAddLabel(key, labelInput.value.trim());
    setLabelInput({ key: "", value: "" });
  };
  const tabs: Array<{ id: TerminalDetailTab; label: string; icon: React.ReactNode }> = [
    { id: "twins", label: `孪生数据 (${twinItems.length})`, icon: <Settings className="h-3.5 w-3.5" /> },
    { id: "labels", label: "标签", icon: <Tag className="h-3.5 w-3.5" /> },
    { id: "access", label: "访问配置", icon: <FileCode2 className="h-3.5 w-3.5" /> },
    { id: "events", label: `事件 (${events.length})`, icon: <Bug className="h-3.5 w-3.5" /> },
    { id: "audit", label: "审计", icon: <ClipboardList className="h-3.5 w-3.5" /> },
  ];
  return <div className="blueedge-page space-y-5">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3"><button type="button" onClick={onBack} className="action-button" aria-label="返回终端设备列表"><ArrowLeft className="h-4 w-4" /></button><div><div className="mb-0.5 flex items-center gap-3"><h1 className="text-lg font-semibold text-[#111827]">{device.name}</h1><StatusPill status={device.status} /><ProtocolBadge value={device.protocol || "-"} /></div><p className="text-xs text-[var(--color-text-secondary)]">{device.model} · {device.node} · 创建于 {device.createdAt}</p></div></div>
      <Button onClick={onEdit} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-xs text-white"><Pencil className="mr-1.5 h-3.5 w-3.5" />编辑</Button>
    </div>
    {error && <div className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-xs text-[#dc2626]">{error}</div>}
    <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"><h2 className="mb-5 text-sm font-semibold text-[#111827]">基本信息</h2><div className="grid grid-cols-3 gap-x-6 gap-y-5"><DeviceInfo label="设备名称" value={device.name} /><DeviceInfo label="设备模型" value={device.model} /><DeviceInfo label="绑定节点" value={device.node} /><DeviceInfo label="协议" value={<ProtocolBadge value={device.protocol || "-"} />} /><DeviceInfo label="状态" value={<StatusPill status={device.status} />} /><DeviceInfo label="最后上报" value={device.lastReport} /></div>{device.description !== "-" && <><div className="my-5 border-t border-[#f0f1f3]" /><DeviceInfo label="描述" value={device.description} /></>}</section>
    <div className="flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium", activeTab === tab.id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]")}>{tab.icon}{tab.label}</button>)}</div>
    {activeTab === "twins" && <DevicePanel title="孪生数据"><div className="table-card overflow-x-auto"><Table className="min-w-[700px] table-fixed"><TableHeader><TableRow className="h-12 bg-white hover:bg-white"><TableHead className="w-[160px] px-4 text-xs">属性</TableHead><TableHead className="w-[140px] px-4 text-xs">期望值</TableHead><TableHead className="w-[140px] px-4 text-xs">上报值</TableHead><TableHead className="w-[160px] px-4 text-xs">同步时间</TableHead><TableHead className="w-[100px] px-4 text-right text-xs">操作</TableHead></TableRow></TableHeader><TableBody>{twinItems.length === 0 ? <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-[var(--color-text-secondary)]">暂无孪生数据</TableCell></TableRow> : twinItems.map((twin) => <TableRow key={`${twin.name}-${twin.desired}`} className="h-[60px]"><TableCell className="px-4 text-sm font-medium text-[var(--color-brand)]">{twin.name}</TableCell><TableCell className="px-4"><Input defaultValue={twin.desired === "-" ? "" : twin.desired} onBlur={(event) => { const nextValue = event.currentTarget.value; if (nextValue !== (twin.desired === "-" ? "" : twin.desired)) onUpdateTwin(twin.name, nextValue); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={saving} className="h-9 w-full rounded-[10px] px-3 font-mono text-xs" /></TableCell><TableCell className="px-4 font-mono text-xs">{twin.reported}</TableCell><TableCell className="px-4 text-xs text-[var(--color-text-tertiary)]">{twin.syncTime}</TableCell><TableCell className="px-4 text-right"><button type="button" disabled={saving} onClick={() => onDeleteTwin(twin.name)} className="action-button is-danger ml-auto" title="删除孪生属性"><Trash2 className="h-3.5 w-3.5" /></button></TableCell></TableRow>)}</TableBody></Table></div></DevicePanel>}
    {activeTab === "labels" && (
      <section className="rounded-2xl border border-[#f0f1f3] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#111827]">设备标签</h2>
          <span className="text-xs text-[var(--color-text-tertiary)]">{Object.keys(device.labels).length} 个标签</span>
        </div>
        {Object.keys(device.labels).length === 0 ? (
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">暂无标签</p>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {Object.entries(device.labels).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 rounded-lg border border-[#f0f1f3] bg-[#fafbfc] p-3">
                <Tag className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="text-sm font-medium text-[#111827]">{key}</span>
                <span className="text-[var(--color-text-tertiary)]">=</span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-secondary)]">{value || "—"}</span>
                <button type="button" disabled={saving} onClick={() => onDeleteLabel(key)} className="action-button is-danger shrink-0" title="删除标签"><Trash2 className="h-[13px] w-[13px]" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-[#f0f1f3] pt-4">
          <Input id="device-label-key" value={labelInput.key} onChange={(event) => { setLabelInput((current) => ({ ...current, key: event.target.value })); setLabelInputError(""); }} onKeyDown={(event) => { if (event.key === "Enter") handleAddLabel(); }} placeholder="键" aria-invalid={Boolean(labelInputError)} className="h-9 flex-1 rounded-[10px] px-3 text-xs" />
          <Input value={labelInput.value} onChange={(event) => setLabelInput((current) => ({ ...current, value: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") handleAddLabel(); }} placeholder="值" className="h-9 flex-1 rounded-[10px] px-3 text-xs" />
          <Button type="button" disabled={saving} onClick={handleAddLabel} className="h-8 shrink-0 rounded-[10px] bg-[#0f172a] px-3 text-xs font-medium text-white hover:bg-[#0f172a]/90"><Plus className="mr-1 h-3 w-3" />添加标签</Button>
        </div>
        {labelInputError && <p className="mt-1 text-xs text-[var(--color-danger)]">{labelInputError}</p>}
      </section>
    )}
    {activeTab === "access" && (
      <section className="overflow-hidden rounded-2xl border border-[#f0f1f3] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between border-b border-[#f0f1f3] bg-[#fafbfc] px-4 py-2">
          <span className="text-xs font-medium text-[#6b7280]">YAML 预览</span>
          <button type="button" onClick={() => void navigator.clipboard.writeText(accessYaml)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-border-strong)] bg-white px-2 text-xs text-[#1a73e8] transition-colors hover:bg-[var(--color-bg-hover)]"><Copy className="h-3 w-3" />复制</button>
        </div>
        <div className="max-h-[420px] overflow-hidden bg-[#1e1e1e]">
          <pre className="max-h-[420px] overflow-auto whitespace-pre p-4 font-mono text-xs leading-6 text-[#d4d4d4]">{accessYaml}</pre>
        </div>
      </section>
    )}
    {activeTab === "events" && (events.length === 0 ? <DeviceEmpty icon={<Bug className="h-10 w-10" />} text="暂无事件" /> : <DevicePanel title="事件"><div className="space-y-3">{events.map((event) => <div key={event.name || `${event.reason}-${event.lastTimestamp}`} className="rounded-xl bg-[var(--color-bg-soft)] p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">{event.reason}</span><span className="rounded-full bg-white px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">{event.type}</span></div><p className="mt-2 text-xs text-[var(--color-text-secondary)]">{event.message}</p><p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{event.lastTimestamp || "-"}</p></div>)}</div></DevicePanel>)}
    {activeTab === "audit" && <DeviceEmpty icon={<ClipboardList className="h-10 w-10" />} text="暂无审计记录" />}
  </div>;
}

function DeviceInfo({ label, value }: { label: string; value: React.ReactNode }) { return <div><p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p><div className="text-sm font-medium text-[#111827]">{value}</div></div>; }
function DevicePanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"><h2 className="mb-4 text-sm font-semibold text-[#111827]">{title}</h2>{children}</section>; }
function DeviceEmpty({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex min-h-[260px] flex-col items-center justify-center text-[var(--color-text-tertiary)]">{icon}<p className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">{text}</p></div>; }

function ProtocolBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const isMqtt = normalized.includes("mqtt");
  return (
    <span className={cn(
      "inline-flex max-w-[120px] items-center rounded-full px-2 py-0.5 text-xs font-medium",
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
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      online ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[#f2f4f7] text-[var(--color-text-tertiary)]"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-[var(--color-success)]" : "bg-[#9ca3af]")} />
      {online ? "在线" : unknown ? "未知" : "离线"}
    </span>
  );
}

function CreateStepper({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex w-full items-center justify-center gap-2 overflow-visible">
      {steps.map((step, index) => {
        const active = index + 1 === current;
        const done = index + 1 < current;
        return (
          <div key={step} className="flex shrink-0 items-center gap-2">
            {index > 0 && <span className={cn("h-px w-6 shrink-0", done || active ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />}
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", active || done ? "bg-[var(--color-text-primary)] text-white" : "bg-[#e5eaf1] text-[#94a3b8]")}>
              {done ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current" />}
            </span>
            <span className={cn("whitespace-nowrap text-xs font-medium", active || done ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function YamlPanel({ title, value, onChange, readonly, actions, readonlyActions, compact, downloadName }: { title: string; value: string; onChange?: (value: string) => void; readonly?: boolean; actions?: boolean; readonlyActions?: boolean; compact?: boolean; downloadName?: string; }) {
  const showActions = actions || readonlyActions;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenDraft, setFullscreenDraft] = useState(value);
  const downloadYaml = () => {
    const blob = new Blob([value], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName || `${title.replace(/\s+/g, "-").toLowerCase() || "config"}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const uploadYaml = (file?: File) => {
    if (!file || !onChange) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result ?? ""));
    reader.readAsText(file);
  };
  const openFullscreen = () => {
    setFullscreenDraft(value);
    setFullscreen(true);
  };
  const renderPanel = (isFullscreen = false) => {
    const panelValue = isFullscreen ? fullscreenDraft : value;
    const lines = panelValue.split("\n");
    return (
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
            <button type="button" onClick={openFullscreen} className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-brand)]"><Maximize2 className="h-3.5 w-3.5" />全屏</button>
          </div>
        ) : null}
      </div>
      <div className={cn("grid grid-cols-[44px_1fr] bg-[#1f1f1f] font-mono text-[13px] leading-6", compact ? "h-[220px]" : "h-[300px]", isFullscreen && "h-[calc(88vh-132px)]")}>
        <div className="select-none border-r border-white/5 py-3 text-right text-[#858585]">
          {lines.map((_, index) => <div key={index} className="px-3">{index + 1}</div>)}
        </div>
        {readonly || !onChange ? (
          <pre className="overflow-auto whitespace-pre py-3 pl-4 pr-5"><code><HighlightedYaml value={panelValue} /></code></pre>
        ) : (
          <Textarea value={panelValue} onChange={(event) => isFullscreen ? setFullscreenDraft(event.target.value) : onChange(event.target.value)} spellCheck={false} className="h-full resize-none overflow-auto rounded-none border-0 bg-transparent py-3 pl-4 pr-5 font-mono text-[13px] leading-6 text-[#d4d4d4] caret-white shadow-none outline-none selection:bg-white/20 focus-visible:ring-0" />
        )}
      </div>
    </div>
  );
  };
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
            {!readonly && onChange && <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4"><Button variant="outline" onClick={() => setFullscreen(false)}>取消</Button><Button onClick={() => { onChange(fullscreenDraft); setFullscreen(false); }} className="bg-[var(--color-text-primary)] text-white">保存</Button></div>}
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

function PrototypeField({ label, required, children, error, errorId }: { label: string; required?: boolean; children: React.ReactNode; error?: string; errorId?: string }) {
  return (
    <div>
      <Label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </Label>
      {children}
      <RequiredFieldError id={errorId || "field-error"} message={error} />
    </div>
  );
}

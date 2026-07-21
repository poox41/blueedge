import { ListPagination } from "@/components/common/ListPagination";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight, X, ArrowLeft, Pencil, Settings, Tag, Cpu, Bug, ClipboardList, TriangleAlert, Copy } from "lucide-react";
import { createDeviceModelResource, deleteDeviceModelResource, listNamespaces, updateDeviceModelResource } from "@/api/services/resources";
import { getDeviceModelSummary, listDeviceModelSummaries } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { DeviceModelSummary } from "@/api/adapters/device-model-summary.adapter";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useNamespace } from "@/contexts/NamespaceContext";
import { useNavigate, useParams } from "react-router-dom";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

interface DM { namespace: string; name: string; properties: number; twinProperties: DeviceModelProperty[]; labels: Record<string, string>; createdAt: string; description?: string; protocol?: string; raw: KubeResource | any; devices?: DeviceModelSummary["devices"]; }
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
    twinProperties: normalizeProperties(item.properties, 0),
    labels: item.labels || {},
    createdAt: item.createdAt,
    description: item.description || "-",
    protocol: item.protocol || "-",
    devices: item.devices,
    raw: item.raw || item,
  };
}

function buildDeviceModelResource(form: { name: string; namespace: string; properties: number; protocol: string; description: string; propertiesText: string; labels?: LabelRule[] }, base?: KubeResource): KubeResource {
  const properties = parseProperties(form.propertiesText, form.properties);
  const customLabels = Object.fromEntries((form.labels || []).filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
  return {
    ...base,
    apiVersion: base?.apiVersion || "devices.kubeedge.io/v1beta1",
    kind: base?.kind || "DeviceModel",
    metadata: {
      ...(base?.metadata || {}),
      name: form.name,
      namespace: form.namespace,
      labels: { ...((base?.metadata?.labels as Record<string, string> | undefined) || {}), protocol: form.protocol.toLowerCase().replace(/\s+/g, "-"), ...customLabels },
      annotations: { ...((base?.metadata?.annotations as Record<string, string> | undefined) || {}), description: form.description.trim() },
    },
    spec: {
      ...((base?.spec as Record<string, unknown> | undefined) || {}),
      protocol: form.protocol,
      properties,
    },
  };
}

export function DeviceModels() {
  const modelValidation = useRequiredFieldValidation<"name" | "protocol" | "namespace">();
  const twinValidation = useRequiredFieldValidation<"name">();
  const navigate = useNavigate();
  const { namespace: detailNamespaceParam, name: detailNameParam } = useParams<{ namespace?: string; name?: string }>();
  const detailNamespace = detailNamespaceParam ? decodeURIComponent(detailNamespaceParam) : "";
  const detailName = detailNameParam ? decodeURIComponent(detailNameParam) : "";
  const isDetailRoute = Boolean(detailNamespace && detailName);
  const { selectedNamespace } = useNamespace();
  const namespaces = useNamespaceOptions();
  const [refreshedNamespaces, setRefreshedNamespaces] = useState<ReturnType<typeof useNamespaceOptions> | null>(null);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [data, setData] = useState<DM[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DM | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DM | null>(null);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [cancelCreateOpen, setCancelCreateOpen] = useState(false);
  const [addTwinOpen, setAddTwinOpen] = useState(false);
  const [detailTwinTarget, setDetailTwinTarget] = useState<DM | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delItem, setDelItem] = useState<DM | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [editingTwinIndex, setEditingTwinIndex] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
  const [twinForm, setTwinForm] = useState<TwinPropertyForm>({ name: "", type: "string", accessMode: "ReadOnly", minimum: "", maximum: "", unit: "" });
  const [pageSize, setPageSize] = useState(10);
  const twinProperties = useMemo(() => normalizeProperties(JSON.parse(form.propertiesText || "[]"), 0), [form.propertiesText]);

  const loadData = useCallback(async (preserveCurrentRows = false) => {
    if (preserveCurrentRows) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    setWarnings([]);
    try {
      const res = await listDeviceModelSummaries();
      const rows = res.items.map(toDeviceModelRow);
      setData(rows);
      let nextWarnings = (res.warnings || []).map((item) => item.message);
      if (detailNamespace && detailName) {
        const detail = await getDeviceModelSummary(detailNamespace, detailName);
        setSelected(toDeviceModelRow(detail.item));
        nextWarnings = [...nextWarnings, ...(detail.warnings || []).map((item) => item.message)];
      }
      setWarnings(nextWarnings);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型数据失败");
      if (!preserveCurrentRows) setData([]);
    } finally {
      if (preserveCurrentRows) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, [detailName, detailNamespace]);

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
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (d: DM) => {
    setSelected(d);
    navigate(`/devicemodels/${encodeURIComponent(d.namespace)}/${encodeURIComponent(d.name)}`);
    try {
      const detail = await getDeviceModelSummary(d.namespace, d.name);
      setSelected(toDeviceModelRow(detail.item));
      setWarnings((detail.warnings || []).map((item) => item.message));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设备模型详情失败");
    }
  };
  const openDel = (d: DM) => { setDelItem(d); setDeleteConfirmation(""); setDelOpen(true); };
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
      setDeleteConfirmation("");
      setIsLoading(false);
    }
  };
  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      const resource = buildDeviceModelResource(form, editingModel?.raw);
      if (editingModel) await updateDeviceModelResource(editingModel.namespace, resource);
      else await createDeviceModelResource(resource);
      await loadData();
      setCreateOpen(false);
      setEditingModel(null);
      setCreateStep(1);
      setForm({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建设备模型失败");
    } finally {
      setIsLoading(false);
    }
  };
  const goToDeviceConfig = () => {
    const nameValid = /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/.test(form.name.trim());
    if (!modelValidation.validate([
      { field: "name", valid: nameValid, message: form.name.trim() ? "模型名称格式不正确" : "请输入模型名称", elementId: "device-model-name" },
      { field: "protocol", valid: Boolean(form.protocol.trim()), message: "请输入访问协议", elementId: "device-model-protocol" },
      { field: "namespace", valid: Boolean(form.namespace), message: "请选择命名空间", elementId: "device-model-namespace" },
    ])) return;
    setError("");
    setCreateStep(2);
  };
  const requestCancelCreate = () => setCancelCreateOpen(true);
  const confirmCancelCreate = () => {
    setCancelCreateOpen(false);
    setCreateOpen(false);
    setEditingModel(null);
    setCreateStep(1);
    setForm({ name: "", namespace: "default", properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
  };
  const addLabelRule = () => setForm((prev) => ({ ...prev, labels: [...prev.labels, { id: `label-${Date.now()}`, key: "", value: "" }] }));
  const updateLabelRule = (id: string, patch: Partial<LabelRule>) => setForm((prev) => ({ ...prev, labels: prev.labels.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const removeLabelRule = (id: string) => setForm((prev) => ({ ...prev, labels: prev.labels.length > 1 ? prev.labels.filter((item) => item.id !== id) : [{ id: "label-1", key: "", value: "" }] }));
  const resetTwinForm = () => {
    setEditingTwinIndex(null);
    setTwinForm({ name: "", type: "string", accessMode: "ReadOnly", minimum: "", maximum: "", unit: "" });
  };
  const openTwinEditor = (property?: DeviceModelProperty, index?: number) => {
    if (property && index !== undefined) {
      setEditingTwinIndex(index);
      setTwinForm({
        name: property.name,
        type: property.type.toLowerCase(),
        accessMode: property.accessMode || "ReadOnly",
        minimum: property.minimum || "",
        maximum: property.maximum || "",
        unit: property.unit || "",
      });
    } else resetTwinForm();
    setAddTwinOpen(true);
  };
  const confirmAddTwin = async () => {
    if (!twinValidation.validate([{ field: "name", valid: Boolean(twinForm.name.trim()), message: "请输入属性名称", elementId: "device-model-twin-name" }])) return;
    const nextProperty: DeviceModelProperty = {
      name: twinForm.name.trim(),
      type: twinForm.type.toUpperCase(),
      accessMode: twinForm.accessMode,
      ...(twinForm.minimum.trim() ? { minimum: twinForm.minimum.trim() } : {}),
      ...(twinForm.maximum.trim() ? { maximum: twinForm.maximum.trim() } : {}),
      ...(twinForm.unit.trim() ? { unit: twinForm.unit.trim() } : {}),
    };
    const nextProperties = editingTwinIndex === null
      ? [...twinProperties, nextProperty]
      : twinProperties.map((item, index) => index === editingTwinIndex ? nextProperty : item);
    const nextForm = { ...form, properties: nextProperties.length, propertiesText: JSON.stringify(nextProperties, null, 2) };
    setForm(nextForm);
    if (detailTwinTarget) {
      setIsLoading(true);
      setError("");
      try {
        await updateDeviceModelResource(detailTwinTarget.namespace, buildDeviceModelResource(nextForm, detailTwinTarget.raw));
        const detail = await getDeviceModelSummary(detailTwinTarget.namespace, detailTwinTarget.name);
        const updated = toDeviceModelRow(detail.item);
        setSelected(updated);
        setData((current) => current.map((item) => item.namespace === updated.namespace && item.name === updated.name ? updated : item));
        setWarnings((detail.warnings || []).map((item) => item.message));
        setDetailTwinTarget(null);
        resetTwinForm();
        setAddTwinOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存孪生属性失败");
      } finally {
        setIsLoading(false);
      }
      return;
    }
    resetTwinForm();
    setAddTwinOpen(false);
  };

  const openCreate = () => {
    setError("");
    modelValidation.resetErrors();
    setEditingModel(null);
    setCreateStep(1);
    setForm({ name: "", namespace: selectedNamespace === "all" ? "default" : selectedNamespace, properties: 0, protocol: "MQTT", description: "", propertiesText: "[]", labels: [{ id: "label-1", key: "", value: "" }] });
    setCreateOpen(true);
  };

  const openEdit = (model: DM, step: 1 | 2 = 1) => {
    setError("");
    const labels = Object.entries(model.labels).filter(([key]) => key !== "protocol").map(([key, value], index) => ({ id: `label-${index + 1}`, key, value }));
    setEditingModel(model);
    setCreateStep(step);
    setForm({
      name: model.name,
      namespace: model.namespace,
      properties: model.twinProperties.length,
      protocol: model.protocol || "MQTT",
      description: model.description === "-" ? "" : model.description || "",
      propertiesText: JSON.stringify(model.twinProperties, null, 2),
      labels: labels.length ? labels : [{ id: "label-1", key: "", value: "" }],
    });
    setCreateOpen(true);
  };
  const openDetailTwinEditor = (model: DM, property?: DeviceModelProperty, index?: number) => {
    const labels = Object.entries(model.labels).filter(([key]) => key !== "protocol").map(([key, value], labelIndex) => ({ id: `label-${labelIndex + 1}`, key, value }));
    setDetailTwinTarget(model);
    setForm({
      name: model.name,
      namespace: model.namespace,
      properties: model.twinProperties.length,
      protocol: model.protocol || "MQTT",
      description: model.description === "-" ? "" : model.description || "",
      propertiesText: JSON.stringify(model.twinProperties, null, 2),
      labels: labels.length ? labels : [{ id: "label-1", key: "", value: "" }],
    });
    queueMicrotask(() => openTwinEditor(property, index));
  };

  const detailModel = selected?.namespace === detailNamespace && selected?.name === detailName
    ? selected
    : data.find((item) => item.namespace === detailNamespace && item.name === detailName) || null;
  return (
    <>
      {isDetailRoute && detailModel && (
        <DeviceModelDetailPage
          model={detailModel}
          onBack={() => navigate("/devicemodels")}
          onEdit={() => openEdit(detailModel)}
          onConfigureTwins={() => openEdit(detailModel, 2)}
          onAddTwin={() => openDetailTwinEditor(detailModel)}
          onEditTwin={(property, index) => openDetailTwinEditor(detailModel, property, index)}
        />
      )}
      {isDetailRoute && !detailModel && (
        <div className="blueedge-page"><div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white text-sm text-[var(--color-text-secondary)]">{isLoading ? "正在加载设备模型详情..." : error || "未找到该设备模型"}</div></div>
      )}
    <div className={cn("blueedge-page space-y-6", isDetailRoute && "hidden")}>
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#111827]">设备模型</h1>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">定义终端设备的协议和数字孪生属性</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="toolbar-search relative w-[240px] transition-[width] focus-within:w-[300px]">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input placeholder="搜索设备模型名称..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-10 rounded-xl bg-white pl-11 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-[10px] border-[var(--color-border-strong)] bg-white" onClick={() => void loadData(true)} disabled={isLoading || isRefreshing}>
              <RefreshCw className={cn("h-4 w-4", (isLoading || isRefreshing) && "animate-spin")} />
            </Button>
          <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : requestCancelCreate()}>
            <DialogTrigger asChild><Button onClick={openCreate} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--color-text-primary)]/90"><Plus className="mr-1.5 h-4 w-4" />创建设备模型</Button></DialogTrigger>
            <DialogContent className="!flex max-h-[90vh] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
              {createStep === 2 && (
                <button type="button" onClick={() => setCreateStep(1)} className="absolute left-7 top-[18px] flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" aria-label="返回基础信息">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={requestCancelCreate} className="absolute right-7 top-[18px] flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-4 w-4" /></button>
              <DialogHeader className={cn("h-[72px] shrink-0 justify-center border-b border-[#eef1f5] px-7", createStep === 2 && "pl-20")}><DialogTitle className="text-base font-semibold">{editingModel ? "编辑设备模型" : createStep === 1 ? "创建设备模型" : "设备配置"}</DialogTitle></DialogHeader>
              <div className="shrink-0 px-7 pt-4">
                <CreateStepper current={createStep} steps={["基础信息", "设备配置"]} />
              </div>
              {error && <div className="mx-7 mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{error}</div>}
              <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-6">
                {createStep === 1 ? (
                  <div className="space-y-5">
                    <PrototypeField label="模型名称" required error={modelValidation.errors.name} errorId="device-model-name-error">
                      <Input id="device-model-name" disabled={Boolean(editingModel)} placeholder="temp-sensor-v1" value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); modelValidation.clearError("name"); }} aria-invalid={Boolean(modelValidation.errors.name)} aria-describedby={modelValidation.errors.name ? "device-model-name-error" : undefined} className="h-10 rounded-xl text-sm disabled:bg-[var(--color-bg-soft)] disabled:text-[var(--color-text-tertiary)]" />
                      <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">最长 253 个字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号</p>
                    </PrototypeField>
                    <PrototypeField label="访问协议" required error={modelValidation.errors.protocol} errorId="device-model-protocol-error">
                      <Input id="device-model-protocol" disabled={Boolean(editingModel)} placeholder="MQTT / Modbus TCP / OPC UA" value={form.protocol} onChange={e => { setForm({ ...form, protocol: e.target.value }); modelValidation.clearError("protocol"); }} aria-invalid={Boolean(modelValidation.errors.protocol)} aria-describedby={modelValidation.errors.protocol ? "device-model-protocol-error" : undefined} className="h-10 rounded-xl text-sm disabled:bg-[var(--color-bg-soft)] disabled:text-[var(--color-text-tertiary)]" />
                    </PrototypeField>
                    <PrototypeField label="命名空间" required error={modelValidation.errors.namespace} errorId="device-model-namespace-error">
                      {editingModel ? (
                        <Input disabled value={form.namespace} className="h-10 rounded-xl bg-[var(--color-bg-soft)] text-sm text-[var(--color-text-tertiary)]" />
                      ) : (
                        <>
                          <div className="grid grid-cols-[1fr_36px] gap-2">
                            <select id="device-model-namespace" value={form.namespace} onChange={e => { setForm({ ...form, namespace: e.target.value }); modelValidation.clearError("namespace"); }} aria-invalid={Boolean(modelValidation.errors.namespace)} aria-describedby={modelValidation.errors.namespace ? "device-model-namespace-error" : undefined} className="blueedge-native-select !h-10 !rounded-xl !text-sm">{(refreshedNamespaces || namespaces.filter(n => n.value !== "all")).map(n => (<option key={n.value} value={n.value}>{n.label}</option>))}</select>
                            <Button type="button" variant="outline" className="h-9 w-9 self-center rounded-[10px] p-0" onClick={() => void refreshNamespaces()} disabled={refreshingNamespaces} title="刷新命名空间"><RefreshCw className={cn("h-3.5 w-3.5", refreshingNamespaces && "animate-spin")} /></Button>
                          </div>
                          <a href="https://183.95.195.121:31417/kpanda/clusters/ali-139-131/namespaces" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex text-xs font-medium text-[var(--color-brand)]">+ 创建命名空间</a>
                        </>
                      )}
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
                      <Button type="button" onClick={() => openTwinEditor()} className="h-7 rounded-lg bg-[var(--color-text-primary)] px-3 text-xs text-white hover:bg-[var(--color-text-primary)]/90">
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
                      <div className="table-card overflow-x-auto">
                        <Table className="min-w-[620px] table-fixed">
                          <TableHeader><TableRow className="h-10 bg-white hover:bg-white"><TableHead className="w-[140px] px-3 text-xs">属性名称</TableHead><TableHead className="w-[80px] px-3 text-xs">类型</TableHead><TableHead className="w-[70px] px-3 text-xs">权限</TableHead><TableHead className="w-[60px] px-3 text-xs">单位</TableHead><TableHead className="w-[110px] px-3 text-xs">值区间</TableHead><TableHead className="w-[80px] px-3 text-xs">默认值</TableHead><TableHead className="w-[80px] px-3 text-right text-xs">操作</TableHead></TableRow></TableHeader>
                          <TableBody>{twinProperties.map((item, index) => <TableRow key={`${item.name}-${index}`} className="h-[52px]"><TableCell className="truncate px-3 text-xs font-medium text-[var(--color-brand)]">{item.name}</TableCell><TableCell className="px-3 text-xs">{item.type.toLowerCase()}</TableCell><TableCell className="px-3 text-xs">{item.accessMode === "ReadOnly" ? "只读" : "读/写"}</TableCell><TableCell className="px-3 text-xs">{item.unit || "—"}</TableCell><TableCell className="px-3 font-mono text-xs">{item.minimum || item.maximum ? `${item.minimum || "—"}~${item.maximum || "—"}` : "—"}</TableCell><TableCell className="px-3 text-xs">{item.defaultValue || "—"}</TableCell><TableCell className="px-3"><div className="flex justify-end gap-1"><button type="button" className="action-button" onClick={() => openTwinEditor(item, index)} aria-label={`编辑 ${item.name}`}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" onClick={() => { const nextProperties = twinProperties.filter((_, currentIndex) => currentIndex !== index); setForm((prev) => ({ ...prev, properties: nextProperties.length, propertiesText: JSON.stringify(nextProperties, null, 2) })); }} aria-label={`删除 ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell></TableRow>)}</TableBody>
                        </Table>
                      </div>
                    )}
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">标签</h3>
                      {form.labels.map((label) => (
                        <div key={label.id} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                          <Input value={label.key} onChange={(event) => updateLabelRule(label.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-xl text-sm" />
                          <Input value={label.value} onChange={(event) => updateLabelRule(label.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-xl text-sm" />
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" onClick={() => removeLabelRule(label.id)} aria-label="删除标签">
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
                <Button onClick={() => createStep === 1 ? goToDeviceConfig() : handleCreate()} disabled={isLoading} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">{createStep === 1 ? "下一步" : editingModel ? "保存" : "创建"} <ChevronRight className="ml-1 h-4 w-4" /></Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={addTwinOpen} onOpenChange={(open) => { setAddTwinOpen(open); if (!open) { setDetailTwinTarget(null); resetTwinForm(); } }}>
            <DialogContent className="!flex max-h-[85vh] max-w-[520px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton={false}>
              <button type="button" onClick={() => { setAddTwinOpen(false); setDetailTwinTarget(null); resetTwinForm(); }} className="absolute right-8 top-[18px] flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--color-border-strong)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"><X className="h-4 w-4" /></button>
              <DialogHeader className="h-[72px] shrink-0 justify-center border-b border-[#eef1f5] px-8"><DialogTitle className="text-base font-semibold">{editingTwinIndex === null ? "新增孪生属性" : "编辑孪生属性"}</DialogTitle></DialogHeader>
              <div className="space-y-5 overflow-y-auto px-8 py-7">
                <PrototypeField label="属性名称" required error={twinValidation.errors.name} errorId="device-model-twin-name-error">
                  <Input id="device-model-twin-name" placeholder="temperature" value={twinForm.name} onChange={(event) => { setTwinForm({ ...twinForm, name: event.target.value }); twinValidation.clearError("name"); }} aria-invalid={Boolean(twinValidation.errors.name)} aria-describedby={twinValidation.errors.name ? "device-model-twin-name-error" : undefined} className="h-10 rounded-xl text-sm" />
                </PrototypeField>
                <PrototypeField label="属性值类型" required>
                  <Select value={twinForm.type} onValueChange={(value) => setTwinForm({ ...twinForm, type: value })}>
                    <SelectTrigger
                      id="device-model-twin-type"
                      className="h-10 w-full rounded-xl border-2 border-[#cbd5e1] px-4 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#94a3b8] focus-visible:border-[#111827] focus-visible:ring-2 focus-visible:ring-[#111827]/10 [&[data-state=open]>svg]:rotate-180 [&>svg]:transition-transform"
                    >
                      <SelectValue placeholder="请选择属性值类型" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      align="start"
                      sideOffset={6}
                      viewportClassName="!h-auto max-h-[320px] !p-0"
                      className="z-[100] max-h-[320px] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white p-0 shadow-[0_14px_34px_rgba(15,23,42,0.16)]"
                    >
                      {["int", "float", "double", "string", "boolean", "bytes", "stream"].map((type) => (
                        <SelectItem
                          key={type}
                          value={type}
                          className="min-h-10 rounded-none px-5 py-2 pr-12 text-sm text-[#1e293b] focus:bg-[#eaf2ff] focus:text-[var(--color-brand)] data-[state=checked]:bg-[#eaf2ff] data-[state=checked]:text-[var(--color-brand)] [&_[data-slot=select-item-indicator]]:right-5 [&_[data-slot=select-item-indicator]]:text-[var(--color-brand)]"
                        >
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PrototypeField>
                <PrototypeField label="访问权限" required>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setTwinForm({ ...twinForm, accessMode: "ReadOnly" })} className={cn("h-9 rounded-[10px] border text-sm font-medium", twinForm.accessMode === "ReadOnly" ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)]")}>只读</button>
                    <button type="button" onClick={() => setTwinForm({ ...twinForm, accessMode: "ReadWrite" })} className={cn("h-9 rounded-[10px] border text-sm font-medium", twinForm.accessMode === "ReadWrite" ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)]")}>读/写</button>
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
              <DialogFooter className="h-[72px] shrink-0 items-center border-t border-[#eef1f5] bg-white px-8">
                <Button variant="outline" onClick={() => { setAddTwinOpen(false); setDetailTwinTarget(null); resetTwinForm(); }} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
                <Button onClick={() => void confirmAddTwin()} disabled={isLoading} className="h-9 rounded-[10px] bg-[var(--color-text-primary)] px-4 text-sm text-white hover:bg-[var(--color-text-primary)]/90">确定</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog open={cancelCreateOpen} onOpenChange={setCancelCreateOpen}>
            <AlertDialogContent className="z-[140] !w-[calc(100%-2rem)] !max-w-[440px] gap-0 overflow-hidden rounded-2xl p-0 sm:!max-w-[440px]">
              <AlertDialogHeader className="flex-row items-center justify-between border-b border-[var(--color-border)] px-6 py-4 text-left">
                <AlertDialogTitle className="flex items-center gap-2 text-base font-semibold"><TriangleAlert className="h-[18px] w-[18px] text-[var(--color-danger)]" />确认取消{editingModel ? "编辑" : "创建"}</AlertDialogTitle>
                <AlertDialogCancel className="m-0 h-8 w-8 rounded-lg p-0"><X className="h-4 w-4" /></AlertDialogCancel>
              </AlertDialogHeader>
              <div className="px-6 py-5"><AlertDialogDescription className="text-sm">取消后，当前{editingModel ? "编辑" : "创建"}内容将不会保存。</AlertDialogDescription></div>
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
      <div className="table-card overflow-hidden">
        <div className="overflow-x-auto">
        <Table className="min-w-[900px] table-fixed"><TableHeader><TableRow className="h-12 bg-white hover:bg-white">
          <TableHead className="w-[200px] px-6 text-xs font-medium text-[var(--color-text-tertiary)]">模型名称</TableHead>
          <TableHead className="w-[100px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">协议</TableHead>
          <TableHead className="w-[120px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
          <TableHead className="w-auto px-5 text-xs font-medium text-[var(--color-text-tertiary)]">描述</TableHead>
          <TableHead className="w-[90px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">孪生属性</TableHead>
          <TableHead className="w-[150px] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[80px] px-5 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载设备模型数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无设备模型数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="group h-[69px] cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]" onClick={() => void openDetail(row)}>
            <TableCell className="truncate px-6 py-3 text-sm font-medium text-[var(--color-brand)] group-hover:underline">{row.name}</TableCell>
            <TableCell className="px-5 py-3"><ProtocolBadge value={row.protocol || "-"} /></TableCell>
            <TableCell className="px-5 py-3 text-xs font-medium text-[var(--color-text-primary)]">{row.namespace}</TableCell>
            <TableCell className="truncate px-5 py-3 text-xs text-[var(--color-text-secondary)]">{row.description}</TableCell>
            <TableCell className="px-5 py-3 text-xs text-[var(--color-text-primary)]">{row.properties} 个</TableCell>
            <TableCell className="truncate px-5 py-3 text-xs text-[var(--color-text-tertiary)]">{row.createdAt}</TableCell>
            <TableCell className="px-5 py-3 text-right"><button type="button" className="action-button is-danger ml-auto" title="删除" onClick={(event) => { event.stopPropagation(); openDel(row); }}><Trash2 className="h-3.5 w-3.5" /></button></TableCell>
          </TableRow>
        ))}</TableBody></Table>
        </div>
        <ListPagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>
      <AlertDialog open={delOpen} onOpenChange={(open) => { setDelOpen(open); if (!open) setDeleteConfirmation(""); }}>
        <AlertDialogContent className="!w-[calc(100%-2rem)] !max-w-[480px] gap-0 overflow-hidden rounded-2xl p-0 sm:!max-w-[480px]">
          <AlertDialogHeader className="border-b border-[var(--color-border)] px-6 py-4">
            <div className="flex items-center justify-between"><AlertDialogTitle className="flex items-center gap-2.5 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]"><TriangleAlert className="h-4 w-4" /></span>确认删除「{delItem?.name}」吗？</AlertDialogTitle><AlertDialogCancel className="m-0 h-8 w-8 rounded-lg p-0"><X className="h-4 w-4" /></AlertDialogCancel></div>
          </AlertDialogHeader>
          <div className="space-y-4 px-6 py-5">
            <AlertDialogDescription className="flex items-start gap-2 rounded-lg border border-[#ffd591] bg-[#fff7e6] p-3 text-xs leading-5 text-[#ad6800]"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fa8c16]" />此操作不可恢复。删除后相关设备模型资源将被永久移除。</AlertDialogDescription>
            <div><div className="mb-2 flex items-center justify-between"><label className="text-xs font-semibold text-[var(--color-text-primary)]">请输入 <span className="text-[var(--color-danger)]">{delItem?.name}</span> 以确认删除</label><button type="button" onClick={() => { if (delItem) { setDeleteConfirmation(delItem.name); void navigator.clipboard?.writeText(delItem.name); } }} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)]"><Copy className="h-3.5 w-3.5" />复制名称</button></div><Input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={delItem?.name} className="h-10 rounded-[10px] text-sm" /></div>
          </div>
          <AlertDialogFooter className="border-t border-[var(--color-border)] px-6 py-4"><AlertDialogCancel className="h-9 rounded-[10px] px-4 text-sm">取消</AlertDialogCancel><AlertDialogAction disabled={!delItem || deleteConfirmation !== delItem.name || isLoading} className="h-9 rounded-[10px] bg-[var(--color-danger)] px-5 text-sm text-white hover:bg-[var(--color-danger)]/90 disabled:bg-[#ffccc7]" onClick={confirmDel}>删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}

type DeviceModelDetailTab = "twins" | "labels" | "instances" | "events" | "audit";

function DeviceModelDetailPage({ model, onBack, onEdit, onConfigureTwins, onAddTwin, onEditTwin }: { model: DM; onBack: () => void; onEdit: () => void; onConfigureTwins: () => void; onAddTwin: () => void; onEditTwin: (property: DeviceModelProperty, index: number) => void }) {
  const [activeTab, setActiveTab] = useState<DeviceModelDetailTab>("twins");
  const tabs: Array<{ id: DeviceModelDetailTab; label: string; icon: React.ReactNode }> = [
    { id: "twins", label: `孪生属性 (${model.twinProperties.length})`, icon: <Settings className="h-3.5 w-3.5" /> },
    { id: "labels", label: "标签", icon: <Tag className="h-3.5 w-3.5" /> },
    { id: "instances", label: "设备实例", icon: <Cpu className="h-3.5 w-3.5" /> },
    { id: "events", label: "事件", icon: <Bug className="h-3.5 w-3.5" /> },
    { id: "audit", label: "审计", icon: <ClipboardList className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="blueedge-page space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button" aria-label="返回设备模型列表"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <div className="mb-0.5 flex items-center gap-3"><h1 className="text-lg font-semibold text-[#111827]">{model.name}</h1><ProtocolBadge value={model.protocol || "-"} /><span className="rounded-full bg-[#f0f1f3] px-2 py-0.5 text-xs font-medium text-[#5f6368]">{model.namespace}</span></div>
            <p className="text-xs text-[var(--color-text-secondary)]">创建于 {model.createdAt}</p>
          </div>
        </div>
        <Button onClick={onEdit} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-xs text-white"><Pencil className="mr-1.5 h-3.5 w-3.5" />编辑</Button>
      </div>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[#111827]">基本信息</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5"><ModelInfo label="模型名称" value={model.name} /><ModelInfo label="协议" value={<ProtocolBadge value={model.protocol || "-"} />} /><ModelInfo label="命名空间" value={model.namespace} /></div>
        {model.description && model.description !== "-" && <><div className="my-5 border-t border-[#f0f1f3]" /><ModelInfo label="描述" value={model.description} /></>}
      </section>

      <div className="flex flex-wrap items-center gap-2">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition-colors", activeTab === tab.id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]")}>{tab.icon}{tab.label}</button>)}</div>

      {activeTab === "twins" && <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#111827]">孪生属性</h2><Button onClick={onAddTwin} className="h-[30px] rounded-lg bg-[#0f172a] px-3 text-xs text-white"><Plus className="mr-1 h-3 w-3" />新增孪生属性</Button></div>
        <div className="table-card overflow-x-auto"><Table className="min-w-[780px] table-fixed"><TableHeader><TableRow className="h-12 bg-white hover:bg-white"><TableHead className="w-[160px] px-4 text-xs">属性名称</TableHead><TableHead className="w-[90px] px-4 text-xs">数据类型</TableHead><TableHead className="w-[90px] px-4 text-xs">访问权限</TableHead><TableHead className="w-[80px] px-4 text-xs">单位</TableHead><TableHead className="w-[130px] px-4 text-xs">值区间</TableHead><TableHead className="w-[110px] px-4 text-xs">默认值</TableHead><TableHead className="w-[100px] px-4 text-right text-xs">操作</TableHead></TableRow></TableHeader>
          <TableBody>{model.twinProperties.length === 0 ? <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-[var(--color-text-secondary)]">暂无孪生属性，点击上方按钮添加</TableCell></TableRow> : model.twinProperties.map((property, index) => <TableRow key={property.name} className="h-[60px]"><TableCell className="px-4 text-sm font-medium text-[var(--color-brand)]">{property.name}</TableCell><TableCell className="px-4 text-xs"><span className="rounded-full bg-[var(--color-brand-light)] px-2 py-0.5 text-[var(--color-brand)]">{property.type}</span></TableCell><TableCell className="px-4 text-xs">{property.accessMode === "ReadOnly" ? "只读" : "读/写"}</TableCell><TableCell className="px-4 text-xs">{property.unit || "—"}</TableCell><TableCell className="px-4 font-mono text-xs">{property.minimum !== undefined || property.maximum !== undefined ? `${property.minimum ?? "—"} ~ ${property.maximum ?? "—"}` : "—"}</TableCell><TableCell className="px-4 text-xs">{property.defaultValue ?? "—"}</TableCell><TableCell className="px-4"><div className="flex justify-end gap-1"><button type="button" className="action-button" onClick={() => onEditTwin(property, index)} aria-label={`编辑 ${property.name}`}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" onClick={onConfigureTwins} aria-label={`删除 ${property.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell></TableRow>)}</TableBody></Table></div>
      </section>}

      {activeTab === "labels" && <DetailPanel title="标签" action={<button type="button" onClick={onConfigureTwins} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)]"><Pencil className="h-3.5 w-3.5" />编辑标签</button>}>{Object.keys(model.labels).length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">暂无标签</p> : <div className="flex flex-wrap gap-2">{Object.entries(model.labels).filter(([key]) => key !== "protocol").map(([key, value]) => <span key={key} className="rounded-md bg-[#f0f1f3] px-2 py-1 text-xs text-[#5f6368]">{key}={value}</span>)}</div>}</DetailPanel>}
      {activeTab === "instances" && <DetailPanel title={`设备实例 (${model.devices?.total || 0})`}><div className="table-card overflow-x-auto"><Table className="min-w-[500px] table-fixed"><TableHeader><TableRow className="h-12 bg-white hover:bg-white"><TableHead className="w-[200px] px-4 text-xs">设备名称</TableHead><TableHead className="w-[150px] px-4 text-xs">绑定节点</TableHead><TableHead className="px-4 text-xs">描述</TableHead></TableRow></TableHeader><TableBody>{!model.devices?.items?.length ? <TableRow><TableCell colSpan={3} className="py-12 text-center text-sm text-[var(--color-text-secondary)]">暂无引用此模型的设备实例</TableCell></TableRow> : model.devices.items.map((device) => <TableRow key={`${device.namespace}/${device.name}`} className="h-[60px]"><TableCell className="px-4 text-sm font-medium text-[var(--color-brand)]">{device.name}</TableCell><TableCell className="px-4 text-sm">{device.nodeName || "—"}</TableCell><TableCell className="px-4 text-sm text-[var(--color-text-secondary)]">{device.description || "—"}</TableCell></TableRow>)}</TableBody></Table></div></DetailPanel>}
      {activeTab === "events" && <EmptyDetail icon={<Bug className="h-10 w-10" />} text="暂无事件" />}
      {activeTab === "audit" && <EmptyDetail icon={<ClipboardList className="h-10 w-10" />} text="暂无审计记录" />}
    </div>
  );
}

function ModelInfo({ label, value }: { label: string; value: React.ReactNode }) { return <div><p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p><div className="text-sm font-medium text-[#111827]">{value}</div></div>; }
function DetailPanel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#111827]">{title}</h2>{action}</div>{children}</section>; }
function EmptyDetail({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex min-h-[260px] flex-col items-center justify-center text-[var(--color-text-tertiary)]">{icon}<p className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">{text}</p></div>; }

function ProtocolBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("mqtt")
    ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
    : normalized.includes("modbus")
      ? "bg-[var(--color-brand-light)] text-[var(--color-brand)]"
      : normalized.includes("opc")
        ? "bg-[var(--color-warning-soft)] text-[#d97706]"
        : normalized.includes("http")
          ? "bg-[#f3e8ff] text-[#9333ea]"
          : "bg-[#f0f1f3] text-[#5f6368]";
  return (
    <span className={cn(
      "inline-flex max-w-[120px] items-center rounded-full px-2 py-0.5 text-xs font-medium",
      tone
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
            {index > 0 && <span className="h-px w-8 bg-[var(--color-border-strong)]" />}
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", active ? "bg-[var(--color-text-primary)] text-white" : "bg-[#e5eaf1] text-[#94a3b8]")}>
              <span className="h-2 w-2 rounded-full bg-current ring-4 ring-white" />
            </span>
            <span className={cn("text-xs font-semibold", active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{step}</span>
          </div>
        );
      })}
    </div>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination, useListPagination } from "@/components/common/ListPagination";
import { createRuleEndpointResource, deleteRuleEndpointResource, getRuleEndpoint, listNamespaces, listRuleEndpoints, updateRuleEndpointResource } from "@/api/services/resources";
import { listClusterEvents } from "@/api/services/product";
import type { ClusterEvent } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useNamespace } from "@/contexts/NamespaceContext";
import { Activity, AlertTriangle, ArrowLeft, Bug, Check, ChevronDown, ClipboardList, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Terminal, Trash2, Wifi, X } from "lucide-react";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

type EndpointType = "rest" | "eventbus" | "servicebus";

interface MessageEndpointRow {
  namespace: string;
  name: string;
  ruleEndpointType: string;
  targetResource: string;
  createdAt: string;
  connected: boolean | null;
  raw: KubeResource;
}

type CreateForm = {
  type: EndpointType;
  namespace: string;
  name: string;
};

type EditForm = CreateForm & {
  targetResource: string;
  propertyKey: "topic" | "resource" | "path";
  propertyValue: string;
};

type EndpointAuditRecord = {
  manager: string;
  operation: string;
  apiVersion: string;
  subresource: string;
  time: string;
};

const endpointTypeOptions: Array<{ key: EndpointType; label: string; desc: string }> = [
  { key: "rest", label: "Rest", desc: "云端端点，向边缘发送消息请求的源端点。或者作为目标端点，从边缘接收消息。" },
  { key: "eventbus", label: "Event Bus", desc: "边端端点，可作为源端点，向云端发送数据。或者作为目标端点，从云端接收消息。" },
  { key: "servicebus", label: "Service Bus", desc: "边端端点，可作为目标端点，用于接收从云端传递的消息。" },
];

function normalizeRuleEndpointType(type: string): EndpointType {
  const normalized = type.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "rest" || normalized === "http") return "rest";
  if (normalized === "servicebus") return "servicebus";
  return "eventbus";
}

function displayRuleEndpointType(type: string): string {
  const normalized = normalizeRuleEndpointType(type);
  if (normalized === "rest") return "Rest";
  if (normalized === "servicebus") return "Service Bus";
  return "Event Bus";
}

function endpointLocation(type: string): string {
  return normalizeRuleEndpointType(type) === "rest" ? "云端" : "边端";
}

function endpointConnectionState(item: RuleEndpointView): boolean | null {
  const status = item.raw.status || {};
  const rawValue = status.phase || status.state || status.connectionStatus || status.connected || status.ready;
  if (typeof rawValue === "boolean") return rawValue;
  const phase = String(rawValue || "").trim().toLowerCase();
  if (["ready", "running", "connected", "online", "true", "healthy", "active"].includes(phase)) return true;
  if (["notready", "not ready", "stopped", "disconnected", "offline", "false", "unhealthy", "inactive", "failed"].includes(phase)) return false;
  return null;
}

function toRuleEndpointRow(item: RuleEndpointView): MessageEndpointRow {
  return {
    namespace: item.namespace,
    name: item.name,
    ruleEndpointType: item.type,
    targetResource: item.targetResource,
    createdAt: item.createdAt,
    connected: endpointConnectionState(item),
    raw: item.raw,
  };
}

function propertyKeyForType(type: EndpointType): "topic" | "resource" | "path" {
  if (type === "rest") return "resource";
  if (type === "servicebus") return "path";
  return "topic";
}

function buildRuleEndpointResource(form: CreateForm): KubeResource {
  return {
    apiVersion: "rules.kubeedge.io/v1",
    kind: "RuleEndpoint",
    metadata: {
      name: form.name.trim(),
      namespace: form.namespace,
    },
    spec: {
      ruleEndpointType: form.type,
      properties: {
        [propertyKeyForType(form.type)]: "",
      },
    },
  };
}

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function endpointProperties(row: MessageEndpointRow): Record<string, string> {
  const properties = asObject(asObject(row.raw.spec).properties);
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
}

function explicitTargetResource(row: MessageEndpointRow): string {
  const value = asObject(row.raw.spec).targetResource;
  return typeof value === "string" ? value : "";
}

function endpointAddress(row: MessageEndpointRow): string {
  const targetResource = explicitTargetResource(row);
  if (targetResource) return targetResource;
  return Object.values(endpointProperties(row)).find(Boolean) || "-";
}

function endpointPort(row: MessageEndpointRow): string {
  const address = endpointAddress(row);
  const match = address.match(/:(\d+)(?:\/|$)/);
  return match?.[1] || "-";
}

function endpointProtocol(row: MessageEndpointRow): string {
  const address = endpointAddress(row).toLowerCase();
  if (address.startsWith("https://")) return "HTTPS";
  if (address.startsWith("http://")) return "HTTP";
  if (address.startsWith("mqtt://") || address.startsWith("mqtts://")) return "MQTT";
  return "集群未声明";
}

function endpointAuth(row: MessageEndpointRow): string {
  const properties = endpointProperties(row);
  if (properties.username || properties.password || properties.token) return "已配置凭证";
  return "集群未声明";
}

function endpointAuditRecords(row: MessageEndpointRow): EndpointAuditRecord[] {
  const metadata = asObject(row.raw.metadata);
  const managedFields = Array.isArray(metadata.managedFields) ? metadata.managedFields : [];
  return managedFields.map((item) => {
    const record = asObject(item);
    return {
      manager: String(record.manager || "-"),
      operation: String(record.operation || "-"),
      apiVersion: String(record.apiVersion || "-"),
      subresource: String(record.subresource || "资源主体"),
      time: String(record.time || "-"),
    };
  });
}

function editFormFromRow(row: MessageEndpointRow): EditForm {
  const type = normalizeRuleEndpointType(row.ruleEndpointType);
  const propertyKey = propertyKeyForType(type);
  const properties = endpointProperties(row);
  return {
    type,
    namespace: row.namespace,
    name: row.name,
    targetResource: explicitTargetResource(row),
    propertyKey,
    propertyValue: properties[propertyKey] || "",
  };
}

function buildUpdatedRuleEndpoint(row: MessageEndpointRow, form: EditForm): KubeResource {
  const existingProperties = endpointProperties(row);
  delete existingProperties.topic;
  delete existingProperties.resource;
  delete existingProperties.path;
  const metadata = { ...(row.raw.metadata || {}), name: row.name, namespace: row.namespace } as KubeResource["metadata"] & { managedFields?: unknown };
  delete metadata.managedFields;
  const spec: Record<string, unknown> = {
    ...asObject(row.raw.spec),
    ruleEndpointType: form.type,
    properties: { ...existingProperties, [propertyKeyForType(form.type)]: form.propertyValue },
  };
  if (form.targetResource.trim()) spec.targetResource = form.targetResource.trim();
  else delete spec.targetResource;
  return {
    ...row.raw,
    apiVersion: row.raw.apiVersion || "rules.kubeedge.io/v1",
    kind: row.raw.kind || "RuleEndpoint",
    metadata,
    spec,
  };
}

function formatCreatedAt(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function validEndpointName(name: string) {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) && name.length <= 253;
}

export function RuleEndpoints() {
  const { selectedNamespace } = useNamespace();
  const navigate = useNavigate();
  const { namespace: detailNamespace, name: detailName } = useParams<{ namespace?: string; name?: string }>();
  const isDetailRoute = Boolean(detailNamespace && detailName);
  const namespaces = useNamespaceOptions();
  const [refreshedNamespaces, setRefreshedNamespaces] = useState<Array<{ value: string; label: string }> | null>(null);
  const namespaceItems = useMemo(
    () => (refreshedNamespaces || namespaces).filter((item) => item.value !== "all"),
    [namespaces, refreshedNamespaces],
  );
  const [data, setData] = useState<MessageEndpointRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({ type: "rest", namespace: "default", name: "" });
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [menuTarget, setMenuTarget] = useState<MessageEndpointRow | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [deleteTarget, setDeleteTarget] = useState<MessageEndpointRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<MessageEndpointRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailEvents, setDetailEvents] = useState<ClusterEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<MessageEndpointRow | null>(null);

  const loadData = useCallback(async (preserveData = false) => {
    if (preserveData) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    try {
      const rows = await listRuleEndpoints();
      setData(rows.map(toRuleEndpointRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "消息端点数据加载失败");
      if (!preserveData) setData([]);
    } finally {
      if (preserveData) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!detailNamespace || !detailName) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await getRuleEndpoint(detailNamespace, detailName);
      setDetailTarget(toRuleEndpointRow(detail));
    } catch (err) {
      setDetailTarget(null);
      setDetailError(err instanceof Error ? err.message : "加载消息端点详情失败");
    } finally {
      setDetailLoading(false);
    }
  }, [detailName, detailNamespace]);

  const loadEvents = useCallback(async () => {
    if (!detailNamespace || !detailName) return;
    setEventsLoading(true);
    try {
      const events = await listClusterEvents(detailNamespace);
      setDetailEvents(events.filter((event) => event.involvedObject?.name === detailName && event.involvedObject?.kind?.toLowerCase() === "ruleendpoint"));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "加载消息端点事件失败");
      setDetailEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [detailName, detailNamespace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isDetailRoute) {
        void Promise.all([loadDetail(), loadEvents()]);
      } else {
        setDetailTarget(null);
        setDetailEvents([]);
        void loadData();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isDetailRoute, loadData, loadDetail, loadEvents]);

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => setForm((current) => ({
        ...current,
        namespace: namespaceItems.some((item) => item.value === current.namespace) ? current.namespace : namespaceItems[0]?.value || "default",
      })), 0);
    return () => window.clearTimeout(timer);
  }, [createOpen, namespaceItems]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return data.filter((row) => (selectedNamespace === "all" || row.namespace === selectedNamespace) && (!keyword || row.name.toLowerCase().includes(keyword)));
  }, [data, search, selectedNamespace]);
  const { paginatedItems, paginationProps } = useListPagination(filtered);

  const openMenu = (row: MessageEndpointRow, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const width = 120;
    setMenuPosition({
      top: rect.bottom + 4,
      left: Math.min(window.innerWidth - width - 16, Math.max(16, rect.right - width)),
    });
    setMenuTarget((current) => (current?.name === row.name && current.namespace === row.namespace ? null : row));
  };

  const refreshNamespaces = async () => {
    setRefreshingNamespaces(true);
    setError("");
    try {
      const [nextNamespaces, rows] = await Promise.all([listNamespaces(), listRuleEndpoints()]);
      const usableNamespaces = nextNamespaces.filter((item) => item.value !== "all");
      setRefreshedNamespaces(nextNamespaces);
      setData(rows.map(toRuleEndpointRow));
      setForm((current) => ({
        ...current,
        namespace: usableNamespaces.some((item) => item.value === current.namespace)
          ? current.namespace
          : usableNamespaces[0]?.value || "default",
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "命名空间刷新失败");
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  const handleCreate = async () => {
    if (!validEndpointName(form.name.trim())) return;
    setIsLoading(true);
    setError("");
    try {
      await createRuleEndpointResource(buildRuleEndpointResource(form));
      setCreateOpen(false);
      setForm({ type: "rest", namespace: "default", name: "" });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建消息端点失败");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteRuleEndpointResource(deleteTarget.namespace, deleteTarget.name);
      setDeleteTarget(null);
      if (isDetailRoute) navigate("/ruleendpoints");
      else await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除消息端点失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (form: EditForm) => {
    if (!editTarget) return;
    setIsLoading(true);
    setError("");
    try {
      await updateRuleEndpointResource(editTarget.namespace, buildUpdatedRuleEndpoint(editTarget, form));
      setEditTarget(null);
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新消息端点失败");
    } finally {
      setIsLoading(false);
    }
  };

  if (isDetailRoute) {
    return (
      <>
        <EndpointDetailPage
          row={detailTarget}
          loading={detailLoading}
          error={detailError || error}
          events={detailEvents}
          eventsLoading={eventsLoading}
          onBack={() => navigate("/ruleendpoints")}
          onEdit={() => detailTarget && setEditTarget(detailTarget)}
          onDelete={() => detailTarget && setDeleteTarget(detailTarget)}
          onRefreshEvents={loadEvents}
        />
        <EditEndpointDialog open={Boolean(editTarget)} row={editTarget} isLoading={isLoading} onOpenChange={(open) => !open && setEditTarget(null)} onSave={handleUpdate} onDelete={() => { if (editTarget) setDeleteTarget(editTarget); setEditTarget(null); }} />
        <EndpointDeleteDialog target={deleteTarget} isLoading={isLoading} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={confirmDelete} />
      </>
    );
  }

  return (
    <div className="page-container">
      <div className="space-y-5">
        <div>
          <h1 className="mb-1 text-lg font-semibold text-[#111827]">消息端点</h1>
          <p className="text-xs text-[var(--color-text-secondary)]">定义消息进入或离开边缘单元的连接端点</p>
        </div>

        <div className="page-toolbar">
          <div className="toolbar-search relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索消息端点名称..." className="h-9 rounded-[10px] pl-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void loadData(true)} className="action-button" title="刷新" disabled={isLoading || isRefreshing}><RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isRefreshing) && "animate-spin")} /></button>
            <button type="button" onClick={() => setCreateOpen(true)} className="btn-black text-xs"><Plus className="h-3.5 w-3.5" />创建消息端点</button>
          </div>
        </div>

      {error && <div className="rounded-xl border border-[#fde68a] bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[#b45309]">{error}</div>}

      <section className="table-card overflow-visible">
        <Table className="min-w-[820px] table-fixed">
          <TableHeader>
            <TableRow className="table-header-row bg-white hover:bg-white">
              <TableHead className="table-header-cell table-header-name w-[200px]">端点名称</TableHead>
              <TableHead className="table-header-cell w-[100px]">类型</TableHead>
              <TableHead className="table-header-cell w-[90px]">位置</TableHead>
              <TableHead className="table-header-cell w-[110px]">命名空间</TableHead>
              <TableHead className="table-header-cell w-[100px]">连接状态</TableHead>
              <TableHead className="table-header-cell w-[150px]">创建时间</TableHead>
              <TableHead className="table-header-cell table-header-action w-[80px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="blueedge-empty-state min-h-[210px]">
                    <span className="text-sm">正在加载消息端点数据...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="blueedge-empty-state min-h-[210px]">
                    <span className="blueedge-empty-state-icon" aria-hidden="true" />
                    <span className="text-sm">暂无消息端点数据</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((row) => (
                <TableRow key={`${row.namespace}-${row.name}`} className="table-row cursor-pointer" onClick={() => navigate(`/ruleendpoints/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}`)}>
                  <TableCell className="table-name-cell">
                    <span className="text-sm font-medium text-[var(--color-brand)]">{row.name}</span>
                  </TableCell>
                  <TableCell className="table-cell text-xs">{displayRuleEndpointType(row.ruleEndpointType)}</TableCell>
                  <TableCell className="table-cell text-xs">{endpointLocation(row.ruleEndpointType)}</TableCell>
                  <TableCell className="table-cell text-xs">{row.namespace}</TableCell>
                  <TableCell className="table-cell">
                    <StatusPill connected={row.connected} />
                  </TableCell>
                  <TableCell className="table-cell text-xs text-[var(--color-text-tertiary)]">{formatCreatedAt(row.createdAt)}</TableCell>
                  <TableCell className="table-action-cell text-right" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="action-button" title="更多" onClick={(event) => openMenu(row, event.currentTarget)}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <ListPagination {...paginationProps} />
      </section>

      {menuTarget && (
        <>
          <button type="button" aria-label="关闭操作菜单" className="fixed inset-0 z-[70] cursor-default" onClick={() => setMenuTarget(null)} />
          <div
            className="fixed z-[90] rounded-xl border border-[var(--color-border)] bg-white py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]"
            style={{ top: menuPosition.top, left: menuPosition.left, width: 120 }}
          >
            <button
              type="button"
              className="mx-1 flex h-9 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-3 text-left text-xs text-[#ef4444] transition-colors hover:bg-[#fdecec]"
              onClick={() => {
                setDeleteTarget(menuTarget);
                setMenuTarget(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
        </>
      )}

      <CreateEndpointDialog
        open={createOpen}
        form={form}
        namespaceItems={namespaceItems}
        refreshingNamespaces={refreshingNamespaces}
        isLoading={isLoading}
        onOpenChange={setCreateOpen}
        onChange={setForm}
        onRefreshNamespaces={refreshNamespaces}
        onCreate={handleCreate}
      />

      <EndpointDeleteDialog target={deleteTarget} isLoading={isLoading} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={confirmDelete} />
      </div>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean | null }) {
  const label = connected === true ? "在线" : connected === false ? "离线" : "未上报";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        connected === true
          ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
          : connected === false
            ? "bg-[#f3f4f6] text-[#9ca3af]"
            : "bg-[#fff7e6] text-[#ad6800]",
      )}
      title={connected === null ? "KubeEdge RuleEndpoint 原生资源不提供连接状态" : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function CreateEndpointDialog({
  open,
  form,
  namespaceItems,
  refreshingNamespaces,
  isLoading,
  onOpenChange,
  onChange,
  onRefreshNamespaces,
  onCreate,
}: {
  open: boolean;
  form: CreateForm;
  namespaceItems: Array<{ value: string; label: string }>;
  refreshingNamespaces: boolean;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: CreateForm) => void;
  onRefreshNamespaces: () => Promise<void>;
  onCreate: () => void;
}) {
  const formValidation = useRequiredFieldValidation<"namespace" | "name">();
  const submit = () => {
    const name = form.name.trim();
    if (!formValidation.validate([
      { field: "namespace", valid: Boolean(form.namespace), message: "请选择命名空间", elementId: "rule-endpoint-namespace" },
      { field: "name", valid: validEndpointName(name), message: name ? "名称格式不正确，仅支持小写字母、数字和中划线" : "请输入消息端点名称", elementId: "rule-endpoint-name" },
    ])) return;
    onCreate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-48px))] w-[calc(100vw-48px)] max-w-[600px] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[600px]" showCloseButton={false}>
        <DialogHeader className="flex h-14 flex-row items-center justify-between border-b border-[var(--color-border)] px-6 text-left">
          <DialogTitle className="text-base font-semibold">创建消息端点</DialogTitle>
          <button type="button" onClick={() => onOpenChange(false)} className="action-button h-8 w-8 rounded-[10px]">
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="max-h-[calc(100vh-168px)] overflow-y-auto px-6 py-5">
          <div>
            <Label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
              消息端点类型 <span className="text-[var(--color-danger)]">*</span>
            </Label>
            <div className="space-y-3">
              {endpointTypeOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onChange({ ...form, type: option.key })}
                  className={cn(
                    "w-full rounded-xl border p-3.5 text-left transition-all",
                    form.type === option.key ? "border-[1.5px] border-[var(--color-brand)] bg-[var(--color-brand-light)]" : "border-[var(--color-border-strong)] bg-white hover:border-[var(--color-input-border-hover)]",
                  )}
                >
                  <span className={cn("block text-sm font-semibold", form.type === option.key ? "text-[var(--color-brand)]" : "text-[#374151]")}>{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">备注:{option.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="my-5 border-t border-[var(--color-border)]" />

          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">基础信息</h3>
            <div>
              <Label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
                命名空间 <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <div className="flex items-center gap-3">
                <div className="relative min-w-0 flex-1">
                  <select
                    id="rule-endpoint-namespace"
                    value={form.namespace}
                    onChange={(event) => { onChange({ ...form, namespace: event.target.value }); formValidation.clearError("namespace"); }}
                    aria-invalid={Boolean(formValidation.errors.namespace)}
                    aria-describedby={formValidation.errors.namespace ? "rule-endpoint-namespace-error" : undefined}
                    className="h-9 w-full appearance-none rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-3 pr-9 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-text-primary)]"
                  >
                    {namespaceItems.length === 0 && <option value="default">default</option>}
                    {namespaceItems.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                </div>
                <button type="button" onClick={() => void onRefreshNamespaces()} className="action-button h-9 w-9 rounded-[10px]" title="刷新命名空间" disabled={refreshingNamespaces}>
                  <RefreshCw className={cn("h-4 w-4", refreshingNamespaces && "animate-spin")} />
                </button>
                <a href="https://183.95.195.121:31417/kpanda/clusters/ali-139-131/namespaces" target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[#1a73e8]">创建命名空间</a>
              </div>
              <RequiredFieldError id="rule-endpoint-namespace-error" message={formValidation.errors.namespace} />
            </div>

            <div>
              <Label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
                消息端点名称 <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="rule-endpoint-name"
                value={form.name}
                onChange={(event) => { onChange({ ...form, name: event.target.value }); formValidation.clearError("name"); }}
                aria-invalid={Boolean(formValidation.errors.name)}
                aria-describedby={formValidation.errors.name ? "rule-endpoint-name-error" : undefined}
                placeholder="mqtt-internal"
                className="h-9 rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-3 text-sm"
              />
              <p className={cn("mt-1.5 text-xs", form.name && !validEndpointName(form.name) ? "text-[var(--color-danger)]" : "text-[var(--color-text-tertiary)]")}>
                支持小写字母、数字、"-"，长度1~253
              </p>
              <RequiredFieldError id="rule-endpoint-name-error" message={formValidation.errors.name} />
            </div>
          </div>
        </div>

        <DialogFooter className="h-16 border-t border-[var(--color-border)] px-6 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className="blueedge-muted-button h-9 rounded-[10px] px-4 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isLoading}
            className="blueedge-primary-button h-9 rounded-[10px] px-4 text-sm disabled:cursor-not-allowed disabled:bg-[#9ca3af] disabled:opacity-70"
          >
            创建
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EndpointDetailTab = "detail" | "connectivity" | "events" | "audit";

function EndpointDetailPage({
  row,
  loading,
  error,
  events,
  eventsLoading,
  onBack,
  onEdit,
  onDelete,
  onRefreshEvents,
}: {
  row: MessageEndpointRow | null;
  loading: boolean;
  error: string;
  events: ClusterEvent[];
  eventsLoading: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefreshEvents: () => Promise<void>;
}) {
  const [tab, setTab] = useState<EndpointDetailTab>("detail");

  if (loading) return <div className="page-container flex min-h-[520px] items-center justify-center"><RefreshCw className="h-9 w-9 animate-spin text-[#94a3b8]" /></div>;
  if (!row) return <div className="page-container space-y-5"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#475569]"><ArrowLeft className="h-4 w-4" />返回列表</button><div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-5 text-sm text-[#b91c1c]">{error || "消息端点不存在或无权访问"}</div></div>;

  const tabs: Array<{ id: EndpointDetailTab; label: string; icon: typeof Terminal }> = [
    { id: "detail", label: "端点详情", icon: Terminal },
    { id: "connectivity", label: "连通性", icon: Activity },
    { id: "events", label: "事件", icon: Bug },
    { id: "audit", label: "审计", icon: ClipboardList },
  ];

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="action-button h-9 w-9 shrink-0 rounded-[10px]" title="返回列表"><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-3"><h1 className="truncate text-lg font-semibold text-[#111827]">{row.name}</h1><StatusPill connected={row.connected} /></div>
            <p className="truncate text-xs text-[var(--color-text-secondary)]">{displayRuleEndpointType(row.ruleEndpointType)} · {endpointLocation(row.ruleEndpointType)} · {endpointAddress(row)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onEdit} className="btn-black text-xs"><Pencil className="h-3.5 w-3.5" />编辑</button>
          <button type="button" onClick={onDelete} className="btn-danger-outline text-xs"><Trash2 className="h-3.5 w-3.5" />删除</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#b45309]">{error}</div>}

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[#111827]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-6 gap-y-5">
          <EndpointInfo label="端点名称" value={row.name} />
          <div><div className="mb-1.5 text-xs tracking-[0.01em] text-[var(--color-text-tertiary)]">连接状态</div><StatusPill connected={row.connected} /></div>
          <EndpointInfo label="类型" value={displayRuleEndpointType(row.ruleEndpointType)} />
          <EndpointInfo label="创建时间" value={formatCreatedAt(row.createdAt)} />
          <div className="col-span-4 my-2 border-t border-[#f0f1f3]" />
          <EndpointInfo label="位置" value={endpointLocation(row.ruleEndpointType)} />
          <EndpointInfo label="连接地址" value={endpointAddress(row)} mono />
          <EndpointInfo label="服务端口" value={endpointPort(row)} />
          <EndpointInfo label="命名空间" value={row.namespace} />
          <div className="col-span-4 my-2 border-t border-[#f0f1f3]" />
          <EndpointInfo label="协议" value={endpointProtocol(row)} />
          <EndpointInfo label="认证方式" value={endpointAuth(row)} />
          <div className="col-span-2" />
        </div>
      </section>

      <div className="flex items-center gap-2">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? "btn-tab-active" : "btn-tab"}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>

      {tab === "detail" && <EndpointPropertiesPanel row={row} />}
      {tab === "connectivity" && <EndpointConnectivityPanel row={row} />}
      {tab === "events" && <EndpointEventsPanel events={events} loading={eventsLoading} onRefresh={onRefreshEvents} />}
      {tab === "audit" && <EndpointAuditPanel row={row} />}
    </div>
  );
}

function EndpointInfo({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="mb-1.5 text-xs tracking-[0.01em] text-[var(--color-text-tertiary)]">{label}</div><div className={cn("break-words text-sm font-medium leading-5 text-[#111827]", mono && "font-mono text-xs")}>{value || "-"}</div></div>;
}

function EndpointPropertiesPanel({ row }: { row: MessageEndpointRow }) {
  const properties = endpointProperties(row);
  return (
    <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <h2 className="mb-4 text-sm font-semibold text-[#111827]">连接详情</h2>
      <div className="grid grid-cols-4 gap-4 rounded-xl bg-[#f8f9fb] p-4">
        <EndpointInfo label="协议版本" value={properties.protocolVersion || endpointProtocol(row)} />
        <EndpointInfo label="Keep Alive" value={properties.keepAlive || "-"} />
        <EndpointInfo label="Clean Session" value={properties.cleanSession || "-"} />
        <EndpointInfo label="QoS 支持" value={properties.qos || properties.qosSupport || "-"} />
      </div>
    </section>
  );
}

function EndpointConnectivityPanel({ row }: { row: MessageEndpointRow }) {
  const healthy = row.connected === true;
  const unknown = row.connected === null;
  return (
    <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className={cn("mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full", healthy ? "bg-[#dcfce7] text-[#16a34a]" : unknown ? "bg-[#fff7e6] text-[#d97706]" : "bg-[#fee2e2] text-[#dc2626]")}><Wifi className="h-5 w-5" /></div>
      <h2 className="mb-1 text-sm font-medium text-[#111827]">{healthy ? "连接正常" : unknown ? "状态未上报" : "连接异常"}</h2>
      <p className="mx-auto max-w-[620px] text-xs leading-5 text-[var(--color-text-tertiary)]">
        {healthy ? "状态来自集群返回的 RuleEndpoint.status。" : unknown ? "KubeEdge 原生 RuleEndpoint 资源不提供 status，当前无法从 Kubernetes API 判断实际连接状态。" : "集群已明确返回端点断开或不可用状态。"}
      </p>
      <div className="mx-auto mt-4 w-fit rounded-xl bg-[#f8f9fb] px-4 py-2 font-mono text-xs text-[#475569]">{endpointAddress(row)}</div>
    </section>
  );
}

function EndpointEventsPanel({ events, loading, onRefresh }: { events: ClusterEvent[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const abnormal = events.filter((event) => event.type !== "Normal").length;
  return (
    <section className="rounded-2xl border border-[#eef2f7] bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <div className="mb-5 flex items-start justify-between"><div><h2 className="text-base font-semibold text-[#111827]">事件</h2><p className="mt-1 text-sm text-[#64748b]">展示当前 RuleEndpoint 的真实 Kubernetes Events</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs text-[#64748b]">总数 {events.length}</span><span className="rounded-full bg-[#fff7ed] px-3 py-1 text-xs text-[#c2410c]">异常 {abnormal}</span><button type="button" onClick={() => void onRefresh()} disabled={loading} className="action-button h-9 w-9" title="刷新事件"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></button></div></div>
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0]"><Table><TableHeader><TableRow><TableHead>事件级别</TableHead><TableHead>组件/对象</TableHead><TableHead>事件名称</TableHead><TableHead>详细描述</TableHead><TableHead>次数</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{events.length === 0 ? <TableRow><TableCell colSpan={6} className="py-14 text-center text-[#94a3b8]">{loading ? "正在加载真实事件..." : "当前 RuleEndpoint 没有关联事件"}</TableCell></TableRow> : events.map((event, index) => <TableRow key={`${event.reason}-${event.lastTimestamp}-${index}`}><TableCell><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", event.type === "Normal" ? "bg-[#f3f4f6] text-[#64748b]" : "bg-[#fee2e2] text-[#dc2626]")}>● {event.type}</span></TableCell><TableCell>{event.involvedObject.kind}/{event.involvedObject.name}</TableCell><TableCell className="font-semibold">{event.reason}</TableCell><TableCell className="max-w-[420px] whitespace-normal text-[#475569]">{event.message}</TableCell><TableCell>{event.count || 1}</TableCell><TableCell>{formatCreatedAt(event.lastTimestamp)}</TableCell></TableRow>)}</TableBody></Table></div>
    </section>
  );
}

function EndpointAuditPanel({ row }: { row: MessageEndpointRow }) {
  const records = endpointAuditRecords(row);
  return (
    <section className="rounded-2xl border border-[#eef2f7] bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <div className="mb-5 flex items-start justify-between"><div><h2 className="text-base font-semibold text-[#111827]">审计</h2><p className="mt-1 text-sm text-[#64748b]">真实来源：metadata.managedFields；集群未提供用户 IP 级审计日志</p></div><span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs text-[#64748b]">记录 {records.length}</span></div>
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0]"><Table><TableHeader><TableRow><TableHead>管理器</TableHead><TableHead>操作</TableHead><TableHead>API 版本</TableHead><TableHead>子资源</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{records.length === 0 ? <TableRow><TableCell colSpan={5} className="py-14 text-center text-[#94a3b8]">当前资源没有 managedFields 记录</TableCell></TableRow> : records.map((record, index) => <TableRow key={`${record.manager}-${record.time}-${index}`}><TableCell className="font-semibold">{record.manager}</TableCell><TableCell>{record.operation}</TableCell><TableCell>{record.apiVersion}</TableCell><TableCell>{record.subresource}</TableCell><TableCell>{formatCreatedAt(record.time)}</TableCell></TableRow>)}</TableBody></Table></div>
    </section>
  );
}

function EditEndpointDialog({ open, row, isLoading, onOpenChange, onSave, onDelete }: { open: boolean; row: MessageEndpointRow | null; isLoading: boolean; onOpenChange: (open: boolean) => void; onSave: (form: EditForm) => Promise<void>; onDelete: () => void }) {
  const [form, setForm] = useState<EditForm>(() => row ? editFormFromRow(row) : { type: "rest", namespace: "default", name: "", targetResource: "", propertyKey: "resource", propertyValue: "" });
  useEffect(() => {
    if (!open || !row) return;
    const timer = window.setTimeout(() => setForm(editFormFromRow(row)), 0);
    return () => window.clearTimeout(timer);
  }, [open, row]);
  if (!row) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[600px]" showCloseButton={false}>
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center justify-between border-b border-[#f0f1f3] px-6"><DialogTitle className="text-base">编辑消息端点</DialogTitle><div className="flex gap-2"><button type="button" onClick={onDelete} className="action-button h-8 w-8 rounded-[10px]" title="删除"><Trash2 className="h-4 w-4" /></button><button type="button" onClick={() => onOpenChange(false)} className="action-button h-8 w-8 rounded-[10px]"><X className="h-4 w-4" /></button></div></DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div><Label className="mb-2 block text-sm font-medium">消息端点类型 <span className="text-[#ff4d4f]">*</span></Label><div className="space-y-3">{endpointTypeOptions.map((option) => <button key={option.key} type="button" onClick={() => setForm({ ...form, type: option.key, propertyKey: propertyKeyForType(option.key), propertyValue: option.key === form.type ? form.propertyValue : "" })} className={cn("w-full rounded-xl border p-3.5 text-left transition-all", form.type === option.key ? "border-[1.5px] border-[#1e6bff] bg-[#eff6ff]" : "border-[#e5e7eb] bg-white hover:border-[#d8dee8]")}><span className={cn("block text-sm font-semibold", form.type === option.key && "text-[#1e6bff]")}>{option.label}</span><span className="mt-1 block text-xs leading-5 text-[#64748b]">备注:{option.desc}</span></button>)}</div></div>
          <div className="space-y-5 border-t border-[#f0f1f3] pt-5">
            <h3 className="text-sm font-semibold">基础信息</h3>
            <div>
              <Label className="mb-1.5 block text-sm font-medium">命名空间 <span className="text-[var(--color-danger)]">*</span></Label>
              <div className="relative"><Input value={form.namespace} readOnly className="h-9 rounded-[10px] bg-white pr-9" /><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" /></div>
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-medium">消息端点名称 <span className="text-[var(--color-danger)]">*</span></Label>
              <Input value={form.name} readOnly className="h-9 rounded-[10px] bg-white" />
              <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">支持小写字母、数字、"-"，长度1~253</p>
            </div>
          </div>
        </div>
        <DialogFooter className="h-16 shrink-0 border-t border-[#f0f1f3] px-6 py-3"><button type="button" onClick={() => onOpenChange(false)} className="blueedge-muted-button h-9 rounded-[10px] px-4">取消</button><button type="button" onClick={() => void onSave(form)} disabled={isLoading} className="blueedge-primary-button h-9 rounded-[10px] px-4">{isLoading ? "保存中..." : "保存"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndpointDeleteDialog({ target, isLoading, onOpenChange, onConfirm }: { target: MessageEndpointRow | null; isLoading: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  const [confirmName, setConfirmName] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConfirmName("");
      setCopied(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [target]);
  const copyName = async () => {
    if (!target) return;
    setConfirmName(target.name);
    setCopied(await copyToClipboard(target.name));
  };
  const confirmed = Boolean(target && confirmName === target.name);
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[480px] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        <AlertDialogHeader className="flex h-[61px] flex-row items-center justify-between border-b border-[#f0f1f3] px-6 text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff4d4f]/10"><AlertTriangle className="h-4 w-4 text-[#ff4d4f]" /></span>
            <AlertDialogTitle className="text-sm">确认删除「{target?.name}」吗？</AlertDialogTitle>
          </div>
          <AlertDialogCancel className="action-button m-0 h-8 w-8 rounded-[10px] border-[#e8ecf3] p-0"><X className="h-4 w-4" /></AlertDialogCancel>
        </AlertDialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2 rounded-lg border border-[#ffd591] bg-[#fff7e6] p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fa8c16]" />
            <p className="text-xs leading-5 text-[#ad6800]">此操作不可恢复。删除后相关资源将被永久移除。</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#111827]">请输入 <strong className="text-[#ff4d4f]">{target?.name}</strong> 以确认删除</label>
              <button type="button" onClick={() => void copyName()} className="flex items-center gap-1 text-xs text-[#1a73e8]">
                {copied ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Copy className="h-3 w-3" />}
                {copied ? "已复制" : "复制名称"}
              </button>
            </div>
            <Input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={target?.name} className="h-10 rounded-[10px]" />
          </div>
        </div>
        <AlertDialogFooter className="h-[69px] border-t border-[#f0f1f3] px-6 py-4">
          <AlertDialogCancel className="btn-secondary m-0">取消</AlertDialogCancel>
          <AlertDialogAction className="h-9 rounded-[10px] px-5 text-sm" onClick={() => void onConfirm()} disabled={!confirmed || isLoading}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

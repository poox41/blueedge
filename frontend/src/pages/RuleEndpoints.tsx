import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createRuleEndpointResource, deleteRuleEndpointResource, getRuleEndpoint, listNamespaces, listRuleEndpoints, updateRuleEndpointResource } from "@/api/services/resources";
import { listClusterEvents } from "@/api/services/product";
import type { ClusterEvent } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useNamespace } from "@/contexts/NamespaceContext";
import { Activity, ArrowLeft, Bug, ClipboardList, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Terminal, Trash2, Wifi, X } from "lucide-react";

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

function isEndpointConnected(item: RuleEndpointView): boolean | null {
  const status = item.raw.status || {};
  const phase = String(status.phase || status.state || status.connectionStatus || "").toLowerCase();
  if (phase) return ["ready", "running", "connected", "online", "true"].includes(phase);
  return null;
}

function toRuleEndpointRow(item: RuleEndpointView): MessageEndpointRow {
  return {
    namespace: item.namespace,
    name: item.name,
    ruleEndpointType: item.type,
    targetResource: item.targetResource,
    createdAt: item.createdAt,
    connected: isEndpointConnected(item),
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
    setIsLoading(true);
    setError("");
    try {
      const rows = await listRuleEndpoints();
      setData(rows.map(toRuleEndpointRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "消息端点数据加载失败");
      if (!preserveData) setData([]);
    } finally {
      setIsLoading(false);
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

  const openMenu = (row: MessageEndpointRow, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const width = 160;
    setMenuPosition({
      top: rect.bottom + 10,
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

  const canCreate = validEndpointName(form.name.trim()) && Boolean(form.namespace);

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
    <div className="blueedge-page space-y-5">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">消息端点</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">定义消息进入或离开边缘单元的连接端点</p>
      </div>

      <div className="page-toolbar">
        <div className="relative w-[240px] transition-all focus-within:w-[300px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索消息端点名称..."
            className="h-10 rounded-xl border-2 border-[var(--color-input-border)] bg-white pl-10 text-sm shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadData(true)} className="action-button h-10 w-10" title="刷新" disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className="blueedge-primary-button h-10 rounded-xl px-4">
            <Plus className="h-4 w-4" />
            创建消息端点
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fde68a] bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[#b45309]">{error}</div>}

      <section className="table-card overflow-visible">
        <Table className="min-w-[980px] table-fixed">
          <TableHeader>
            <TableRow className="h-12 bg-white hover:bg-white">
              <TableHead className="w-[24%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">端点名称</TableHead>
              <TableHead className="w-[12%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">类型</TableHead>
              <TableHead className="w-[11%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">位置</TableHead>
              <TableHead className="w-[13%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
              <TableHead className="w-[13%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">连接状态</TableHead>
              <TableHead className="w-[18%] px-5 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
              <TableHead className="w-[9%] px-5 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
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
              filtered.map((row) => (
                <TableRow key={`${row.namespace}-${row.name}`} className="h-[72px] border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
                  <TableCell className="px-5">
                    <button type="button" onClick={() => navigate(`/ruleendpoints/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}`)} className="text-left text-sm font-semibold text-[var(--color-brand)] hover:underline">{row.name}</button>
                  </TableCell>
                  <TableCell className="px-5 text-sm font-medium text-[var(--color-text-primary)]">{displayRuleEndpointType(row.ruleEndpointType)}</TableCell>
                  <TableCell className="px-5 text-sm font-medium text-[var(--color-text-primary)]">{endpointLocation(row.ruleEndpointType)}</TableCell>
                  <TableCell className="px-5 text-sm font-medium text-[var(--color-text-primary)]">{row.namespace}</TableCell>
                  <TableCell className="px-5">
                    <StatusPill connected={row.connected} />
                  </TableCell>
                  <TableCell className="px-5 text-sm text-[var(--color-text-tertiary)]">{formatCreatedAt(row.createdAt)}</TableCell>
                  <TableCell className="px-5 text-right" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="action-button h-10 w-10" title="更多" onClick={(event) => openMenu(row, event.currentTarget)}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      {menuTarget && (
        <>
          <button type="button" aria-label="关闭操作菜单" className="fixed inset-0 z-[70] cursor-default" onClick={() => setMenuTarget(null)} />
          <div
            className="fixed z-[90] rounded-2xl border border-[#eef2f7] bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
            style={{ top: menuPosition.top, left: menuPosition.left, width: 160 }}
          >
            <button
              type="button"
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
              onClick={() => {
                setDeleteTarget(menuTarget);
                setMenuTarget(null);
              }}
            >
              <Trash2 className="h-4 w-4" />
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
        canCreate={canCreate}
        isLoading={isLoading}
        onOpenChange={setCreateOpen}
        onChange={setForm}
        onRefreshNamespaces={refreshNamespaces}
        onCreate={handleCreate}
      />

      <EndpointDeleteDialog target={deleteTarget} isLoading={isLoading} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={confirmDelete} />
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean | null }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        connected === true ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[#f3f4f6] text-[#9ca3af]",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {connected === null ? "未知" : connected ? "在线" : "离线"}
    </span>
  );
}

function CreateEndpointDialog({
  open,
  form,
  namespaceItems,
  refreshingNamespaces,
  canCreate,
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
  canCreate: boolean;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: CreateForm) => void;
  onRefreshNamespaces: () => Promise<void>;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-48px))] w-[calc(100vw-48px)] max-w-[620px] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[620px]" showCloseButton={false}>
        <DialogHeader className="flex h-14 flex-row items-center justify-between border-b border-[var(--color-border)] px-7 text-left">
          <DialogTitle className="text-base font-semibold">创建消息端点</DialogTitle>
          <button type="button" onClick={() => onOpenChange(false)} className="action-button h-10 w-10 rounded-xl">
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="max-h-[calc(100vh-168px)] overflow-y-auto px-7 py-5">
          <div>
            <Label className="mb-3 block text-sm font-semibold text-[var(--color-text-primary)]">
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
                  <span className="mt-2 block text-xs leading-5 text-[var(--color-text-secondary)]">备注:{option.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="my-5 border-t border-[var(--color-border)]" />

          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">基础信息</h3>
            <div>
              <Label className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">
                命名空间 <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <div className="flex items-center gap-3">
                <select
                  value={form.namespace}
                  onChange={(event) => onChange({ ...form, namespace: event.target.value })}
                  className="h-10 min-w-0 flex-1 rounded-xl border-2 border-[var(--color-input-border)] bg-white px-4 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-brand)]"
                >
                  {namespaceItems.length === 0 && <option value="default">default</option>}
                  {namespaceItems.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void onRefreshNamespaces()} className="action-button h-10 w-10 rounded-xl" title="刷新命名空间" disabled={refreshingNamespaces}>
                  <RefreshCw className={cn("h-4 w-4", refreshingNamespaces && "animate-spin")} />
                </button>
                <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">创建命名空间暂未开放</span>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">
                消息端点名称 <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                placeholder="mqtt-internal"
                className="h-10 rounded-xl border-2 border-[var(--color-input-border)] bg-white px-4 text-sm"
              />
              <p className={cn("mt-1.5 text-xs", form.name && !validEndpointName(form.name) ? "text-[var(--color-danger)]" : "text-[var(--color-text-tertiary)]")}>
                支持小写字母、数字、"-"，长度1~253
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="h-16 border-t border-[var(--color-border)] px-7 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className="blueedge-muted-button h-10 rounded-xl px-5 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={!canCreate || isLoading}
            className="blueedge-primary-button h-10 rounded-xl px-6 text-sm disabled:cursor-not-allowed disabled:bg-[#9ca3af] disabled:opacity-70"
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

  if (loading) return <div className="blueedge-page flex min-h-[520px] items-center justify-center"><RefreshCw className="h-9 w-9 animate-spin text-[#94a3b8]" /></div>;
  if (!row) return <div className="blueedge-page space-y-5"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#475569]"><ArrowLeft className="h-4 w-4" />返回列表</button><div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-5 text-sm text-[#b91c1c]">{error || "消息端点不存在或无权访问"}</div></div>;

  const tabs: Array<{ id: EndpointDetailTab; label: string; icon: typeof Terminal }> = [
    { id: "detail", label: "端点详情", icon: Terminal },
    { id: "connectivity", label: "连通性", icon: Activity },
    { id: "events", label: "事件", icon: Bug },
    { id: "audit", label: "审计", icon: ClipboardList },
  ];

  return (
    <div className="blueedge-page space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={onBack} className="action-button h-11 w-11 shrink-0 rounded-xl" title="返回列表"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0">
            <div className="flex items-center gap-3"><h1 className="truncate text-xl font-semibold text-[#111827]">{row.name}</h1><StatusPill connected={row.connected} /></div>
            <p className="mt-1 truncate text-sm text-[#64748b]">{displayRuleEndpointType(row.ruleEndpointType)} · {endpointLocation(row.ruleEndpointType)} · {endpointAddress(row)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onEdit} className="blueedge-primary-button h-10 rounded-xl px-5"><Pencil className="h-4 w-4" />编辑</button>
          <button type="button" onClick={onDelete} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#fee2e2] bg-white px-5 text-sm font-semibold text-[#ff4d4f] hover:bg-[#fff5f5]"><Trash2 className="h-4 w-4" />删除</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#b45309]">{error}</div>}

      <section className="rounded-2xl border border-[#eef2f7] bg-white px-6 py-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
        <h2 className="mb-6 text-base font-semibold text-[#111827]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-8 gap-y-8">
          <EndpointInfo label="端点名称" value={row.name} />
          <div><div className="mb-2 text-sm text-[#94a3b8]">连接状态</div><StatusPill connected={row.connected} /></div>
          <EndpointInfo label="类型" value={displayRuleEndpointType(row.ruleEndpointType)} />
          <EndpointInfo label="创建时间" value={formatCreatedAt(row.createdAt)} />
          <EndpointInfo label="位置" value={endpointLocation(row.ruleEndpointType)} />
          <EndpointInfo label="连接地址" value={endpointAddress(row)} mono />
          <EndpointInfo label="服务端口" value={endpointPort(row)} />
          <EndpointInfo label="命名空间" value={row.namespace} />
          <EndpointInfo label="协议" value={endpointProtocol(row)} />
          <EndpointInfo label="认证方式" value={endpointAuth(row)} />
        </div>
      </section>

      <div className="flex items-center gap-2">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold", tab === id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#dfe5ee] bg-white text-[#64748b] hover:bg-[#f8fafc]")}><Icon className="h-4 w-4" />{label}</button>)}</div>

      {tab === "detail" && <EndpointPropertiesPanel row={row} />}
      {tab === "connectivity" && <EndpointConnectivityPanel row={row} />}
      {tab === "events" && <EndpointEventsPanel events={events} loading={eventsLoading} onRefresh={onRefreshEvents} />}
      {tab === "audit" && <EndpointAuditPanel row={row} />}
    </div>
  );
}

function EndpointInfo({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="mb-2 text-sm text-[#94a3b8]">{label}</div><div className={cn("break-words text-sm font-semibold leading-6 text-[#111827]", mono && "font-mono")}>{value || "-"}</div></div>;
}

function EndpointPropertiesPanel({ row }: { row: MessageEndpointRow }) {
  const properties = Object.entries(endpointProperties(row));
  return (
    <section className="rounded-2xl border border-[#eef2f7] bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <h2 className="mb-5 text-base font-semibold text-[#111827]">连接详情</h2>
      <div className="grid grid-cols-4 gap-5 rounded-2xl bg-[#f8fafc] p-5">
        <EndpointInfo label="端点类型" value={displayRuleEndpointType(row.ruleEndpointType)} />
        <EndpointInfo label="目标资源" value={explicitTargetResource(row) || "-"} />
        <EndpointInfo label="协议" value={endpointProtocol(row)} />
        <EndpointInfo label="服务端口" value={endpointPort(row)} />
      </div>
      <h3 className="mb-3 mt-6 text-sm font-semibold text-[#111827]">spec.properties</h3>
      {properties.length === 0 ? <EndpointEmpty text="当前端点没有 properties 配置" /> : <div className="overflow-hidden rounded-xl border border-[#e2e8f0]">{properties.map(([key, value]) => <div key={key} className="grid grid-cols-[220px_1fr_60px] items-center border-b border-[#e2e8f0] px-4 py-4 last:border-b-0"><span className="font-mono text-sm text-[#64748b]">{key}</span><span className="break-all font-mono text-sm text-[#111827]">{value || "-"}</span><button type="button" onClick={() => void navigator.clipboard.writeText(value)} className="action-button ml-auto h-9 w-9" title="复制"><Copy className="h-4 w-4" /></button></div>)}</div>}
    </section>
  );
}

function EndpointConnectivityPanel({ row }: { row: MessageEndpointRow }) {
  const known = row.connected !== null;
  const healthy = row.connected === true;
  return (
    <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-[#eef2f7] bg-white p-8 text-center shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <div className={cn("mb-5 flex h-20 w-20 items-center justify-center rounded-full", known ? healthy ? "bg-[#dcfce7] text-[#16a34a]" : "bg-[#fee2e2] text-[#dc2626]" : "bg-[#f1f5f9] text-[#94a3b8]")}><Wifi className="h-8 w-8" /></div>
      <h2 className="text-lg font-semibold text-[#111827]">{known ? healthy ? "连接正常" : "连接异常" : "连接状态未知"}</h2>
      <p className="mt-2 max-w-[620px] text-sm leading-6 text-[#94a3b8]">{known ? "状态来自 RuleEndpoint.status。" : "当前集群的 RuleEndpoint 资源未返回 status，官方 BFF 也没有提供主动探测接口，因此不使用前端模拟结果。"}</p>
      <div className="mt-6 rounded-xl bg-[#f8fafc] px-5 py-3 font-mono text-sm text-[#475569]">{endpointAddress(row)}</div>
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

function EndpointEmpty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[#d1d5db] bg-[#fafbfc] px-4 py-12 text-center text-sm text-[#94a3b8]">{text}</div>;
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
      <DialogContent className="!flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[760px] flex-col gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[760px]" showCloseButton={false}>
        <DialogHeader className="flex h-16 shrink-0 flex-row items-center justify-between border-b border-[#eef2f7] px-7"><DialogTitle className="text-lg">编辑消息端点</DialogTitle><div className="flex gap-2"><button type="button" onClick={onDelete} className="action-button h-10 w-10 text-[#ff4d4f]" title="删除"><Trash2 className="h-4 w-4" /></button><button type="button" onClick={() => onOpenChange(false)} className="action-button h-10 w-10"><X className="h-4 w-4" /></button></div></DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-6">
          <div><Label className="mb-3 block text-sm font-semibold">消息端点类型 <span className="text-[#ff4d4f]">*</span></Label><div className="space-y-3">{endpointTypeOptions.map((option) => <button key={option.key} type="button" onClick={() => setForm({ ...form, type: option.key, propertyKey: propertyKeyForType(option.key), propertyValue: option.key === form.type ? form.propertyValue : "" })} className={cn("w-full rounded-2xl border p-4 text-left", form.type === option.key ? "border-2 border-[#1e6bff] bg-[#eff6ff]" : "border-[#dfe5ee] bg-white")}><span className={cn("block font-semibold", form.type === option.key && "text-[#1e6bff]")}>{option.label}</span><span className="mt-2 block text-sm text-[#64748b]">备注:{option.desc}</span></button>)}</div></div>
          <div className="border-t border-[#eef2f7] pt-6"><h3 className="mb-5 text-base font-semibold">基础信息</h3><div className="grid grid-cols-2 gap-5"><div><Label className="mb-2 block">命名空间</Label><Input value={form.namespace} disabled className="h-11 rounded-xl" /></div><div><Label className="mb-2 block">消息端点名称</Label><Input value={form.name} disabled className="h-11 rounded-xl" /></div></div><div className="mt-5"><Label className="mb-2 block">目标资源</Label><Input value={form.targetResource} onChange={(event) => setForm({ ...form, targetResource: event.target.value })} placeholder="可选，填写真实目标资源或连接地址" className="h-11 rounded-xl" /></div><div className="mt-5 grid grid-cols-[180px_1fr] gap-4"><div><Label className="mb-2 block">属性键</Label><Input value={propertyKeyForType(form.type)} disabled className="h-11 rounded-xl font-mono" /></div><div><Label className="mb-2 block">属性值</Label><Input value={form.propertyValue} onChange={(event) => setForm({ ...form, propertyValue: event.target.value })} className="h-11 rounded-xl font-mono" /></div></div></div>
        </div>
        <DialogFooter className="h-16 shrink-0 border-t border-[#eef2f7] px-7 py-3"><button type="button" onClick={() => onOpenChange(false)} className="blueedge-muted-button h-10 rounded-xl px-6">取消</button><button type="button" onClick={() => void onSave(form)} disabled={isLoading} className="blueedge-primary-button h-10 rounded-xl px-7">{isLoading ? "保存中..." : "保存"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndpointDeleteDialog({ target, isLoading, onOpenChange, onConfirm }: { target: MessageEndpointRow | null; isLoading: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  return <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除消息端点？</AlertDialogTitle><AlertDialogDescription>即将删除消息端点 <span className="font-semibold text-[var(--color-text-primary)]">{target?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-10 rounded-xl text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-10 rounded-xl text-sm" onClick={() => void onConfirm()} disabled={isLoading}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { createRuleEndpointResource, deleteRuleEndpointResource, getRuleEndpoint, listRuleEndpoints } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { Copy, MoreHorizontal, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

type EndpointType = "rest" | "eventbus" | "servicebus";

interface MessageEndpointRow {
  namespace: string;
  name: string;
  ruleEndpointType: string;
  targetResource: string;
  createdAt: string;
  connected: boolean;
  raw: KubeResource;
}

type CreateForm = {
  type: EndpointType;
  namespace: string;
  name: string;
};

const endpointTypeOptions: Array<{ key: EndpointType; label: string; desc: string }> = [
  { key: "rest", label: "Rest", desc: "云端端点，向边缘发送消息请求的源端点。或者作为目标端点，从边缘接收消息。" },
  { key: "eventbus", label: "Event Bus", desc: "边端端点，可作为源端点，向云端发送数据。或者作为目标端点，从云端接收消息。" },
  { key: "servicebus", label: "Service Bus", desc: "边端端点，可作为目标端点，用于接收从云端传递的消息。" },
];

const namespaceManagementUrl = "https://183.95.195.121:31417/kpanda/clusters/ali-139-131/namespaces";

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

function isEndpointConnected(item: RuleEndpointView): boolean {
  const raw = item.raw as Record<string, any>;
  const phase = String(raw.status?.phase || raw.status?.state || raw.status?.connectionStatus || "").toLowerCase();
  if (phase) return ["ready", "running", "connected", "online", "true"].includes(phase);
  return normalizeRuleEndpointType(item.type) !== "rest";
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

function endpointYaml(row: MessageEndpointRow) {
  return `apiVersion: rules.kubeedge.io/v1
kind: RuleEndpoint
metadata:
  name: ${row.name}
  namespace: ${row.namespace}
spec:
  ruleEndpointType: ${normalizeRuleEndpointType(row.ruleEndpointType)}
  targetResource: ${row.targetResource || '""'}`;
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
  const namespaces = useNamespaceOptions();
  const namespaceItems = useMemo(() => namespaces.filter((item) => item.value !== "all"), [namespaces]);
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
  const [detailOpen, setDetailOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listRuleEndpoints();
      setData(rows.map(toRuleEndpointRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "消息端点数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!createOpen) return;
    setForm((current) => ({
      ...current,
      namespace: namespaceItems.some((item) => item.value === current.namespace) ? current.namespace : namespaceItems[0]?.value || "default",
    }));
  }, [createOpen, namespaceItems]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return data.filter((row) => !keyword || row.name.toLowerCase().includes(keyword));
  }, [data, search]);

  const openMenu = (row: MessageEndpointRow, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const width = 160;
    setMenuPosition({
      top: rect.bottom + 10,
      left: Math.min(window.innerWidth - width - 16, Math.max(16, rect.right - width)),
    });
    setMenuTarget((current) => (current?.name === row.name && current.namespace === row.namespace ? null : row));
  };

  const openDetail = async (row: MessageEndpointRow) => {
    setDetailTarget(row);
    setDetailOpen(true);
    try {
      const detail = await getRuleEndpoint(row.namespace, row.name);
      setDetailTarget(toRuleEndpointRow(detail));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载消息端点详情失败");
    }
  };

  const refreshNamespaces = () => {
    setRefreshingNamespaces(true);
    window.setTimeout(() => setRefreshingNamespaces(false), 500);
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
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除消息端点失败");
    } finally {
      setIsLoading(false);
    }
  };

  const canCreate = validEndpointName(form.name.trim()) && Boolean(form.namespace);

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
          <button type="button" onClick={loadData} className="action-button h-10 w-10" title="刷新" disabled={isLoading}>
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
                <TableRow key={`${row.namespace}-${row.name}`} className="h-[72px] cursor-pointer border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]" onClick={() => openDetail(row)}>
                  <TableCell className="px-5">
                    <span className="text-sm font-semibold text-[var(--color-brand)]">{row.name}</span>
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

      <EndpointDetailDialog open={detailOpen} row={detailTarget} onOpenChange={setDetailOpen} />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除消息端点？</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除消息端点 <span className="font-semibold text-[var(--color-text-primary)]">{deleteTarget?.name}</span>，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 rounded-xl text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-10 rounded-xl text-sm" onClick={confirmDelete} disabled={isLoading}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        connected ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[#f3f4f6] text-[#9ca3af]",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {connected ? "在线" : "离线"}
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
  onRefreshNamespaces: () => void;
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
                <button type="button" onClick={onRefreshNamespaces} className="action-button h-10 w-10 rounded-xl" title="刷新命名空间">
                  <RefreshCw className={cn("h-4 w-4", refreshingNamespaces && "animate-spin")} />
                </button>
                <a href={namespaceManagementUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[var(--color-brand)]">
                  创建命名空间
                </a>
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

function EndpointDetailDialog({ open, row, onOpenChange }: { open: boolean; row: MessageEndpointRow | null; onOpenChange: (open: boolean) => void }) {
  if (!row) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] rounded-3xl">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Info label="类型" value={displayRuleEndpointType(row.ruleEndpointType)} />
          <Info label="位置" value={endpointLocation(row.ruleEndpointType)} />
          <Info label="命名空间" value={row.namespace} />
          <Info label="连接状态" value={row.connected ? "在线" : "离线"} />
          <Info label="目标资源" value={row.targetResource || "-"} />
          <Info label="创建时间" value={formatCreatedAt(row.createdAt)} />
        </div>
        <div className="relative mt-2">
          <pre className="blueedge-code-block max-h-[280px] overflow-auto p-4">{endpointYaml(row)}</pre>
          <button type="button" className="action-button absolute right-2 top-2 h-8 w-8 border-white/10 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white" onClick={() => navigator.clipboard.writeText(endpointYaml(row))}>
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="blueedge-info-card">
      <p className="blueedge-info-card-label">{label}</p>
      <p className="blueedge-info-card-value">{value}</p>
    </div>
  );
}

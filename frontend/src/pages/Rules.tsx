import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNamespace } from "@/contexts/NamespaceContext";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  ClipboardList,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination, useListPagination } from "@/components/common/ListPagination";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";
import { createRuleResource, deleteRuleResource, getRule, listNamespaces, listRuleEndpoints, listRules, updateRuleResource } from "@/api/services/resources";
import { getEdgeUnitResources, getRuleAudit, getRuleDelivery, getRuleEvents } from "@/api/services/product";
import type { ClusterEvent, RuleAuditResponse, RuleDeliverySummary } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource, RuleEndpointView, RuleView } from "@/types/kubeedge";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";

type EndpointKind = "rest" | "eventbus" | "servicebus";
type RouteTab = "delivery" | "events" | "audit";
type RouteStatusTone = "success" | "danger" | "warning" | "neutral";

type MessageRouteRow = {
  id: string;
  namespace: string;
  name: string;
  source: string;
  sourceResource: string;
  target: string;
  targetResource: string;
  createdAt: string;
  statusLabel: string;
  statusTone: RouteStatusTone;
  description: string;
  raw: KubeResource;
};

type RouteForm = {
  name: string;
  namespace: string;
  source: string;
  sourceSearch: string;
  sourceResource: string;
  sourceNodeName: string;
  target: string;
  targetSearch: string;
  targetResource: string;
  description: string;
};

function normalizeEndpointType(type: string): EndpointKind {
  const normalized = type.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "rest" || normalized === "http") return "rest";
  if (normalized === "servicebus") return "servicebus";
  return "eventbus";
}

function displayEndpointType(type: string): string {
  const normalized = normalizeEndpointType(type);
  if (normalized === "rest") return "Rest";
  if (normalized === "servicebus") return "ServiceBus";
  return "EventBus";
}

function endpointLocation(type: string): string {
  return normalizeEndpointType(type) === "rest" ? "云端" : "边端";
}

function endpointTagText(endpoint?: RuleEndpointView) {
  if (!endpoint) return "-";
  return `${endpointLocation(endpoint.type)} ${normalizeEndpointType(endpoint.type)}`;
}

function endpointTagClass(type: string) {
  const normalized = normalizeEndpointType(type);
  if (normalized === "rest") return "bg-[#e3f2fd] text-[#1e88e5]";
  if (normalized === "servicebus") return "bg-[var(--color-warning-soft)] text-[#d97706]";
  return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
}

function endpointAddress(endpoint?: RuleEndpointView): string {
  if (!endpoint) return "-";
  const properties = endpoint.raw.spec?.properties as Record<string, unknown> | undefined;
  const value =
    endpoint.targetResource ||
    (typeof properties?.targetResource === "string" ? properties.targetResource : "") ||
    (typeof properties?.resource === "string" ? properties.resource : "") ||
    (typeof properties?.topic === "string" ? properties.topic : "") ||
    (typeof properties?.path === "string" ? properties.path : "");
  if (value) return value;
  return "未配置";
}

function sourceTargetAllowed(sourceType: string, targetType: string): boolean {
  const source = normalizeEndpointType(sourceType);
  const target = normalizeEndpointType(targetType);
  return (
    (source === "rest" && target === "eventbus") ||
    (source === "eventbus" && target === "rest") ||
    (source === "rest" && target === "servicebus")
  );
}

function findEndpoint(endpoints: RuleEndpointView[], namespace: string, name: string): RuleEndpointView | undefined {
  return endpoints.find((endpoint) => endpoint.namespace === namespace && endpoint.name === name)
    || endpoints.find((endpoint) => endpoint.namespace === "default" && endpoint.name === name);
}

function resourceValue(raw: KubeResource, key: "sourceResource" | "targetResource"): string {
  const value = raw.spec?.[key];
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const resource = value as Record<string, unknown>;
  if (typeof resource.resource === "string") return resource.resource;
  if (typeof resource.path === "string") return resource.path;
  if (typeof resource.topic === "string" && typeof resource.node_name === "string") return `${resource.node_name}/${resource.topic}`;
  if (typeof resource.topic === "string") return resource.topic;
  return "";
}

function nodeNameValue(raw: KubeResource): string {
  const value = raw.spec?.sourceResource;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const resource = value as Record<string, unknown>;
  return typeof resource.node_name === "string" ? resource.node_name : "";
}

function toRouteRow(item: RuleView): MessageRouteRow {
  const rawStatus = item.raw.status || {};
  const declared = String(rawStatus.phase || rawStatus.state || "").trim();
  const errors = rawStatus.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(errors);
  const normalized = declared.toLowerCase();
  const statusTone: RouteStatusTone = hasErrors || ["failed", "error", "disabled"].includes(normalized)
    ? "danger"
    : ["enabled", "ready", "running", "active"].includes(normalized)
      ? "success"
      : declared
        ? "warning"
        : "neutral";
  return {
    id: `${item.namespace}-${item.name}`,
    namespace: item.namespace,
    name: item.name,
    source: item.source,
    sourceResource: resourceValue(item.raw, "sourceResource") || item.sourceResource || "",
    target: item.target,
    targetResource: resourceValue(item.raw, "targetResource") || item.targetResource || "",
    createdAt: formatCreatedAt(item.createdAt),
    statusLabel: declared || (hasErrors ? "异常" : "未声明"),
    statusTone,
    description: item.raw.metadata?.annotations?.description || item.raw.metadata?.labels?.description || "",
    raw: item.raw,
  };
}

function formatCreatedAt(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function validName(name: string) {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) && name.length <= 253;
}

function buildResource(type: EndpointKind, role: "source" | "target", value: string, nodeName: string): Record<string, string> {
  const trimmed = value.trim();
  const sourceNode: Record<string, string> = role === "source" && nodeName.trim() ? { node_name: nodeName.trim() } : {};
  if (type === "eventbus") {
    return {
      ...sourceNode,
      ...(trimmed ? { topic: trimmed } : {}),
    };
  }
  if (type === "rest") return { ...sourceNode, ...(trimmed ? { [role === "source" ? "path" : "resource"]: trimmed } : {}) };
  return { ...sourceNode, ...(trimmed ? { path: trimmed } : {}) };
}

function buildRuleResource(form: RouteForm, source?: RuleEndpointView, target?: RuleEndpointView, current?: MessageRouteRow): KubeResource {
  const sourceType = source ? normalizeEndpointType(source.type) : "rest";
  const targetType = target ? normalizeEndpointType(target.type) : "eventbus";
  const currentMetadata = current?.raw.metadata ? { ...current.raw.metadata } as Record<string, unknown> : {};
  delete currentMetadata.managedFields;
  const currentAnnotations = current?.raw.metadata?.annotations || {};
  const annotations = { ...currentAnnotations };
  if (form.description.trim()) annotations.description = form.description.trim();
  else delete annotations.description;
  const labels = { ...(current?.raw.metadata?.labels || {}) };
  delete labels.description;
  return {
    ...(current?.raw || {}),
    apiVersion: "rules.kubeedge.io/v1",
    kind: "Rule",
    metadata: {
      ...currentMetadata,
      name: form.name.trim(),
      namespace: form.namespace,
      labels: Object.keys(labels).length > 0 ? labels : undefined,
      annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    },
    spec: {
      ...(current?.raw.spec || {}),
      source: form.source,
      sourceResource: buildResource(sourceType, "source", form.sourceResource, form.sourceNodeName),
      target: form.target,
      targetResource: buildResource(targetType, "target", form.targetResource, ""),
    },
  };
}

function prepareRuleForCreate(resource: KubeResource): KubeResource {
  const metadata = { ...(resource.metadata as Record<string, unknown> | undefined) };
  for (const key of ["uid", "resourceVersion", "generation", "creationTimestamp", "managedFields", "selfLink"]) {
    delete metadata[key];
  }
  const next: KubeResource = {
    ...resource,
    metadata: metadata as KubeResource["metadata"],
  };
  delete next.status;
  return next;
}

function routeYaml(row: MessageRouteRow) {
  return `apiVersion: rules.kubeedge.io/v1
kind: Rule
metadata:
  name: ${row.name}
  namespace: ${row.namespace}
spec:
  source: ${row.source}
  sourceResource: ${row.sourceResource || '""'}
  target: ${row.target}
  targetResource: ${row.targetResource || '""'}`;
}

const emptyForm: RouteForm = {
  name: "",
  namespace: "default",
  source: "",
  sourceSearch: "",
  sourceResource: "",
  sourceNodeName: "",
  target: "",
  targetSearch: "",
  targetResource: "",
  description: "",
};

export function Rules() {
  const { selectedNamespace } = useNamespace();
  const { selectedEdgeUnitName } = useEdgeUnits();
  const namespaces = useNamespaceOptions();
  const [refreshedNamespaces, setRefreshedNamespaces] = useState<Array<{ value: string; label: string }> | null>(null);
  const namespaceItems = useMemo(
    () => (refreshedNamespaces || namespaces).filter((item) => item.value !== "all"),
    [namespaces, refreshedNamespaces],
  );
  const [routes, setRoutes] = useState<MessageRouteRow[]>([]);
  const [endpoints, setEndpoints] = useState<RuleEndpointView[]>([]);
  const [edgeUnitNodeNames, setEdgeUnitNodeNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<RouteForm>(emptyForm);
  const [editing, setEditing] = useState<MessageRouteRow | null>(null);
  const [detail, setDetail] = useState<MessageRouteRow | null>(null);
  const [activeTab, setActiveTab] = useState<RouteTab>("delivery");
  const [delivery, setDelivery] = useState<RuleDeliverySummary | null>(null);
  const [detailEvents, setDetailEvents] = useState<ClusterEvent[]>([]);
  const [audit, setAudit] = useState<RuleAuditResponse | null>(null);
  const [panelLoading, setPanelLoading] = useState<Record<RouteTab, boolean>>({ delivery: false, events: false, audit: false });
  const [panelErrors, setPanelErrors] = useState<Partial<Record<RouteTab, string>>>({});
  const [menuTarget, setMenuTarget] = useState<MessageRouteRow | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [deleteTarget, setDeleteTarget] = useState<MessageRouteRow | null>(null);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);

  const loadData = useCallback(async (preserveData = false) => {
    if (preserveData) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    try {
      const [ruleItems, endpointItems, edgeUnitScope] = await Promise.all([
        listRules(),
        listRuleEndpoints(),
        selectedEdgeUnitName ? getEdgeUnitResources(selectedEdgeUnitName).catch(() => null) : Promise.resolve(null),
      ]);
      setEndpoints(endpointItems);
      const nodeNames = Array.from(new Set(edgeUnitScope?.item.nodeNames || [])).sort();
      setEdgeUnitNodeNames(nodeNames);
      setRoutes(ruleItems.map(toRouteRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "消息路由数据加载失败");
      if (!preserveData) {
        setEndpoints([]);
        setEdgeUnitNodeNames([]);
        setRoutes([]);
      }
    } finally {
      if (preserveData) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, [selectedEdgeUnitName]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => {
      setForm((current) => ({
        ...current,
        namespace: namespaceItems.some((item) => item.value === current.namespace) ? current.namespace : namespaceItems[0]?.value || current.namespace || "default",
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [createOpen, namespaceItems]);

  const filteredRoutes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return routes.filter((route) => (selectedNamespace === "all" || route.namespace === selectedNamespace) && (!keyword || route.name.toLowerCase().includes(keyword)));
  }, [routes, search, selectedNamespace]);
  const { paginatedItems, paginationProps } = useListPagination(filteredRoutes);

  const sourceEndpoint = findEndpoint(endpoints, form.namespace, form.source);
  const targetEndpoint = findEndpoint(endpoints, form.namespace, form.target);
  const sourceOptions = useMemo(
    () => filterEndpoints(endpoints, form.namespace, form.sourceSearch),
    [endpoints, form.namespace, form.sourceSearch],
  );
  const targetOptions = useMemo(() => {
    const items = filterEndpoints(endpoints, form.namespace, form.targetSearch);
    if (!sourceEndpoint) return items;
    return items.filter((endpoint) => sourceTargetAllowed(sourceEndpoint.type, endpoint.type));
  }, [endpoints, form.namespace, form.targetSearch, sourceEndpoint]);
  const validDirection = sourceEndpoint && targetEndpoint ? sourceTargetAllowed(sourceEndpoint.type, targetEndpoint.type) : false;
  const sourceIsEventBus = sourceEndpoint ? normalizeEndpointType(sourceEndpoint.type) === "eventbus" : false;
  const effectiveNodeName = sourceIsEventBus ? form.sourceNodeName : "";
  const canSave =
    validName(form.name.trim()) &&
    Boolean(
        form.namespace &&
        form.source &&
        form.target &&
        validDirection &&
        (!sourceIsEventBus || effectiveNodeName.trim()) &&
        form.sourceResource.trim() &&
        form.targetResource.trim(),
    );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, namespace: namespaceItems[0]?.value || "default" });
    setCreateOpen(true);
  };

  const openEdit = (route: MessageRouteRow) => {
    setEditing(route);
    setForm({
      name: route.name,
      namespace: route.namespace,
      source: route.source,
      sourceSearch: "",
      sourceResource: route.sourceResource,
      sourceNodeName: nodeNameValue(route.raw),
      target: route.target,
      targetSearch: "",
      targetResource: route.targetResource,
      description: route.description,
    });
    setCreateOpen(true);
  };

  const loadRoutePanel = async (tab: RouteTab, namespace: string, name: string) => {
    setPanelLoading((current) => ({ ...current, [tab]: true }));
    setPanelErrors((current) => ({ ...current, [tab]: undefined }));
    try {
      if (tab === "delivery") setDelivery(await getRuleDelivery(namespace, name));
      if (tab === "events") setDetailEvents((await getRuleEvents(namespace, name)).items);
      if (tab === "audit") setAudit(await getRuleAudit(namespace, name));
    } catch (err) {
      const message = err instanceof Error ? err.message : "消息路由详情数据加载失败";
      setPanelErrors((current) => ({ ...current, [tab]: message }));
      if (tab === "delivery") setDelivery(null);
      if (tab === "events") setDetailEvents([]);
      if (tab === "audit") setAudit(null);
    } finally {
      setPanelLoading((current) => ({ ...current, [tab]: false }));
    }
  };

  const openDetail = async (route: MessageRouteRow) => {
    setDetail(route);
    setActiveTab("delivery");
    setDelivery(null);
    setDetailEvents([]);
    setAudit(null);
    setPanelErrors({});
    void Promise.all([
      loadRoutePanel("delivery", route.namespace, route.name),
      loadRoutePanel("events", route.namespace, route.name),
      loadRoutePanel("audit", route.namespace, route.name),
    ]);
    try {
      const fresh = await getRule(route.namespace, route.name);
      setDetail(toRouteRow(fresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载消息路由详情失败");
    }
  };

  const saveRoute = async () => {
    const source = findEndpoint(endpoints, form.namespace, form.source);
    const target = findEndpoint(endpoints, form.namespace, form.target);
    if (sourceIsEventBus && !effectiveNodeName.trim()) {
      setError(edgeUnitNodeNames.length > 0 ? "请选择源端点资源中的边缘节点" : selectedEdgeUnitName ? `边缘单元 ${selectedEdgeUnitName} 没有关联可用节点` : "请先选择边缘单元");
      return;
    }
    if (!source || !target || !canSave) return;
    const resource = buildRuleResource({ ...form, sourceNodeName: effectiveNodeName }, source, target, editing || undefined);
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      if (editing) {
        const identityChanged = editing.name !== form.name.trim() || editing.namespace !== form.namespace;
        if (identityChanged) {
          await createRuleResource(prepareRuleForCreate(resource));
          try {
            await deleteRuleResource(editing.namespace, editing.name);
          } catch (deleteError) {
            try {
              await deleteRuleResource(form.namespace, form.name.trim());
            } catch {
              // The follow-up list refresh exposes either resource if rollback also fails.
            }
            throw deleteError;
          }
        } else {
          await updateRuleResource(editing.namespace, resource);
        }
      } else {
        await createRuleResource(resource);
      }
      await loadData(true);
      if (editing && detail) {
        const fresh = await getRule(form.namespace, form.name.trim());
        setDetail(toRouteRow(fresh));
      }
      setNotice(editing ? "消息路由更新成功" : "消息路由创建成功");
      setCreateOpen(false);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "消息路由保存失败");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      await deleteRuleResource(deleteTarget.namespace, deleteTarget.name);
      await loadData();
      if (detail?.id === deleteTarget.id) setDetail(null);
      setDeleteTarget(null);
      setNotice("消息路由删除成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除消息路由失败");
    } finally {
      setIsLoading(false);
    }
  };

  const openMenu = (route: MessageRouteRow, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const width = 120;
    setMenuPosition({
      top: rect.bottom + 10,
      left: Math.min(window.innerWidth - width - 16, Math.max(16, rect.right - width)),
    });
    setMenuTarget((current) => (current?.id === route.id ? null : route));
  };

  const refreshNamespaces = async () => {
    setRefreshingNamespaces(true);
    setError("");
    try {
      const nextNamespaces = await listNamespaces();
      setRefreshedNamespaces(nextNamespaces);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "命名空间刷新失败");
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  if (detail) {
    return (
      <>
        <RouteDetailPage
          route={detail}
          endpoints={endpoints}
          activeTab={activeTab}
          delivery={delivery}
          events={detailEvents}
          audit={audit}
          panelLoading={panelLoading}
          panelErrors={panelErrors}
          onTabChange={setActiveTab}
          onRefresh={(tab) => loadRoutePanel(tab, detail.namespace, detail.name)}
          onBack={() => setDetail(null)}
          onEdit={() => openEdit(detail)}
          onDelete={() => setDeleteTarget(detail)}
        />
        <CreateRouteDialog
          open={createOpen}
          form={form}
          editing={editing}
          namespaceItems={namespaceItems}
          sourceOptions={sourceOptions}
          targetOptions={targetOptions}
          sourceEndpoint={sourceEndpoint}
          targetEndpoint={targetEndpoint}
          edgeUnitNodeNames={edgeUnitNodeNames}
          refreshingNamespaces={refreshingNamespaces}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setEditing(null);
          }}
          onChange={setForm}
          onRefreshNamespaces={refreshNamespaces}
          onSave={saveRoute}
        />
        <ConfirmDeleteDialog target={deleteTarget} loading={isLoading} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
      </>
    );
  }

  return (
    <div className="page-container space-y-5">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">消息路由</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">定义消息在云端与边缘端点之间的转发规则</p>
      </div>

      <div className="page-toolbar">
        <div className="relative w-[240px] transition-all focus-within:w-[300px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按消息路由名称搜索"
            className="h-10 rounded-xl border-2 border-[var(--color-input-border)] bg-white pl-10 text-sm shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadData(true)} className="action-button h-10 w-10" title="刷新" disabled={isLoading || isRefreshing}>
            <RefreshCw className={cn("h-4 w-4", (isLoading || isRefreshing) && "animate-spin")} />
          </button>
          <button type="button" onClick={openCreate} className="blueedge-primary-button h-10 rounded-xl px-4">
            <Plus className="h-4 w-4" />
            创建消息路由
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fde68a] bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[#b45309]">{error}</div>}
      {notice && <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#15803d]">{notice}</div>}

      <section className="table-card overflow-x-auto">
        <Table className="min-w-[860px] table-fixed border-collapse">
          <TableHeader>
            <TableRow className="table-header-row hover:bg-white">
              <TableHead className="table-header-cell table-header-name w-[190px]">消息路由名称</TableHead>
              <TableHead className="table-header-cell w-[170px]">源端点</TableHead>
              <TableHead className="table-header-cell w-[170px]">目的端点</TableHead>
              <TableHead className="table-header-cell w-[110px]">命名空间</TableHead>
              <TableHead className="table-header-cell w-[150px]">创建时间</TableHead>
              <TableHead className="table-header-cell table-header-action w-20">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="blueedge-empty-state min-h-[160px]">
                    <span className="text-sm">正在加载消息路由数据...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredRoutes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="blueedge-empty-state min-h-[180px]">
                    <span className="blueedge-empty-state-icon" aria-hidden="true" />
                    <span className="text-sm">暂无消息路由</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((route) => {
                const source = findEndpoint(endpoints, route.namespace, route.source);
                const target = findEndpoint(endpoints, route.namespace, route.target);
                return (
                  <TableRow key={route.id} className="table-row group cursor-pointer" onClick={() => openDetail(route)}>
                    <TableCell className="table-name-cell">
                      <span className="text-sm font-medium text-[#1e6bff]">{route.name}</span>
                    </TableCell>
                    <TableCell className="table-cell">
                      <EndpointCell name={route.source} endpoint={source} />
                    </TableCell>
                    <TableCell className="table-cell">
                      <EndpointCell name={route.target} endpoint={target} />
                    </TableCell>
                    <TableCell className="table-cell"><span className="text-xs">{route.namespace}</span></TableCell>
                    <TableCell className="table-cell"><span className="text-xs text-[var(--color-text-tertiary)]">{route.createdAt}</span></TableCell>
                    <TableCell className="table-action-cell text-right" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="action-button" title="更多" onClick={(event) => openMenu(route, event.currentTarget)}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <ListPagination {...paginationProps} />
      </section>

      {menuTarget && (
        <>
          <button type="button" aria-label="关闭操作菜单" className="fixed inset-0 z-[70] cursor-default" onClick={() => setMenuTarget(null)} />
          <div className="fixed z-[90] rounded-xl border border-[#eef2f7] bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]" style={{ top: menuPosition.top, left: menuPosition.left, width: 120 }}>
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
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

      <CreateRouteDialog
        open={createOpen}
        form={form}
        editing={editing}
        namespaceItems={namespaceItems}
        sourceOptions={sourceOptions}
        targetOptions={targetOptions}
        sourceEndpoint={sourceEndpoint}
        targetEndpoint={targetEndpoint}
        edgeUnitNodeNames={edgeUnitNodeNames}
        refreshingNamespaces={refreshingNamespaces}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditing(null);
        }}
        onChange={setForm}
        onRefreshNamespaces={refreshNamespaces}
        onSave={saveRoute}
      />

      <ConfirmDeleteDialog target={deleteTarget} loading={isLoading} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
    </div>
  );
}

function filterEndpoints(endpoints: RuleEndpointView[], namespace: string, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  return endpoints.filter((endpoint) => {
    const namespaceMatched = !namespace || endpoint.namespace === namespace || endpoint.namespace === "default";
    return namespaceMatched && (!normalized || endpoint.name.toLowerCase().includes(normalized));
  });
}

function EndpointCell({ name, endpoint }: { name: string; endpoint?: RuleEndpointView }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-xs text-[var(--color-text-primary)]">{name || "-"}</span>
      {endpoint && <EndpointTag type={endpoint.type} />}
    </div>
  );
}

function EndpointTag({ type }: { type: string }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", endpointTagClass(type))}>{displayEndpointType(type)}</span>;
}

function StatusPill({ label, tone }: { label: string; tone: RouteStatusTone }) {
  return (
    <span className={cn(
      "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
      tone === "success" && "bg-[var(--color-success-soft)] text-[var(--color-success)]",
      tone === "danger" && "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
      tone === "warning" && "bg-[var(--color-warning-soft)] text-[#b45309]",
      tone === "neutral" && "bg-[#f1f5f9] text-[#64748b]",
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function CreateRouteDialog({
  open,
  form,
  editing,
  namespaceItems,
  sourceOptions,
  targetOptions,
  sourceEndpoint,
  targetEndpoint,
  edgeUnitNodeNames,
  refreshingNamespaces,
  onOpenChange,
  onChange,
  onRefreshNamespaces,
  onSave,
}: {
  open: boolean;
  form: RouteForm;
  editing: MessageRouteRow | null;
  namespaceItems: Array<{ value: string; label: string }>;
  sourceOptions: RuleEndpointView[];
  targetOptions: RuleEndpointView[];
  sourceEndpoint?: RuleEndpointView;
  targetEndpoint?: RuleEndpointView;
  edgeUnitNodeNames: string[];
  refreshingNamespaces: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: RouteForm) => void;
  onRefreshNamespaces: () => Promise<void>;
  onSave: () => void;
}) {
  const [showHelp, setShowHelp] = useState(true);
  const validation = useRequiredFieldValidation<"name" | "namespace" | "source" | "sourceResource" | "sourceNodeName" | "target" | "targetResource">();
  const submit = () => {
    const directionValid = Boolean(sourceEndpoint && targetEndpoint && sourceTargetAllowed(sourceEndpoint.type, targetEndpoint.type));
    if (!validation.validate([
      { field: "name", valid: validName(form.name.trim()), message: form.name.trim() ? "名称格式不正确，仅支持小写字母、数字和中划线" : "请输入消息路由名称", elementId: "message-route-name" },
      { field: "namespace", valid: Boolean(form.namespace), message: "请选择命名空间", elementId: "message-route-namespace" },
      { field: "source", valid: Boolean(form.source) && directionValid, message: form.source && !directionValid ? "当前源端点与目的端点组合不受支持" : "请选择源端点", elementId: "message-route-source" },
      { field: "sourceResource", valid: Boolean(form.sourceResource.trim()), message: "请输入源端点资源", elementId: "message-route-source-resource" },
      { field: "sourceNodeName", valid: !sourceEndpoint || normalizeEndpointType(sourceEndpoint.type) !== "eventbus" || Boolean(form.sourceNodeName.trim()), message: "请选择边缘节点", elementId: "message-route-source-node" },
      { field: "target", valid: Boolean(form.target) && directionValid, message: form.target && !directionValid ? "当前源端点与目的端点组合不受支持" : "请选择目的端点", elementId: "message-route-target" },
      { field: "targetResource", valid: Boolean(form.targetResource.trim()), message: "请输入目的端点资源", elementId: "message-route-target-resource" },
    ])) return;
    onSave();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-48px))] w-[calc(100vw-48px)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[600px]" showCloseButton={false}>
        <DialogHeader className="flex h-14 shrink-0 flex-row items-center gap-3 border-b border-[var(--color-border)] px-6 text-left">
          <button type="button" onClick={() => onOpenChange(false)} className="action-button h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DialogTitle className="text-base font-semibold">{editing ? "编辑消息路由" : "创建消息路由"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="space-y-6">
            {showHelp && (
              <div className="flex items-start gap-2 rounded-xl border border-[#d6e4ff] bg-[var(--color-brand-light)] p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand)]" />
                <div className="flex-1">
                  <p className="mb-1.5 text-xs font-semibold text-[var(--color-brand)]">当前支持如下三种消息转发路径</p>
                  <div className="space-y-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                    <p>1. Rest -&gt; EventBus：用户应用调用云端的 REST API 发送消息，最终消息发送到边缘中的 MQTT broker。</p>
                    <p>2. EventBus -&gt; Rest：用户向边缘中的 MQTT broker 发布消息，最终将消息发送到云端的 REST API。</p>
                    <p>3. Rest -&gt; ServiceBus：用户应用调用云端 REST API 发送消息，最终消息发送到边缘应用。</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowHelp(false)} className="action-button h-7 w-7 rounded-lg">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="space-y-5">
              <div>
                <RouteTextField id="message-route-name" label="消息路由名称" required value={form.name} onChange={(value) => { onChange({ ...form, name: value }); validation.clearError("name"); }} placeholder="请输入消息路由名称" error={validation.errors.name} />
                <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">支持小写英文字母、数字和中横线（-）；必须以小写英文字母或数字开头和结尾；长度限制为 1~253 个字符。</p>
              </div>
              <div>
                <RouteLabel required>命名空间</RouteLabel>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <select id="message-route-namespace" value={form.namespace} onChange={(event) => { onChange({ ...form, namespace: event.target.value, source: "", target: "" }); validation.clearError("namespace"); }} aria-invalid={Boolean(validation.errors.namespace)} className="h-9 w-full appearance-none rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-4 pr-9 text-sm outline-none focus:border-[var(--color-brand)]">
                      {namespaceItems.length === 0 && <option value="default">default</option>}
                      {namespaceItems.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  </div>
                  <button type="button" onClick={() => void onRefreshNamespaces()} className="action-button h-9 w-9" title="刷新命名空间" disabled={refreshingNamespaces}>
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshingNamespaces && "animate-spin")} />
                  </button>
                  <a href="https://183.95.195.121:31417/kpanda/clusters/ali-139-131/namespaces" target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[#1a73e8]">创建命名空间</a>
                </div>
                <RequiredFieldError id="message-route-namespace-error" message={validation.errors.namespace} />
              </div>

              <EndpointPicker
                label="源端点"
                required
                showSearch={!editing}
                searchValue={form.sourceSearch}
                selectValue={form.source}
                searchPlaceholder="搜索端点"
                selectPlaceholder="请选择源端点"
                options={sourceOptions}
                onSearchChange={(value) => onChange({ ...form, sourceSearch: value })}
                onSelectChange={(value) => { onChange({ ...form, source: value, sourceSearch: "", sourceNodeName: "", target: "", targetSearch: "", targetResource: "" }); validation.clearError("source"); validation.clearError("sourceNodeName"); validation.clearError("target"); }}
                id="message-route-source"
                error={validation.errors.source}
              />
              {sourceEndpoint && normalizeEndpointType(sourceEndpoint.type) === "eventbus" ? (
                <div>
                  <RouteLabel required>源端点资源</RouteLabel>
                  <div className="flex gap-2">
                    <div className="relative w-[42%] shrink-0">
                      <select
                        id="message-route-source-node"
                        value={form.sourceNodeName}
                        onChange={(event) => { onChange({ ...form, sourceNodeName: event.target.value }); validation.clearError("sourceNodeName"); }}
                        aria-invalid={Boolean(validation.errors.sourceNodeName)}
                        className="h-9 w-full appearance-none rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-4 pr-9 text-sm outline-none focus:border-[var(--color-brand)]"
                      >
                        <option value="">请选择节点</option>
                        {edgeUnitNodeNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                    </div>
                    <Input
                      id="message-route-source-resource"
                      value={form.sourceResource}
                      onChange={(event) => { onChange({ ...form, sourceResource: event.target.value }); validation.clearError("sourceResource"); }}
                      placeholder="请输入 EventBus Topic"
                      aria-invalid={Boolean(validation.errors.sourceResource)}
                      className="h-9 min-w-0 flex-1 rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-4 text-sm"
                    />
                  </div>
                  <RequiredFieldError id="message-route-source-node-error" message={validation.errors.sourceNodeName} />
                  <RequiredFieldError id="message-route-source-resource-error" message={validation.errors.sourceResource} />
                  {edgeUnitNodeNames.length === 0 && <p className="mt-1.5 text-xs text-[var(--color-danger)]">当前边缘单元没有关联可用节点。</p>}
                </div>
              ) : (
                <RouteTextField id="message-route-source-resource" label="源端点资源" required value={form.sourceResource} onChange={(value) => { onChange({ ...form, sourceResource: value }); validation.clearError("sourceResource"); }} placeholder={resourcePlaceholder(sourceEndpoint, "source")} error={validation.errors.sourceResource} />
              )}

              <EndpointPicker
                label="目的端点"
                required
                showSearch={!editing}
                searchValue={form.targetSearch}
                selectValue={form.target}
                searchPlaceholder="搜索端点"
                selectPlaceholder="请选择目的端点"
                options={targetOptions}
                onSearchChange={(value) => onChange({ ...form, targetSearch: value })}
                onSelectChange={(value) => { onChange({ ...form, target: value, targetSearch: "" }); validation.clearError("target"); }}
                id="message-route-target"
                error={validation.errors.target}
              />
              <RouteTextField id="message-route-target-resource" label="目的端点资源" required value={form.targetResource} onChange={(value) => { onChange({ ...form, targetResource: value }); validation.clearError("targetResource"); }} placeholder={resourcePlaceholder(targetEndpoint, "target")} error={validation.errors.targetResource} />

              <div>
                <RouteLabel>描述</RouteLabel>
                <Textarea value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} placeholder="请输入消息路由描述" rows={3} className="min-h-[76px] resize-none rounded-xl border-2 border-[var(--color-input-border)] bg-white px-4 py-3 text-sm" />
              </div>
            </div>

            {(sourceEndpoint || targetEndpoint) && (
              <div className="space-y-3 border-t border-[var(--color-border)] pt-5">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">路由预览</h3>
                <div className="flex items-center gap-3">
                  <RoutePreviewCard endpoint={sourceEndpoint} resource={form.sourceResource} />
                  <div className="flex shrink-0 flex-col items-center gap-1 text-[var(--color-text-tertiary)]">
                    <ArrowRight className="h-5 w-5 text-[var(--color-brand)]" />
                    <span className="text-xs">路由</span>
                  </div>
                  <RoutePreviewCard endpoint={targetEndpoint} resource={form.targetResource} />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="h-16 shrink-0 border-t border-[var(--color-border)] px-6 py-3">
          <button type="button" onClick={() => onOpenChange(false)} className="btn-secondary">取消</button>
          <button type="button" onClick={submit} className="btn-black text-sm">
            {editing ? "保存" : "创建"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function resourcePlaceholder(endpoint: RuleEndpointView | undefined, role: "source" | "target") {
  const type = endpoint ? normalizeEndpointType(endpoint.type) : "rest";
  if (type === "eventbus") return "请输入 EventBus Topic";
  if (type === "servicebus") return "请输入 ServiceBus 资源";
  return role === "source" ? "请输入 Rest 路径，如 /abc/bc" : "请输入 Rest 路径";
}

function RouteLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Label className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">
      {children} {required && <span className="text-[var(--color-danger)]">*</span>}
    </Label>
  );
}

function RouteTextField({ id, label, required, disabled, value, onChange, placeholder, error }: { id?: string; label: string; required?: boolean; disabled?: boolean; value: string; onChange: (value: string) => void; placeholder: string; error?: string }) {
  return (
    <div>
      <RouteLabel required={required}>{label}</RouteLabel>
      <Input id={id} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} className="h-9 rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-4 text-sm disabled:cursor-not-allowed disabled:bg-[#f3f4f6]" />
      <RequiredFieldError id={id ? `${id}-error` : undefined} message={error} />
    </div>
  );
}

function EndpointPicker({
  label,
  required,
  showSearch = true,
  searchValue,
  selectValue,
  searchPlaceholder,
  selectPlaceholder,
  options,
  onSearchChange,
  onSelectChange,
  id,
  error,
}: {
  label: string;
  required?: boolean;
  showSearch?: boolean;
  searchValue: string;
  selectValue: string;
  searchPlaceholder: string;
  selectPlaceholder: string;
  options: RuleEndpointView[];
  onSearchChange: (value: string) => void;
  onSelectChange: (value: string) => void;
  id?: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedEndpoint = options.find((endpoint) => endpoint.name === selectValue);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  return (
    <div>
      <RouteLabel required={required}>{label}</RouteLabel>
      <div ref={containerRef} className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          className={cn("flex h-9 w-full items-center rounded-[10px] border-2 bg-white px-4 pr-9 text-left text-sm outline-none", error ? "border-[var(--color-danger)]" : "border-[var(--color-input-border)]", open && "border-[var(--color-brand)]")}
        >
          {selectedEndpoint ? (
            <><span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{selectedEndpoint.name}</span><EndpointTag type={selectedEndpoint.type} /></>
          ) : (
            <span className="text-[var(--color-text-tertiary)]">{selectPlaceholder}</span>
          )}
        </button>
        <ChevronDown className={cn("pointer-events-none absolute right-3 top-[18px] h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)] transition-transform", open && "rotate-180")} />
        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[120] rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-[0_14px_36px_rgba(15,23,42,0.16)]">
            {showSearch && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                <Input autoFocus value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="h-9 rounded-[10px] border-2 border-[var(--color-input-border)] bg-white pl-9 pr-3 text-sm" />
              </div>
            )}
            <div className="max-h-48 overflow-y-auto">
              {options.length === 0 ? <p className="px-3 py-5 text-center text-xs text-[var(--color-text-tertiary)]">没有匹配的端点</p> : options.map((endpoint) => (
                <button
                  key={`${endpoint.namespace}-${endpoint.name}`}
                  type="button"
                  onClick={() => { onSelectChange(endpoint.name); setOpen(false); }}
                  className={cn("flex h-10 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--color-bg-hover)]", endpoint.name === selectValue && "bg-[var(--color-brand-light)] text-[var(--color-brand)]")}
                >
                  <span className="min-w-0 flex-1 truncate">{endpoint.name}</span>
                  <EndpointTag type={endpoint.type} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <RequiredFieldError id={id ? `${id}-error` : undefined} message={error} />
    </div>
  );
}

function RoutePreviewCard({ endpoint, resource }: { endpoint?: RuleEndpointView; resource?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
      {!endpoint ? (
        <p className="py-7 text-center text-xs text-[var(--color-text-tertiary)]">请选择端点</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <EndpointTag type={endpoint.type} />
            <span className="text-xs text-[var(--color-text-tertiary)]">{endpointTagText(endpoint)}</span>
          </div>
          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{endpoint.name}</p>
          <p className="truncate font-mono text-xs text-[var(--color-text-secondary)]">{endpointAddress(endpoint)}</p>
          {resource && <p className="truncate text-xs text-[var(--color-brand)]">资源: {resource}</p>}
        </div>
      )}
    </div>
  );
}

function RouteDetailPage({
  route,
  endpoints,
  activeTab,
  delivery,
  events,
  audit,
  panelLoading,
  panelErrors,
  onTabChange,
  onRefresh,
  onBack,
  onEdit,
  onDelete,
}: {
  route: MessageRouteRow;
  endpoints: RuleEndpointView[];
  activeTab: RouteTab;
  delivery: RuleDeliverySummary | null;
  events: ClusterEvent[];
  audit: RuleAuditResponse | null;
  panelLoading: Record<RouteTab, boolean>;
  panelErrors: Partial<Record<RouteTab, string>>;
  onTabChange: (tab: RouteTab) => void;
  onRefresh: (tab: RouteTab) => Promise<void>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const source = findEndpoint(endpoints, route.namespace, route.source);
  const target = findEndpoint(endpoints, route.namespace, route.target);
  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{route.name}</h1>
            <p className="text-xs text-[var(--color-text-secondary)]">{route.namespace} · {route.createdAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEdit} className="btn-black flex items-center gap-1.5 text-xs">
            <Pencil className="h-[13px] w-[13px]" />
            编辑
          </button>
          <button type="button" onClick={onDelete} className="btn-danger-outline flex items-center gap-1.5 text-xs">
            <Trash2 className="h-[13px] w-[13px]" />
            删除
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[var(--color-text-primary)]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-6 gap-y-5">
          <InfoField label="消息路由名称" value={route.name} />
          <InfoField label="命名空间" value={route.namespace} />
          <InfoField label="创建时间" value={route.createdAt} />
          <InfoField label="状态" value={<StatusPill label={route.statusLabel} tone={route.statusTone} />} />
        </div>
      </section>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[var(--color-text-primary)]">路由规则</h2>
        <div className="flex items-stretch gap-4">
          <DetailEndpointCard title="源端点" endpoint={source} fallbackName={route.source} resource={route.sourceResource} />
          <div className="flex shrink-0 flex-col items-center justify-center gap-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-light)]">
              <ArrowRight className="h-5 w-5 text-[var(--color-brand)]" />
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">路由</span>
          </div>
          <DetailEndpointCard title="目的端点" endpoint={target} fallbackName={route.target} resource={route.targetResource} />
        </div>
      </section>

      <div className="flex items-center gap-2">
        <TabButton active={activeTab === "delivery"} onClick={() => onTabChange("delivery")} icon={<ArrowRight className="h-3.5 w-3.5" />} label="投递记录" />
        <TabButton active={activeTab === "events"} onClick={() => onTabChange("events")} icon={<Bug className="h-3.5 w-3.5" />} label="事件" />
        <TabButton active={activeTab === "audit"} onClick={() => onTabChange("audit")} icon={<ClipboardList className="h-3.5 w-3.5" />} label="审计" />
      </div>

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        {activeTab === "delivery" && (
          <DeliveryPanel data={delivery} loading={panelLoading.delivery} error={panelErrors.delivery} onRefresh={() => onRefresh("delivery")} />
        )}
        {activeTab === "events" && <EventsPanel events={events} loading={panelLoading.events} error={panelErrors.events} onRefresh={() => onRefresh("events")} />}
        {activeTab === "audit" && <AuditPanel data={audit} loading={panelLoading.audit} error={panelErrors.audit} onRefresh={() => onRefresh("audit")} />}
      </section>

      <div className="hidden">
        <pre>{routeYaml(route)}</pre>
        <button type="button" onClick={() => navigator.clipboard.writeText(routeYaml(route))}><Copy /></button>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <div className="break-all text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function DetailEndpointCard({ title, endpoint, fallbackName, resource }: { title: string; endpoint?: RuleEndpointView; fallbackName: string; resource: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
      <p className="mb-3 text-xs font-semibold text-[var(--color-text-secondary)]">{title}</p>
      <div className="space-y-2">
        {endpoint && (
          <div className="flex items-center gap-2">
            <EndpointTag type={endpoint.type} />
            <span className="text-xs text-[var(--color-text-tertiary)]">{endpointTagText(endpoint)}</span>
          </div>
        )}
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{endpoint?.name || fallbackName}</p>
        <p className="font-mono text-xs text-[var(--color-text-secondary)]">{endpointAddress(endpoint)}</p>
        {resource && <p className="text-xs text-[var(--color-brand)]">资源: {resource}</p>}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? "btn-tab-active" : "btn-tab"}
    >
      {icon}
      {label}
    </button>
  );
}

function PanelRefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => Promise<void> }) {
  return (
    <button type="button" onClick={() => void onRefresh()} disabled={loading} className="action-button h-9 w-9" title="刷新真实数据">
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
    </button>
  );
}

function PanelError({ message }: { message?: string }) {
  return message ? <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{message}</div> : null;
}

function DeliveryPanel({ data, loading, error, onRefresh }: { data: RuleDeliverySummary | null; loading: boolean; error?: string; onRefresh: () => Promise<void> }) {
  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">投递统计</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">真实来源：KubeEdge Rule.status</p>
        </div>
        <PanelRefreshButton loading={loading} onRefresh={onRefresh} />
      </div>
      <PanelError message={error} />
      {loading && !data ? (
        <div className="blueedge-empty-state min-h-36 text-sm">正在读取真实投递状态...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            <DeliveryMetric label="总投递数" value={data.totalMessages} tone="neutral" />
            <DeliveryMetric label="成功" value={data.successMessages} tone="success" />
            <DeliveryMetric label="失败" value={data.failMessages} tone="danger" />
          </div>
          {data.errors.length > 0 && <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">{data.errors.join("；")}</div>}
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-5 text-center">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">集群未提供逐条投递历史</p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{data.warning}</p>
          </div>
        </>
      ) : !error ? <div className="blueedge-empty-state min-h-36 text-sm">暂无投递状态</div> : null}
    </div>
  );
}

function DeliveryMetric({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "neutral" }) {
  return (
    <div className={cn("rounded-xl border p-5", tone === "success" && "border-[#bbf7d0] bg-[#f0fdf4]", tone === "danger" && "border-[#fecaca] bg-[#fef2f2]", tone === "neutral" && "border-[var(--color-border)] bg-[var(--color-bg-soft)]")}>
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold", tone === "success" && "text-[var(--color-success)]", tone === "danger" && "text-[var(--color-danger)]", tone === "neutral" && "text-[var(--color-text-primary)]")}>{value}</p>
    </div>
  );
}

function EventsPanel({ events, loading, error, onRefresh }: { events: ClusterEvent[]; loading: boolean; error?: string; onRefresh: () => Promise<void> }) {
  const abnormal = events.filter((event) => event.type !== "Normal").length;
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">事件</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">展示当前 Rule 的真实 Kubernetes Events</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs text-[#64748b]">总数 {events.length}</span>
          <span className="rounded-full bg-[#fff7ed] px-3 py-1 text-xs text-[#c2410c]">异常 {abnormal}</span>
          <PanelRefreshButton loading={loading} onRefresh={onRefresh} />
        </div>
      </div>
      <PanelError message={error} />
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
        <Table>
          <TableHeader><TableRow><TableHead>级别</TableHead><TableHead>对象</TableHead><TableHead>事件</TableHead><TableHead>描述</TableHead><TableHead>次数</TableHead><TableHead>时间</TableHead></TableRow></TableHeader>
          <TableBody>
            {events.length === 0 ? <TableRow><TableCell colSpan={6} className="py-12 text-center text-[var(--color-text-tertiary)]">{loading ? "正在读取真实事件..." : error ? "事件接口读取失败" : "当前 Rule 没有关联事件"}</TableCell></TableRow> : events.map((event, index) => (
              <TableRow key={`${event.name}-${event.lastTimestamp}-${index}`}>
                <TableCell><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", event.type === "Normal" ? "bg-[#f1f5f9] text-[#64748b]" : "bg-[#fee2e2] text-[#dc2626]")}>● {event.type}</span></TableCell>
                <TableCell>{event.involvedObject.kind}/{event.involvedObject.name}</TableCell>
                <TableCell className="font-semibold">{event.reason}</TableCell>
                <TableCell className="max-w-[360px] whitespace-normal text-[var(--color-text-secondary)]">{event.message}</TableCell>
                <TableCell>{event.count || 1}</TableCell>
                <TableCell>{formatCreatedAt(event.lastTimestamp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AuditPanel({ data, loading, error, onRefresh }: { data: RuleAuditResponse | null; loading: boolean; error?: string; onRefresh: () => Promise<void> }) {
  const records = data?.items || [];
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">审计</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">真实来源：metadata.managedFields；不包含操作者 IP</p>
        </div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs text-[#64748b]">记录 {records.length}</span><PanelRefreshButton loading={loading} onRefresh={onRefresh} /></div>
      </div>
      <PanelError message={error} />
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
        <Table>
          <TableHeader><TableRow><TableHead>管理器</TableHead><TableHead>操作</TableHead><TableHead>API 版本</TableHead><TableHead>子资源</TableHead><TableHead>时间</TableHead></TableRow></TableHeader>
          <TableBody>
            {records.length === 0 ? <TableRow><TableCell colSpan={5} className="py-12 text-center text-[var(--color-text-tertiary)]">{loading ? "正在读取真实变更记录..." : error ? "审计接口读取失败" : "当前 Rule 没有 managedFields 记录"}</TableCell></TableRow> : records.map((record, index) => (
              <TableRow key={`${record.manager}-${record.time}-${index}`}><TableCell className="font-semibold">{record.manager}</TableCell><TableCell>{record.operation}</TableCell><TableCell>{record.apiVersion}</TableCell><TableCell>{record.subresource || "资源主体"}</TableCell><TableCell>{formatCreatedAt(record.time)}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data?.warning && <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{data.warning}</p>}
    </div>
  );
}

function ConfirmDeleteDialog({ target, loading, onCancel, onConfirm }: { target: MessageRouteRow | null; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
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
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
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
          <AlertDialogAction className="h-9 rounded-[10px] px-5 text-sm" disabled={!confirmed || loading} onClick={onConfirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

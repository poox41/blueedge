import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ListPagination, useListPagination } from "@/components/common/ListPagination";
import { AlertTriangle, Trash2, Copy, Ban, CheckCircle2, MoreHorizontal, Pause, Pencil, Plus, Search, X } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatMemory, listNodeMetrics } from "@/api/services/metrics";
import { deleteNodeResource, getNode, listNodes, listPods, updateNodeResource } from "@/api/services/resources";
import { toAccessConfigUiModel, type AccessConfigUiModel } from "@/api/adapters/access-config.adapter";
import { nodeSummaryStatusText } from "@/api/adapters/node-summary.adapter";
import { createAccessConfig as createAccessConfigResource, deleteAccessConfig, getEdgeUnitResources, getNodeSummary, listAccessConfigs, updateAccessConfig, type AccessConfigPayload } from "@/api/services/product";
import type { EdgeNodeView, KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";

interface Node {
  name: string; role: string; status: string; statusColor: string; labels: number;
  cpu: string; memory: string; ip: string; taints: number; pods: number; createdAt: string;
  raw: KubeResource; unschedulable: boolean;
  alias?: string;
  labelPreview?: string;
  extraLabels?: number;
  cpuUsage?: string;
  cpuCapacity?: string;
  memoryUsage?: string;
  memoryCapacity?: string;
  metricsAvailable?: boolean;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  version?: string;
  os?: string; kernel?: string; kubelet?: string; containerRuntime?: string;
  architecture?: string; capacity?: { cpu: string; memory: string; storage: string };
  conditions?: Array<{ type: string; status: string; message: string }>;
}

interface AccessConfig extends AccessConfigUiModel {
  nodeLabel: string;
  address: string;
}

type AccessConfigForm = {
  name: string;
  driver: "systemd" | "cgroups";
  criAddress: string;
  address: string;
  protocol: "websocket" | "QUIC";
  registry: string;
  description: string;
  labelRules: Array<{ key: string; value: string }>;
};

type AccessLabelDraft = {
  id: string;
  key: string;
  value: string;
};

type AccessRequiredField = "name" | "criAddress" | "address" | "registry";

const accessRequiredMessages: Record<AccessRequiredField, string> = {
  name: "请输入配置名称",
  criAddress: "请选择 CRI 服务地址",
  address: "请输入访问地址",
  registry: "请输入镜像仓库地址",
};

const defaultAccessForm: AccessConfigForm = {
  name: "",
  driver: "systemd",
  criAddress: "",
  address: "",
  protocol: "websocket",
  registry: "registry.cn-beijing.aliyuncs.com/kubeedge",
  description: "",
  labelRules: [
    { key: "blueedge.io/managed-by", value: "blueedge" },
    { key: "blueedge.io/node-role", value: "edge" },
  ],
};

function statusText(status: EdgeNodeView["status"]) {
  if (status === "Ready") return "就绪";
  if (status === "NotReady") return "未就绪";
  return "未知";
}

function statusColor(status: EdgeNodeView["status"]) {
  if (status === "Ready") return "success";
  if (status === "NotReady") return "warning";
  return "default";
}

function getPodNodeName(pod: any): string {
  return pod?.spec?.nodeName || pod?.nodeName || pod?.node || "-";
}

function formatCapacityCpu(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  return value.endsWith("m") ? value : `${value}核`;
}

function formatCapacityMemory(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const match = value.match(/^(\d+)(Ki|Mi|Gi|Ti)?$/);
  if (!match) return value;
  const amount = Number(match[1]);
  const unit = match[2] || "";
  if (!Number.isFinite(amount)) return value;
  if (unit === "Ki") return formatMemory(amount * 1024);
  if (unit === "Mi") return formatMemory(amount * 1024 ** 2);
  if (unit === "Gi") return `${amount}Gi`;
  if (unit === "Ti") return `${amount}Ti`;
  return formatMemory(amount);
}

function cpuCapacityMillicores(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const amount = Number.parseFloat(value.endsWith("m") ? value.slice(0, -1) : value);
  if (!Number.isFinite(amount)) return null;
  return value.endsWith("m") ? amount : amount * 1000;
}

function memoryCapacityBytes(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };
  return amount * (multipliers[match[2] || ""] || 1);
}

function usagePercent(used: number | null, capacity: number | null): number | undefined {
  if (used === null || capacity === null || capacity <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((used / capacity) * 100)));
}

function toPageNode(
  node: EdgeNodeView,
  metricsByName: Map<string, { cpuMillicores: number; memoryBytes: number }>,
  podCountByNode: Map<string, number> = new Map(),
): Node {
  const raw = node.raw as Record<string, any>;
  const nodeInfo = raw.status?.nodeInfo || {};
  const capacity = raw.status?.capacity || {};
  const allocatable = raw.status?.allocatable || {};
  const conditions = Array.isArray(raw.status?.conditions) ? raw.status.conditions : [];
  const metrics = metricsByName.get(node.name);
  const labels = raw.metadata?.labels || {};
  const cpuCapacity = formatCapacityCpu(allocatable.cpu || capacity.cpu);
  const memoryCapacity = formatCapacityMemory(allocatable.memory || capacity.memory);
  const cpuUsage = metrics ? `${Math.min(100, Math.round((metrics.cpuMillicores / Math.max(Number.parseInt(String(allocatable.cpu || capacity.cpu || "1000"), 10) || 1000, 1)) * 100))}%` : "-";
  const memoryUsage = metrics ? formatMemory(metrics.memoryBytes) : "-";
  const cpuUsagePercent = metrics ? usagePercent(metrics.cpuMillicores, cpuCapacityMillicores(allocatable.cpu || capacity.cpu)) : undefined;
  const memoryUsagePercent = metrics ? usagePercent(metrics.memoryBytes, memoryCapacityBytes(allocatable.memory || capacity.memory)) : undefined;
  return {
    name: node.name,
    role: node.role === "unknown" ? "cloud" : node.role,
    status: statusText(node.status),
    statusColor: statusColor(node.status),
    labels: Object.keys(labels).length,
    cpu: metrics ? `${metrics.cpuMillicores}m` : cpuCapacity,
    memory: metrics ? memoryUsage : memoryCapacity,
    ip: node.internalIP,
    taints: Array.isArray(raw.spec?.taints) ? raw.spec.taints.length : 0,
    pods: podCountByNode.get(node.name) ?? Number(raw.podCount || raw.pods || 0),
    createdAt: node.createdAt,
    raw: node.raw,
    unschedulable: Boolean(raw.spec?.unschedulable),
    alias: raw.metadata?.annotations?.alias || raw.metadata?.annotations?.["blueedge.io/alias"] || node.name,
    labelPreview: Object.entries(labels)[0]?.join(": ") || "-",
    extraLabels: Math.max(Object.keys(labels).length - 1, 0),
    cpuUsage,
    cpuCapacity,
    memoryUsage: metrics ? `${memoryUsage}` : "-",
    memoryCapacity,
    metricsAvailable: Boolean(metrics),
    cpuUsagePercent,
    memoryUsagePercent,
    version: node.kubeletVersion,
    os: node.osImage,
    kernel: nodeInfo.kernelVersion || "-",
    kubelet: node.kubeletVersion,
    containerRuntime: nodeInfo.containerRuntimeVersion || "-",
    architecture: nodeInfo.architecture || "-",
    capacity: { cpu: capacity.cpu || "-", memory: capacity.memory || "-", storage: capacity["ephemeral-storage"] || "-" },
    conditions: conditions.length > 0
      ? conditions.map((item: any) => ({
        type: item.type || "-",
        status: item.status || "-",
        message: item.message || item.reason || "-",
      }))
      : [
        {
          type: "Ready",
          status: node.status === "Ready" ? "True" : "False",
          message: node.status === "Ready" ? "节点已就绪" : "节点未就绪",
        },
      ],
  };
}

function yamlNode(n: Node) {
  return `apiVersion: v1
kind: Node
metadata:
  name: ${n.name}
  labels:
    kubernetes.io/arch: ${n.architecture}
    kubernetes.io/os: ${n.os?.split(" ")[0] || "linux"}
spec:
  taints:
  - key: node-role.kubernetes.io/${n.role}
    effect: NoSchedule
status:
  capacity:
    cpu: "${n.capacity?.cpu || "4"}"
    memory: ${n.capacity?.memory || "8Gi"}
    storage: ${n.capacity?.storage || "100Gi"}
  conditions:
${(n.conditions || []).map(c => `  - type: ${c.type}\n    status: "${c.status}"`).join("\n")}`;
}

function toAccessConfigRow(item: AccessConfigUiModel): AccessConfig {
  return {
    ...item,
    address: item.cloudCoreAddress,
  };
}

export function Nodes() {
  const { selectedEdgeUnit, selectedEdgeUnitName } = useEdgeUnits();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Node[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [accessSearch, setAccessSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"nodes" | "access">("nodes");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);
  const [deleteItem, setDeleteItem] = useState<Node | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aliasTarget, setAliasTarget] = useState<Node | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [accessConfigs, setAccessConfigs] = useState<AccessConfig[]>([]);
  const [accessError, setAccessError] = useState("");
  const [accessCreateOpen, setAccessCreateOpen] = useState(false);
  const [accessCancelConfirmOpen, setAccessCancelConfirmOpen] = useState(false);
  const [accessLabelTarget, setAccessLabelTarget] = useState<AccessConfig | null>(null);
  const [accessLabelDrafts, setAccessLabelDrafts] = useState<AccessLabelDraft[]>([]);
  const [accessLabelSearch, setAccessLabelSearch] = useState("");
  const [accessForm, setAccessForm] = useState<AccessConfigForm>(defaultAccessForm);
  const [accessFormErrors, setAccessFormErrors] = useState<Partial<Record<AccessRequiredField, string>>>({});
  const [pageSize, setPageSize] = useState(10);

  const loadAccessConfigs = useCallback(async () => {
    setAccessError("");
    try {
      const configsResult = await listAccessConfigs();
      setAccessConfigs(configsResult.items.map(toAccessConfigUiModel).map(toAccessConfigRow));
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : "接入配置加载失败");
    }
  }, []);

  const loadNodes = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) {
        setData([]);
        return;
      }
      const [nodes, metrics, pods, scope] = await Promise.allSettled([
        listNodes(),
        listNodeMetrics(),
        listPods(),
        getEdgeUnitResources(selectedEdgeUnitName),
      ]);
      const nodeRows = nodes.status === "fulfilled" ? nodes.value : [];
      const metricsRows = metrics.status === "fulfilled" ? metrics.value : [];
      const podRows = pods.status === "fulfilled" ? pods.value : [];
      const metricsByName = new Map(metricsRows.map((item) => [item.name, item]));
      const podCountByNode = podRows.reduce((acc, pod) => {
        const nodeName = getPodNodeName(pod);
        if (nodeName && nodeName !== "-") {
          acc.set(nodeName, (acc.get(nodeName) || 0) + 1);
        }
        return acc;
      }, new Map<string, number>());
      const allowedNodeNames = scope.status === "fulfilled" ? new Set(scope.value.item.nodeNames) : null;
      const visibleNodeRows = allowedNodeNames
        ? nodeRows.filter((node) => allowedNodeNames.has(node.name))
        : nodeRows;
      setData(visibleNodeRows.map((node) => toPageNode(node, metricsByName, podCountByNode)));
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedEdgeUnitName]);

  useEffect(() => {
    void loadNodes();
    void loadAccessConfigs();
  }, [loadNodes, loadAccessConfigs]);

  useEffect(() => {
    if (searchParams.get("tab") !== "access") return;
    setActiveTab("access");
    if (searchParams.get("create") === "1") {
      setAccessCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    let result = data;
    if (nodeSearch.trim()) {
      const s = nodeSearch.toLowerCase();
      result = result.filter(n => n.name.toLowerCase().includes(s) || n.ip.toLowerCase().includes(s) || (n.alias || "").toLowerCase().includes(s));
    }
    return result;
  }, [data, nodeSearch]);

  const filteredAccessConfigs = useMemo(() => {
    const keyword = accessSearch.trim().toLowerCase();
    if (!keyword) return accessConfigs;
    return accessConfigs.filter((item) => item.name.toLowerCase().includes(keyword) || item.nodeLabel.toLowerCase().includes(keyword) || item.address.toLowerCase().includes(keyword));
  }, [accessConfigs, accessSearch]);
  const { paginatedItems: paginatedAccessConfigs, paginationProps: accessPaginationProps } = useListPagination(filteredAccessConfigs);

  const start = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDelete = (n: Node) => { setDeleteItem(n); setDeleteOpen(true); };
  const openAliasDialog = (n: Node) => {
    setAliasTarget(n);
    setAliasValue(n.alias || n.name);
  };
  const saveAlias = async () => {
    if (!aliasTarget) return;
    const nextAlias = aliasValue.trim() || aliasTarget.name;
    setIsLoading(true);
    setError("");
    try {
      const detail = await getNode(aliasTarget.name);
      const resource = detail.raw;
      resource.metadata = {
        ...(resource.metadata || {}),
        annotations: {
          ...(resource.metadata?.annotations || {}),
          "blueedge.io/alias": nextAlias,
        },
      };
      await updateNodeResource(resource);
      await loadNodes();
      setSelected((current) => current?.name === aliasTarget.name ? { ...current, alias: nextAlias, raw: resource } : current);
      setAliasTarget(null);
      setAliasValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点别名保存失败");
    } finally {
      setIsLoading(false);
    }
  };
  const openAccessLabelDialog = (item: AccessConfig) => {
    setAccessLabelTarget(item);
    setAccessLabelDrafts(Object.entries(item.labels).map(([key, value], index) => ({ id: `existing-${index}`, key, value })));
    setAccessLabelSearch("");
  };
  const saveAccessLabels = async () => {
    if (!accessLabelTarget) return;
    try {
      await updateAccessConfig(accessLabelTarget.name, {
        edgeUnitRef: accessLabelTarget.edgeUnitRef,
        nodeName: accessLabelTarget.nodeName,
        cloudCoreAddress: accessLabelTarget.cloudCoreAddress,
        protocol: accessLabelTarget.protocol,
        ...(accessLabelTarget.driver ? { driver: accessLabelTarget.driver } : {}),
        criAddress: accessLabelTarget.criAddress,
        registry: accessLabelTarget.registry,
        description: accessLabelTarget.description,
        labels: Object.fromEntries(accessLabelDrafts.filter((label) => label.key.trim()).map((label) => [label.key.trim(), label.value.trim()])),
      });
      await loadAccessConfigs();
      setAccessLabelTarget(null);
      setAccessLabelDrafts([]);
      setAccessLabelSearch("");
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : "接入配置更新失败");
    }
  };
  const resetAccessForm = () => {
    setAccessForm(defaultAccessForm);
    setAccessFormErrors({});
  };
  const updateAccessFormField = <K extends keyof AccessConfigForm,>(field: K, value: AccessConfigForm[K]) => {
    setAccessForm((current) => ({ ...current, [field]: value }));
    if (field in accessRequiredMessages) {
      setAccessFormErrors((current) => {
        if (!current[field as AccessRequiredField]) return current;
        const next = { ...current };
        delete next[field as AccessRequiredField];
        return next;
      });
    }
  };
  const validateAccessForm = () => {
    const nextErrors: Partial<Record<AccessRequiredField, string>> = {};
    (Object.keys(accessRequiredMessages) as AccessRequiredField[]).forEach((field) => {
      const value = accessForm[field];
      if (typeof value !== "string" || !value.trim()) nextErrors[field] = accessRequiredMessages[field];
    });
    setAccessFormErrors(nextErrors);
    const firstInvalidField = (Object.keys(accessRequiredMessages) as AccessRequiredField[]).find((field) => nextErrors[field]);
    if (firstInvalidField) {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`access-config-${firstInvalidField}`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
      return false;
    }
    return true;
  };
  const requestCloseAccessCreate = () => {
    setAccessCancelConfirmOpen(true);
  };
  const confirmCancelAccessCreate = () => {
    setAccessCancelConfirmOpen(false);
    setAccessCreateOpen(false);
    resetAccessForm();
  };
  const createAccessConfig = async () => {
    if (!validateAccessForm()) return;
    if (!selectedEdgeUnitName) {
      setAccessError("当前未选择边缘单元，无法创建接入配置");
      return;
    }
    const name = accessForm.name.trim();
    const payload: AccessConfigPayload = {
      name,
      edgeUnitRef: selectedEdgeUnitName,
      cloudCoreAddress: accessForm.address,
      protocol: accessForm.protocol === "QUIC" ? "quic" : accessForm.protocol,
      driver: accessForm.driver,
      criAddress: accessForm.criAddress,
      registry: accessForm.registry,
      description: accessForm.description,
      labels: Object.fromEntries(accessForm.labelRules.filter((rule) => rule.key.trim()).map((rule) => [rule.key.trim(), rule.value.trim()])),
    };
    try {
      await createAccessConfigResource(payload);
      await loadAccessConfigs();
      setAccessCreateOpen(false);
      resetAccessForm();
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : "接入配置创建失败");
    }
  };
  const openDetailWithFreshData = async (n: Node) => {
    setError("");
    setSelected(n);
    setDetailOpen(true);
    try {
      const { item, warnings } = await getNodeSummary(n.name);
      const actionableWarnings = (warnings || []).filter((warning) => warning.source !== "metrics.node");
      if (actionableWarnings.length) setError(actionableWarnings.map((warning) => warning.message).join("；"));
      const raw = item.raw || {};
      setSelected({
        ...n,
        name: item.name,
        role: item.roles[0] || n.role,
        status: nodeSummaryStatusText(item.status),
        statusColor: item.status === "ready" ? "success" : item.status === "notReady" ? "warning" : "default",
        labels: Object.keys(item.labels || {}).length,
        cpu: item.metrics.available && item.metrics.cpuUsage !== null ? `${item.metrics.cpuUsage}m` : n.cpu,
        memory: item.metrics.available && item.metrics.memoryUsage !== null ? formatMemory(item.metrics.memoryUsage) : n.memory,
        ip: item.internalIP || n.ip,
        pods: item.pods.total,
        createdAt: item.createdAt || n.createdAt,
        raw,
        alias: item.annotations?.alias || item.annotations?.["blueedge.io/alias"] || item.name,
        labelPreview: Object.entries(item.labels || {})[0]?.join(": ") || "-",
        extraLabels: Math.max(Object.keys(item.labels || {}).length - 1, 0),
        cpuUsage: item.metrics.available && item.metrics.cpuUsage !== null ? `${item.metrics.cpuUsage}m` : "-",
        memoryUsage: item.metrics.available && item.metrics.memoryUsage !== null ? formatMemory(item.metrics.memoryUsage) : "-",
        metricsAvailable: item.metrics.available,
        cpuUsagePercent: item.metrics.available
          ? usagePercent(item.metrics.cpuUsage, cpuCapacityMillicores(raw.status?.allocatable?.cpu || raw.status?.capacity?.cpu))
          : undefined,
        memoryUsagePercent: item.metrics.available
          ? usagePercent(item.metrics.memoryUsage, memoryCapacityBytes(raw.status?.allocatable?.memory || raw.status?.capacity?.memory))
          : undefined,
        version: item.kubeletVersion || item.kubeEdgeVersion || n.version,
        os: item.os || n.os,
        kernel: item.kernelVersion || "-",
        kubelet: item.kubeletVersion || "-",
        containerRuntime: item.containerRuntime || "-",
        architecture: item.architecture || "-",
        capacity: {
          cpu: raw.status?.capacity?.cpu || "-",
          memory: raw.status?.capacity?.memory || "-",
          storage: raw.status?.capacity?.["ephemeral-storage"] || "-",
        },
        conditions: item.conditions.length > 0
          ? item.conditions.map((condition) => ({
            type: condition.type || "-",
            status: condition.status || "-",
            message: condition.message || condition.reason || "-",
          }))
          : n.conditions,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载节点详情失败");
      setSelected(n);
    }
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteNodeResource(deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      if (selected?.name === deleteItem.name) {
        setDetailOpen(false);
        setSelected(null);
      }
      await loadNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除节点失败");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleScheduling = async (node: Node) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = await getNode(node.name);
      const resource = detail.raw;
      resource.spec = {
        ...(resource.spec || {}),
        unschedulable: !(resource.spec as Record<string, unknown> | undefined)?.unschedulable,
      };
      await updateNodeResource(resource);
      await loadNodes();
      const refreshed = await getNode(node.name);
      setSelected({ ...toPageNode(refreshed, new Map()), cpu: node.cpu, memory: node.memory, pods: node.pods });
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新节点调度状态失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="blueedge-page space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-[#111827]">边缘节点</h1>
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">是容器集群组成的基本元素，既可以是云主机，也可以是物理机，用于运行容器化应用的载体，边缘应用将以 Pod 的形式在节点上运行。</p>
      </div>
      {error && (
        <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">
          {error}
        </div>
      )}
      {accessError && (
        <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">
          {accessError}
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-[var(--color-border)] bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("nodes")}
            className={cn("h-9 rounded-[10px] px-4 text-sm font-semibold transition-colors", activeTab === "nodes" ? "bg-[var(--color-text-primary)] text-white" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]")}
          >
            边缘节点 <span className="ml-1 opacity-70">({filtered.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("access")}
            className={cn("h-9 rounded-[10px] px-4 text-sm font-semibold transition-colors", activeTab === "access" ? "bg-[var(--color-text-primary)] text-white" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]")}
          >
            接入配置 <span className="ml-1 opacity-70">({filteredAccessConfigs.length})</span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-[240px] transition-[width] focus-within:w-[300px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input
              value={activeTab === "nodes" ? nodeSearch : accessSearch}
              onChange={(event) => {
                if (activeTab === "nodes") setNodeSearch(event.target.value);
                else setAccessSearch(event.target.value);
                setCurrentPage(1);
              }}
              placeholder={activeTab === "nodes" ? "输入节点名称搜索" : "输入接入配置名称搜索"}
              className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-11 text-sm"
            />
          </div>
          <Button onClick={() => activeTab === "nodes" ? navigate("/nodes/access") : setAccessCreateOpen(true)} className="blueedge-primary-button h-10 rounded-xl px-4 text-sm">
            <Plus className="h-4 w-4" />
            {activeTab === "nodes" ? "接入节点" : "创建接入配置"}
          </Button>
        </div>
      </div>
      <div className="table-card overflow-hidden">
        <div className="overflow-x-auto">
        {activeTab === "nodes" ? (
          <Table className="min-w-[960px] table-fixed">
            <TableHeader>
              <TableRow className="h-12 bg-white hover:bg-white">
                <TableHead className="w-[190px] px-4 text-left text-xs font-medium text-[var(--color-text-tertiary)]">名称</TableHead>
                <TableHead className="w-[110px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">别名</TableHead>
                <TableHead className="w-[88px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">状态</TableHead>
                <TableHead className="w-[96px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">调度状态</TableHead>
                <TableHead className="w-[170px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">标签</TableHead>
                <TableHead className="w-[110px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">CPU</TableHead>
                <TableHead className="w-[120px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">内存</TableHead>
                <TableHead className="w-[120px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">版本</TableHead>
                <TableHead className="w-[68px] px-4 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">正在加载节点数据...</span></div></TableCell></TableRow>
              ) : paginated.length === 0 ? (
                <TableRow><TableCell colSpan={9}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">暂无节点数据</span></div></TableCell></TableRow>
              ) : paginated.map(row => (
                <TableRow key={row.name} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
                  <TableCell className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-brand)] hover:underline" onClick={() => openDetailWithFreshData(row)}>{row.name}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{row.alias || "-"}</TableCell>
                  <TableCell className="px-4 py-3"><NodeStatePill status={row.status} /></TableCell>
                  <TableCell className="px-4 py-3"><SchedulePill unschedulable={row.unschedulable} /></TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-md bg-[var(--color-bg-soft)] px-2 py-1 text-xs text-[var(--color-text-primary)]">{row.labelPreview || "-"}</span>
                      {Boolean(row.extraLabels) && <span className="rounded-md bg-[var(--color-brand-light)] px-2 py-1 text-xs font-semibold text-[var(--color-brand)]">+{row.extraLabels}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{row.cpuUsage || "-"} <span className="text-[var(--color-text-tertiary)]">/ {row.cpuCapacity || "-"}</span></TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{row.memoryUsage || "-"} <span className="text-[var(--color-text-tertiary)]">/ {row.memoryCapacity || "-"}</span></TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{row.version || row.kubelet || "-"}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <NodeActionMenu node={row} onSchedule={() => void toggleScheduling(row)} onAlias={() => openAliasDialog(row)} onRemove={() => openDelete(row)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table className="min-w-[800px] table-fixed">
            <TableHeader>
              <TableRow className="h-12 bg-white hover:bg-white">
                <TableHead className="w-[220px] px-4 text-left text-xs font-medium text-[var(--color-text-tertiary)]">名称</TableHead>
                <TableHead className="w-[220px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">节点标签</TableHead>
                <TableHead className="w-[100px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">驱动方式</TableHead>
                <TableHead className="w-[150px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">访问地址</TableHead>
                <TableHead className="w-[100px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">通信协议</TableHead>
                <TableHead className="w-[150px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
                <TableHead className="w-[68px] px-4 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccessConfigs.length === 0 ? (
                <TableRow><TableCell colSpan={7}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">暂无接入配置</span></div></TableCell></TableRow>
              ) : paginatedAccessConfigs.map((item) => (
                <TableRow
                  key={item.name}
                  className="h-[69px] cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]"
                  onClick={() => navigate(`/nodes/access-config/${encodeURIComponent(item.name)}`)}
                >
                  <TableCell className="px-4 py-3 text-sm font-semibold text-[var(--color-brand)]">{item.name}</TableCell>
                  <TableCell className="px-4 py-3"><span className="inline-block max-w-[360px] truncate rounded-md bg-[var(--color-bg-soft)] px-2 py-1 text-sm text-[var(--color-text-primary)]">{item.nodeLabel}</span></TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{item.driver || "未配置"}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{item.address}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{item.protocol}</TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[var(--color-text-tertiary)]">{item.createdAt}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <AccessConfigActionMenu
                      onLabels={() => openAccessLabelDialog(item)}
                      onDelete={async () => {
                        try {
                          await deleteAccessConfig(item.name);
                          await loadAccessConfigs();
                        } catch (err) {
                          setAccessError(err instanceof Error ? err.message : "接入配置删除失败");
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </div>
        {activeTab === "nodes" && <ListPagination total={filtered.length} page={currentPage} pageSize={pageSize} onPageChange={setCurrentPage} onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }} />}
        {activeTab === "access" && <ListPagination {...accessPaginationProps} />}
      </div>
      <Dialog open={!!aliasTarget} onOpenChange={(open) => {
        if (!open) {
          setAliasTarget(null);
          setAliasValue("");
        }
      }}>
        <DialogContent className="max-w-[420px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">编辑别名</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm text-[var(--color-text-secondary)]">节点：<span className="font-semibold text-[var(--color-text-primary)]">{aliasTarget?.name}</span></div>
            <Input value={aliasValue} onChange={(event) => setAliasValue(event.target.value)} placeholder="请输入节点别名" className="h-10 rounded-xl" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAliasTarget(null)}>取消</Button>
            <Button onClick={() => void saveAlias()} disabled={isLoading}>{isLoading ? "保存中..." : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={accessCreateOpen} onOpenChange={(open) => {
        if (open) {
          setAccessCreateOpen(true);
          return;
        }
        requestCloseAccessCreate();
      }}>
        <DialogContent className="!flex max-h-[92vh] max-w-[760px] flex-col gap-0 overflow-hidden rounded-[24px] p-0" showCloseButton>
          <DialogHeader className="border-b border-[var(--color-border)] px-7 py-5">
            <DialogTitle className="text-lg font-semibold">创建接入配置</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <AccessField label="配置名称" required error={accessFormErrors.name} errorId="access-config-name-error">
              <Input id="access-config-name" value={accessForm.name} onChange={(event) => updateAccessFormField("name", event.target.value)} placeholder="请输入配置名称" aria-invalid={Boolean(accessFormErrors.name)} aria-describedby={accessFormErrors.name ? "access-config-name-error" : undefined} className={cn("h-11 rounded-xl", accessFormErrors.name && "border-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]")} />
            </AccessField>
            <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm leading-6 text-[#1d4ed8]">
              接入配置将自动关联当前边缘单元 <span className="font-semibold">{selectedEdgeUnitName || "未选择"}</span>，KubeEdge 版本自动继承为 <span className="font-semibold">{selectedEdgeUnit?.kubeEdgeVersion && selectedEdgeUnit.kubeEdgeVersion !== "unknown" ? selectedEdgeUnit.kubeEdgeVersion : "未配置"}</span>；注册节点名称默认与配置名称一致，节点架构由接入脚本自动检测。
            </div>
            <AccessField label="驱动方式" required>
              <SegmentedChoice
                value={accessForm.driver}
                options={["systemd", "cgroups"]}
                onChange={(driver) => setAccessForm({ ...accessForm, driver: driver as AccessConfigForm["driver"] })}
              />
            </AccessField>
            <AccessField label="CRI 服务地址" required error={accessFormErrors.criAddress} errorId="access-config-criAddress-error">
              <select id="access-config-criAddress" value={accessForm.criAddress} onChange={(event) => updateAccessFormField("criAddress", event.target.value)} aria-invalid={Boolean(accessFormErrors.criAddress)} aria-describedby={accessFormErrors.criAddress ? "access-config-criAddress-error" : undefined} className={cn("h-11 w-full rounded-xl border-2 bg-white px-4 text-sm outline-none", accessFormErrors.criAddress ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]" : "border-[var(--color-input-border)] focus:border-[var(--color-brand)]")}>
                <option value="">点击读取现有 CRI 服务地址</option>
                <option value="/run/containerd/containerd.sock">/run/containerd/containerd.sock</option>
                <option value="/var/run/dockershim.sock">/var/run/dockershim.sock</option>
              </select>
            </AccessField>
            <AccessField label="访问地址" required error={accessFormErrors.address} errorId="access-config-address-error">
              <Input id="access-config-address" value={accessForm.address} onChange={(event) => updateAccessFormField("address", event.target.value)} placeholder="example.com:10000" aria-invalid={Boolean(accessFormErrors.address)} aria-describedby={accessFormErrors.address ? "access-config-address-error" : undefined} className={cn("h-11 rounded-xl", accessFormErrors.address && "border-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]")} />
            </AccessField>
            <AccessField label="通信协议" required>
              <SegmentedChoice
                value={accessForm.protocol}
                options={["websocket", "QUIC"]}
                onChange={(protocol) => setAccessForm({ ...accessForm, protocol: protocol as AccessConfigForm["protocol"] })}
              />
            </AccessField>
            <AccessField label="镜像仓库" required error={accessFormErrors.registry} errorId="access-config-registry-error">
              <Input id="access-config-registry" value={accessForm.registry} onChange={(event) => updateAccessFormField("registry", event.target.value)} aria-invalid={Boolean(accessFormErrors.registry)} aria-describedby={accessFormErrors.registry ? "access-config-registry-error" : undefined} className={cn("h-11 rounded-xl", accessFormErrors.registry && "border-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]")} />
              <div className="mt-3 flex gap-3">
                <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => updateAccessFormField("registry", "registry.cn-shanghai.aliyuncs.com/kubeedge/default")}>引用云端地址</Button>
                <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => updateAccessFormField("registry", "registry.cn-beijing.aliyuncs.com/kubeedge")}>一键填充默认仓库</Button>
              </div>
              <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 text-sm text-[var(--color-text-secondary)]">
                <p className="mb-2 font-semibold text-[var(--color-text-primary)]">镜像仓库说明</p>
                <p>用于拉取边端组件（Mosquitto / pause / installation-package）</p>
                <p>建议使用企业内网仓库，公网仓库需确保可访问。</p>
              </div>
            </AccessField>
            <AccessField label="描述">
              <Input value={accessForm.description} onChange={(event) => setAccessForm({ ...accessForm, description: event.target.value })} placeholder="请输入描述" className="h-11 rounded-xl" />
            </AccessField>
            <AccessField label="标签匹配规则">
              <div className="space-y-3">
                {accessForm.labelRules.map((rule, index) => (
                  <div key={index} className="grid grid-cols-[1fr_24px_1fr_40px] items-center gap-3">
                    <Input
                      value={rule.key}
                      onChange={(event) => setAccessForm({ ...accessForm, labelRules: accessForm.labelRules.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })}
                      placeholder="键（key）"
                      className="h-11 rounded-xl"
                    />
                    <span className="text-center text-[var(--color-text-tertiary)]">=</span>
                    <Input
                      value={rule.value}
                      onChange={(event) => setAccessForm({ ...accessForm, labelRules: accessForm.labelRules.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })}
                      placeholder="值（value）"
                      className="h-11 rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => setAccessForm({ ...accessForm, labelRules: accessForm.labelRules.length > 1 ? accessForm.labelRules.filter((_, itemIndex) => itemIndex !== index) : [{ key: "", value: "" }] })}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                      title="删除标签规则"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setAccessForm({ ...accessForm, labelRules: [...accessForm.labelRules, { key: "", value: "" }] })} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text-primary)]">
                <Plus className="h-4 w-4" />
                添加标签规则
              </button>
            </AccessField>
          </div>
          <DialogFooter className="border-t border-[var(--color-border)] px-7 py-5">
            <Button variant="outline" className="h-10 rounded-xl px-5" onClick={requestCloseAccessCreate}>取消</Button>
            <Button className="h-10 rounded-xl px-6" onClick={() => void createAccessConfig()} disabled={isLoading}>{isLoading ? "创建中..." : "确定"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={accessCancelConfirmOpen} onOpenChange={setAccessCancelConfirmOpen}>
        <AlertDialogContent className="z-[120] !w-[calc(100%-2rem)] !max-w-[440px] gap-0 overflow-hidden rounded-2xl p-0 sm:!max-w-[440px]">
          <AlertDialogHeader className="border-b border-[var(--color-border)] px-6 py-4 text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="h-[18px] w-[18px] text-[var(--color-danger)]" />
              确认取消创建
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="px-6 py-5">
            <AlertDialogDescription className="text-sm leading-6 text-[var(--color-text-secondary)]">
              取消后，当前创建内容将不会保存。
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter className="border-t border-[var(--color-border)] px-6 py-4">
            <AlertDialogCancel className="h-9 rounded-[10px] px-5 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-9 rounded-[10px] bg-[var(--color-danger)] px-5 text-sm text-white hover:bg-[var(--color-danger)]/90" onClick={confirmCancelAccessCreate}>
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!accessLabelTarget} onOpenChange={(open) => {
        if (!open) {
          setAccessLabelTarget(null);
          setAccessLabelDrafts([]);
          setAccessLabelSearch("");
        }
      }}>
        <DialogContent
          className="max-w-[680px] gap-0 overflow-hidden rounded-[24px] p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b border-[var(--color-border)] px-8 py-6">
            <DialogTitle className="text-lg font-semibold">修改标签 — {accessLabelTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-8 py-7">
            <section>
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">已有标签</h3>
                <div className="relative w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <Input value={accessLabelSearch} onChange={(event) => setAccessLabelSearch(event.target.value)} placeholder="搜索标签" className="h-10 rounded-xl pl-9" />
                </div>
              </div>
              <div className="flex min-h-12 flex-wrap gap-2">
                {accessLabelDrafts
                  .filter((label) => !label.id.startsWith("new-"))
                  .filter((label) => !accessLabelSearch.trim() || `${label.key}:${label.value}`.toLowerCase().includes(accessLabelSearch.trim().toLowerCase()))
                  .map((label) => (
                    <span key={label.id} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--color-bg-soft)] px-3 text-sm text-[var(--color-text-primary)]">
                      <span>{label.key}: {label.value}</span>
                      <button type="button" onClick={() => setAccessLabelDrafts((current) => current.filter((item) => item.id !== label.id))} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" title="删除标签">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                {!accessLabelDrafts.some((label) => !label.id.startsWith("new-")) && <span className="text-sm text-[var(--color-text-tertiary)]">暂无标签</span>}
              </div>
            </section>

            <div className="border-t border-[var(--color-border)]" />

            <section>
              <h3 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">新增标签</h3>
              <div className="space-y-3">
                {accessLabelDrafts.filter((label) => label.id.startsWith("new-")).map((label) => (
                  <div key={label.id} className="grid grid-cols-[1fr_1fr_40px] items-center gap-3">
                    <Input value={label.key} onChange={(event) => setAccessLabelDrafts((current) => current.map((item) => item.id === label.id ? { ...item, key: event.target.value } : item))} placeholder="键（Key）" className="h-11 rounded-xl" />
                    <Input value={label.value} onChange={(event) => setAccessLabelDrafts((current) => current.map((item) => item.id === label.id ? { ...item, value: event.target.value } : item))} placeholder="值（Value）" className="h-11 rounded-xl" />
                    <button type="button" onClick={() => setAccessLabelDrafts((current) => current.filter((item) => item.id !== label.id))} className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" title="删除新增标签">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setAccessLabelDrafts((current) => [...current, { id: `new-${Date.now()}-${current.length}`, key: "", value: "" }])} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]">
                <Plus className="h-4 w-4" />
                添加标签
              </button>
            </section>
            {accessError && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{accessError}</div>}
          </div>
          <DialogFooter className="border-t border-[var(--color-border)] px-8 py-5">
            <Button variant="outline" className="h-10 rounded-xl px-6" onClick={() => setAccessLabelTarget(null)}>取消</Button>
            <Button className="h-10 rounded-xl px-6" onClick={() => void saveAccessLabels()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]">
            <SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} />
              <Badge variant="outline" className="text-xs font-normal capitalize">{selected?.role}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[var(--color-bg-soft)] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="resource" className="text-xs h-7">资源</TabsTrigger>
                <TabsTrigger value="conditions" className="text-xs h-7">状态条件</TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Info label="名称" value={selected.name} />
                  <Info label="角色" value={selected.role} />
                  <Info label="状态" value={selected.status} />
                  <Info label="IP 地址" value={selected.ip} />
                  <Info label="OS" value={selected.os || "-"} />
                  <Info label="内核" value={selected.kernel || "-"} />
                  <Info label="Kubelet 版本" value={selected.kubelet || "-"} />
                  <Info label="容器运行时" value={selected.containerRuntime || "-"} />
                  <Info label="架构" value={selected.architecture || "-"} />
                  <Info label="Pod 数量" value={String(selected.pods)} />
                  <Info label="标签数" value={String(selected.labels)} />
                  <Info label="污点" value={String(selected.taints)} />
                  <Info label="调度状态" value={selected.unschedulable ? "不可调度" : "可调度"} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toggleScheduling(selected)} disabled={isLoading}>
                    {selected.unschedulable ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Ban className="w-3.5 h-3.5 mr-1" />}
                    {selected.unschedulable ? "恢复调度" : "设为不可调度"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs text-[var(--color-text-secondary)]" onClick={() => openDelete(selected)}><Trash2 className="mr-1 h-3.5 w-3.5" /><span>删除</span></Button>
                </div>
              </TabsContent>
              <TabsContent value="resource" className="mt-3 space-y-3">
                <Info label="CPU 容量" value={selected.capacity?.cpu || "-"} />
                <Info label="内存容量" value={selected.capacity?.memory || "-"} />
                <Info label="存储容量" value={selected.capacity?.storage || "-"} />
                <Info label="CPU 使用" value={selected.cpu} />
                <Info label="内存使用" value={selected.memory} />
                {selected.metricsAvailable && selected.cpuUsagePercent !== undefined ? (
                  <div className="bg-[var(--color-bg-soft)] rounded-md p-3"><p className="text-xs text-[var(--color-text-tertiary)] mb-1">CPU 使用率 {selected.cpuUsagePercent}%</p><div className="h-2 bg-[var(--color-border-strong)] rounded-full"><div className="h-full bg-[var(--color-brand)] rounded-full" style={{ width: `${selected.cpuUsagePercent}%` }} /></div></div>
                ) : <div className="rounded-md bg-[var(--color-bg-soft)] p-3 text-xs text-[var(--color-text-tertiary)]">CPU 指标暂不可用</div>}
                {selected.metricsAvailable && selected.memoryUsagePercent !== undefined ? (
                  <div className="bg-[var(--color-bg-soft)] rounded-md p-3"><p className="text-xs text-[var(--color-text-tertiary)] mb-1">内存使用率 {selected.memoryUsagePercent}%</p><div className="h-2 bg-[var(--color-border-strong)] rounded-full"><div className="h-full bg-[var(--color-success)] rounded-full" style={{ width: `${selected.memoryUsagePercent}%` }} /></div></div>
                ) : <div className="rounded-md bg-[var(--color-bg-soft)] p-3 text-xs text-[var(--color-text-tertiary)]">内存指标暂不可用</div>}
              </TabsContent>
              <TabsContent value="conditions" className="mt-3 space-y-2">
                {(selected.conditions || []).map((c, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[var(--color-bg-soft)]">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", c.status === "True" ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]")} />
                    <div className="flex-1"><p className="text-sm font-medium text-[var(--color-text-primary)]">{c.type}</p><p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{c.message}</p></div>
                    <Badge className={cn("text-xs font-normal flex-shrink-0", c.status === "True" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]")}>{c.status}</Badge>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="blueedge-code-block p-4 overflow-x-auto">{yamlNode(selected)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yamlNode(selected))}><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="text-base">确认删除节点？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除节点 <span className="font-medium text-[var(--color-text-primary)]">{deleteItem?.name}</span>，此操作不可恢复。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDelete}>确认删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}

type ActionMenuItem = {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void | Promise<void>;
};

function PortalActionMenu({ items }: { items: ActionMenuItem[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 148;
    const estimatedHeight = items.length * 36 + 12;
    const top = rect.bottom + estimatedHeight + 8 > window.innerHeight
      ? Math.max(12, rect.top - estimatedHeight - 8)
      : rect.bottom + 8;
    setPosition({
      top,
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
    });
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const close = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnViewportChange = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="action-button h-10 w-10 rounded-xl"
        title="操作"
        aria-label="操作"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) updatePosition();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[2000] w-[148px] overflow-hidden rounded-xl border border-[#e5e7eb] bg-white py-1.5 text-left shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]"
          style={position}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn(
                "flex h-9 w-full items-center gap-2 px-3.5 text-left text-xs transition-colors hover:bg-[var(--color-bg-hover)]",
                item.danger ? "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" : "text-[#111827]",
              )}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                void item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function NodeActionMenu({ node, onSchedule, onAlias, onRemove }: { node: Node; onSchedule: () => void | Promise<void>; onAlias: () => void; onRemove: () => void }) {
  return (
    <PortalActionMenu items={[
      { label: node.unschedulable ? "恢复调度" : "暂停调度", icon: node.unschedulable ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />, onClick: onSchedule },
      { label: "编辑别名", icon: <Pencil className="h-3.5 w-3.5" />, onClick: onAlias },
      { label: "移除节点", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: onRemove },
    ]} />
  );
}

function AccessConfigActionMenu({ onLabels, onDelete }: { onLabels: () => void; onDelete: () => void | Promise<void> }) {
  return (
    <PortalActionMenu items={[
      { label: "修改标签", icon: <Pencil className="h-3.5 w-3.5" />, onClick: onLabels },
      { label: "删除", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: onDelete },
    ]} />
  );
}

function NodeStatePill({ status }: { status: string }) {
  const healthy = status === "健康" || status === "就绪";
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", healthy ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {healthy ? "健康" : "未知"}
    </span>
  );
}

function SchedulePill({ unschedulable }: { unschedulable: boolean }) {
  return (
    <span className={cn("inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold", unschedulable ? "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]")}>
      {unschedulable ? "不可调度" : "可调度"}
    </span>
  );
}

function AccessField({ label, required, children, error, errorId }: { label: string; required?: boolean; children: React.ReactNode; error?: string; errorId?: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </div>
      {children}
      {error && <p id={errorId} className="mt-1.5 text-xs font-medium text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function SegmentedChoice({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "h-12 rounded-xl border-2 text-sm font-semibold transition-colors",
            value === option ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-input-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-input-border-hover)]",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import yaml from "js-yaml";
import { useNamespace } from "@/contexts/NamespaceContext";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Bug,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toBatchWorkloadRow } from "@/api/adapters/batch-task.adapter";
import type { BatchTaskApiItem } from "@/api/adapters/batch-task.adapter";
import {
  addBatchWorkloadDeployments,
  createBatchWorkloadTask,
  deleteBatchWorkload,
  deleteBatchWorkloadDeployment,
  getBatchWorkloadAudit,
  getBatchWorkloadEvents,
  getBatchWorkloadTask,
  listBatchWorkloads,
  updateBatchWorkloadMetadata,
  updateBatchWorkloadYaml,
  type BatchWorkloadAuditItem,
  type BatchWorkloadEvent,
  type BatchWorkloadPlan,
  type BatchWorkloadPlanContainer,
} from "@/api/services/product";
import { listNamespaces, listNodeGroups } from "@/api/services/resources";
import { cn } from "@/lib/utils";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

type BatchWorkload = {
  id: string;
  name: string;
  namespace: string;
  image: string;
  targetGroups: string[];
  status: "成功" | "执行中" | "失败" | "部分成功" | "待执行" | "已取消";
  createTime: string;
  description: string;
  rolloutPolicy: string;
  rollbackPolicy: string;
  raw?: BatchTaskApiItem;
};

type BatchKeyValue = {
  id: string;
  key: string;
  value: string;
};

type BatchContainerForm = {
  id: string;
  name: string;
  image: string;
  pullPolicy: "IfNotPresent" | "Always" | "Never";
  privileged: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  gpuEnabled: boolean;
  gpuType: string;
  gpuCount: number;
  lifecyclePostStart: string;
  lifecyclePreStop: string;
  startupProbe: boolean;
  readinessProbe: boolean;
  livenessProbe: boolean;
  envs: BatchKeyValue[];
  volumes: { id: string; name: string; type: "emptyDir" | "hostPath" | "pvc" | "configMap" | "secret"; mountPath: string; source: string }[];
  runAsUser: string;
  runAsGroup: string;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
};

type BatchImageCreateForm = {
  name: string;
  namespace: string;
  targetGroups: string[];
  replicas: string;
  description: string;
  containers: BatchContainerForm[];
  workloadLabels: BatchKeyValue[];
  podLabels: BatchKeyValue[];
  workloadAnnotations: BatchKeyValue[];
  podAnnotations: BatchKeyValue[];
  networkType: "none" | "portmap" | "host";
  ports: { id: string; containerName: string; containerPort: string; hostPort: string }[];
  strategy: "RollingUpdate" | "Recreate";
  maxUnavailable: string;
  maxUnavailableUnit: "%" | "个";
  maxSurge: string;
  maxSurgeUnit: "%" | "个";
  revisionHistoryLimit: string;
  minReadySeconds: string;
  progressDeadlineSeconds: string;
  terminationGracePeriodSeconds: string;
};

const createBatchContainer = (index: number): BatchContainerForm => ({
  id: `batch-container-${Date.now()}-${index}`,
  name: "",
  image: "",
  pullPolicy: "IfNotPresent",
  privileged: false,
  cpuRequest: "",
  cpuLimit: "",
  memoryRequest: "",
  memoryLimit: "",
  gpuEnabled: false,
  gpuType: "",
  gpuCount: 1,
  lifecyclePostStart: "",
  lifecyclePreStop: "",
  startupProbe: false,
  readinessProbe: false,
  livenessProbe: false,
  envs: [{ id: `env-${Date.now()}-${index}`, key: "", value: "" }],
  volumes: [],
  runAsUser: "",
  runAsGroup: "",
  readOnlyRootFilesystem: false,
  allowPrivilegeEscalation: false,
});

const defaultBatchImageForm = (): BatchImageCreateForm => ({
  name: "",
  namespace: "",
  targetGroups: [],
  replicas: "1",
  description: "",
  containers: [createBatchContainer(0)],
  workloadLabels: [],
  podLabels: [],
  workloadAnnotations: [],
  podAnnotations: [],
  networkType: "none",
  ports: [],
  strategy: "RollingUpdate",
  maxUnavailable: "25",
  maxUnavailableUnit: "%",
  maxSurge: "25",
  maxSurgeUnit: "%",
  revisionHistoryLimit: "10",
  minReadySeconds: "0",
  progressDeadlineSeconds: "600",
  terminationGracePeriodSeconds: "30",
});

const keyValueRecord = (items: BatchKeyValue[]): Record<string, string> => Object.fromEntries(items.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
const optionalNumber = (value: string): number | undefined => value.trim() === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);
const compactStringList = (value: string): string[] => value.split(/\s+/).map((item) => item.trim()).filter(Boolean);

function toPlanContainer(container: BatchContainerForm): BatchWorkloadPlanContainer {
  const gpuResource = container.gpuEnabled ? (container.gpuType.trim() || "nvidia.com/gpu") : "";
  const gpuCount = String(Math.max(1, Math.floor(Number(container.gpuCount) || 1)));
  return {
    name: container.name.trim(),
    image: container.image.trim(),
    imagePullPolicy: container.pullPolicy,
    env: container.envs.filter((item) => item.key.trim()).map((item) => ({ name: item.key.trim(), value: item.value })),
    resources: {
      requests: { ...(container.cpuRequest.trim() ? { cpu: container.cpuRequest.trim() } : {}), ...(container.memoryRequest.trim() ? { memory: container.memoryRequest.trim() } : {}), ...(gpuResource ? { [gpuResource]: gpuCount } : {}) },
      limits: { ...(container.cpuLimit.trim() ? { cpu: container.cpuLimit.trim() } : {}), ...(container.memoryLimit.trim() ? { memory: container.memoryLimit.trim() } : {}), ...(gpuResource ? { [gpuResource]: gpuCount } : {}) },
    },
    lifecycle: { ...(container.lifecyclePostStart.trim() ? { postStart: container.lifecyclePostStart.trim() } : {}), ...(container.lifecyclePreStop.trim() ? { preStop: container.lifecyclePreStop.trim() } : {}) },
    healthChecks: { startup: container.startupProbe, readiness: container.readinessProbe, liveness: container.livenessProbe },
    securityContext: {
      privileged: container.privileged,
      ...(optionalNumber(container.runAsUser) !== undefined ? { runAsUser: optionalNumber(container.runAsUser) } : {}),
      ...(optionalNumber(container.runAsGroup) !== undefined ? { runAsGroup: optionalNumber(container.runAsGroup) } : {}),
      readOnlyRootFilesystem: container.readOnlyRootFilesystem,
      allowPrivilegeEscalation: container.allowPrivilegeEscalation,
    },
    volumes: container.volumes.filter((item) => item.name.trim() && item.mountPath.trim()).map((item) => ({ name: item.name.trim(), type: item.type, mountPath: item.mountPath.trim(), ...(item.source.trim() ? { source: item.source.trim() } : {}) })),
  };
}

function toBatchWorkloadPlan(form: BatchImageCreateForm, targetGroups: string[] = form.targetGroups): BatchWorkloadPlan {
  return {
    namespace: form.namespace,
    name: form.name.trim(),
    targetGroups,
    replicas: Number(form.replicas),
    workloadType: "Deployment",
    metadata: { labels: keyValueRecord(form.workloadLabels), annotations: keyValueRecord(form.workloadAnnotations) },
    podTemplate: {
      labels: keyValueRecord(form.podLabels),
      annotations: keyValueRecord(form.podAnnotations),
      containers: form.containers.map(toPlanContainer),
      network: {
        type: form.networkType,
        ports: form.ports.filter((item) => item.containerName && Number(item.containerPort) > 0).map((item) => ({ containerName: item.containerName, containerPort: Number(item.containerPort), ...(Number(item.hostPort) > 0 ? { hostPort: Number(item.hostPort) } : {}) })),
      },
      terminationGracePeriodSeconds: Number(form.terminationGracePeriodSeconds),
    },
    strategy: {
      type: form.strategy,
      maxUnavailable: `${form.maxUnavailable}${form.maxUnavailableUnit === "%" ? "%" : ""}`,
      maxSurge: `${form.maxSurge}${form.maxSurgeUnit === "%" ? "%" : ""}`,
      revisionHistoryLimit: Number(form.revisionHistoryLimit),
      minReadySeconds: Number(form.minReadySeconds),
      progressDeadlineSeconds: Number(form.progressDeadlineSeconds),
    },
  };
}

const defaultBatchYaml = `# BlueEdge 平台批量工作负载定义；提交后会生成真实 apps/v1 Deployment
apiVersion: blueedge.io/v1alpha1
kind: BatchWorkloadPlan
metadata:
  name: batch-app
  namespace: default
spec:
  replicas: 1
  targetGroups:
    - edge-group
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          imagePullPolicy: IfNotPresent
`;

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const highlightYamlValue = (value: string): string => {
  const leading = value.match(/^\s*/)?.[0] || "";
  const raw = value.slice(leading.length);
  if (!raw) return escapeHtml(value);
  const color = /^(true|false|null|~)$/i.test(raw)
    ? "#569CD6"
    : /^-?\d+(\.\d+)?$/.test(raw)
      ? "#B5CEA8"
      : "#CE9178";
  return `${escapeHtml(leading)}<span style="color:${color}">${escapeHtml(raw)}</span>`;
};

const highlightYamlLine = (line: string): string => {
  const commentIndex = line.indexOf("#");
  const source = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = source.match(/^(\s*-\s*|\s*)([A-Za-z_][A-Za-z0-9_-]*)(:\s*)(.*)$/);
  if (keyMatch) {
    const [, prefix, key, colon, rest] = keyMatch;
    return `${escapeHtml(prefix)}<span style="color:#9CDCFE">${escapeHtml(key)}</span>${escapeHtml(colon)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  const listMatch = source.match(/^(\s*-\s+)(.*)$/);
  if (listMatch) {
    const [, prefix, rest] = listMatch;
    return `${escapeHtml(prefix)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  return `${escapeHtml(source)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
};

const highlightYaml = (code: string): string => code.split("\n").map(highlightYamlLine).join("\n");

export function BatchWorkloads() {
  const { selectedNamespace } = useNamespace();
  const [items, setItems] = useState<BatchWorkload[]>([]);
  const [search, setSearch] = useState("");
  const [yamlOpen, setYamlOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [definitionTarget, setDefinitionTarget] = useState<BatchWorkload | null>(null);
  const [openDefinitionInitially, setOpenDefinitionInitially] = useState(false);
  const [editYamlTarget, setEditYamlTarget] = useState<BatchWorkload | null>(null);
  const [deployTarget, setDeployTarget] = useState<BatchWorkload | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BatchWorkload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadItems = async (preserveCurrentRows = false) => {
    if (preserveCurrentRows) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await listBatchWorkloads();
      setItems(data.items.map((item) => toBatchWorkloadRow(item) as BatchWorkload));
    } catch (err) {
      if (!preserveCurrentRows) setItems([]);
      setError(err instanceof Error ? err.message : "批量工作负载加载失败");
    } finally {
      if (preserveCurrentRows) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items
      .filter((item) => selectedNamespace === "all" || item.namespace === selectedNamespace)
      .filter((item) => !keyword || [item.name, item.namespace, item.image].some((value) => value.toLowerCase().includes(keyword)));
  }, [items, search, selectedNamespace]);

  const createFromYaml = async (yamlText: string) => {
    try {
      const document = yaml.load(yamlText) as any;
      if (!document || typeof document !== "object" || document.kind !== "BatchWorkloadPlan") throw new Error("YAML kind 必须是 BatchWorkloadPlan");
      const metadata = document.metadata || {};
      const spec = document.spec || {};
      const containers = Array.isArray(spec?.template?.spec?.containers) ? spec.template.spec.containers : [];
      const name = String(metadata.name || `batch-workload-${Date.now().toString().slice(-5)}`).trim();
      const namespace = String(metadata.namespace || "default").trim();
      const targetGroups = Array.isArray(spec.targetGroups) ? spec.targetGroups.map(String).filter(Boolean) : [];
      if (!targetGroups.length) throw new Error("YAML 中 spec.targetGroups 至少需要一个真实 NodeGroup");
      if (!containers.length || containers.some((container: any) => !container?.name || !container?.image)) throw new Error("YAML 中至少需要一个包含 name 和 image 的容器");
      const image = String(containers[0].image);
      await createBatchWorkloadTask({
        name,
        targetType: "deployment",
        targetRefs: targetGroups,
        image,
        failurePolicy: "continue",
        description: "YAML 批量工作负载计划",
        targets: [{ namespace, image, yaml: yamlText }],
        plan: {
          namespace,
          name,
          targetGroups,
          replicas: Math.max(1, Number(spec.replicas || 1)),
          workloadType: "Deployment",
          podTemplate: { containers },
        },
      });
      setYamlOpen(false);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建批量工作负载失败");
    }
  };

  const createFromImage = async (form: BatchImageCreateForm) => {
    const primaryImage = form.containers[0]?.image.trim() || "nginx:1.25-alpine";
    try {
      await createBatchWorkloadTask({
        name: form.name.trim() || `batch-image-${Date.now().toString().slice(-5)}`,
        targetType: "deployment",
        targetRefs: form.targetGroups,
        image: primaryImage,
        failurePolicy: "continue",
        description: form.description || "镜像批量工作负载计划",
        targets: [{
          namespace: form.namespace || "default",
          image: primaryImage,
          replicas: Number(form.replicas || 1),
          containers: form.containers,
          workloadLabels: form.workloadLabels,
          podLabels: form.podLabels,
          workloadAnnotations: form.workloadAnnotations,
          podAnnotations: form.podAnnotations,
          networkType: form.networkType,
          ports: form.ports,
          strategy: form.strategy,
        }],
        plan: toBatchWorkloadPlan(form, form.targetGroups),
      });
      setImageOpen(false);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建批量工作负载失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteBatchWorkload(deleteTarget.id);
      setDeleteTarget(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除批量工作负载失败");
    }
  };

  if (definitionTarget) {
    return (
      <div>
        <BatchWorkloadDetailPage
          item={definitionTarget}
          openDefinitionInitially={openDefinitionInitially}
          onBack={() => setDefinitionTarget(null)}
          onChanged={async () => {
            const detail = await getBatchWorkloadTask(definitionTarget.id);
            const next = toBatchWorkloadRow(detail.item) as BatchWorkload;
            setDefinitionTarget(next);
            await loadItems();
          }}
          onDelete={async () => {
            await deleteBatchWorkload(definitionTarget.id);
            setDefinitionTarget(null);
            await loadItems();
          }}
        />
        <ImageCreateDialog open={imageOpen} onOpenChange={setImageOpen} onCreate={createFromImage} />
      </div>
    );
  }

  return (
    <div className="page-container space-y-5">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">批量工作负载</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">面向多个目标批量部署边缘应用</p>
      </section>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}

      <section className="page-toolbar">
        <div className="toolbar-search relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索批量工作负载名称..."
            className="h-9 rounded-[10px] pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadItems(true)} disabled={loading || refreshing} className="action-button" title="刷新">
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || refreshing) && "animate-spin")} />
          </button>
          <Button variant="outline" onClick={() => setYamlOpen(true)} className="btn-secondary flex shrink-0 items-center gap-1.5 text-xs">
            YAML 创建
          </Button>
          <Button onClick={() => setImageOpen(true)} className="btn-black flex shrink-0 items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            镜像创建
          </Button>
        </div>
      </section>

      <section className="table-card overflow-x-auto">
        <Table className="min-w-[600px] table-fixed border-collapse">
          <TableHeader>
            <TableRow className="table-header-row bg-white hover:bg-white">
              <TableHead className="table-header-cell table-header-name w-[220px]">工作负载名称</TableHead>
              <TableHead className="table-header-cell w-[120px]">命名空间</TableHead>
              <TableHead className="table-header-cell w-[40%]">镜像</TableHead>
              <TableHead className="table-header-cell w-[160px]">创建时间</TableHead>
              <TableHead className="table-header-cell table-header-action w-[80px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center justify-center py-14 text-[var(--color-text-tertiary)]">
                    <Search className="mb-2 h-8 w-8" />
                    <span className="text-sm">暂无批量工作负载数据</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.id} className="table-row group cursor-pointer" onClick={() => { setOpenDefinitionInitially(false); setDefinitionTarget(item); }}>
                  <TableCell className="table-name-cell">
                    <span className="text-sm font-medium text-[#1e6bff]">{item.name}</span>
                  </TableCell>
                  <TableCell className="table-cell text-xs text-[#111827]">{item.namespace}</TableCell>
                  <TableCell className="table-cell">
                    <span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]" title={item.image}>{item.image}</span>
                  </TableCell>
                  <TableCell className="table-cell text-xs text-[var(--color-text-tertiary)]">{item.createTime}</TableCell>
                  <TableCell className="table-action-cell" onClick={(event) => event.stopPropagation()}>
                    <BatchWorkloadActions
                      open={menuOpenId === item.id}
                      onOpenChange={(open) => setMenuOpenId(open ? item.id : null)}
                      onView={() => {
                        setOpenDefinitionInitially(true);
                        setDefinitionTarget(item);
                        setMenuOpenId(null);
                      }}
                      onEditYaml={() => {
                        setEditYamlTarget(item);
                        setMenuOpenId(null);
                      }}
                      onDeploy={() => {
                        setDeployTarget(item);
                        setMenuOpenId(null);
                      }}
                      onDelete={() => {
                        setDeleteTarget(item);
                        setMenuOpenId(null);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <BatchYamlEditor open={yamlOpen} title="YAML 批量创建工作负载" defaultValue={defaultBatchYaml} onSubmit={createFromYaml} onCancel={() => setYamlOpen(false)} />
      <BatchYamlEditor
        open={!!editYamlTarget}
        title="编辑 YAML"
        defaultValue={editYamlTarget?.raw?.yaml || "# 暂无 Deployment YAML"}
        onSubmit={async (value) => {
          if (!editYamlTarget) return;
          try {
            await updateBatchWorkloadYaml(editYamlTarget.id, value);
            setEditYamlTarget(null);
            await loadItems();
          } catch (err) {
            setError(err instanceof Error ? err.message : "YAML 更新失败");
          }
        }}
        onCancel={() => setEditYamlTarget(null)}
      />
      <ImageCreateDialog open={imageOpen} onOpenChange={setImageOpen} onCreate={createFromImage} />
      <DeployDialog
        item={deployTarget}
        onOpenChange={(open) => !open && setDeployTarget(null)}
        onCreatePlan={async (plan) => {
          if (!deployTarget) return;
          await addBatchWorkloadDeployments(deployTarget.id, plan);
          await loadItems();
          setDeployTarget(null);
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除批量工作负载？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除 <span className="font-medium text-[var(--color-text-primary)]">{deleteTarget?.name}</span> 以及所有由它创建的真实 Deployment。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 bg-[var(--color-danger)] text-sm hover:bg-[var(--color-danger)]/90" onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BatchWorkloadActions({ open, onOpenChange, onView, onEditYaml, onDeploy, onDelete }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: () => void;
  onEditYaml: () => void;
  onDeploy: () => void;
  onDelete: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const toggleMenu = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 148;
      const menuHeight = 151;
      const viewportPadding = 12;
      const gap = 8;
      const canOpenDown = rect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding;
      setMenuPosition({
        top: canOpenDown ? rect.bottom + gap : Math.max(viewportPadding, rect.top - gap - menuHeight),
        left: Math.max(16, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 16)),
      });
    }
    onOpenChange(!open);
  };

  return (
    <div className="inline-block text-left align-middle">
      <button ref={buttonRef} type="button" className="action-button" onClick={toggleMenu} title="更多">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[70] cursor-default" onClick={() => onOpenChange(false)} aria-label="关闭菜单" />
          <div className="fixed z-[90] w-[148px] overflow-hidden rounded-2xl border border-[#eef2f7] bg-white py-1.5 text-left shadow-[0_18px_45px_rgba(15,23,42,0.14)]" style={{ top: menuPosition.top, left: menuPosition.left }}>
            <div className="px-1.5">
              <BatchActionMenuItem icon={<Eye className="h-3.5 w-3.5" />} label="查看定义" onClick={onView} />
              <BatchActionMenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="编辑 YAML" onClick={onEditYaml} />
              <BatchActionMenuItem icon={<Upload className="h-3.5 w-3.5" />} label="部署" onClick={onDeploy} />
            </div>
            <div className="my-1.5 border-t border-[#eef2f7]" />
            <div className="px-1.5"><BatchActionMenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} label="删除" onClick={onDelete} /></div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function BatchActionMenuItem({ icon, label, onClick, danger = false, disabled = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "当前版本暂不支持编辑已创建计划" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium hover:bg-[#f8fafc]",
        danger ? "text-[#64748b]" : "text-[#374151]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="text-[#94a3b8]">{icon}</span>
      {label}
    </button>
  );
}

function BatchYamlEditor({ open, title, defaultValue, onSubmit, onCancel }: { open: boolean; title: string; defaultValue: string; onSubmit: (yaml: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(defaultValue);
  const [fullscreen, setFullscreen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const lineCount = Math.max(value.split("\n").length, 1);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [defaultValue, open]);

  if (!open) return null;

  const download = () => {
    const blob = new Blob([value], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "batch-workload.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {!fullscreen && <div className="absolute inset-0 bg-black/40" onClick={onCancel} />}
      <div
        className={cn("relative flex flex-col overflow-hidden bg-white", fullscreen ? "fixed inset-0 h-full w-full" : "rounded-[24px] shadow-[0_24px_60px_rgba(16,24,40,0.10)]")}
        style={fullscreen ? undefined : { width: 920, height: "min(820px, calc(100vh - 48px))" }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5">
          <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setValue(String(reader.result || ""));
                reader.readAsText(file);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><Upload className="h-3.5 w-3.5" />上传</button>
            <button type="button" onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><Download className="h-3.5 w-3.5" />下载</button>
            <button type="button" onClick={() => setFullscreen((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{fullscreen ? "退出全屏" : "全屏"}</button>
            <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
            <button type="button" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)]"><X className="h-[18px] w-[18px]" /></button>
          </div>
        </div>

        <div className="mx-5 mt-4 flex shrink-0 items-center gap-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#3b82f6] text-xs font-semibold text-[#3b82f6]">i</span>
          <span>为保证工作负载能被正常调度，请先阅读</span>
          <a href="https://docs.daocloud.io/kant/user-guide/edge-app/create-app.html#yaml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#2563eb] hover:underline">
            YAML 创建须知 <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="mx-5 my-3 min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)]" style={{ backgroundColor: "#1e1e1e" }}>
          <div className="flex h-full min-h-0 overflow-hidden">
            <div className="w-12 shrink-0 select-none overflow-hidden text-right font-mono text-xs leading-6 text-[#858585]" style={{ backgroundColor: "#1e1e1e" }}>
              <div ref={lineGutterRef} className="py-3">
                {Array.from({ length: lineCount }, (_, index) => <div key={index} className="px-2">{index + 1}</div>)}
              </div>
            </div>
            <div className="relative min-w-0 flex-1">
              <pre
                ref={previewRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden p-3 font-mono text-xs leading-6"
                style={{ color: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 1 }}
                dangerouslySetInnerHTML={{ __html: highlightYaml(value) }}
              />
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onScroll={(event) => {
                  if (lineGutterRef.current) lineGutterRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                  if (previewRef.current) {
                    previewRef.current.scrollTop = event.currentTarget.scrollTop;
                    previewRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                }}
                spellCheck={false}
                className="absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-6 outline-none"
                style={{ color: "transparent", caretColor: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 2 }}
              />
            </div>
          </div>
        </div>

        <div className="flex h-16 shrink-0 items-center justify-end gap-3 border-t border-[var(--color-border)] px-5">
          <button type="button" onClick={onCancel} className="h-10 rounded-xl bg-[var(--color-bg-hover)] px-6 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[#eef2f7]">取消</button>
          <button type="button" onClick={() => onSubmit(value)} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">确定</button>
        </div>
      </div>
    </div>
  );
}

function ImageCreateDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (form: BatchImageCreateForm) => void }) {
  const formValidation = useRequiredFieldValidation<"name" | "namespace" | "replicas" | "containerName" | "containerImage">();
  const [step, setStep] = useState(0);
  const [advancedTab, setAdvancedTab] = useState(0);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [form, setForm] = useState<BatchImageCreateForm>(() => defaultBatchImageForm());
  const [namespaceOptions, setNamespaceOptions] = useState<Array<{ value: string; label: string }>>([{ value: "default", label: "default" }]);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [namespaceError, setNamespaceError] = useState("");

  const refreshNamespaces = async () => {
    setRefreshingNamespaces(true);
    setNamespaceError("");
    try {
      const items = (await listNamespaces()).filter((item) => item.value !== "all");
      if (items.length > 0) {
        setNamespaceOptions(items);
        setForm((current) => items.some((item) => item.value === current.namespace)
          ? current
          : { ...current, namespace: items[0].value });
      }
    } catch (err) {
      setNamespaceError(err instanceof Error ? err.message : "命名空间刷新失败");
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setAdvancedTab(0);
    setActiveContainerIndex(0);
    setForm(defaultBatchImageForm());
    formValidation.resetErrors();
    void refreshNamespaces();
  }, [open]);

  const close = () => onOpenChange(false);
  const activeContainer = form.containers[activeContainerIndex] || form.containers[0];

  const goToNextStep = () => {
    if (step === 0) {
      if (!formValidation.validate([
        { field: "name", valid: Boolean(form.name.trim()), message: "请输入批量工作负载名称", elementId: "batch-workload-name" },
        { field: "namespace", valid: Boolean(form.namespace.trim()), message: "请选择命名空间", elementId: "batch-workload-namespace" },
        { field: "replicas", valid: Number(form.replicas) > 0, message: "请输入大于 0 的实例数", elementId: "batch-workload-replicas" },
      ])) return;
    }
    if (step === 1) {
      const invalidIndex = form.containers.findIndex((container) => !container.name.trim() || !container.image.trim());
      if (invalidIndex >= 0) setActiveContainerIndex(invalidIndex);
      const container = invalidIndex >= 0 ? form.containers[invalidIndex] : activeContainer;
      if (!formValidation.validate([
        { field: "containerName", valid: Boolean(container?.name.trim()), message: "请输入容器名称", elementId: "batch-container-name" },
        { field: "containerImage", valid: Boolean(container?.image.trim()), message: "请输入容器镜像", elementId: "batch-container-image" },
      ])) return;
    }
    setStep((current) => current + 1);
  };

  const setContainers = (containers: BatchContainerForm[]) => {
    setForm((current) => ({ ...current, containers }));
  };

  const updateContainer = (patch: Partial<BatchContainerForm>) => {
    setContainers(form.containers.map((container, index) => index === activeContainerIndex ? { ...container, ...patch } : container));
  };

  const addContainer = () => {
    const next = createBatchContainer(form.containers.length);
    setContainers([...form.containers, next]);
    setActiveContainerIndex(form.containers.length);
  };

  const removeContainer = (indexToRemove: number) => {
    if (form.containers.length <= 1) return;
    const next = form.containers.filter((_, index) => index !== indexToRemove);
    setContainers(next);
    setActiveContainerIndex(Math.min(activeContainerIndex, next.length - 1));
  };

  const addPort = () => {
    const firstContainer = form.containers[0]?.name || "container-1";
    setForm((current) => ({
      ...current,
      ports: [...current.ports, { id: `port-${Date.now()}`, containerName: firstContainer, containerPort: "", hostPort: "" }],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : close()}>
      <DialogContent className="!flex h-[min(720px,calc(100vh-48px))] max-h-[min(720px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)] sm:max-w-none" showCloseButton={false}>
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-6 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">创建批量工作负载</DialogTitle>
            <button type="button" onClick={close} className="action-button h-8 w-8 rounded-[10px]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <BatchWizardSteps step={step} />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="space-y-4">
              <CreateField label="名称" required error={formValidation.errors.name} errorId="batch-workload-name-error">
                <Input id="batch-workload-name" value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }); formValidation.clearError("name"); }} placeholder="batch-nginx" aria-invalid={Boolean(formValidation.errors.name)} aria-describedby={formValidation.errors.name ? "batch-workload-name-error" : undefined} className="h-9 rounded-[10px] border border-[#dfe5ee] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">最长 63 个字符，必须由小写字母、数字字符、"-"或"."组成，且以字母或数字开头及结尾。</p>
              </CreateField>
              <CreateField label="命名空间" required error={formValidation.errors.namespace} errorId="batch-workload-namespace-error">
                <div className="flex gap-2">
                  <select id="batch-workload-namespace" value={form.namespace} onChange={(event) => { setForm({ ...form, namespace: event.target.value }); formValidation.clearError("namespace"); }} aria-invalid={Boolean(formValidation.errors.namespace)} aria-describedby={formValidation.errors.namespace ? "batch-workload-namespace-error" : undefined} className="blueedge-native-select h-9 flex-1 rounded-[10px] border text-sm">
                    <option value="">请选择命名空间</option>
                    {namespaceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <button type="button" onClick={() => void refreshNamespaces()} disabled={refreshingNamespaces} className="action-button h-9 w-9" title="刷新命名空间"><RefreshCw className={cn("h-[15px] w-[15px]", refreshingNamespaces && "animate-spin")} /></button>
                </div>
                {namespaceError && <p className="mt-2 text-xs text-[var(--color-danger)]">{namespaceError}</p>}
              </CreateField>
              <CreateField label="实例" required error={formValidation.errors.replicas} errorId="batch-workload-replicas-error">
                <Input id="batch-workload-replicas" type="number" min={1} value={form.replicas} onChange={(event) => { setForm({ ...form, replicas: event.target.value }); formValidation.clearError("replicas"); }} aria-invalid={Boolean(formValidation.errors.replicas)} aria-describedby={formValidation.errors.replicas ? "batch-workload-replicas-error" : undefined} className="h-9 rounded-[10px] border border-[#dfe5ee] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">任务完成可以容忍拉取镜像失败的节点数量占比</p>
              </CreateField>
              <CreateField label="描述">
                <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="批量工作负载用途描述（可选）" className="h-[120px] min-h-[120px] rounded-[10px] border border-[#dfe5ee] px-3 py-2 text-sm shadow-sm focus-visible:ring-0" />
              </CreateField>
            </div>
          )}

          {step === 1 && activeContainer && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {form.containers.map((container, index) => (
                  <button
                    key={container.id}
                    type="button"
                    onClick={() => setActiveContainerIndex(index)}
                    className={cn("inline-flex items-center gap-2 rounded-[10px] border px-4 py-2 text-sm font-semibold", index === activeContainerIndex ? "border-[1.5px] border-[#1a73e8] bg-[#f0f6ff] text-[#1a73e8]" : "border-[#e5e7eb] bg-white text-[#374151]")}
                  >
                    <Box className="h-3.5 w-3.5" />
                    {`容器 ${index + 1}`}
                    {form.containers.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeContainer(index);
                        }}
                        className="ml-1 rounded p-0.5 hover:bg-white/70 hover:text-[#ef4444]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                ))}
                <button type="button" onClick={addContainer} className="inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[#d1d5db] px-3 py-2 text-sm font-medium text-[#6b7280] hover:bg-[#f9fafb]"><Plus className="h-3.5 w-3.5" />添加容器</button>
              </div>

              <BatchAccordion title="基本信息" defaultOpen>
                <div className="grid grid-cols-2 gap-3">
                  <CreateField label="容器名称" required compact error={formValidation.errors.containerName} errorId="batch-container-name-error">
                    <Input id="batch-container-name" value={activeContainer.name} onChange={(event) => { updateContainer({ name: event.target.value }); formValidation.clearError("containerName"); }} placeholder="container-1" aria-invalid={Boolean(formValidation.errors.containerName)} aria-describedby={formValidation.errors.containerName ? "batch-container-name-error" : undefined} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                  </CreateField>
                  <CreateField label="容器镜像" required compact error={formValidation.errors.containerImage} errorId="batch-container-image-error">
                    <Input id="batch-container-image" value={activeContainer.image} onChange={(event) => { updateContainer({ image: event.target.value }); formValidation.clearError("containerImage"); }} placeholder="nginx:1.21" aria-invalid={Boolean(formValidation.errors.containerImage)} aria-describedby={formValidation.errors.containerImage ? "batch-container-image-error" : undefined} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                  </CreateField>
                  <CreateField label="镜像拉取策略" compact>
                    <select value={activeContainer.pullPolicy} onChange={(event) => updateContainer({ pullPolicy: event.target.value as BatchContainerForm["pullPolicy"] })} className="blueedge-native-select h-10 rounded-[10px] border-2 text-sm">
                      <option value="IfNotPresent">IfNotPresent</option>
                      <option value="Always">Always</option>
                      <option value="Never">Never</option>
                    </select>
                  </CreateField>
                  <label className="flex items-end gap-2 pb-2 text-sm text-[#111827]">
                    <input type="checkbox" checked={activeContainer.privileged} onChange={(event) => updateContainer({ privileged: event.target.checked })} className="h-4 w-4 rounded border-[#d1d5db]" />
                    特权容器
                  </label>
                </div>
              </BatchAccordion>

              <BatchAccordion title="资源配置">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <CreateField label="CPU 请求 (request)" compact>
                      <Input value={activeContainer.cpuRequest} onChange={(event) => updateContainer({ cpuRequest: event.target.value })} placeholder="500m 或 0.5" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                    <CreateField label="CPU 限制 (limit)" compact>
                      <Input value={activeContainer.cpuLimit} onChange={(event) => updateContainer({ cpuLimit: event.target.value })} placeholder="1000m 或 1" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                    <CreateField label="内存请求 (request)" compact>
                      <Input value={activeContainer.memoryRequest} onChange={(event) => updateContainer({ memoryRequest: event.target.value })} placeholder="256Mi" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                    <CreateField label="内存限制 (limit)" compact>
                      <Input value={activeContainer.memoryLimit} onChange={(event) => updateContainer({ memoryLimit: event.target.value })} placeholder="512Mi" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                  </div>
                  <div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#1e6bff]">
                      <input type="checkbox" checked={activeContainer.gpuEnabled} onChange={(event) => updateContainer({ gpuEnabled: event.target.checked })} className="h-4 w-4 rounded border-[#9ca3af] accent-[#1a73e8]" />
                      启用 GPU
                    </label>
                    {activeContainer.gpuEnabled && (
                      <div className="mt-3 grid grid-cols-2 gap-3 pl-5">
                        <CreateField label="GPU 类型" compact>
                          <Input value={activeContainer.gpuType} onChange={(event) => updateContainer({ gpuType: event.target.value })} placeholder="nvidia.com/gpu" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                        </CreateField>
                        <CreateField label="GPU 数量" compact>
                          <Input type="number" min={1} value={activeContainer.gpuCount} onChange={(event) => updateContainer({ gpuCount: Math.max(1, Number(event.target.value) || 1) })} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                        </CreateField>
                      </div>
                    )}
                  </div>
                </div>
              </BatchAccordion>

              <BatchAccordion title="生命周期">
                <div className="space-y-3">
                  <CreateField label="启动后执行 (Post Start)" compact>
                    <Input value={activeContainer.lifecyclePostStart} onChange={(event) => updateContainer({ lifecyclePostStart: event.target.value })} placeholder="/bin/sh -c 'echo started'" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                  </CreateField>
                  <CreateField label="停止前执行 (Pre Stop)" compact>
                    <Input value={activeContainer.lifecyclePreStop} onChange={(event) => updateContainer({ lifecyclePreStop: event.target.value })} placeholder="/bin/sh -c 'sleep 5'" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                  </CreateField>
                </div>
              </BatchAccordion>

              <BatchAccordion title="健康检查">
                <p className="mb-3 rounded-lg bg-[#eff6ff] px-3 py-2 text-xs leading-5 text-[#1d4ed8]">启用后会写入真实 Kubernetes Probe，使用容器内 /bin/sh 检查 /proc/1；不含 shell 的镜像请在创建后通过 YAML 改为 HTTP、TCP 或自定义 Exec 探针。</p>
                <div className="divide-y divide-[#eef2f7]">
                  <BatchCheckRow label="启用启动探针 (Startup)" checked={activeContainer.startupProbe} onChange={(checked) => updateContainer({ startupProbe: checked })} />
                  <BatchCheckRow label="启用就绪探针 (Readiness)" checked={activeContainer.readinessProbe} onChange={(checked) => updateContainer({ readinessProbe: checked })} />
                  <BatchCheckRow label="启用存活探针 (Liveness)" checked={activeContainer.livenessProbe} onChange={(checked) => updateContainer({ livenessProbe: checked })} />
                </div>
              </BatchAccordion>

              <BatchAccordion title="环境变量">
                <BatchKeyValueEditor
                  items={activeContainer.envs}
                  onChange={(items) => updateContainer({ envs: items })}
                  addText="添加"
                />
              </BatchAccordion>

              <BatchAccordion title="数据存储">
                <div className="space-y-3">
                  {activeContainer.volumes.length === 0 && <p className="text-xs text-[var(--color-text-tertiary)]">暂无挂载卷，点击下方按钮添加。</p>}
                  {activeContainer.volumes.map((volume, index) => (
                    <div key={volume.id} className="space-y-3 rounded-xl border border-[#e5e7eb] bg-[#fafbfc] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#111827]">卷 #{index + 1}</span>
                        <button type="button" onClick={() => updateContainer({ volumes: activeContainer.volumes.filter((item) => item.id !== volume.id) })} className="action-button h-9 w-9"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input value={volume.name} onChange={(event) => updateContainer({ volumes: activeContainer.volumes.map((item) => item.id === volume.id ? { ...item, name: event.target.value } : item) })} placeholder="卷名称" className="h-10 rounded-[10px] border-2 border-[#e2e8f0]" />
                        <select value={volume.type} onChange={(event) => updateContainer({ volumes: activeContainer.volumes.map((item) => item.id === volume.id ? { ...item, type: event.target.value as BatchContainerForm["volumes"][number]["type"] } : item) })} className="blueedge-native-select h-10 rounded-[10px] border-2 text-sm">
                          <option value="emptyDir">emptyDir</option>
                          <option value="hostPath">hostPath</option>
                          <option value="pvc">pvc</option>
                          <option value="configMap">configMap</option>
                          <option value="secret">secret</option>
                        </select>
                        <Input value={volume.mountPath} onChange={(event) => updateContainer({ volumes: activeContainer.volumes.map((item) => item.id === volume.id ? { ...item, mountPath: event.target.value } : item) })} placeholder="挂载路径" className="h-10 rounded-[10px] border-2 border-[#e2e8f0]" />
                        <Input value={volume.source} onChange={(event) => updateContainer({ volumes: activeContainer.volumes.map((item) => item.id === volume.id ? { ...item, source: event.target.value } : item) })} placeholder="源" className="h-10 rounded-[10px] border-2 border-[#e2e8f0]" />
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => updateContainer({ volumes: [...activeContainer.volumes, { id: `volume-${Date.now()}`, name: "", type: "emptyDir", mountPath: "", source: "" }] })} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
                    <Plus className="h-4 w-4" />
                    添加卷
                  </button>
                </div>
              </BatchAccordion>

              <BatchAccordion title="安全配置">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <CreateField label="RunAsUser" compact>
                      <Input value={activeContainer.runAsUser} onChange={(event) => updateContainer({ runAsUser: event.target.value })} placeholder="1000" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                    <CreateField label="RunAsGroup" compact>
                      <Input value={activeContainer.runAsGroup} onChange={(event) => updateContainer({ runAsGroup: event.target.value })} placeholder="1000" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                    </CreateField>
                  </div>
                  <div className="space-y-3">
                    <BatchCheckRow label="只读根文件系统" checked={activeContainer.readOnlyRootFilesystem} onChange={(checked) => updateContainer({ readOnlyRootFilesystem: checked })} compact />
                    <BatchCheckRow label="允许特权提升" checked={activeContainer.allowPrivilegeEscalation} onChange={(checked) => updateContainer({ allowPrivilegeEscalation: checked })} compact />
                  </div>
                </div>
              </BatchAccordion>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex gap-1 rounded-lg bg-[#f4f5f7] p-1">
                {["标签与注解", "访问配置", "升级策略"].map((tab, index) => (
                  <button key={tab} type="button" onClick={() => setAdvancedTab(index)} className="flex-1 rounded-md py-1.5 text-sm font-semibold transition-all" style={{ background: advancedTab === index ? "#fff" : "transparent", color: advancedTab === index ? "#1a73e8" : "#6b7280", boxShadow: advancedTab === index ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                    {tab}
                  </button>
                ))}
              </div>

              {advancedTab === 0 && (
                <div className="space-y-5">
                  <BatchKeyValueSection title="工作负载标签" items={form.workloadLabels} onChange={(items) => setForm({ ...form, workloadLabels: items })} />
                  <BatchKeyValueSection title="容器组标签" items={form.podLabels} onChange={(items) => setForm({ ...form, podLabels: items })} />
                  <BatchKeyValueSection title="工作负载注解" items={form.workloadAnnotations} onChange={(items) => setForm({ ...form, workloadAnnotations: items })} />
                  <BatchKeyValueSection title="容器组注解" items={form.podAnnotations} onChange={(items) => setForm({ ...form, podAnnotations: items })} />
                </div>
              )}

              {advancedTab === 1 && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-sm font-medium text-[#111827]">网络模式</p>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["none", "不可访问", "工作负载不可访问"],
                        ["portmap", "端口映射", "流量映射到容器端口"],
                        ["host", "主机网络", "使用边缘节点网络"],
                      ] as const).map(([value, label, desc]) => (
                        <button key={value} type="button" onClick={() => setForm({ ...form, networkType: value, ports: value === "portmap" && form.ports.length === 0 ? [{ id: `port-${Date.now()}`, containerName: form.containers[0]?.name || "main", containerPort: "", hostPort: "" }] : form.ports })} className={cn("rounded-lg border p-3 text-left", form.networkType === value ? "border-[#1a73e8] bg-[#f0f6ff]" : "border-[#e5e7eb] bg-white")}>
                          <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                            <span className={cn("h-3.5 w-3.5 rounded-full border", form.networkType === value ? "border-[5px] border-[#1a73e8]" : "border-[#9ca3af]")} />
                            {label}
                          </div>
                          <p className="mt-1 pl-5 text-[11px] leading-5 text-[var(--color-text-secondary)]">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.networkType === "portmap" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-[#111827]">端口映射</p>
                        <button type="button" onClick={addPort} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e6bff]"><Plus className="h-3.5 w-3.5" />添加</button>
                      </div>
                      {form.ports.map((port) => (
                        <div key={port.id} className="grid grid-cols-[1.2fr_1fr_1fr_36px] gap-2 rounded-lg border border-[#e5e7eb] bg-[#fafbfc] p-3">
                          <select value={port.containerName} onChange={(event) => setForm({ ...form, ports: form.ports.map((item) => item.id === port.id ? { ...item, containerName: event.target.value } : item) })} className="blueedge-native-select h-9 rounded-[10px] border-2 text-sm">
                            {form.containers.map((container, index) => <option key={container.id} value={container.name || `container-${index + 1}`}>{container.name || `容器 ${index + 1}`}</option>)}
                          </select>
                          <Input value={port.containerPort} onChange={(event) => setForm({ ...form, ports: form.ports.map((item) => item.id === port.id ? { ...item, containerPort: event.target.value } : item) })} placeholder="容器端口" className="h-9 rounded-[10px] border-2" />
                          <Input value={port.hostPort} onChange={(event) => setForm({ ...form, ports: form.ports.map((item) => item.id === port.id ? { ...item, hostPort: event.target.value } : item) })} placeholder="主机端口" className="h-9 rounded-[10px] border-2" />
                          <button type="button" onClick={() => setForm({ ...form, ports: form.ports.filter((item) => item.id !== port.id) })} className="action-button h-9 w-9"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {advancedTab === 2 && (
                <div className="rounded-xl border border-[#e5e7eb] bg-white p-4">
                  <CreateField label="升级方式">
                    <select value={form.strategy} onChange={(event) => setForm({ ...form, strategy: event.target.value as BatchImageCreateForm["strategy"] })} className="blueedge-native-select h-11 rounded-[10px] border-2 text-sm">
                      <option value="RollingUpdate">滚动升级（RollingUpdate）</option>
                      <option value="Recreate">重建升级 (Recreate)</option>
                    </select>
                  </CreateField>
                  <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                    <BatchStrategyNumberField
                      label="最大无效 Pod 数"
                      required
                      value={form.maxUnavailable}
                      unit={form.maxUnavailableUnit}
                      helper="滚动升级最大无效 Pod 数。"
                      onValueChange={(value) => setForm({ ...form, maxUnavailable: value })}
                      onUnitChange={(unit) => setForm({ ...form, maxUnavailableUnit: unit })}
                    />
                    <BatchStrategyNumberField
                      label="最大浪涌"
                      required
                      value={form.maxSurge}
                      unit={form.maxSurgeUnit}
                      helper="每次滚动升级允许超出所需规模的最大 Pod 数。"
                      onValueChange={(value) => setForm({ ...form, maxSurge: value })}
                      onUnitChange={(unit) => setForm({ ...form, maxSurgeUnit: unit })}
                    />
                    <BatchStrategyTextField
                      label="最大保留版本数"
                      value={form.revisionHistoryLimit}
                      onChange={(value) => setForm({ ...form, revisionHistoryLimit: value })}
                    />
                    <BatchStrategyTextField
                      label="Pod 可用最短时间"
                      required
                      value={form.minReadySeconds}
                      suffix="秒"
                      helper="Pod 就绪后持续超出该时间才被认为可用。"
                      onChange={(value) => setForm({ ...form, minReadySeconds: value })}
                    />
                    <BatchStrategyTextField
                      label="升级最大持续时间"
                      required
                      value={form.progressDeadlineSeconds}
                      suffix="秒"
                      helper="标记 deployment 失败前，等待部署进行的最小持续时间。"
                      onChange={(value) => setForm({ ...form, progressDeadlineSeconds: value })}
                    />
                    <BatchStrategyTextField
                      label="缩容时间窗"
                      required
                      value={form.terminationGracePeriodSeconds}
                      suffix="秒"
                      helper="工作负载停止前命令的执行时间窗（0-9,999 秒）。"
                      onChange={(value) => setForm({ ...form, terminationGracePeriodSeconds: value })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="h-16 shrink-0 border-t border-[#f0f1f3] bg-white px-6 py-0">
          <div className="flex w-full items-center justify-between">
            <div>
              {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="btn-secondary text-sm">上一步</button>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={close} className="btn-secondary text-sm">取消</button>
              {step < 2 ? (
                <button type="button" onClick={goToNextStep} className="btn-black text-sm">下一步</button>
              ) : (
                <button type="button" onClick={() => onCreate(form)} className="btn-black text-sm">创建</button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchWizardSteps({ step }: { step: number }) {
  const steps = [
    { label: "基础信息", icon: Settings },
    { label: "容器配置", icon: Box },
    { label: "高级配置", icon: Server },
  ];

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#f0f1f3] px-6 py-4">
      {steps.map((item, index) => (
        <div key={item.label} className="flex flex-1 items-center gap-2 last:flex-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: index === step ? "#1a73e8" : index < step ? "#dcfce7" : "#f3f4f6", color: index === step ? "#fff" : index < step ? "#16a34a" : "#9ca3af" }}>
            <item.icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold" style={{ color: index === step ? "#1a73e8" : index < step ? "#16a34a" : "#9ca3af" }}>{item.label}</span>
          {index < steps.length - 1 && <div className="h-px flex-1" style={{ background: index < step ? "#dcfce7" : "#f3f4f6" }} />}
        </div>
      ))}
    </div>
  );
}

function BatchCheckRow({ label, checked, onChange, compact = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; compact?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 text-[#111827]", compact ? "py-1 text-sm" : "min-h-12 text-sm")}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-[#d1d5db]" />
      {label}
    </label>
  );
}

function BatchStrategyNumberField({
  label,
  required,
  value,
  unit,
  helper,
  onValueChange,
  onUnitChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  unit: "%" | "个";
  helper: string;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: "%" | "个") => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#4b5563]">
        {label}
        {required && <span className="ml-1 text-[#ff4d4f]">*</span>}
      </Label>
      <div className="grid grid-cols-[1fr_76px] gap-2">
        <Input value={value} onChange={(event) => onValueChange(event.target.value)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        <select value={unit} onChange={(event) => onUnitChange(event.target.value as "%" | "个")} className="blueedge-native-select h-10 rounded-[10px] border-2 text-sm">
          <option value="%">%</option>
          <option value="个">个</option>
        </select>
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">{helper}</p>
    </div>
  );
}

function BatchStrategyTextField({
  label,
  required,
  value,
  suffix,
  helper,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  suffix?: string;
  helper?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#4b5563]">
        {label}
        {required && <span className="ml-1 text-[#ff4d4f]">*</span>}
      </Label>
      <div className={cn("grid items-center gap-2", suffix ? "grid-cols-[1fr_28px]" : "grid-cols-1")}>
        <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
        {suffix && <span className="text-sm text-[#4b5563]">{suffix}</span>}
      </div>
      {helper && <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">{helper}</p>}
    </div>
  );
}

function BatchAccordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-12 w-full items-center justify-between bg-[#fafbfc] px-4 text-left text-sm font-semibold text-[#111827]">
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-[#9ca3af]" /> : <ChevronDown className="h-4 w-4 text-[#9ca3af]" />}
      </button>
      {open && <div className="border-t border-[#eef2f7] p-4">{children}</div>}
    </div>
  );
}

function BatchKeyValueSection({ title, items, onChange }: { title: string; items: BatchKeyValue[]; onChange: (items: BatchKeyValue[]) => void }) {
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-[#111827]">{title}</h3>
      <BatchKeyValueEditor items={items} onChange={onChange} addText="添加" emptyText="暂无数据" />
    </div>
  );
}

function BatchKeyValueEditor({ items, onChange, addText, emptyText }: { items: BatchKeyValue[]; onChange: (items: BatchKeyValue[]) => void; addText: string; emptyText?: string }) {
  const update = (id: string, patch: Partial<BatchKeyValue>) => {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && emptyText && <div className="rounded-lg border border-dashed border-[#d1d5db] bg-[#fafbfc] px-3 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{emptyText}</div>}
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[1fr_1fr_40px] gap-2">
          <Input value={item.key} onChange={(event) => update(item.id, { key: event.target.value })} placeholder="键" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          <Input value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} placeholder="值" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
          <button type="button" onClick={() => onChange(items.filter((current) => current.id !== item.id))} className="action-button h-10 w-10"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { id: `kv-${Date.now()}`, key: "", value: "" }])} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
        <Plus className="h-4 w-4" />
        {addText}
      </button>
    </div>
  );
}

function liveStatusText(status: string) {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "partialSuccess") return "部分成功";
  if (status === "running") return "执行中";
  return "待执行";
}

function LiveStatusBadge({ status }: { status: string }) {
  const success = status === "succeeded";
  const failed = status === "failed";
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", success ? "bg-[#dcfce7] text-[#16a34a]" : failed ? "bg-[#fee2e2] text-[#dc2626]" : "bg-[#fef3c7] text-[#d97706]") }>
      <span className={cn("h-1.5 w-1.5 rounded-full", success ? "bg-[#22c55e]" : failed ? "bg-[#ef4444]" : "bg-[#f59e0b]")} />
      {liveStatusText(status)}
    </span>
  );
}

function displayTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function BatchWorkloadDetailPage({ item, openDefinitionInitially, onBack, onChanged, onDelete }: {
  item: BatchWorkload;
  openDefinitionInitially?: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<BatchWorkload>(item);
  const [activeTab, setActiveTab] = useState<"instances" | "events" | "audit" | "yaml">("instances");
  const [events, setEvents] = useState<BatchWorkloadEvent[]>([]);
  const [eventSummary, setEventSummary] = useState({ total: 0, warning: 0 });
  const [audit, setAudit] = useState<BatchWorkloadAuditItem[]>([]);
  const [auditWarning, setAuditWarning] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [definitionOpen, setDefinitionOpen] = useState(Boolean(openDefinitionInitially));
  const [deployOpen, setDeployOpen] = useState(false);
  const [yamlEditorOpen, setYamlEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deploymentToDelete, setDeploymentToDelete] = useState<string | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getBatchWorkloadTask(item.id);
      setDetail(toBatchWorkloadRow(response.item) as BatchWorkload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量工作负载详情加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDetail(); }, [item.id]);
  useEffect(() => {
    if (activeTab === "events") {
      void getBatchWorkloadEvents(item.id).then((response) => { setEvents(response.items); setEventSummary(response.summary); }).catch((err) => setError(err instanceof Error ? err.message : "事件加载失败"));
    }
    if (activeTab === "audit") {
      void getBatchWorkloadAudit(item.id).then((response) => { setAudit(response.items); setAuditWarning(response.warning || ""); }).catch((err) => setError(err instanceof Error ? err.message : "审计记录加载失败"));
    }
  }, [activeTab, item.id]);

  const raw = detail.raw;
  const workloads = raw?.workloads || [];
  const filteredWorkloads = workloads.filter((workload) => !search.trim() || [workload.name, workload.nodeGroup, workload.image].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())));

  if (definitionOpen) {
    return <BatchWorkloadDefinitionPage item={detail} onBack={() => setDefinitionOpen(false)} onChanged={async () => { await loadDetail(); await onChanged(); }} onEditYaml={() => { setDefinitionOpen(false); setActiveTab("yaml"); setYamlEditorOpen(true); }} />;
  }

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <div className="flex items-center gap-3"><h1 className="text-lg font-semibold text-[#111827]">{detail.name}</h1><LiveStatusBadge status={raw?.status || "pending"} /></div>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{detail.namespace} · {detail.image || "-"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDefinitionOpen(true)} className="btn-black flex items-center gap-1.5 text-xs"><Eye className="h-[13px] w-[13px]" />查看定义</button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="btn-danger-outline flex items-center gap-1.5 text-xs"><Trash2 className="h-[13px] w-[13px]" />删除</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{error}</div>}

      <DefinitionSection title="基本信息">
        <div className="grid grid-cols-4 gap-8">
          <InfoField label="批量工作负载名称" value={detail.name} />
          <InfoField label="命名空间" value={detail.namespace} />
          <InfoField label="创建时间" value={detail.createTime} />
          <InfoField label="描述" value={detail.description || "-"} />
        </div>
      </DefinitionSection>

      <div className="flex items-center gap-2">
        <DefinitionTab active={activeTab === "instances"} icon={<Server className="h-4 w-4" />} label="工作负载实例" onClick={() => setActiveTab("instances")} />
        <DefinitionTab active={activeTab === "events"} icon={<Bug className="h-4 w-4" />} label="事件" onClick={() => setActiveTab("events")} />
        <DefinitionTab active={activeTab === "audit"} icon={<ClipboardList className="h-4 w-4" />} label="审计" onClick={() => setActiveTab("audit")} />
        <DefinitionTab active={activeTab === "yaml"} icon={<FileCode2 className="h-4 w-4" />} label="YAML" onClick={() => setActiveTab("yaml")} />
      </div>

      {activeTab === "instances" && (
        <DefinitionSection title="工作负载实例">
          <div className="page-toolbar mb-4">
            <div className="toolbar-search relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工作负载实例" className="h-9 rounded-[10px] pl-9 text-sm" /></div>
            <div className="flex gap-2"><button type="button" onClick={() => void loadDetail()} className="action-button" title="刷新"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button><button type="button" onClick={() => setDeployOpen(true)} className="btn-black flex items-center gap-1.5 text-xs"><Plus className="h-3.5 w-3.5" />新增部署</button></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#e8ebf0]">
            <Table><TableHeader><TableRow className="bg-[#fafbfc]"><TableHead className="px-5">工作负载名称</TableHead><TableHead>节点组名称</TableHead><TableHead>实例</TableHead><TableHead>状态</TableHead><TableHead>镜像</TableHead><TableHead className="w-[88px] text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>{filteredWorkloads.length ? filteredWorkloads.map((workload) => <TableRow key={workload.name} className="h-[76px]"><TableCell className="px-5 font-semibold text-[#1e6bff]">{workload.name}</TableCell><TableCell>{workload.nodeGroup || "-"}</TableCell><TableCell>{workload.readyReplicas}/{workload.replicas}</TableCell><TableCell><LiveStatusBadge status={workload.status} /></TableCell><TableCell><ImageChip text={workload.image} /></TableCell><TableCell className="text-right"><button type="button" title="删除这个 Deployment" onClick={() => setDeploymentToDelete(workload.name)} className="action-button h-9 w-9"><Trash2 className="h-4 w-4" /></button></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-14 text-center text-sm text-[var(--color-text-tertiary)]">暂无工作负载实例</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
        </DefinitionSection>
      )}

      {activeTab === "events" && (
        <DefinitionSection title="事件">
          <div className="mb-4 flex items-center justify-between"><p className="text-sm text-[var(--color-text-secondary)]">展示真实 Kubernetes Deployment 事件</p><div className="flex gap-2"><span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs">总数 {eventSummary.total}</span><span className="rounded-full bg-[#fef2f2] px-3 py-1 text-xs text-[#dc2626]">异常 {eventSummary.warning}</span></div></div>
          <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="px-5">事件级别</TableHead><TableHead>组件</TableHead><TableHead>对象</TableHead><TableHead>事件名称</TableHead><TableHead>详细描述</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{events.length ? events.map((event) => <TableRow key={`${event.name}-${event.time}`} className="h-[72px]"><TableCell className="px-5"><span className={cn("rounded-full px-3 py-1 text-xs", event.type === "Warning" ? "bg-[#fef2f2] text-[#dc2626]" : "bg-[#f3f4f6] text-[#64748b]")}>{event.type}</span></TableCell><TableCell>{event.component}</TableCell><TableCell>{event.object}</TableCell><TableCell className="font-semibold">{event.reason}</TableCell><TableCell className="max-w-[360px] truncate">{event.message}</TableCell><TableCell className="text-[var(--color-text-tertiary)]">{displayTime(event.time)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-14 text-center text-sm text-[var(--color-text-tertiary)]">暂无 Kubernetes 事件</TableCell></TableRow>}</TableBody></Table></div>
        </DefinitionSection>
      )}

      {activeTab === "audit" && (
        <DefinitionSection title="审计">
          {auditWarning && <div className="mb-4 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">{auditWarning}</div>}
          <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="px-5">操作</TableHead><TableHead>结果</TableHead><TableHead>操作方</TableHead><TableHead>请求方法</TableHead><TableHead>来源 IP</TableHead><TableHead>时间</TableHead></TableRow></TableHeader><TableBody>{audit.length ? audit.map((entry, index) => <TableRow key={`${entry.action}-${entry.time}-${index}`} className="h-[72px]"><TableCell className="px-5 font-semibold">{entry.action}</TableCell><TableCell><LiveStatusBadge status={entry.result === "success" ? "succeeded" : "failed"} /></TableCell><TableCell>{entry.actor}</TableCell><TableCell><span className="rounded-md bg-[#f3f4f6] px-2 py-1 font-mono text-xs">{entry.method}</span></TableCell><TableCell>{entry.sourceIP}</TableCell><TableCell className="text-[var(--color-text-tertiary)]">{displayTime(entry.time)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="py-14 text-center text-sm text-[var(--color-text-tertiary)]">暂无 managedFields 记录</TableCell></TableRow>}</TableBody></Table></div>
        </DefinitionSection>
      )}

      {activeTab === "yaml" && (
        <DefinitionSection title="YAML">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-sm text-[var(--color-text-secondary)]">当前展示由平台真实创建的 apps/v1 Deployment 定义</p><div className="mt-5 grid grid-cols-4 gap-10"><InfoField label="资源类型" value="Deployment 集合" /><InfoField label="资源名称" value={detail.name} /><InfoField label="命名空间" value={detail.namespace} /><InfoField label="版本状态" value={<LiveStatusBadge status={raw?.status || "pending"} />} /></div></div><button type="button" onClick={() => setYamlEditorOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white"><Pencil className="h-4 w-4" />编辑 YAML</button></div>
          <pre className="max-h-[620px] overflow-auto rounded-2xl bg-[#0f1a2d] p-6 font-mono text-sm leading-6 text-[#d4d9e2]">{raw?.yaml || "# 暂无 Deployment YAML"}</pre>
        </DefinitionSection>
      )}

      <DeployDialog item={deployOpen ? detail : null} onOpenChange={setDeployOpen} onCreatePlan={async (plan) => { await addBatchWorkloadDeployments(item.id, plan); setDeployOpen(false); await loadDetail(); await onChanged(); }} />
      <BatchYamlEditor open={yamlEditorOpen} title="编辑 YAML" defaultValue={raw?.yaml || ""} onSubmit={async (value) => { try { await updateBatchWorkloadYaml(item.id, value); setYamlEditorOpen(false); await loadDetail(); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "YAML 更新失败"); } }} onCancel={() => setYamlEditorOpen(false)} />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除批量工作负载？</AlertDialogTitle><AlertDialogDescription>将删除该批次下所有真实 Deployment 和平台控制记录，操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={() => void onDelete()}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={!!deploymentToDelete} onOpenChange={(open) => !open && setDeploymentToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除 Deployment？</AlertDialogTitle><AlertDialogDescription>将从 Kubernetes 删除真实资源 <span className="font-semibold text-[#111827]">{deploymentToDelete}</span>，对应节点组之后可以重新新增部署。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={async () => { if (!deploymentToDelete) return; try { await deleteBatchWorkloadDeployment(item.id, deploymentToDelete); setDeploymentToDelete(null); await loadDetail(); await onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "Deployment 删除失败"); } }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}

function BatchWorkloadDefinitionPage({ item, onBack, onEditYaml, onChanged }: { item: BatchWorkload; onBack: () => void; onEditYaml?: () => void; onChanged: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<"containers" | "labels" | "access">("containers");
  const [containerTab, setContainerTab] = useState<"base" | "lifecycle" | "health" | "env" | "storage" | "security">("base");
  const [definitionName, setDefinitionName] = useState("");
  const [containerName, setContainerName] = useState("");
  const [basicEditOpen, setBasicEditOpen] = useState(false);
  const [description, setDescription] = useState(item.description || "");
  const [savingBasic, setSavingBasic] = useState(false);
  const [editError, setEditError] = useState("");
  const definitions = (item.raw?.definitions || []) as Array<Record<string, any>>;
  const definition = definitions.find((entry) => entry?.metadata?.name === definitionName) || definitions[0];
  const podSpec = definition?.spec?.template?.spec || {};
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers : [];
  const container = containers.find((entry: any) => entry?.name === containerName) || containers[0];

  useEffect(() => {
    const nextDefinitionName = String(definitions[0]?.metadata?.name || "");
    if (!definitions.some((entry) => entry?.metadata?.name === definitionName)) setDefinitionName(nextDefinitionName);
  }, [definitionName, definitions]);

  useEffect(() => {
    const nextContainerName = String(containers[0]?.name || "");
    if (!containers.some((entry: any) => entry?.name === containerName)) setContainerName(nextContainerName);
  }, [containerName, containers]);

  useEffect(() => setDescription(item.description || ""), [item.description]);

  const planValue = (value: unknown) => value === undefined || value === null || value === "" ? "未配置" : String(value);
  const booleanValue = (value: unknown) => value === true ? "已启用" : value === false ? "未启用" : "未配置";
  const keyValueText = (value: unknown) => Array.isArray(value) && value.length
    ? value.map((entry) => {
      const item = entry as Partial<BatchKeyValue> & { name?: string };
      const name = item.name || item.key;
      return name ? `${name}=${item.value || ""}` : "";
    }).filter(Boolean)
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}=${String(item)}`)
      : [];
  const workloadLabels = definition?.metadata?.labels;
  const podLabels = definition?.spec?.template?.metadata?.labels;
  const workloadAnnotations = definition?.metadata?.annotations;
  const podAnnotations = definition?.spec?.template?.metadata?.annotations;
  const probeText = (probe: any) => {
    if (!probe) return "未配置";
    if (probe.httpGet) return `HTTP ${probe.httpGet.path || "/"} · 端口 ${probe.httpGet.port}`;
    if (probe.tcpSocket) return `TCP · 端口 ${probe.tcpSocket.port}`;
    if (probe.exec?.command) return `Exec ${probe.exec.command.join(" ")}`;
    if (probe.grpc) return `gRPC · 端口 ${probe.grpc.port}`;
    return "已配置";
  };
  const probeTiming = (probe: any) => probe ? `延迟 ${probe.initialDelaySeconds || 0}s · 周期 ${probe.periodSeconds || 10}s · 超时 ${probe.timeoutSeconds || 1}s` : "未配置";
  const lifecycleText = (handler: any) => handler?.exec?.command?.length ? `Exec ${handler.exec.command.join(" ")}` : handler?.httpGet ? `HTTP ${handler.httpGet.path || "/"}` : handler?.tcpSocket ? `TCP ${handler.tcpSocket.port}` : "未配置";
  const securityContext = { ...(podSpec.securityContext || {}), ...(container?.securityContext || {}) };
  const volumeMounts = Array.isArray(container?.volumeMounts) ? container.volumeMounts : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes : [];
  const ports = containers.flatMap((entry: any) => (entry.ports || []).map((port: any) => `${entry.name}:${port.containerPort}${port.hostPort ? ` → 主机 ${port.hostPort}` : ""}/${port.protocol || "TCP"}`));
  const containerTabs = [
    { id: "base", label: "基本信息" },
    { id: "lifecycle", label: "生命周期" },
    { id: "health", label: "健康检查" },
    { id: "env", label: "环境变量" },
    { id: "storage", label: "数据储存" },
    { id: "security", label: "安全设置" },
  ] as const;

  const renderContainerDefinition = () => {
    if (!container) return <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">当前真实 Deployment 没有容器配置</div>;
    if (containerTab === "lifecycle") return <DefinitionGrid items={[["启动后处理", lifecycleText(container.lifecycle?.postStart)], ["停止前处理", lifecycleText(container.lifecycle?.preStop)], ["启动命令", planValue(container.command?.join(" "))], ["运行参数", planValue(container.args?.join(" "))]]} />;
    if (containerTab === "health") return <DefinitionGrid items={[["存活检查", probeText(container.livenessProbe)], ["存活检查参数", probeTiming(container.livenessProbe)], ["就绪检查", probeText(container.readinessProbe)], ["就绪检查参数", probeTiming(container.readinessProbe)], ["启动检查", probeText(container.startupProbe)], ["启动检查参数", probeTiming(container.startupProbe)]]} />;
    if (containerTab === "env") {
      const envs = (container.env || []).map((env: any) => env.valueFrom ? `${env.name}=${JSON.stringify(env.valueFrom)}` : `${env.name}=${env.value ?? ""}`);
      return <DefinitionGrid items={envs.length ? envs.map((value: string, index: number) => [`环境变量 ${index + 1}`, value]) : [["环境变量", "未配置"]]} />;
    }
    if (containerTab === "storage") {
      return <DefinitionGrid items={volumeMounts.length ? volumeMounts.map((mount: any, index: number) => {
        const volume = volumes.find((entry: any) => entry.name === mount.name) || {};
        const volumeType = Object.keys(volume).find((key) => key !== "name") || "未知";
        return [`挂载卷 ${index + 1}`, `${mount.name} · ${volumeType} · ${mount.mountPath}${mount.readOnly ? " · 只读" : ""}`];
      }) : [["挂载卷", "未配置"]]} />;
    }
    if (containerTab === "security") return <DefinitionGrid items={[["特权模式", booleanValue(securityContext.privileged)], ["只读根文件系统", booleanValue(securityContext.readOnlyRootFilesystem)], ["运行用户", planValue(securityContext.runAsUser)], ["运行用户组", planValue(securityContext.runAsGroup)], ["权限提升", booleanValue(securityContext.allowPrivilegeEscalation)], ["ServiceAccount", planValue(podSpec.serviceAccountName)]]} />;
    return <DefinitionGrid items={[["容器镜像", planValue(container.image || item.image)], ["镜像拉取策略", planValue(container.imagePullPolicy)], ["CPU 请求/限制", `${planValue(container.resources?.requests?.cpu)} / ${planValue(container.resources?.limits?.cpu)}`], ["内存请求/限制", `${planValue(container.resources?.requests?.memory)} / ${planValue(container.resources?.limits?.memory)}`]]} />;
  };

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-lg font-semibold text-[#111827]">查看定义</h1>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.name}</p>
          </div>
        </div>
        <button type="button" onClick={onEditYaml} className="btn-black flex items-center gap-1.5 text-xs">
          <Pencil className="h-[13px] w-[13px]" />
          编辑YAML
        </button>
      </div>

      <DefinitionSection title="基本信息" onEdit={() => { setEditError(""); setDescription(item.description || ""); setBasicEditOpen(true); }}>
        <div className="grid grid-cols-4 gap-x-8 gap-y-5">
          <InfoField label="批量工作负载名称" value={item.name} />
          <InfoField label="命名空间" value={item.namespace} />
          <InfoField label="创建时间" value={item.createTime} />
          <InfoField label="描述" value={item.description || "-"} />
        </div>
      </DefinitionSection>

      <div className="flex items-center gap-2">
        <DefinitionTab active={activeTab === "containers"} icon={<Server className="h-4 w-4" />} label="容器配置" onClick={() => setActiveTab("containers")} />
        <DefinitionTab active={activeTab === "labels"} icon={<Tag className="h-4 w-4" />} label="标签与注解" onClick={() => setActiveTab("labels")} />
        <DefinitionTab active={activeTab === "access"} icon={<Settings className="h-4 w-4" />} label="访问设置" onClick={() => setActiveTab("access")} />
      </div>

      {activeTab === "containers" && (
        <DefinitionSection title="容器配置" onEdit={onEditYaml}>
          {definitions.length > 1 && <div className="mb-4 flex items-center gap-3"><span className="text-xs font-medium text-[var(--color-text-secondary)]">Deployment</span><select value={definition?.metadata?.name || ""} onChange={(event) => setDefinitionName(event.target.value)} className="blueedge-native-select h-10 min-w-[280px] rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm">{definitions.map((entry) => <option key={entry.metadata?.name} value={entry.metadata?.name}>{entry.metadata?.name}</option>)}</select></div>}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {containerTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setContainerTab(tab.id)}
                className={containerTab === tab.id ? "btn-tab-active" : "btn-tab"}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-[#f0f1f3] bg-[#f8f9fb] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111827]">{containerTabs.find((tab) => tab.id === containerTab)?.label}</span>
              <div className="flex items-center gap-2">{containers.length > 1 && <select value={container?.name || ""} onChange={(event) => setContainerName(event.target.value)} className="blueedge-native-select h-8 rounded-lg border bg-white px-2 text-xs">{containers.map((entry: any) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select>}<ImageChip text={container?.image || item.image} /></div>
            </div>
            {renderContainerDefinition()}
          </div>
        </DefinitionSection>
      )}

      {activeTab === "labels" && (
        <DefinitionSection title="标签与注解" onEdit={onEditYaml}>
          <div className="grid grid-cols-2 gap-4">
            {[["工作负载标签", workloadLabels], ["容器组标签", podLabels], ["工作负载注释", workloadAnnotations], ["容器组注释", podAnnotations]].map(([label, values]) => (
              <div key={String(label)} className="rounded-2xl border border-[#f0f1f3] bg-[#f8f9fb] p-4">
                <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">{String(label)}</p>
                <div className="flex flex-wrap gap-2">
                  {keyValueText(values).length ? keyValueText(values).map((value) => <span key={value} className="inline-flex rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs text-[#374151]">{value}</span>) : <span className="text-sm text-[var(--color-text-tertiary)]">未配置</span>}
                </div>
              </div>
            ))}
          </div>
        </DefinitionSection>
      )}

      {activeTab === "access" && (
        <DefinitionSection title="访问配置" onEdit={onEditYaml}>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="网络模式" value={podSpec.hostNetwork ? "HostNetwork" : "Pod 网络"} />
            <InfoField label="DNS 策略" value={planValue(podSpec.dnsPolicy)} />
            <InfoField label="容器端口" value={ports.length ? ports.join("；") : "未配置"} />
            <InfoField label="Service / 负载均衡" value="当前批量工作负载未创建 Service" />
          </div>
        </DefinitionSection>
      )}

      <Dialog open={basicEditOpen} onOpenChange={setBasicEditOpen}>
        <DialogContent className="w-[min(600px,calc(100vw-48px))] max-w-none rounded-[24px] p-0" showCloseButton={false}>
          <DialogHeader className="border-b px-6 py-5"><div className="flex items-center justify-between"><DialogTitle>编辑基本信息</DialogTitle><button type="button" onClick={() => setBasicEditOpen(false)} className="action-button h-9 w-9"><X className="h-4 w-4" /></button></div></DialogHeader>
          <div className="space-y-4 px-6 py-5">
            {editError && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{editError}</div>}
            <CreateField label="名称"><Input value={item.name} disabled className="h-11 rounded-xl bg-[#f8fafc]" /></CreateField>
            <CreateField label="命名空间"><Input value={item.namespace} disabled className="h-11 rounded-xl bg-[#f8fafc]" /></CreateField>
            <CreateField label="描述"><Textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="请输入批量工作负载描述" className="min-h-[120px] rounded-xl" /><p className="text-right text-xs text-[var(--color-text-tertiary)]">{description.length}/500</p></CreateField>
            <p className="text-xs text-[var(--color-text-secondary)]">名称和命名空间是 Kubernetes 资源身份，创建后不可直接修改；如需变更请新建批次。</p>
          </div>
          <DialogFooter className="border-t px-6 py-4"><button type="button" disabled={savingBasic} onClick={() => setBasicEditOpen(false)} className="h-10 rounded-xl border px-5 text-sm font-semibold">取消</button><button type="button" disabled={savingBasic} onClick={async () => { setSavingBasic(true); setEditError(""); try { await updateBatchWorkloadMetadata(item.id, { description }); await onChanged(); setBasicEditOpen(false); } catch (err) { setEditError(err instanceof Error ? err.message : "基本信息更新失败"); } finally { setSavingBasic(false); } }} className="h-10 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white disabled:opacity-50">{savingBasic ? "保存中..." : "保存"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DefinitionSection({ title, children, onEdit }: { title: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#111827]">{title}</h3>
        {onEdit && <button type="button" onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-xs"><Pencil className="h-3 w-3" />编辑</button>}
      </div>
      {children}
    </section>
  );
}

function DefinitionTab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={active ? "btn-tab-active" : "btn-tab"}>
      {icon}
      {label}
    </button>
  );
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <div className="break-all text-sm font-medium text-[#111827]">{value}</div>
    </div>
  );
}

function ImageChip({ text }: { text: string }) {
  return <span className="inline-flex max-w-[280px] truncate rounded-md bg-white px-2.5 py-1 font-mono text-xs text-[#111827]" title={text}>{text}</span>;
}

function DefinitionGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[#eef1f5] bg-white px-3 py-2">
          <p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p>
          <div className="text-xs font-medium text-[#111827]">{value}</div>
        </div>
      ))}
    </div>
  );
}

type DeployContainerForm = {
  id: string;
  name: string;
  image: string;
  imagePullPolicy: "Always" | "IfNotPresent" | "Never";
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  envs: BatchKeyValue[];
  command: string;
  args: string;
};

const createDeployContainer = (index: number, image = ""): DeployContainerForm => ({
  id: `container-${Date.now()}-${index}`,
  name: `container-${index + 1}`,
  image,
  imagePullPolicy: "IfNotPresent",
  cpuRequest: "100m",
  cpuLimit: "500m",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
  envs: [],
  command: "",
  args: "",
});

function DeployDialog({ item, onOpenChange, onCreatePlan }: {
  item: BatchWorkload | null;
  onOpenChange: (open: boolean) => void;
  onCreatePlan: (plan: BatchWorkloadPlan) => Promise<void>;
}) {
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [replicas, setReplicas] = useState("2");
  const [replicaEditable, setReplicaEditable] = useState(false);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [containers, setContainers] = useState<DeployContainerForm[]>([createDeployContainer(0)]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [yamlPreview, setYamlPreview] = useState<{ title: string; yaml: string } | null>(null);
  const [availableNodeGroups, setAvailableNodeGroups] = useState<{ id: string; name: string; nodes: string[]; description: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    let active = true;
    setSelectedGroups([]);
    setReplicas(String(item.raw?.plan?.replicas || 1));
    setReplicaEditable(false);
    setActiveContainerIndex(0);
    const originalContainers = item.raw?.plan?.podTemplate?.containers || [];
    setContainers(originalContainers.length ? originalContainers.map((container, index) => ({
      ...createDeployContainer(index, container.image),
      name: container.name,
      imagePullPolicy: container.imagePullPolicy || "IfNotPresent",
      command: (container.command || []).join(" "),
      args: (container.args || []).join(" "),
      cpuRequest: container.resources?.requests?.cpu || "",
      cpuLimit: container.resources?.limits?.cpu || "",
      memoryRequest: container.resources?.requests?.memory || "",
      memoryLimit: container.resources?.limits?.memory || "",
      envs: (container.env || []).map((env, envIndex) => ({ id: `env-${index}-${envIndex}`, key: env.name, value: env.value })),
    })) : [createDeployContainer(0, item.image)]);
    setSubmitted(false);
    setSubmitting(false);
    setSubmitError("");
    setYamlPreview(null);
    setGroupsLoading(true);
    void listNodeGroups().then((groups) => {
      if (!active) return;
      const existing = new Set(item.targetGroups);
      setAvailableNodeGroups(groups.map((group: any) => ({
        id: String(group?.metadata?.uid || group?.metadata?.name || group?.name || ""),
        name: String(group?.metadata?.name || group?.name || ""),
        nodes: Array.isArray(group?.spec?.nodes) ? group.spec.nodes.map(String) : [],
        description: String(group?.metadata?.annotations?.description || group?.spec?.description || "真实 Kubernetes NodeGroup"),
      })).filter((group) => group.name && !existing.has(group.name)));
    }).catch((err) => {
      if (active) setSubmitError(err instanceof Error ? err.message : "NodeGroup 加载失败");
    }).finally(() => {
      if (active) setGroupsLoading(false);
    });
    return () => { active = false; };
  }, [item]);

  if (!item) return null;

  const selectedNodeGroups = availableNodeGroups.filter((group) => selectedGroups.includes(group.name));
  const activeContainer = containers[activeContainerIndex] || containers[0];
  const showErrors = submitted;
  const updateActiveContainer = (patch: Partial<DeployContainerForm>) => setContainers((current) => current.map((container, index) => index === activeContainerIndex ? { ...container, ...patch } : container));
  const toggleGroup = (name: string) => setSelectedGroups((current) => current.includes(name) ? current.filter((group) => group !== name) : [...current, name]);
  const addContainer = () => {
    const nextIndex = containers.length + 1;
    setContainers((current) => [...current, createDeployContainer(nextIndex - 1)]);
    setActiveContainerIndex(containers.length);
  };
  const removeContainer = (index: number) => {
    if (containers.length <= 1) return;
    setContainers((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setActiveContainerIndex((current) => Math.max(0, Math.min(current, containers.length - 2)));
  };
  const handleSubmit = async () => {
    setSubmitted(true);
    const count = Number(replicas);
    if (selectedGroups.length === 0 || !Number.isInteger(count) || count <= 0 || containers.some((container) => !container.name.trim() || !container.image.trim())) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onCreatePlan({
        namespace: item.namespace,
        name: `${item.name}-deployment-plan`,
        targetGroups: selectedGroups,
        replicas: count,
        workloadType: "Deployment",
        podTemplate: {
          containers: containers.map((container) => ({
            name: container.name.trim(),
            image: container.image.trim(),
            imagePullPolicy: container.imagePullPolicy,
            command: compactStringList(container.command),
            args: compactStringList(container.args),
            env: container.envs.filter((env) => env.key.trim()).map((env) => ({ name: env.key.trim(), value: env.value })),
            resources: {
              requests: { cpu: container.cpuRequest.trim(), memory: container.memoryRequest.trim() },
              limits: { cpu: container.cpuLimit.trim(), memory: container.memoryLimit.trim() },
            },
          })),
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "创建 Deployment 失败");
    } finally {
      setSubmitting(false);
    }
  };
  const buildDeployPatchYaml = (moduleTitle: string) => `# ${moduleTitle}预览；提交后由后端补齐 selector、节点组调度约束和平台管理标签
apiVersion: apps/v1
kind: Deployment
metadata:
  generateName: ${item.name}-
  namespace: ${item.namespace}
spec:
  replicas: ${replicas || 0}
  template:
    metadata:
      annotations:
        blueedge.io/target-groups: ${selectedGroups.join(",") || "<请选择 NodeGroup>"}
    spec:
      containers:
        - name: ${activeContainer?.name || ""}
          image: ${activeContainer?.image || ""}
`;

  return (
    <>
      <Dialog open={!!item} onOpenChange={onOpenChange}>
        <DialogContent className="!flex max-h-[min(800px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)] sm:max-w-none" showCloseButton={false}>
          <DialogHeader className="h-[68px] shrink-0 border-b border-[#eef1f5] px-6 py-0">
            <div className="flex h-full items-center justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-[#111827]">新增部署</DialogTitle>
                <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{item.name}</p>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} className="action-button h-9 w-9"><X className="h-4 w-4" /></button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm leading-6 text-[#1d4ed8]">
              提交后会为每个所选 NodeGroup 创建真实的 Kubernetes apps/v1 Deployment。
            </div>
            {submitError && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#dc2626]">{submitError}</div>}
            <section className="rounded-xl border border-[#e5e7eb] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#111827]">部署对象</h3>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">指定节点组</p>
                </div>
                <button type="button" onClick={() => setGroupPickerOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0f172a] px-4 text-xs font-semibold text-white hover:bg-[#172033]">
                  <Plus className="h-3.5 w-3.5" />
                  选择边缘节点组
                </button>
              </div>
              {showErrors && selectedGroups.length === 0 && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  请至少选择一个边缘节点组
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-[#eef1f5]">
                <table className="w-full table-fixed border-collapse">
                  <thead className="bg-[#fafbfc]">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">节点组名称</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">节点信息</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">描述</th>
                      <th className="w-[64px] px-3 py-3 text-right text-xs font-medium text-[var(--color-text-secondary)]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNodeGroups.length === 0 ? (
                      <tr><td colSpan={4} className="py-9 text-center text-sm text-[var(--color-text-tertiary)]">暂无数据</td></tr>
                    ) : selectedNodeGroups.map((group) => (
                      <tr key={group.id} className="border-t border-[#f3f4f6]">
                        <td className="px-3 py-3 text-sm font-semibold text-[#1e6bff]">{group.name}</td>
                        <td className="truncate px-3 py-3 text-xs text-[#374151]">{group.nodes.join("、")}</td>
                        <td className="truncate px-3 py-3 text-xs text-[var(--color-text-secondary)]">{group.description}</td>
                        <td className="px-3 py-3 text-right"><button type="button" onClick={() => toggleGroup(group.name)} className="action-button h-8 w-8"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111827]">差异化配置 <span className="text-[#ff4d4f]">*</span></h3>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">支持按容器维度配置实例数、镜像、资源配额、环境变量和启动命令。</p>
              </div>

              <div className={cn("rounded-xl border bg-white p-4", showErrors && (!replicas.trim() || Number(replicas) <= 0) ? "border-[#ef4444]" : "border-[#e5e7eb]")}>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[#111827]">实例数 <span className="text-[#ff4d4f]">*</span></h4>
                  <button type="button" onClick={() => setReplicaEditable(true)} className="text-xs font-semibold text-[#1e6bff]">修改</button>
                </div>
                <div className="flex items-start gap-2">
                  <button type="button" disabled={!replicaEditable} onClick={() => setReplicas(String(Math.max(1, Number(replicas || 1) - 1)))} className="h-[38px] w-[38px] rounded-[10px] border border-[#e2e8f0] bg-white text-sm disabled:opacity-55">-</button>
                  <Input type="number" min={1} disabled={!replicaEditable} value={replicas} onChange={(event) => setReplicas(event.target.value)} className="h-[38px] flex-1 rounded-[10px] border border-[#e2e8f0] bg-white px-3 text-sm disabled:bg-[#f8fafc]" />
                  <button type="button" disabled={!replicaEditable} onClick={() => setReplicas(String(Math.max(1, Number(replicas || 0) + 1)))} className="h-[38px] w-[38px] rounded-[10px] border border-[#e2e8f0] bg-white text-sm disabled:opacity-55">+</button>
                </div>
                {showErrors && (!replicas.trim() || Number(replicas) <= 0) && <p className="mt-1 text-xs text-[#ef4444]">实例数必须为正整数</p>}
              </div>

              <div className="rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-4">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]">当前容器</span>
                  <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                    {containers.map((container, index) => (
                      <button key={container.id} type="button" onClick={() => setActiveContainerIndex(index)} className={cn("flex h-9 w-[132px] shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium", index === activeContainerIndex ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#e5e7eb] bg-white text-[#374151]")}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", index === activeContainerIndex ? "bg-[#22c55e]" : "bg-[#cbd5e1]")} />
                        <span className="min-w-0 flex-1 truncate text-left">{container.name}</span>
                        {containers.length > 1 && <span onClick={(event) => { event.stopPropagation(); removeContainer(index); }}><Trash2 className="h-3 w-3" /></span>}
                      </button>
                    ))}
                    <button type="button" onClick={addContainer} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-[#d1d5db] bg-white"><Plus className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>

              <DeployDiffModule title="容器镜像" defaultOpen error={showErrors && !activeContainer?.image ? "值不能为空" : undefined} onViewYaml={() => setYamlPreview({ title: "容器镜像 YAML", yaml: buildDeployPatchYaml("容器镜像") })}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><DeployFieldLabel label="容器名称" /><Input value={activeContainer?.name || ""} onChange={(event) => updateActiveContainer({ name: event.target.value })} className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /></div>
                    <div><DeployFieldLabel label="拉取策略" /><select value={activeContainer?.imagePullPolicy || "IfNotPresent"} onChange={(event) => updateActiveContainer({ imagePullPolicy: event.target.value as DeployContainerForm["imagePullPolicy"] })} className="blueedge-native-select h-[38px] w-full rounded-[10px] border border-[#e2e8f0] px-3 text-sm"><option value="IfNotPresent">IfNotPresent</option><option value="Always">Always</option><option value="Never">Never</option></select></div>
                  </div>
                  <div>
                    <DeployFieldLabel label="期望镜像" />
                    <Input value={activeContainer?.image || ""} onChange={(event) => updateActiveContainer({ image: event.target.value })} placeholder="请输入镜像，例如 nginx:1.25" className={cn("h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm", showErrors && !activeContainer?.image && "border-[#ef4444]")} />
                  </div>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="资源配额" onViewYaml={() => setYamlPreview({ title: "资源配额 YAML", yaml: buildDeployPatchYaml("资源配额") })}>
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2">
                    <p className="mb-1 text-xs font-medium text-[#111827]">CPU / 内存配置说明</p>
                    <p className="text-[11px] leading-5 text-[var(--color-text-secondary)]">建议根据实际使用情况设置请求值和限制值，防止因计算或内存资源不足导致应用不可用或无法调度。</p>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-[#111827]">CPU 配额</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div><DeployFieldLabel label="请求值" /><Input value={activeContainer?.cpuRequest || ""} onChange={(event) => updateActiveContainer({ cpuRequest: event.target.value })} placeholder="100m" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /></div>
                      <div><DeployFieldLabel label="限制值" /><Input value={activeContainer?.cpuLimit || ""} onChange={(event) => updateActiveContainer({ cpuLimit: event.target.value })} placeholder="500m" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /></div>
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-[#111827]">内存配额</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div><DeployFieldLabel label="请求值" /><Input value={activeContainer?.memoryRequest || ""} onChange={(event) => updateActiveContainer({ memoryRequest: event.target.value })} placeholder="128Mi" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /></div>
                      <div><DeployFieldLabel label="限制值" /><Input value={activeContainer?.memoryLimit || ""} onChange={(event) => updateActiveContainer({ memoryLimit: event.target.value })} placeholder="256Mi" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /></div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-[#92400e]">GPU 配额</p>
                        <p className="mt-1 text-[11px] leading-5 text-[#92400e]">集群未启用 GPU 卡，如需使用 GPU 算力，请前往集群启用 GPU。</p>
                      </div>
                      <button type="button" disabled className="shrink-0 cursor-not-allowed text-xs font-medium text-[#92400e] opacity-70" title="当前版本暂未支持 GPU 计划字段">暂未支持</button>
                    </div>
                  </div>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="环境变量" onViewYaml={() => setYamlPreview({ title: "环境变量 YAML", yaml: buildDeployPatchYaml("环境变量") })}>
                <div className="space-y-3">
                  {(activeContainer?.envs || []).map((env) => <div key={env.id} className="grid grid-cols-[1fr_1fr_36px] gap-2"><Input value={env.key} onChange={(event) => updateActiveContainer({ envs: activeContainer.envs.map((item) => item.id === env.id ? { ...item, key: event.target.value } : item) })} placeholder="变量名" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /><Input value={env.value} onChange={(event) => updateActiveContainer({ envs: activeContainer.envs.map((item) => item.id === env.id ? { ...item, value: event.target.value } : item) })} placeholder="值" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" /><button type="button" onClick={() => updateActiveContainer({ envs: activeContainer.envs.filter((item) => item.id !== env.id) })} className="action-button h-9 w-9"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
                  <button type="button" onClick={() => updateActiveContainer({ envs: [...(activeContainer?.envs || []), { id: `env-${Date.now()}`, key: "", value: "" }] })} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><Plus className="h-3.5 w-3.5" />新增环境变量</button>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="启动命令" onViewYaml={() => setYamlPreview({ title: "启动命令 YAML", yaml: buildDeployPatchYaml("启动命令") })}>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-[#111827]">运行命令</h4>
                    <Input value={activeContainer?.command || ""} onChange={(event) => updateActiveContainer({ command: event.target.value })} placeholder="例如 /bin/sh -c" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" />
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-[#111827]">运行参数</h4>
                    <Input value={activeContainer?.args || ""} onChange={(event) => updateActiveContainer({ args: event.target.value })} placeholder="例如 echo start" className="h-[38px] rounded-[10px] border border-[#e2e8f0] text-sm" />
                  </div>
                </div>
              </DeployDiffModule>
            </section>
          </div>

          <DialogFooter className="h-[68px] shrink-0 border-t border-[#eef1f5] px-6 py-0">
            <div className="flex w-full justify-end gap-3">
              <button type="button" disabled={submitting} onClick={() => onOpenChange(false)} className="h-9 rounded-xl border border-[#e2e8f0] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc] disabled:opacity-50">取消</button>
              <button type="button" disabled={submitting} onClick={() => void handleSubmit()} className="h-9 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033] disabled:opacity-50">{submitting ? "正在创建 Deployment..." : "创建真实部署"}</button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupPickerOpen} onOpenChange={setGroupPickerOpen}>
        <DialogContent className="!flex max-h-[min(720px,calc(100vh-64px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[20px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)] sm:max-w-none" showCloseButton={false}>
          <DialogHeader className="h-16 shrink-0 border-b border-[#eef1f5] px-6 py-0">
            <div className="flex h-full items-center justify-between">
              <DialogTitle className="text-base font-semibold text-[#111827]">选择边缘节点组</DialogTitle>
              <button type="button" onClick={() => setGroupPickerOpen(false)} className="action-button h-9 w-9"><X className="h-4 w-4" /></button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2">
              <p className="text-xs leading-5 text-[#1d4ed8]">这里只显示尚未部署的真实 NodeGroup；可多选并一次创建对应的 Deployment。</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#eef1f5]">
              <table className="w-full table-fixed border-collapse">
                <thead className="bg-[#fafbfc]">
                  <tr>
                    <th className="w-[52px] px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">选择</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">节点组名称</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">节点信息</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)]">描述</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsLoading ? <tr><td colSpan={4} className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">正在加载真实 NodeGroup...</td></tr> : availableNodeGroups.length ? availableNodeGroups.map((group) => (
                    <tr key={group.id} onClick={() => toggleGroup(group.name)} className={cn("cursor-pointer border-t border-[#f3f4f6]", selectedGroups.includes(group.name) && "bg-[#f0f6ff]")}>
                      <td className="px-3 py-3"><input type="checkbox" checked={selectedGroups.includes(group.name)} onChange={() => toggleGroup(group.name)} onClick={(event) => event.stopPropagation()} /></td>
                      <td className="px-3 py-3 text-sm font-semibold text-[#1e6bff]">{group.name}</td>
                      <td className="truncate px-3 py-3 text-xs text-[#374151]">{group.nodes.length ? group.nodes.join("、") : "-"}</td>
                      <td className="truncate px-3 py-3 text-xs text-[var(--color-text-secondary)]">{group.description}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">没有可新增的 NodeGroup</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter className="h-16 shrink-0 border-t border-[#eef1f5] px-6 py-0">
            <div className="flex w-full items-center justify-between">
              <span className="text-xs text-[var(--color-text-secondary)]">已选择 {selectedGroups.length} 个节点组</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setGroupPickerOpen(false)} className="h-9 rounded-xl border border-[#e2e8f0] bg-white px-5 text-sm font-semibold text-[#111827]">取消</button>
                <button type="button" onClick={() => setGroupPickerOpen(false)} className="h-9 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white">确定</button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {yamlPreview && (
        <BatchYamlEditor
          open={!!yamlPreview}
          title={yamlPreview.title}
          defaultValue={yamlPreview.yaml}
          onSubmit={() => setYamlPreview(null)}
          onCancel={() => setYamlPreview(null)}
        />
      )}
    </>
  );
}

function DeployDiffModule({ title, children, error, defaultOpen = false, onViewYaml }: { title: string; children: ReactNode; error?: string; defaultOpen?: boolean; onViewYaml?: () => void }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-white", error ? "border-[#ef4444]" : "border-[#e5e7eb]")}>
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", open && "border-b border-[#f1f5f9]")}>
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 items-center gap-2 text-left">
          <ChevronDown className={cn("h-[15px] w-[15px] shrink-0 text-[#64748b] transition-transform", open && "rotate-180")} />
          <span className="truncate text-sm font-semibold text-[#111827]">{title}</span>
        </button>
        {onViewYaml && (
          <button type="button" onClick={onViewYaml} className="btn-secondary inline-flex shrink-0 items-center gap-1.5 text-xs">
            <FileCode2 className="h-3 w-3" />
            查看 YAML
          </button>
        )}
      </div>
      {error && <p className="-mt-1 px-4 pb-2 text-xs text-[#ef4444]">{error}</p>}
      {open && (
        <div className="px-4 pb-4 pt-3">
          {children}
          <div className="mt-4 flex items-center justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-black text-xs" style={{ height: 32, padding: "0 14px" }}>确认</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeployFieldLabel({ label }: { label: string }) {
  return <Label className="mb-1.5 block text-xs font-normal text-[var(--color-text-secondary)]">{label}</Label>;
}

function CreateField({ label, required, children, compact = false, error, errorId }: { label: string; required?: boolean; children: ReactNode; compact?: boolean; error?: string; errorId?: string }) {
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <Label className={cn("font-semibold text-[#111827]", compact ? "text-xs text-[var(--color-text-secondary)]" : "text-base")}>
        {label}
        {required && <span className="ml-1 text-[#ff4d4f]">*</span>}
      </Label>
      {children}
      <RequiredFieldError id={errorId || "field-error"} message={error} />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Activity,
  ArrowRight,
  ClipboardList,
  Check,
  ChevronLeft,
  Eye,
  History,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
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
import { toBatchTaskRow } from "@/api/adapters/batch-task.adapter";
import type { BatchTaskApiItem } from "@/api/adapters/batch-task.adapter";
import type { BatchTaskAuditRecord, BatchTaskEvent } from "@/api/adapters/batch-task.adapter";
import {
  createImagePreheatTask,
  createNodeUpgradeTask,
  deleteBatchTask,
  getBatchTask,
  getBatchTaskAudit,
  getBatchTaskEvents,
  listBatchTasks,
  retryBatchTask,
  rollbackBatchTask,
  startBatchTask,
} from "@/api/services/product";
import { listNamespaces, listNodes, listSecrets } from "@/api/services/resources";
import { cn } from "@/lib/utils";
import { useNavigate, useParams } from "react-router-dom";

type BatchTaskType = "节点升级" | "镜像预热";
type UpgradeStatus = "成功" | "失败" | "初始化" | "待执行" | "执行中" | "部分成功" | "已取消";
type PreheatStatus = UpgradeStatus;

type BatchTask = {
  id: string;
  name: string;
  type: BatchTaskType;
  status: UpgradeStatus | PreheatStatus;
  image?: string;
  version?: string;
  targetNodes: number;
  createTime: string;
  description?: string;
  executionMode?: string;
  raw?: BatchTaskApiItem;
};

type UpgradeForm = {
  name: string;
  description: string;
  image: string;
  version: string;
  selectorType: "label" | "nodes";
  labels: Array<{ key: string; value: string }>;
  selectedNodes: string[];
  userConfirm: boolean;
  concurrency: string;
  timeout: string;
  failureRate: string;
  resourceCheck: string[];
};

type PreheatForm = {
  name: string;
  images: string[];
  description: string;
  selectorType: "label" | "nodes";
  labels: Array<{ key: string; value: string }>;
  credentialNamespace: string;
  credentialName: string;
  selectedNodes: string[];
  concurrency: string;
  timeout: string;
  failureRate: string;
  retryCount: string;
  resourceCheck: string[];
};

const defaultUpgradeForm: UpgradeForm = {
  name: "",
  description: "",
  image: "",
  version: "",
  selectorType: "label",
  labels: [{ key: "", value: "" }],
  selectedNodes: [],
  userConfirm: false,
  concurrency: "2",
  timeout: "",
  failureRate: "10",
  resourceCheck: ["CPU", "内存"],
};

const defaultPreheatForm: PreheatForm = {
  name: "",
  images: [""],
  description: "",
  selectorType: "label",
  labels: [{ key: "", value: "" }],
  credentialNamespace: "",
  credentialName: "",
  selectedNodes: [],
  concurrency: "2",
  timeout: "",
  failureRate: "10",
  retryCount: "3",
  resourceCheck: ["CPU", "内存"],
};

const upgradeStatusStyle: Record<UpgradeStatus, { className: string; dot: string }> = {
  成功: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  失败: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ff4d4f" },
  初始化: { className: "bg-transparent text-[#475569]", dot: "#64748b" },
  待执行: { className: "bg-[#f1f5f9] text-[#64748b]", dot: "#94a3b8" },
  执行中: { className: "bg-[#dbeafe] text-[#2563eb]", dot: "#2563eb" },
  部分成功: { className: "bg-[#fff7ed] text-[#c2410c]", dot: "#f97316" },
  已取消: { className: "bg-[#f8fafc] text-[#64748b]", dot: "#94a3b8" },
};

const preheatStatusStyle: Record<PreheatStatus, { className: string; dot: string }> = {
  执行中: { className: "bg-[#dbeafe] text-[#2563eb]", dot: "#2563eb" },
  部分成功: { className: "bg-[#fff7ed] text-[#c2410c]", dot: "#f97316" },
  待执行: { className: "bg-[#f1f5f9] text-[#64748b]", dot: "#94a3b8" },
  成功: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  失败: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ff4d4f" },
  初始化: { className: "bg-transparent text-[#475569]", dot: "#64748b" },
  已取消: { className: "bg-[#f8fafc] text-[#64748b]", dot: "#94a3b8" },
};

export function BatchTasks() {
  const navigate = useNavigate();
  const { taskId: taskIdParam } = useParams<{ taskId?: string; taskName?: string }>();
  const detailTaskId = taskIdParam ? decodeURIComponent(taskIdParam) : "";
  const isDetailRoute = Boolean(detailTaskId);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [activeType, setActiveType] = useState<BatchTaskType>("节点升级");
  const [search, setSearch] = useState("");
  const [createUpgradeOpen, setCreateUpgradeOpen] = useState(false);
  const [createPreheatOpen, setCreatePreheatOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BatchTask | null>(null);
  const [detailTarget, setDetailTarget] = useState<BatchTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTasks = useCallback(async () => {
    setError("");
    try {
      const [data, nodes] = await Promise.all([
        listBatchTasks(),
        listNodes().catch(() => []),
      ]);
      setTasks(data.items.filter((item) => item.type === "nodeUpgrade" || item.type === "imagePreheat").map((item) => toBatchTaskRow(item) as BatchTask));
      setNodeOptions(nodes.map((node) => node.name));
    } catch (err) {
      setTasks([]);
      setError(err instanceof Error ? err.message : "批量任务加载失败");
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tasks.filter((task) => task.type === activeType && (!keyword || task.name.toLowerCase().includes(keyword)));
  }, [activeType, search, tasks]);

  const openDetail = (task: BatchTask) => {
    setDetailTarget(task);
    navigate(`/batchtasks/${encodeURIComponent(task.id)}/${encodeURIComponent(task.name)}`);
  };

  useEffect(() => {
    if (!detailTaskId) return;
    let active = true;
    setDetailLoading(true);
    setError("");
    getBatchTask(detailTaskId)
      .then((data) => { if (active) setDetailTarget(toBatchTaskRow(data.item) as BatchTask); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "批量任务详情加载失败"); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [detailTaskId]);

  const deleteTask = async () => {
    if (!deleteTarget) return;
    setError("");
    try {
      await deleteBatchTask(deleteTarget.id);
      setDeleteTarget(null);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除批量任务失败");
    }
  };

  const createUpgradeTask = async (form: UpgradeForm) => {
    setError("");
    try {
      await createNodeUpgradeTask({
        name: form.name.trim(),
        targetType: form.selectorType === "nodes" ? "node" : "nodeGroup",
        targetRefs: form.selectorType === "nodes" ? form.selectedNodes : [],
        labelSelector: form.selectorType === "label"
          ? Object.fromEntries(form.labels.map((item) => [item.key.trim(), item.value.trim()]).filter(([key, value]) => key && value))
          : undefined,
        image: form.image.trim(),
        targetVersion: form.version.trim(),
        concurrency: Number(form.concurrency || 1),
        failurePolicy: "continue",
        timeoutSeconds: Number(form.timeout || 0),
        retryCount: 0,
        failureRateThreshold: Number(form.failureRate || 0),
        resourceChecks: form.resourceCheck,
        userConfirm: form.userConfirm,
        description: form.description || `计划升级到 ${form.version.trim()}`,
      });
      setActiveType("节点升级");
      setCreateUpgradeOpen(false);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建节点升级计划失败");
    }
  };

  const createPreheatTask = async (form: PreheatForm) => {
    setError("");
    try {
      await createImagePreheatTask({
        name: form.name.trim(),
        targetType: form.selectorType === "nodes" ? "node" : "nodeGroup",
        targetRefs: form.selectorType === "nodes" ? form.selectedNodes : [],
        labelSelector: form.selectorType === "label"
          ? Object.fromEntries(form.labels.map((item) => [item.key.trim(), item.value.trim()]).filter(([key, value]) => key && value))
          : undefined,
        images: form.images.map((item) => item.trim()).filter(Boolean),
        concurrency: Number(form.concurrency || 1),
        failurePolicy: "continue",
        timeoutSeconds: Number(form.timeout || 0),
        retryCount: Number(form.retryCount || 0),
        failureRateThreshold: Number(form.failureRate || 0),
        resourceChecks: form.resourceCheck,
        credentialNamespace: form.credentialNamespace,
        credentialName: form.credentialName,
        description: form.description || "镜像预热计划任务",
      });
      setActiveType("镜像预热");
      setCreatePreheatOpen(false);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建镜像预热计划失败");
    }
  };

  if (isDetailRoute && detailTarget) {
    return (
      <BatchTaskDetailPage
        task={detailTarget}
        onBack={() => { setDetailTarget(null); navigate("/batchtasks"); }}
        onRefresh={async () => {
          const data = await getBatchTask(detailTarget.id);
          setDetailTarget(toBatchTaskRow(data.item) as BatchTask);
        }}
        onDelete={async () => {
          try {
            await deleteBatchTask(detailTarget.id);
            setDetailTarget(null);
            navigate("/batchtasks");
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "删除批量任务失败");
          }
        }}
        onRetry={async () => {
          setError("");
          try {
            if (detailTarget.raw?.status === "pending") {
              await startBatchTask(detailTarget.id);
              const refreshed = await getBatchTask(detailTarget.id);
              setDetailTarget(toBatchTaskRow(refreshed.item) as BatchTask);
              await loadTasks();
              return;
            }
            const retried = await retryBatchTask(detailTarget.id);
            const nextTask = toBatchTaskRow(retried.item) as BatchTask;
            setDetailTarget(nextTask);
            navigate(`/batchtasks/${encodeURIComponent(nextTask.id)}/${encodeURIComponent(nextTask.name)}`, { replace: true });
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "执行或重试批量任务失败");
            throw err;
          }
        }}
        onRollback={async () => {
          try {
            await rollbackBatchTask(detailTarget.id);
            const refreshed = await getBatchTask(detailTarget.id);
            setDetailTarget(toBatchTaskRow(refreshed.item) as BatchTask);
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "回滚批量任务失败");
            throw err;
          }
        }}
      />
    );
  }

  if (isDetailRoute) {
    return <div className="blueedge-page"><div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white text-sm text-[var(--color-text-secondary)]">{detailLoading ? "正在加载批量任务详情..." : error || "未找到该批量任务"}</div></div>;
  }

  return (
    <div className="blueedge-page space-y-5">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">批量任务</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">批量执行节点升级、镜像预热任务</p>
      </section>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}

      <section className="page-toolbar">
        <div className="segmented-filter">
          {(["节点升级", "镜像预热"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setActiveType(type);
                setSearch("");
              }}
              className={cn("segmented-filter-item", activeType === type && "is-active")}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-[220px] transition-[width] focus-within:w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索任务名称"
              className="h-9 rounded-[10px] border-[var(--color-input-border)] bg-white pl-9 text-sm shadow-sm"
            />
          </div>
          <Button type="button" onClick={() => activeType === "节点升级" ? setCreateUpgradeOpen(true) : setCreatePreheatOpen(true)} className="btn-black">
            <Plus className="h-4 w-4" />
            {activeType === "节点升级" ? "创建升级任务" : "创建预热任务"}
          </Button>
        </div>
      </section>

      <section className="table-card overflow-visible">
        <Table>
          {activeType === "节点升级" ? (
            <UpgradeTableHeader />
          ) : (
            <PreheatTableHeader />
          )}
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-14 text-[var(--color-text-tertiary)]">
                    <Search className="mb-2 h-8 w-8" />
                    <span className="text-sm">暂无{activeType}任务</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((task) => (
                <TableRow key={task.id} className="group h-[69px] cursor-pointer hover:bg-[var(--color-bg-hover)]" onClick={() => openDetail(task)}>
                  {activeType === "节点升级" ? (
                    <UpgradeTaskRow task={task} onDetail={() => openDetail(task)} onDelete={() => setDeleteTarget(task)} />
                  ) : (
                    <PreheatTaskRow task={task} onDetail={() => openDetail(task)} onDelete={() => setDeleteTarget(task)} />
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <CreateUpgradeTaskModal
        open={createUpgradeOpen}
        onOpenChange={setCreateUpgradeOpen}
        onSubmit={createUpgradeTask}
        nodeOptions={nodeOptions}
      />

      <CreatePreheatTaskModal
        open={createPreheatOpen}
        onOpenChange={setCreatePreheatOpen}
        onSubmit={createPreheatTask}
        nodeOptions={nodeOptions}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除任务？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除任务 <span className="font-medium text-[var(--color-text-primary)]">{deleteTarget?.name}</span>，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 bg-[var(--color-danger)] text-sm hover:bg-[var(--color-danger)]/90" onClick={deleteTask}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UpgradeTableHeader() {
  return (
    <TableHeader>
      <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
        <TableHead className="w-[20%] px-5 text-xs text-[var(--color-text-tertiary)]">任务名称</TableHead>
        <TableHead className="w-[10%] px-5 text-xs text-[var(--color-text-tertiary)]">升级状态</TableHead>
        <TableHead className="w-[22%] px-5 text-xs text-[var(--color-text-tertiary)]">升级镜像</TableHead>
        <TableHead className="w-[12%] px-5 text-xs text-[var(--color-text-tertiary)]">升级版本</TableHead>
        <TableHead className="w-[10%] px-5 text-xs text-[var(--color-text-tertiary)]">升级对象</TableHead>
        <TableHead className="w-[18%] px-5 text-xs text-[var(--color-text-tertiary)]">创建时间</TableHead>
        <TableHead className="w-[132px] px-4 text-center text-xs text-[var(--color-text-tertiary)]">操作</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function PreheatTableHeader() {
  return (
    <TableHeader>
      <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
        <TableHead className="w-[24%] px-5 text-xs text-[var(--color-text-tertiary)]">任务名称</TableHead>
        <TableHead className="w-[12%] px-5 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
        <TableHead className="w-[30%] px-5 text-xs text-[var(--color-text-tertiary)]">镜像</TableHead>
        <TableHead className="w-[12%] px-5 text-xs text-[var(--color-text-tertiary)]">边缘节点</TableHead>
        <TableHead className="w-[14%] px-5 text-xs text-[var(--color-text-tertiary)]">创建时间</TableHead>
        <TableHead className="w-[132px] px-4 text-center text-xs text-[var(--color-text-tertiary)]">操作</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function UpgradeTaskRow({ task, onDetail, onDelete }: { task: BatchTask; onDetail: () => void; onDelete: () => void }) {
  return (
    <>
      <TableCell className="px-5">
        <span className="text-left text-sm font-medium text-[#1e6bff] group-hover:underline">{task.name}</span>
      </TableCell>
      <TableCell className="px-5">
        <StatusPill status={task.status as UpgradeStatus} variant="upgrade" />
      </TableCell>
      <TableCell className="max-w-[320px] truncate px-5 text-xs text-[var(--color-text-secondary)]">{task.image || "-"}</TableCell>
      <TableCell className="px-5 font-mono text-xs text-[#111827]">{task.version || "-"}</TableCell>
      <TableCell className="px-5 text-xs text-[#111827]">{task.targetNodes} 个节点</TableCell>
      <TableCell className="px-5 text-xs text-[var(--color-text-tertiary)]">{task.createTime}</TableCell>
      <TableCell className="w-[132px] px-4 text-center">
        <RowActions onDetail={onDetail} onDelete={onDelete} />
      </TableCell>
    </>
  );
}

function PreheatTaskRow({ task, onDetail, onDelete }: { task: BatchTask; onDetail: () => void; onDelete: () => void }) {
  return (
    <>
      <TableCell className="px-5">
        <span className="text-left text-sm font-medium text-[#1e6bff] group-hover:underline">{task.name}</span>
      </TableCell>
      <TableCell className="px-5">
        <StatusPill status={task.status as PreheatStatus} variant="preheat" />
      </TableCell>
      <TableCell className="max-w-[420px] truncate px-5 text-xs text-[var(--color-text-secondary)]">{task.image || "-"}</TableCell>
      <TableCell className="px-5 text-xs text-[#111827]">{task.targetNodes} 个</TableCell>
      <TableCell className="px-5 text-xs text-[var(--color-text-tertiary)]">{task.createTime}</TableCell>
      <TableCell className="w-[132px] px-4 text-center">
        <RowActions onDetail={onDetail} onDelete={onDelete} />
      </TableCell>
    </>
  );
}

function StatusPill({ status, variant }: { status: UpgradeStatus | PreheatStatus; variant: "upgrade" | "preheat" }) {
  const style = (variant === "upgrade" ? upgradeStatusStyle[status as UpgradeStatus] : preheatStatusStyle[status as PreheatStatus]) || preheatStatusStyle.待执行;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", style.className)}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {status}
    </span>
  );
}

function RowActions({ onDetail, onDelete }: { onDetail: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
      <button type="button" className="action-button" title="查看详情" onClick={(event) => { event.stopPropagation(); onDetail(); }}>
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="action-button is-danger" title="删除" onClick={(event) => { event.stopPropagation(); onDelete(); }}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CreateUpgradeTaskModal({
  open,
  onOpenChange,
  onSubmit,
  nodeOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: UpgradeForm) => void;
  nodeOptions: string[];
}) {
  const [step, setStep] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(defaultUpgradeForm);

  const resetAndClose = () => {
    setStep(1);
    setErrors({});
    setForm(defaultUpgradeForm);
    onOpenChange(false);
  };

  const validateStep1 = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "请输入任务名称";
    if (form.name.trim() && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(form.name.trim())) nextErrors.name = "名称格式不正确";
    if (!form.version.trim()) nextErrors.version = "请输入升级版本";
    if (form.selectorType === "nodes" && form.selectedNodes.length === 0) nextErrors.nodes = "请至少选择 1 个节点";
    if (form.selectorType === "label" && (form.labels.length === 0 || form.labels.some((item) => !item.key.trim() || !item.value.trim()))) nextErrors.labels = "请输入完整的标签键和值";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSubmit = () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    onSubmit(form);
    setStep(1);
    setErrors({});
    setForm(defaultUpgradeForm);
    setConfirmOpen(false);
  };

  const toggleNode = (node: string) => {
    setForm((current) => ({
      ...current,
      selectedNodes: current.selectedNodes.includes(node)
        ? current.selectedNodes.filter((item) => item !== node)
        : [...current.selectedNodes, node],
    }));
  };

  const toggleCheck = (item: string) => {
    setForm((current) => ({
      ...current,
      resourceCheck: current.resourceCheck.includes(item)
        ? current.resourceCheck.filter((value) => value !== item)
        : [...current.resourceCheck, item],
    }));
  };

  const updateLabel = (index: number, field: "key" | "value", value: string) => {
    setForm((current) => ({
      ...current,
      labels: current.labels.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
    setErrors(({ labels, ...rest }) => rest);
  };

  const addLabel = () => setForm((current) => ({ ...current, labels: [...current.labels, { key: "", value: "" }] }));

  const removeLabel = (index: number) => setForm((current) => ({
    ...current,
    labels: current.labels.length === 1 ? [{ key: "", value: "" }] : current.labels.filter((_, itemIndex) => itemIndex !== index),
  }));

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : resetAndClose())}>
        <DialogContent
          className="!flex max-h-[92vh] w-[min(600px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)]"
          showCloseButton={false}
        >
          <DialogHeader className="h-[72px] shrink-0 border-b border-[#eef1f5] px-7 py-0">
            <div className="flex h-full items-center justify-between">
              <div className="flex items-center gap-3">
                {step === 2 && (
                  <button type="button" onClick={() => setStep(1)} className="action-button">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <DialogTitle className="text-base font-semibold text-[#111827]">创建节点升级任务</DialogTitle>
              </div>
              <button type="button" onClick={resetAndClose} className="action-button">
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="shrink-0 px-7 pt-4">
            <div className="flex items-center justify-center gap-2">
              <StepDot active={step === 1} done={step > 1} label="基础信息" />
              <div className={cn("h-px w-8", step > 1 ? "bg-[#0f172a]" : "bg-[var(--color-border-strong)]")} />
              <StepDot active={step === 2} done={false} label="任务设置" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
            {step === 1 ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-2.5 text-xs text-[#c2410c]">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  <span>边缘侧软件升级会影响已使用的消息路由，升级过程会暂时中断消息转发。</span>
                  <a className="font-semibold underline" href="https://docs.daocloud.io/kant/user-guide/node/batch-upgrade.html" target="_blank" rel="noreferrer">
                    了解更多
                  </a>
                </div>

                <CreateField label="任务名称" required error={errors.name} helper="最长 253 字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号">
                  <Input
                    value={form.name}
                    onChange={(event) => {
                      setForm({ ...form, name: event.target.value });
                      setErrors(({ name, ...rest }) => rest);
                    }}
                    placeholder="upgrade-v1.21"
                    className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="描述">
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder="请输入任务描述"
                    className="form-textarea min-h-[72px] rounded-xl border-[var(--color-input-border)] px-3 py-2.5 text-sm shadow-none focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="升级镜像" helper="如果您未填写升级镜像，将默认使用系统提供的镜像地址进行升级。">
                  <Input
                    value={form.image}
                    onChange={(event) => setForm({ ...form, image: event.target.value })}
                    placeholder="kubeedge/installation-package"
                    className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="升级版本" required error={errors.version}>
                  <Input
                    value={form.version}
                    onChange={(event) => {
                      setForm({ ...form, version: event.target.value });
                      setErrors(({ version, ...rest }) => rest);
                    }}
                    placeholder="v1.21.0"
                    className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="边缘节点" required error={errors.labels || errors.nodes}>
                  <div className="space-y-5">
                    <div className={cn("overflow-hidden rounded-xl border-[1.5px] transition-colors", form.selectorType === "label" ? "border-[#0f172a] bg-[#fbfcfe]" : "border-[#e2e8f0] bg-white")}>
                      <button type="button" onClick={() => setForm({ ...form, selectorType: "label" })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                        <Toggle enabled={form.selectorType === "label"} />
                        <span className="text-sm font-semibold text-[#111827]">标签匹配</span>
                        <span className="text-xs text-[#98a2b3]">通过标签选择器自动匹配节点</span>
                      </button>
                      {form.selectorType === "label" && (
                        <div className="space-y-3 border-t border-[#e6eaf0] px-4 pb-4 pt-3">
                          {form.labels.map((label, index) => (
                            <div key={index} className="grid grid-cols-[1fr_1fr_44px] items-center gap-4">
                              <Input value={label.key} onChange={(event) => updateLabel(index, "key", event.target.value)} className="h-10 rounded-xl border border-[#e1e6ee] bg-white px-3 text-sm shadow-none focus-visible:ring-0" placeholder="键" />
                              <Input value={label.value} onChange={(event) => updateLabel(index, "value", event.target.value)} className="h-10 rounded-xl border border-[#e1e6ee] bg-white px-3 text-sm shadow-none focus-visible:ring-0" placeholder="值" />
                              <button type="button" onClick={() => removeLabel(index)} className="flex h-11 w-11 items-center justify-center rounded-xl text-[#c5cbd5] hover:bg-white hover:text-[#64748b]" aria-label="删除标签"><X className="h-5 w-5" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={addLabel} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1769ff]"><Plus className="h-4 w-4" />添加标签</button>
                        </div>
                      )}
                    </div>

                    <div className={cn("overflow-hidden rounded-xl border-[1.5px] transition-colors", form.selectorType === "nodes" ? "border-[#0f172a] bg-[#fbfcfe]" : "border-[#e2e8f0] bg-white")}>
                      <button type="button" onClick={() => setForm({ ...form, selectorType: "nodes" })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                        <Toggle enabled={form.selectorType === "nodes"} />
                        <span className="text-sm font-semibold text-[#111827]">指定节点</span>
                        <span className="text-xs text-[#98a2b3]">手动选择特定节点</span>
                      </button>
                      {form.selectorType === "nodes" && (
                        <div className="flex flex-wrap gap-2 border-t border-[#e6eaf0] px-4 pb-4 pt-3">
                          {nodeOptions.length === 0 && <span className="text-sm text-[var(--color-text-tertiary)]">暂无可选节点</span>}
                          {nodeOptions.map((node) => (
                            <button key={node} type="button" onClick={() => toggleNode(node)} className={cn("rounded-xl border-2 px-4 py-2.5 text-sm font-medium", form.selectedNodes.includes(node) ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#e1e6ee] bg-white text-[#475467]")}>{node}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CreateField>

                <button type="button" onClick={() => setForm({ ...form, userConfirm: !form.userConfirm })} className="flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left">
                  <Toggle enabled={form.userConfirm} />
                  <div>
                    <p className="text-sm font-semibold text-[#111827]">边缘用户确认</p>
                    <p className="mt-1 text-xs text-[#98a2b3]">开启后，边缘用户需手动确认才能开始升级。</p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <CreateField label="并行数" required helper="任务执行过程中允许同时拉取镜像的边缘节点数量，并行数应不大于节点总数">
                  <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
                </CreateField>
                <CreateField label="超时时间" helper="任务运行的最大时间，当任务执行超出该时间时，任务将被识别为执行失败。为空时表示不设置超时时间。">
                  <Input value={form.timeout} onChange={(event) => setForm({ ...form, timeout: event.target.value })} placeholder="为空表示不设置" className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
                </CreateField>
                <CreateField label="容错失败率" helper="任务完成可以容忍拉取镜像失败的节点数量占比">
                  <Input value={form.failureRate} onChange={(event) => setForm({ ...form, failureRate: event.target.value })} className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
                </CreateField>
                <CreateField label="系统资源检查" helper="检查节点资源充足，保证升级任务正常执行，资源使用率超过 80% 将不执行升级任务">
                  <div className="flex items-center gap-4">
                    {["CPU", "内存", "磁盘"].map((item) => (
                      <button key={item} type="button" onClick={() => toggleCheck(item)} className="flex items-center gap-2 text-sm text-[#111827]">
                        <span className={cn("flex h-4 w-4 items-center justify-center rounded border", form.resourceCheck.includes(item) ? "border-[#0f172a] bg-[#0f172a]" : "border-[var(--color-border-strong)] bg-white")}>
                          {form.resourceCheck.includes(item) && <Check className="h-3 w-3 text-white" />}
                        </span>
                        {item}
                      </button>
                    ))}
                  </div>
                </CreateField>
              </div>
            )}
          </div>

          <DialogFooter className="h-[72px] shrink-0 border-t border-[#eef1f5] px-7 py-0">
            <div className="flex w-full items-center justify-between">
              <div>
                {step === 2 && (
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-9 rounded-[10px] px-4 text-sm">
                    上一步
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={resetAndClose} className="h-9 rounded-[10px] px-4 text-sm">
                  取消
                </Button>
                {step === 1 ? (
                  <Button type="button" onClick={handleNext} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-sm text-white hover:bg-[#172033]">
                    下一步
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setConfirmOpen(true)} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-sm text-white hover:bg-[#172033]">
                    创建
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[460px] rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认创建</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">确定后将向集群创建 KubeEdge NodeUpgradeJob，并可能立即在所选边缘节点执行真实升级。升级过程可能导致节点短暂离线，请确认版本、镜像和目标节点无误。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-xl">取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} className="h-9 rounded-xl bg-[#0f172a] text-white hover:bg-[#172033]">
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CreatePreheatTaskModal({
  open,
  onOpenChange,
  onSubmit,
  nodeOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: PreheatForm) => void;
  nodeOptions: string[];
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(defaultPreheatForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [namespaceOptions, setNamespaceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [credentialOptions, setCredentialOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [credentialLoading, setCredentialLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listNamespaces()
      .then((items) => setNamespaceOptions(items.filter((item) => item.value !== "all")))
      .catch((error) => setErrors((current) => ({ ...current, credentials: error instanceof Error ? error.message : "命名空间加载失败" })));
  }, [open]);

  useEffect(() => {
    if (!open || !form.credentialNamespace) {
      setCredentialOptions([]);
      return;
    }
    setCredentialLoading(true);
    void listSecrets(form.credentialNamespace)
      .then((items) => setCredentialOptions(items
        .filter((item) => ["kubernetes.io/dockerconfigjson", "kubernetes.io/dockercfg"].includes(String(item?.type || "")))
        .map((item) => {
          const name = String(item?.metadata?.name || item?.name || "");
          return { value: name, label: name };
        })
        .filter((item) => item.value)))
      .catch((error) => setErrors((current) => ({ ...current, credentials: error instanceof Error ? error.message : "镜像凭证加载失败" })))
      .finally(() => setCredentialLoading(false));
  }, [form.credentialNamespace, open]);

  const resetAndClose = () => {
    setStep(1);
    setForm(defaultPreheatForm);
    setErrors({});
    onOpenChange(false);
  };

  const validateStep1 = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "请输入任务名称";
    if (form.name.trim() && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(form.name.trim())) nextErrors.name = "名称格式不正确";
    if (!form.images.some((item) => item.trim())) nextErrors.images = "请至少输入 1 个镜像地址";
    if (form.selectorType === "nodes" && form.selectedNodes.length === 0) nextErrors.nodes = "请至少选择 1 个节点";
    if (form.selectorType === "label" && (form.labels.length === 0 || form.labels.some((item) => !item.key.trim() || !item.value.trim()))) nextErrors.labels = "请输入完整的标签键和值";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    onSubmit(form);
    setStep(1);
    setForm(defaultPreheatForm);
    setErrors({});
  };

  const updateImage = (index: number, value: string) => {
    setForm((current) => ({
      ...current,
      images: current.images.map((item, itemIndex) => itemIndex === index ? value : item),
    }));
    setErrors(({ images, ...rest }) => rest);
  };

  const addImage = () => {
    setForm((current) => ({ ...current, images: [...current.images, ""] }));
  };

  const removeImage = (index: number) => {
    setForm((current) => ({
      ...current,
      images: current.images.length > 1 ? current.images.filter((_, itemIndex) => itemIndex !== index) : [""],
    }));
  };

  const updateLabel = (index: number, field: "key" | "value", value: string) => {
    setForm((current) => ({
      ...current,
      labels: current.labels.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
    setErrors(({ labels, ...rest }) => rest);
  };

  const addLabel = () => setForm((current) => ({ ...current, labels: [...current.labels, { key: "", value: "" }] }));

  const removeLabel = (index: number) => setForm((current) => ({
    ...current,
    labels: current.labels.length === 1 ? [{ key: "", value: "" }] : current.labels.filter((_, itemIndex) => itemIndex !== index),
  }));

  const toggleNode = (node: string) => {
    setForm((current) => ({
      ...current,
      selectedNodes: current.selectedNodes.includes(node)
        ? current.selectedNodes.filter((item) => item !== node)
        : [...current.selectedNodes, node],
    }));
  };

  const toggleCheck = (item: string) => {
    setForm((current) => ({
      ...current,
      resourceCheck: current.resourceCheck.includes(item)
        ? current.resourceCheck.filter((value) => value !== item)
        : [...current.resourceCheck, item],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : resetAndClose())}>
      <DialogContent
        className="!flex max-h-[92vh] w-[min(600px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)]"
        showCloseButton={false}
      >
        <DialogHeader className="h-[72px] shrink-0 border-b border-[#eef1f5] px-7 py-0">
          <div className="flex h-full items-center justify-between">
            <div className="flex items-center gap-3">
              {step === 2 && (
                <button type="button" onClick={() => setStep(1)} className="action-button">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="text-base font-semibold text-[#111827]">创建镜像预热任务</DialogTitle>
            </div>
            <button type="button" onClick={resetAndClose} className="action-button">
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="shrink-0 px-7 pt-4">
          <div className="flex items-center justify-center gap-2">
            <StepDot active={step === 1} done={step > 1} label="基础信息" />
            <div className={cn("h-px w-8", step > 1 ? "bg-[#0f172a]" : "bg-[var(--color-border-strong)]")} />
            <StepDot active={step === 2} done={false} label="任务设置" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {step === 1 ? (
            <div className="space-y-5">
              <CreateField label="任务名称" required error={errors.name} helper="最长 253 字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号">
                <Input
                  value={form.name}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value });
                    setErrors(({ name, ...rest }) => rest);
                  }}
                  placeholder="warmup-nginx"
                  className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0"
                />
              </CreateField>

              <CreateField label="描述">
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="请输入任务描述"
                  className="form-textarea min-h-[72px] rounded-xl border-[var(--color-input-border)] px-3 py-2.5 text-sm shadow-none focus-visible:ring-0"
                />
              </CreateField>

              <CreateField label="镜像" required error={errors.images}>
                <div className="space-y-3">
                  {form.images.map((image, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <Input
                        value={image}
                        onChange={(event) => updateImage(index, event.target.value)}
                        placeholder="nginx:1.25-alpine"
                        className="form-input h-10 flex-1 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0"
                      />
                      <button type="button" onClick={() => removeImage(index)} className="flex h-11 w-11 items-center justify-center rounded-xl text-[#c5cbd5] hover:bg-[var(--color-bg-hover)] hover:text-[#64748b]" aria-label="删除镜像">
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addImage} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1769ff]">
                  <Plus className="h-4 w-4" />
                  添加更多镜像
                </button>
              </CreateField>

              <CreateField label="镜像凭证" error={errors.credentials}>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={form.credentialNamespace}
                    onChange={(event) => {
                      setForm({ ...form, credentialNamespace: event.target.value, credentialName: "" });
                      setErrors(({ credentials, ...rest }) => rest);
                    }}
                    className="blueedge-native-select h-10 rounded-xl border px-3 text-sm"
                  >
                    <option value="">请选择命名空间</option>
                    {namespaceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <select
                    value={form.credentialName}
                    onChange={(event) => setForm({ ...form, credentialName: event.target.value })}
                    disabled={!form.credentialNamespace || credentialLoading}
                    className="blueedge-native-select h-10 rounded-xl border px-3 text-sm"
                  >
                    <option value="">{credentialLoading ? "正在加载镜像凭证" : "请选择镜像凭证"}</option>
                    {credentialOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
              </CreateField>

              <CreateField label="选择方式" required error={errors.labels || errors.nodes}>
                <div className="space-y-5">
                  <div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, selectorType: "label" })}
                      className={cn("flex w-full items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left transition-colors", form.selectorType === "label" ? "border-[#0f172a] bg-[#fbfcfe]" : "border-[#e2e8f0] bg-white")}
                    >
                      <Toggle enabled={form.selectorType === "label"} />
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">标签匹配</p>
                        <p className="mt-0.5 text-xs text-[#667085]">通过标签选择器匹配目标节点</p>
                      </div>
                    </button>
                    {form.selectorType === "label" && (
                      <div className="space-y-3 px-4 pt-3">
                        {form.labels.map((label, index) => (
                          <div key={index} className="grid grid-cols-[1fr_1fr_44px] items-center gap-4">
                            <Input value={label.key} onChange={(event) => updateLabel(index, "key", event.target.value)} className="h-10 rounded-xl border border-[#e1e6ee] bg-white px-3 text-sm shadow-none focus-visible:ring-0" placeholder="键" />
                            <Input value={label.value} onChange={(event) => updateLabel(index, "value", event.target.value)} className="h-10 rounded-xl border border-[#e1e6ee] bg-white px-3 text-sm shadow-none focus-visible:ring-0" placeholder="值" />
                            <button type="button" onClick={() => removeLabel(index)} className="flex h-11 w-11 items-center justify-center rounded-xl text-[#c5cbd5] hover:bg-[var(--color-bg-hover)] hover:text-[#64748b]" aria-label="删除标签"><X className="h-5 w-5" /></button>
                          </div>
                        ))}
                        <button type="button" onClick={addLabel} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1769ff]"><Plus className="h-4 w-4" />添加标签</button>
                      </div>
                    )}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, selectorType: "nodes" })}
                      className={cn("flex w-full items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left transition-colors", form.selectorType === "nodes" ? "border-[#0f172a] bg-[#fbfcfe]" : "border-[#e2e8f0] bg-white")}
                    >
                      <Toggle enabled={form.selectorType === "nodes"} />
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">指定节点</p>
                        <p className="mt-0.5 text-xs text-[#667085]">直接选择目标节点 ({form.selectedNodes.length})</p>
                      </div>
                    </button>
                    {form.selectorType === "nodes" && (
                      <div className="flex flex-wrap gap-2 px-4 pt-3">
                        {nodeOptions.length === 0 && <span className="text-sm text-[var(--color-text-tertiary)]">暂无可选节点</span>}
                        {nodeOptions.map((node) => (
                          <button key={node} type="button" onClick={() => toggleNode(node)} className={cn("rounded-xl border-2 px-4 py-2.5 text-sm font-medium", form.selectedNodes.includes(node) ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#e1e6ee] bg-white text-[#475467]")}>{node}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CreateField>
            </div>
          ) : (
            <div className="space-y-5">
              <CreateField label="并行数" required helper="任务执行过程中允许同时拉取镜像的边缘节点数量，并行数应不大于节点总数">
                <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
              </CreateField>
              <CreateField label="超时时间" helper="任务运行的最大时间，当任务执行超出该时间时，任务将被识别为执行失败。为空时表示不设置超时时间。">
                <Input value={form.timeout} onChange={(event) => setForm({ ...form, timeout: event.target.value })} placeholder="为空表示不设置" className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
              </CreateField>
              <CreateField label="容错失败率" helper="任务完成可以容忍拉取镜像失败的节点数量占比">
                <Input value={form.failureRate} onChange={(event) => setForm({ ...form, failureRate: event.target.value })} className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
              </CreateField>
              <CreateField label="重试次数" helper="任务标识为失败前允许重试的最大次数">
                <Input value={form.retryCount} onChange={(event) => setForm({ ...form, retryCount: event.target.value })} className="form-input h-10 rounded-xl border-[var(--color-input-border)] px-3 text-sm shadow-none focus-visible:ring-0" />
              </CreateField>
              <CreateField label="系统资源检查" helper="检查节点资源充足，保证预热任务正常执行，资源使用率超过 80% 将不执行预热任务">
                <div className="flex items-center gap-4">
                  {["CPU", "内存", "磁盘"].map((item) => (
                    <button key={item} type="button" onClick={() => toggleCheck(item)} className="flex items-center gap-2 text-sm text-[#111827]">
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded border", form.resourceCheck.includes(item) ? "border-[#0f172a] bg-[#0f172a]" : "border-[var(--color-border-strong)] bg-white")}>
                        {form.resourceCheck.includes(item) && <Check className="h-3 w-3 text-white" />}
                      </span>
                      {item}
                    </button>
                  ))}
                </div>
              </CreateField>
            </div>
          )}
        </div>

        <DialogFooter className="h-[72px] shrink-0 border-t border-[#eef1f5] px-7 py-0">
          <div className="flex w-full items-center justify-between">
            <div>
              {step === 2 && (
                <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-9 rounded-[10px] px-4 text-sm">
                  上一步
                </Button>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={resetAndClose} className="h-9 rounded-[10px] px-4 text-sm">
              取消
            </Button>
            {step === 1 ? (
              <Button type="button" onClick={() => validateStep1() && setStep(2)} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-sm text-white hover:bg-[#172033]">
                下一步
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} className="h-9 rounded-[10px] bg-[#0f172a] px-4 text-sm text-white hover:bg-[#172033]">
                创建
              </Button>
            )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", active || done ? "bg-[#0f172a]" : "bg-[#e2e8f0]")}>
        {done ? <Check className="h-3.5 w-3.5 text-white" /> : <span className={cn("h-2 w-2 rounded-full", active ? "bg-white" : "bg-[#94a3b8]")} />}
      </span>
      <span className={cn("text-xs font-semibold", active || done ? "text-[#111827]" : "text-[var(--color-text-tertiary)]")}>{label}</span>
    </div>
  );
}

function Toggle({ enabled, size = "small" }: { enabled: boolean; size?: "small" | "large" }) {
  const large = size === "large";
  return (
    <span className={cn("relative inline-flex shrink-0 rounded-full transition-colors", large ? "h-9 w-16" : "h-[22px] w-10", enabled ? "bg-[#0f172a]" : "bg-[#d1d5db]")}>
      <span className={cn("absolute rounded-full bg-white transition-all", large ? "top-1 h-7 w-7" : "top-[3px] h-4 w-4", enabled ? (large ? "left-8" : "left-[21px]") : (large ? "left-1" : "left-[3px]"))} />
    </span>
  );
}

function CreateField({
  label,
  required,
  helper,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-2 block text-sm font-semibold text-[#111827]">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </Label>
      {children}
      {helper && <p className="mt-1.5 text-xs leading-5 text-[var(--color-text-tertiary)]">{helper}</p>}
      {error && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function BatchTaskDetailPage({ task, onBack, onRefresh, onDelete, onRetry, onRollback }: { task: BatchTask; onBack: () => void; onRefresh: () => Promise<void>; onDelete: () => void; onRetry: () => Promise<void>; onRollback: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<"detail" | "progress" | "events" | "audit">("detail");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [events, setEvents] = useState<BatchTaskEvent[]>(task.raw?.events || []);
  const [auditRecords, setAuditRecords] = useState<BatchTaskAuditRecord[]>(task.raw?.auditRecords || []);
  const [tabLoading, setTabLoading] = useState(false);
  const detail = getTaskDetail(task);

  useEffect(() => {
    if (activeTab !== "events" && activeTab !== "audit") return;
    setTabLoading(true);
    const request = activeTab === "events"
      ? getBatchTaskEvents(task.id).then((data) => setEvents(data.items))
      : getBatchTaskAudit(task.id).then((data) => setAuditRecords(data.items));
    void request.catch((err) => setRefreshError(err instanceof Error ? err.message : "页签数据加载失败")).finally(() => setTabLoading(false));
  }, [activeTab, task.id]);

  const runAction = async (message: string, action: () => Promise<void>) => {
    setActionLoading(true);
    setActionError("");
    try {
      await action();
      setToast(message);
      window.setTimeout(() => setToast(""), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "批量任务操作失败");
    } finally {
      setActionLoading(false);
    }
  };

  const refreshDetail = async () => {
    setRefreshing(true);
    setRefreshError("");
    try {
      await onRefresh();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "批量任务详情刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="blueedge-page space-y-5">
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[420px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              即将删除任务 <span className="font-medium text-[var(--color-text-primary)]">{task.name}</span>，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 rounded-xl">取消</AlertDialogCancel>
            <AlertDialogAction className="h-10 rounded-xl bg-[var(--color-danger)] hover:bg-[var(--color-danger)]/90" onClick={onDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <section className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button type="button" onClick={onBack} className="action-button bg-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{task.name}</h1>
              <StatusPill status={task.status as UpgradeStatus} variant={task.type === "节点升级" ? "upgrade" : "preheat"} />
              <span className="inline-flex items-center rounded-full bg-[#e3f2fd] px-2 py-0.5 text-xs font-medium text-[#1e88e5]">{task.type}</span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{task.targetNodes} 个目标节点 · 创建于 {task.createTime}</p>
          </div>
        </div>
        <div className="relative flex items-center gap-2">
          {toast && (
            <div className="fixed right-4 top-4 z-[60] flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[#111827] shadow-lg">
              <Info className="h-4 w-4 shrink-0 text-[var(--color-info)]" />
              <span className="whitespace-nowrap">{toast}</span>
              <button type="button" onClick={() => setToast("")} className="ml-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Button type="button" onClick={() => void runAction(task.raw?.status === "pending" ? "执行计划已下发" : "重试指令已下发", onRetry)} disabled={actionLoading} className="btn-black h-9 px-3.5 text-xs">
            <RotateCcw className="h-[13px] w-[13px]" />
            失败重试
          </Button>
          <Button type="button" variant="outline" onClick={() => void runAction("回滚指令已下发", onRollback)} disabled={actionLoading} className="btn-secondary h-9 px-4 text-xs">
            <History className="h-[13px] w-[13px]" />
            回滚任务
          </Button>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="action-button bg-white" aria-label="更多操作">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 z-20 w-44 rounded-2xl border border-[var(--color-border)] bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
                className="flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-semibold text-[var(--color-danger)] hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                删除任务
              </button>
            </div>
          )}
        </div>
      </section>
      {actionError && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{actionError}</div>}
      {refreshError && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{refreshError}</div>}

      <section className="rounded-2xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[var(--color-text-primary)]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-6 gap-y-5">
          <DetailInfo label="任务名称" value={task.name} />
          <DetailInfo label="任务状态" value={<StatusPill status={task.status as UpgradeStatus} variant={task.type === "节点升级" ? "upgrade" : "preheat"} />} />
          <DetailInfo label="任务类型" value={<span className="inline-flex h-7 items-center rounded-lg bg-[#dbeafe] px-3 text-xs font-semibold text-[#2563eb]">{task.type}</span>} />
          <DetailInfo label={task.type === "节点升级" ? "升级镜像" : "镜像"} value={task.image || "-"} />
          <DetailInfo label="并行数" value={detail.concurrency} />
          <DetailInfo label="目标节点数" value={`${task.targetNodes} 个`} />
          <DetailInfo label="重试次数" value={detail.retryCount} />
          <DetailInfo label="容错失败率" value={detail.failureRate} />
          <DetailInfo label="成功" value={<span className="text-[#16a34a]">{detail.success}</span>} />
          <DetailInfo label="失败" value={<span className="text-[#ff4d4f]">{detail.failed}</span>} />
          <DetailInfo label="跳过" value={<span className="text-[#f59e0b]">{detail.skipped}</span>} />
          <DetailInfo label="创建时间" value={task.createTime} />
          <DetailInfo label={task.type === "节点升级" ? "升级版本" : "镜像数量"} value={task.type === "节点升级" ? task.version || "-" : String((task.image || "").split(",").map((item) => item.trim()).filter(Boolean).length)} />
          <DetailInfo label="超时时间" value={detail.timeout} />
          <DetailInfo label="资源检查" value={detail.resourceCheck} />
        </div>
        <div className="mt-5 border-t border-[var(--color-border)] pt-5">
          <DetailInfo label="描述" value={task.description || "-"} />
        </div>
      </section>

      <section className="flex items-center gap-2">
        <DetailTab active={activeTab === "detail"} icon={<ServerIcon />} label="任务详情" onClick={() => setActiveTab("detail")} />
        <DetailTab active={activeTab === "progress"} icon={<Activity className="h-4 w-4" />} label="执行进度" onClick={() => setActiveTab("progress")} />
        <DetailTab active={activeTab === "events"} icon={<AlertTriangle className="h-4 w-4" />} label="事件" onClick={() => setActiveTab("events")} />
        <DetailTab active={activeTab === "audit"} icon={<ClipboardList className="h-4 w-4" />} label="审计" onClick={() => setActiveTab("audit")} />
      </section>

      {activeTab === "detail" && <TaskStatusTable task={task} refreshing={refreshing} onRefresh={refreshDetail} />}
      {activeTab === "progress" && <ExecutionProgressPanel task={task} />}
      {activeTab === "events" && <TaskEventsPanel items={events} loading={tabLoading} />}
      {activeTab === "audit" && <TaskAuditPanel items={auditRecords} loading={tabLoading} />}

    </div>
  );
}

function ServerIcon() {
  return <span className="inline-block h-4 w-4 rounded-[3px] border-2 border-current before:mt-[3px] before:block before:h-[2px] before:bg-current after:mt-[3px] after:block after:h-[2px] after:bg-current" />;
}

function getTaskDetail(task: BatchTask) {
  const raw = task.raw;
  const targetResults = raw?.targetResults || [];
  return {
    concurrency: String(raw?.concurrency ?? "-"),
    retryCount: String(raw?.retryCount ?? "-"),
    failureRate: raw?.failureRateThreshold == null ? "-" : `${raw.failureRateThreshold}%`,
    skipped: targetResults.length > 0 ? String(targetResults.filter((item) => item.status === "skipped").length) : "-",
    success: raw?.successCount == null ? "-" : String(raw.successCount),
    failed: raw?.failedCount == null ? "-" : String(raw.failedCount),
    timeout: raw?.timeoutSeconds ? `${raw.timeoutSeconds} 秒` : "-",
    resourceCheck: raw?.resourceChecks?.length ? raw.resourceChecks.join("、") : "-",
  };
}

function DetailInfo({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function DetailTab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={active ? "btn-tab-active" : "btn-tab"}>
      {icon}
      {label}
    </button>
  );
}

function stepStatusText(status: string): UpgradeStatus {
  if (status === "running") return "执行中";
  if (status === "succeeded" || status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return "待执行";
}

function TaskStatusTable({ task, refreshing, onRefresh }: { task: BatchTask; refreshing: boolean; onRefresh: () => Promise<void> }) {
  const preheat = task.type === "镜像预热";
  const rows = task.raw?.targetResults && task.raw.targetResults.length > 0
    ? task.raw.targetResults
    : (task.raw?.targetRefs || []).map((target) => ({ target, status: "pending", message: "等待任务执行", currentVersion: "", targetVersion: preheat ? task.image : task.version, startedAt: null, finishedAt: null }));
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="mb-3 text-sm font-semibold text-[#111827]">{task.type === "节点升级" ? "升级任务执行状态" : "镜像预热执行状态"}</h2>
        <button type="button" onClick={() => void onRefresh()} disabled={refreshing} className="action-button mb-3 bg-white" title="刷新任务详情"><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /></button>
      </div>
      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">节点名称</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">当前事件</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">{preheat ? "镜像数量" : "升级前版本"}</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">{preheat ? "镜像列表" : "升级后版本"}</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">开始时间</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">结束时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.target} className="h-[76px]">
                <TableCell className="px-6 text-sm font-semibold text-[#1e6bff]">{row.target}</TableCell>
                <TableCell className="px-6"><StatusPill status={stepStatusText(row.status)} variant={preheat ? "preheat" : "upgrade"} /></TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-secondary)]">{row.message || (preheat ? "等待镜像预热状态上报" : "等待节点升级状态上报")}</TableCell>
                <TableCell className="px-6 font-mono text-sm text-[var(--color-text-primary)]">{row.currentVersion || "-"}</TableCell>
                <TableCell className="max-w-[320px] px-6 font-mono text-sm text-[var(--color-text-primary)]"><span className="line-clamp-2">{row.targetVersion || (preheat ? task.image : task.version) || "-"}</span></TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-tertiary)]">{row.startedAt || task.raw?.startedAt || "-"}</TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-tertiary)]">{row.finishedAt || task.raw?.finishedAt || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ExecutionProgressPanel({ task }: { task: BatchTask }) {
  const detail = getTaskDetail(task);
  const progress = Math.max(0, Math.min(100, Number(task.raw?.progress || 0)));
  const steps = task.raw?.steps || [];
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#f0f1f3] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-4 text-sm font-semibold text-[#111827]">执行概览</h2>
        <div className="mb-4 flex items-center gap-8">
          <ProgressMetric label="目标节点" value={String(task.targetNodes)} minWidth="80px" />
          <span className="h-10 w-px bg-[#f0f1f3]" />
          <ProgressMetric label="成功" value={detail.success} tone="success" />
          <span className="h-10 w-px bg-[#f0f1f3]" />
          <ProgressMetric label="失败" value={detail.failed} tone="danger" />
          <span className="h-10 w-px bg-[#f0f1f3]" />
          <ProgressMetric label="跳过" value={detail.skipped} tone="warning" />
          <div className="ml-4 flex-1">
            <div className="h-2 rounded-full bg-[#e5e7eb]">
              <div className="h-2 rounded-full bg-[#20c77a]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-right text-xs text-[var(--color-text-tertiary)]">{progress}% 完成</p>
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-[#f0f1f3] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-4 text-sm font-semibold text-[#111827]">执行步骤</h2>
        <div className="space-y-3">
          {steps.map((row, index) => (
            <div key={`${row.name}-${index}`} className="flex items-center gap-4 rounded-xl bg-[#f8f9fb] p-3">
              <div className="flex items-center gap-4">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", stepStatusText(row.status) === "成功" ? "bg-[#e8fff2] text-[#16c47f]" : stepStatusText(row.status) === "失败" ? "bg-[#fdecec] text-[#ff4d4f]" : "bg-[#e3f2fd] text-[#1e88e5]")}>{index + 1}</span>
                <div>
                  <div className="mb-0.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-[#111827]">{row.displayName || row.name}</p>
                    <StatusPill status={stepStatusText(row.status)} variant={task.type === "镜像预热" ? "preheat" : "upgrade"} />
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{row.message || "等待 KubeEdge TaskManager 状态上报"}</p>
                </div>
              </div>
              <span className="ml-auto max-w-[360px] shrink-0 truncate rounded bg-[#f0f1f3] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">{task.type === "镜像预热" ? task.image || "-" : `${task.raw?.targetResults?.[0]?.currentVersion || "-"} → ${task.version || "-"}`}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProgressMetric({ label, value, tone, minWidth = "60px" }: { label: string; value: string; tone?: "success" | "danger" | "warning"; minWidth?: string }) {
  return (
    <div className="text-center" style={{ minWidth }}>
      <p className={cn("text-3xl font-bold text-[#111827]", tone === "success" && "text-[#16c47f]", tone === "danger" && "text-[#ff4d4f]", tone === "warning" && "text-[#ffb020]")}>{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{label}</p>
    </div>
  );
}

function TaskEventsPanel({ items, loading }: { items: BatchTaskEvent[]; loading: boolean }) {
  if (loading) return <DataLoading />;
  if (items.length === 0) return <DataEmpty icon={<AlertTriangle className="h-12 w-12" />} title="暂无事件" description="任务执行过程中产生的事件将在这里显示" />;
  return (
    <div className="table-card overflow-x-auto"><Table className="min-w-[760px] table-fixed"><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)]"><TableHead className="w-[160px] px-6 text-xs text-[var(--color-text-tertiary)]">时间</TableHead><TableHead className="w-[80px] px-6 text-xs text-[var(--color-text-tertiary)]">类型</TableHead><TableHead className="w-[120px] px-6 text-xs text-[var(--color-text-tertiary)]">原因</TableHead><TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">消息</TableHead></TableRow></TableHeader><TableBody>{items.map((item, index) => <TableRow key={`${item.time}-${index}`} className="h-[69px]"><TableCell className="px-6 text-xs text-[var(--color-text-tertiary)]">{item.time}</TableCell><TableCell className="px-6"><span className={cn("rounded px-1.5 py-0.5 text-xs", item.type === "Warning" ? "bg-[#fff5e5] text-[#ffb020]" : "bg-[#e8fff2] text-[#16c47f]")}>{item.type}</span></TableCell><TableCell className="px-6 text-xs font-medium text-[#111827]">{item.reason}</TableCell><TableCell className="px-6 text-xs text-[var(--color-text-secondary)]">{item.message}</TableCell></TableRow>)}</TableBody></Table></div>
  );
}

function TaskAuditPanel({ items, loading }: { items: BatchTaskAuditRecord[]; loading: boolean }) {
  if (loading) return <DataLoading />;
  if (items.length === 0) return <DataEmpty icon={<ClipboardList className="h-12 w-12" />} title="暂无审计记录" description="任务操作完成后将生成审计日志" />;
  return (
    <div className="table-card"><Table><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)]"><TableHead className="px-6">时间</TableHead><TableHead className="px-6">操作者</TableHead><TableHead className="px-6">操作</TableHead><TableHead className="px-6">结果</TableHead><TableHead className="px-6">说明</TableHead></TableRow></TableHeader><TableBody>{items.map((item, index) => <TableRow key={`${item.time}-${index}`} className="h-[76px]"><TableCell className="px-6 text-[var(--color-text-tertiary)]">{item.time}</TableCell><TableCell className="px-6">{item.actor}</TableCell><TableCell className="px-6 font-semibold">{item.action}</TableCell><TableCell className="px-6 text-emerald-500">{item.result === "success" ? "成功" : "失败"}</TableCell><TableCell className="px-6 text-[var(--color-text-secondary)]">{item.message}</TableCell></TableRow>)}</TableBody></Table></div>
  );
}

function DataLoading() {
  return <section className="flex min-h-[260px] items-center justify-center rounded-2xl bg-white text-sm text-[var(--color-text-tertiary)]"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />加载中...</section>;
}

function DataEmpty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <section className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl bg-white text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)]"><div className="mb-4 text-[var(--color-text-tertiary)]">{icon}</div><p className="text-base font-semibold text-[var(--color-text-secondary)]">{title}</p><p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{description}</p></section>;
}

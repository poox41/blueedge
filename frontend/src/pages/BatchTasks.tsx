import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Activity,
  ArrowRight,
  ClipboardList,
  Check,
  ChevronLeft,
  Clock3,
  Eye,
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
import {
  cancelBatchTask,
  createImagePreheatTask,
  createNodeUpgradeTask,
  deleteBatchTask,
  getBatchTask,
  listBatchTasks,
  startBatchTask,
} from "@/api/services/product";
import { cn } from "@/lib/utils";

type BatchTaskType = "节点升级" | "镜像预热";
type UpgradeStatus = "计划已完成" | "计划生成失败" | "计划初始化" | "计划待生成" | "计划已生成" | "计划部分生成" | "计划已取消";
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
  labelKey: string;
  labelValue: string;
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
  labelKey: string;
  labelValue: string;
  credentialNamespace: string;
  credentialName: string;
  selectedNodes: string[];
  concurrency: string;
  timeout: string;
  failureRate: string;
  retryCount: string;
  resourceCheck: string[];
};

const edgeNodeOptions = ["edge-riscv-01", "edge-riscv-02", "edge-arm-03", "edge-x86-04"];

const defaultUpgradeForm: UpgradeForm = {
  name: "",
  description: "",
  image: "",
  version: "",
  selectorType: "label",
  labelKey: "arch",
  labelValue: "riscv64",
  selectedNodes: ["edge-riscv-01", "edge-riscv-02"],
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
  labelKey: "region",
  labelValue: "store",
  credentialNamespace: "",
  credentialName: "",
  selectedNodes: ["edge-x86-04"],
  concurrency: "2",
  timeout: "",
  failureRate: "10",
  retryCount: "3",
  resourceCheck: ["CPU", "内存"],
};

const upgradeStatusStyle: Record<UpgradeStatus, { className: string; dot: string }> = {
  计划已完成: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  计划生成失败: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ff4d4f" },
  计划初始化: { className: "bg-transparent text-[#475569]", dot: "#64748b" },
  计划待生成: { className: "bg-[#f1f5f9] text-[#64748b]", dot: "#94a3b8" },
  计划已生成: { className: "bg-[#dbeafe] text-[#2563eb]", dot: "#2563eb" },
  计划部分生成: { className: "bg-[#fff7ed] text-[#c2410c]", dot: "#f97316" },
  计划已取消: { className: "bg-[#f8fafc] text-[#64748b]", dot: "#94a3b8" },
};

const preheatStatusStyle: Record<PreheatStatus, { className: string; dot: string }> = {
  计划已生成: { className: "bg-[#dbeafe] text-[#2563eb]", dot: "#2563eb" },
  计划部分生成: { className: "bg-[#fff7ed] text-[#c2410c]", dot: "#f97316" },
  计划待生成: { className: "bg-[#f1f5f9] text-[#64748b]", dot: "#94a3b8" },
  计划已完成: { className: "bg-[#dcfce7] text-[#16a34a]", dot: "#22c55e" },
  计划生成失败: { className: "bg-[#fee2e2] text-[#ef4444]", dot: "#ff4d4f" },
  计划初始化: { className: "bg-transparent text-[#475569]", dot: "#64748b" },
  计划已取消: { className: "bg-[#f8fafc] text-[#64748b]", dot: "#94a3b8" },
};

export function BatchTasks() {
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [activeType, setActiveType] = useState<BatchTaskType>("节点升级");
  const [search, setSearch] = useState("");
  const [createUpgradeOpen, setCreateUpgradeOpen] = useState(false);
  const [createPreheatOpen, setCreatePreheatOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BatchTask | null>(null);
  const [detailTarget, setDetailTarget] = useState<BatchTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listBatchTasks();
      setTasks(data.items.filter((item) => item.type === "nodeUpgrade" || item.type === "imagePreheat").map((item) => toBatchTaskRow(item) as BatchTask));
    } catch (err) {
      setTasks([]);
      setError(err instanceof Error ? err.message : "批量任务加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tasks.filter((task) => task.type === activeType && (!keyword || task.name.toLowerCase().includes(keyword)));
  }, [activeType, search, tasks]);

  const openDetail = async (task: BatchTask) => {
    setError("");
    try {
      const data = await getBatchTask(task.id);
      setDetailTarget(toBatchTaskRow(data.item) as BatchTask);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量任务详情加载失败");
    }
  };

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
        targetRefs: form.selectorType === "nodes" ? form.selectedNodes : [form.labelValue.trim()],
        image: form.image.trim(),
        targetVersion: form.version.trim(),
        concurrency: Number(form.concurrency || 1),
        failurePolicy: "continue",
        timeoutSeconds: Number(form.timeout || 0),
        retryCount: 0,
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
        targetRefs: form.selectorType === "nodes" ? form.selectedNodes : [form.labelValue.trim()],
        images: form.images.map((item) => item.trim()).filter(Boolean),
        concurrency: Number(form.concurrency || 1),
        failurePolicy: "continue",
        timeoutSeconds: Number(form.timeout || 0),
        retryCount: Number(form.retryCount || 0),
        description: form.description || "镜像预热计划任务",
      });
      setActiveType("镜像预热");
      setCreatePreheatOpen(false);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建镜像预热计划失败");
    }
  };

  if (detailTarget) {
    return (
      <BatchTaskDetailPage
        task={detailTarget}
        onBack={() => setDetailTarget(null)}
        onDelete={async () => {
          try {
            await deleteBatchTask(detailTarget.id);
            setDetailTarget(null);
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "删除批量任务失败");
          }
        }}
        onRetry={async () => {
          try {
            const data = await startBatchTask(detailTarget.id);
            setDetailTarget(toBatchTaskRow(data.item) as BatchTask);
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "启动批量任务失败");
          }
        }}
        onRollback={async () => {
          try {
            const data = await cancelBatchTask(detailTarget.id);
            setDetailTarget(toBatchTaskRow(data.item) as BatchTask);
            await loadTasks();
          } catch (err) {
            setError(err instanceof Error ? err.message : "取消批量任务失败");
          }
        }}
      />
    );
  }

  return (
    <div className="blueedge-page space-y-5">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">批量任务</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">创建节点升级和镜像预热计划任务；当前不会执行真实节点操作</p>
      </section>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}

      <section className="page-toolbar">
        <div className="inline-flex h-10 items-center rounded-xl border border-[var(--color-border)] bg-white p-1">
          {(["节点升级", "镜像预热"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setActiveType(type);
                setSearch("");
              }}
              className={cn(
                "inline-flex h-8 items-center justify-center rounded-[10px] px-5 text-sm transition-colors",
                activeType === type
                  ? "bg-[#0f172a] font-medium text-white"
                  : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
              )}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索任务名称"
              className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-9 text-sm shadow-sm"
            />
          </div>
          <button type="button" onClick={() => void loadTasks()} className="action-button h-10 w-10" title="刷新">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Button type="button" onClick={() => activeType === "节点升级" ? setCreateUpgradeOpen(true) : setCreatePreheatOpen(true)} className="h-10 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033]">
            <Plus className="h-4 w-4" />
            {activeType === "节点升级" ? "创建节点升级计划" : "创建镜像预热计划"}
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
                <TableRow key={task.id} className="h-[68px] hover:bg-[var(--color-bg-hover)]">
                  {activeType === "节点升级" ? (
                    <UpgradeTaskRow task={task} onDetail={() => void openDetail(task)} onDelete={() => setDeleteTarget(task)} />
                  ) : (
                    <PreheatTaskRow task={task} onDetail={() => void openDetail(task)} onDelete={() => setDeleteTarget(task)} />
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
      />

      <CreatePreheatTaskModal
        open={createPreheatOpen}
        onOpenChange={setCreatePreheatOpen}
        onSubmit={createPreheatTask}
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
        <button type="button" onClick={onDetail} className="text-left text-sm font-semibold text-[#1e6bff] hover:underline">
          {task.name}
        </button>
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
        <button type="button" onClick={onDetail} className="text-left text-sm font-semibold text-[#1e6bff] hover:underline">
          {task.name}
        </button>
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
  const style = (variant === "upgrade" ? upgradeStatusStyle[status as UpgradeStatus] : preheatStatusStyle[status as PreheatStatus]) || preheatStatusStyle.计划待生成;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", style.className)}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {status}
    </span>
  );
}

function RowActions({ onDetail, onDelete }: { onDetail: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
      <button type="button" className="action-button" title="查看详情" onClick={onDetail}>
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="action-button is-danger" title="删除" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CreateUpgradeTaskModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: UpgradeForm) => void;
}) {
  const [step, setStep] = useState(1);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(defaultUpgradeForm);

  const resetAndClose = () => {
    setStep(1);
    setErrors({});
    setForm(defaultUpgradeForm);
    onOpenChange(false);
  };

  const requestClose = () => setCancelOpen(true);

  const validateStep1 = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "请输入任务名称";
    if (form.name.trim() && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(form.name.trim())) nextErrors.name = "名称格式不正确";
    if (!form.version.trim()) nextErrors.version = "请输入升级版本";
    if (form.selectorType === "nodes" && form.selectedNodes.length === 0) nextErrors.nodes = "请至少选择 1 个节点";
    if (form.selectorType === "label" && (!form.labelKey.trim() || !form.labelValue.trim())) nextErrors.labels = "请输入标签键和值";
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

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : requestClose())}>
        <DialogContent
          className="!flex max-h-[calc(100vh-48px)] w-[min(1200px,calc(100vw-96px))] max-w-none flex-col gap-0 overflow-hidden rounded-[28px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]"
          showCloseButton={false}
        >
          <DialogHeader className="h-[92px] shrink-0 border-b border-[var(--color-border)] px-10 py-0">
            <div className="flex h-full items-center justify-between">
              <div className="flex items-center gap-3">
                {step === 2 && (
                  <button type="button" onClick={() => setStep(1)} className="action-button">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <DialogTitle className="text-xl font-semibold text-[#111827]">创建节点升级任务</DialogTitle>
              </div>
              <button type="button" onClick={requestClose} className="flex h-[54px] w-[54px] items-center justify-center rounded-2xl border border-[var(--color-border-strong)] text-[#64748b] hover:bg-[var(--color-bg-hover)]">
                <X className="h-5 w-5" />
              </button>
            </div>
          </DialogHeader>

          <div className="shrink-0 border-b border-[var(--color-border)] px-10 py-6">
            <div className="flex items-center justify-center gap-4">
              <StepDot active={step === 1} done={step > 1} label="基础信息" />
              <div className={cn("h-px w-16", step > 1 ? "bg-[#0f172a]" : "bg-[var(--color-border-strong)]")} />
              <StepDot active={step === 2} done={false} label="任务设置" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            {step === 1 ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-5 py-4 text-sm text-[#c2410c]">
                  <Info className="h-5 w-5 shrink-0" />
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
                    className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="描述">
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder="请输入任务描述"
                    className="min-h-[112px] rounded-xl border-2 border-[var(--color-input-border)] px-4 py-3 text-base shadow-sm focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="升级镜像" helper="如果您未填写升级镜像，将默认使用系统提供的镜像地址进行升级。">
                  <Input
                    value={form.image}
                    onChange={(event) => setForm({ ...form, image: event.target.value })}
                    placeholder="kubeedge/installation-package"
                    className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0"
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
                    className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0"
                  />
                </CreateField>

                <CreateField label="边缘节点" required error={errors.labels || errors.nodes}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, selectorType: "label" })}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        form.selectorType === "label" ? "border-[#0f172a] bg-[#fafbfc]" : "border-[var(--color-border-strong)] bg-white",
                      )}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <Toggle enabled={form.selectorType === "label"} />
                        <span className="text-sm font-semibold text-[#111827]">标签匹配</span>
                        <span className="text-xs text-[var(--color-text-tertiary)]">通过标签选择器自动匹配节点</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={form.labelKey} onChange={(event) => setForm({ ...form, labelKey: event.target.value })} className="h-10 rounded-xl" placeholder="标签键" />
                        <Input value={form.labelValue} onChange={(event) => setForm({ ...form, labelValue: event.target.value })} className="h-10 rounded-xl" placeholder="标签值" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setForm({ ...form, selectorType: "nodes" })}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        form.selectorType === "nodes" ? "border-[#0f172a] bg-[#fafbfc]" : "border-[var(--color-border-strong)] bg-white",
                      )}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <Toggle enabled={form.selectorType === "nodes"} />
                        <span className="text-sm font-semibold text-[#111827]">指定节点</span>
                        <span className="text-xs text-[var(--color-text-tertiary)]">手动选择特定节点</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {edgeNodeOptions.map((node) => (
                          <span
                            key={node}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleNode(node);
                            }}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs",
                              form.selectedNodes.includes(node) ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]",
                            )}
                          >
                            {node}
                          </span>
                        ))}
                      </div>
                    </button>
                  </div>
                </CreateField>

                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setForm({ ...form, userConfirm: !form.userConfirm })}>
                    <Toggle enabled={form.userConfirm} />
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-[#111827]">边缘用户确认</p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">开启后，边缘用户需手动确认才能开始升级。</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <CreateField label="并行数" required helper="任务执行过程中允许同时拉取镜像的边缘节点数量，并行数应不大于节点总数">
                  <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
                </CreateField>
                <CreateField label="超时时间" helper="任务运行的最大时间，当任务执行超出该时间时，任务将被识别为执行失败。为空时表示不设置超时时间。">
                  <Input value={form.timeout} onChange={(event) => setForm({ ...form, timeout: event.target.value })} placeholder="为空表示不设置" className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
                </CreateField>
                <CreateField label="容错失败率" helper="任务完成可以容忍拉取镜像失败的节点数量占比">
                  <Input value={form.failureRate} onChange={(event) => setForm({ ...form, failureRate: event.target.value })} className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
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

          <DialogFooter className="h-[84px] shrink-0 border-t border-[var(--color-border)] px-10 py-0">
            <div className="flex w-full items-center justify-between">
              <div>
                {step === 2 && (
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-11 rounded-xl px-7">
                    上一步
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={requestClose} className="h-11 rounded-xl px-7 text-base">
                  取消
                </Button>
                {step === 1 ? (
                  <Button type="button" onClick={handleNext} className="h-11 rounded-xl bg-[#0f172a] px-8 text-base text-white hover:bg-[#172033]">
                    下一步
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setConfirmOpen(true)} className="h-11 rounded-xl bg-[#0f172a] px-8 text-base text-white hover:bg-[#172033]">
                    创建
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="z-[120] max-w-[560px] rounded-[24px] p-0">
          <AlertDialogHeader className="border-b border-[var(--color-border)] px-8 py-6">
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <AlertTriangle className="h-6 w-6 text-[var(--color-danger)]" />
              确认取消创建
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-4 text-base">取消后，当前创建任务内容将不会保存。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-8 py-6">
            <AlertDialogCancel className="h-11 rounded-xl px-8">取消</AlertDialogCancel>
            <AlertDialogAction onClick={resetAndClose} className="h-11 rounded-xl bg-[var(--color-danger)] px-8 text-white hover:bg-[var(--color-danger)]/90">
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[460px] rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认创建</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">当前仅创建节点升级计划任务，不会对节点执行真实升级。确定继续吗？</AlertDialogDescription>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: PreheatForm) => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(defaultPreheatForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    if (form.selectorType === "label" && (!form.labelKey.trim() || !form.labelValue.trim())) nextErrors.labels = "请输入标签键和值";
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
        className="!flex max-h-[calc(100vh-48px)] w-[min(960px,calc(100vw-96px))] max-w-none flex-col gap-0 overflow-hidden rounded-[28px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]"
        showCloseButton={false}
      >
        <DialogHeader className="h-[92px] shrink-0 border-b border-[var(--color-border)] px-10 py-0">
          <div className="flex h-full items-center justify-between">
            <div className="flex items-center gap-3">
              {step === 2 && (
                <button type="button" onClick={() => setStep(1)} className="action-button">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="text-xl font-semibold text-[#111827]">创建镜像预热任务</DialogTitle>
            </div>
            <button type="button" onClick={resetAndClose} className="flex h-[54px] w-[54px] items-center justify-center rounded-2xl border border-[var(--color-border-strong)] text-[#64748b] hover:bg-[var(--color-bg-hover)]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-[var(--color-border)] px-10 py-6">
          <div className="flex items-center justify-center gap-4">
            <StepDot active={step === 1} done={step > 1} label="基础信息" />
            <div className={cn("h-px w-16", step > 1 ? "bg-[#0f172a]" : "bg-[var(--color-border-strong)]")} />
            <StepDot active={step === 2} done={false} label="任务设置" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          {step === 1 ? (
            <div className="space-y-6">
              <CreateField label="任务名称" required error={errors.name} helper="最长 253 字符，只能是小写字母、数字、中划线(-)、点(.)的组合，不能有连续符号">
                <Input
                  value={form.name}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value });
                    setErrors(({ name, ...rest }) => rest);
                  }}
                  placeholder="warmup-nginx"
                  className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0"
                />
              </CreateField>

              <CreateField label="描述">
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="请输入任务描述"
                  className="min-h-[96px] rounded-xl border-2 border-[var(--color-input-border)] px-4 py-3 text-base shadow-sm focus-visible:ring-0"
                />
              </CreateField>

              <CreateField label="镜像" required error={errors.images}>
                <div className="space-y-2">
                  {form.images.map((image, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={image}
                        onChange={(event) => updateImage(index, event.target.value)}
                        placeholder="nginx:1.25-alpine"
                        className="h-12 flex-1 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0"
                      />
                      {form.images.length > 1 && (
                        <button type="button" onClick={() => removeImage(index)} className="action-button is-danger">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addImage} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#1e6bff]">
                  <Plus className="h-4 w-4" />
                  添加更多镜像
                </button>
              </CreateField>

              <CreateField label="镜像凭证">
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={form.credentialNamespace}
                    onChange={(event) => setForm({ ...form, credentialNamespace: event.target.value })}
                    className="blueedge-native-select h-12 rounded-xl border-2 text-base"
                  >
                    <option value="">请选择命名空间</option>
                    <option value="default">default</option>
                    <option value="kube-system">kube-system</option>
                    <option value="iot-system">iot-system</option>
                  </select>
                  <select
                    value={form.credentialName}
                    onChange={(event) => setForm({ ...form, credentialName: event.target.value })}
                    className="blueedge-native-select h-12 rounded-xl border-2 text-base"
                  >
                    <option value="">请选择镜像凭证</option>
                    <option value="docker-hub">docker-hub</option>
                    <option value="aliyun-cr">aliyun-cr</option>
                    <option value="harbor-local">harbor-local</option>
                  </select>
                </div>
              </CreateField>

              <CreateField label="选择方式" required error={errors.labels || errors.nodes}>
                <div className="grid gap-4 md:grid-cols-2">
                  <TargetModeCard
                    active={form.selectorType === "label"}
                    title="标签匹配"
                    description="自动匹配需要预热的节点"
                    onClick={() => setForm({ ...form, selectorType: "label" })}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={form.labelKey} onChange={(event) => setForm({ ...form, labelKey: event.target.value })} className="h-10 rounded-xl" placeholder="标签键" />
                      <Input value={form.labelValue} onChange={(event) => setForm({ ...form, labelValue: event.target.value })} className="h-10 rounded-xl" placeholder="标签值" />
                    </div>
                  </TargetModeCard>

                  <TargetModeCard
                    active={form.selectorType === "nodes"}
                    title="指定节点"
                    description="手动选择目标节点"
                    onClick={() => setForm({ ...form, selectorType: "nodes" })}
                  >
                    <div className="space-y-2">
                      {edgeNodeOptions.map((node) => (
                        <button
                          key={node}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleNode(node);
                          }}
                          className={cn(
                            "block w-full rounded-lg border px-3 py-2 text-left text-sm",
                            form.selectedNodes.includes(node) ? "border-[#0f172a] bg-white text-[#111827]" : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]",
                          )}
                        >
                          {node}
                        </button>
                      ))}
                    </div>
                  </TargetModeCard>
                </div>
              </CreateField>
            </div>
          ) : (
            <div className="space-y-6">
              <CreateField label="并行数" required helper="任务执行过程中允许同时拉取镜像的边缘节点数量，并行数应不大于节点总数">
                <Input value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: event.target.value })} className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
              </CreateField>
              <CreateField label="超时时间" helper="任务运行的最大时间，当任务执行超出该时间时，任务将被识别为执行失败。为空时表示不设置超时时间。">
                <Input value={form.timeout} onChange={(event) => setForm({ ...form, timeout: event.target.value })} placeholder="为空表示不设置" className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
              </CreateField>
              <CreateField label="容错失败率" helper="任务完成可以容忍拉取镜像失败的节点数量占比">
                <Input value={form.failureRate} onChange={(event) => setForm({ ...form, failureRate: event.target.value })} className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
              </CreateField>
              <CreateField label="重试次数" helper="任务标识为失败前允许重试的最大次数">
                <Input value={form.retryCount} onChange={(event) => setForm({ ...form, retryCount: event.target.value })} className="h-12 rounded-xl border-2 border-[var(--color-input-border)] px-4 text-base shadow-sm focus-visible:ring-0" />
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

        <DialogFooter className="h-[84px] shrink-0 border-t border-[var(--color-border)] px-10 py-0">
          <div className="flex w-full items-center justify-between">
            <div>
              {step === 2 && (
                <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-11 rounded-xl px-7">
                  上一步
                </Button>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={resetAndClose} className="h-11 rounded-xl px-7 text-base">
              取消
            </Button>
            {step === 1 ? (
              <Button type="button" onClick={() => validateStep1() && setStep(2)} className="h-11 rounded-xl bg-[#0f172a] px-8 text-base text-white hover:bg-[#172033]">
                下一步
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={submit} className="h-11 rounded-xl bg-[#0f172a] px-8 text-base text-white hover:bg-[#172033]">
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

function TargetModeCard({
  active,
  title,
  description,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[180px] rounded-2xl border p-5 text-left transition-colors",
        active ? "border-[#0f172a] bg-[#fafbfc]" : "border-[var(--color-border-strong)] bg-white",
      )}
    >
      <div className="mb-4 flex items-center gap-4">
        <Toggle enabled={active} />
        <div>
          <p className="text-base font-semibold leading-6 text-[#111827]">{title}</p>
          <p className="text-sm text-[var(--color-text-tertiary)]">{description}</p>
        </div>
      </div>
      {children}
    </button>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", active || done ? "bg-[#0f172a]" : "bg-[#e2e8f0]")}>
        {done ? <Check className="h-4 w-4 text-white" /> : <span className={cn("h-2.5 w-2.5 rounded-full", active ? "bg-white" : "bg-[#94a3b8]")} />}
      </span>
      <span className={cn("text-sm font-semibold", active || done ? "text-[#111827]" : "text-[var(--color-text-tertiary)]")}>{label}</span>
    </div>
  );
}

function Toggle({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn("relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-colors", enabled ? "bg-[#0f172a]" : "bg-[#d1d5db]")}>
      <span className={cn("absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all", enabled ? "left-[21px]" : "left-[3px]")} />
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
      <Label className="mb-2 block text-base font-semibold text-[#111827]">
        {label} {required && <span className="text-[var(--color-danger)]">*</span>}
      </Label>
      {children}
      {helper && <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{helper}</p>}
      {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function BatchTaskDetailPage({ task, onBack, onDelete, onRetry, onRollback }: { task: BatchTask; onBack: () => void; onDelete: () => void; onRetry: () => void; onRollback: () => void }) {
  const [activeTab, setActiveTab] = useState<"detail" | "progress" | "events" | "audit">("detail");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const detail = getTaskDetail(task);

  const runAction = (message: string, action: () => void) => {
    action();
    setToast(message);
    window.setTimeout(() => setToast(""), 1600);
  };

  return (
    <div className="blueedge-page space-y-7">
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
          <button type="button" onClick={onBack} className="action-button h-11 w-11 rounded-xl bg-white">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{task.name}</h1>
              <StatusPill status={task.status as UpgradeStatus} variant={task.type === "节点升级" ? "upgrade" : "preheat"} />
              <span className="inline-flex h-7 items-center rounded-lg bg-[#dbeafe] px-3 text-xs font-semibold text-[#2563eb]">{task.type}计划任务</span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{task.targetNodes} 个目标节点 · 创建于 {task.createTime}</p>
          </div>
        </div>
        <div className="relative flex items-center gap-3">
          {toast && (
            <div className="fixed right-8 top-6 z-[120] flex h-12 min-w-[250px] items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-white px-5 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_14px_36px_rgba(15,23,42,0.14)]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[#3b82f6] text-[11px] font-bold leading-none text-[#3b82f6]">i</span>
              <span className="whitespace-nowrap">{toast}</span>
              <button type="button" onClick={() => setToast("")} className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <Button type="button" onClick={() => runAction("计划已生成，当前不会执行真实节点操作", onRetry)} className="h-10 rounded-xl bg-[#0f172a] px-4 text-sm font-semibold text-white hover:bg-[#172033]">
            <RotateCcw className="h-4 w-4" />
            生成计划
          </Button>
          <Button type="button" variant="outline" onClick={() => runAction("任务已取消", onRollback)} className="h-10 rounded-xl bg-white px-4 text-sm font-semibold">
            <Clock3 className="h-4 w-4" />
            取消任务
          </Button>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="action-button h-10 w-10 rounded-xl bg-white" aria-label="更多操作">
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

      <section className="rounded-2xl bg-white px-10 py-8 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <h2 className="mb-7 text-base font-bold text-[var(--color-text-primary)]">基本信息</h2>
        <div className="grid grid-cols-4 gap-x-14 gap-y-8">
          <DetailInfo label="任务名称" value={task.name} />
          <DetailInfo label="任务状态" value={<StatusPill status={task.status as UpgradeStatus} variant={task.type === "节点升级" ? "upgrade" : "preheat"} />} />
          <DetailInfo label="任务类型" value={<span className="inline-flex h-7 items-center rounded-lg bg-[#dbeafe] px-3 text-xs font-semibold text-[#2563eb]">{task.type}</span>} />
          <DetailInfo label={task.type === "节点升级" ? "升级镜像" : "镜像"} value={task.image || "-"} />
          <DetailInfo label="并行数" value={detail.concurrency} />
          <DetailInfo label="目标节点数" value={`${task.targetNodes} 个`} />
          <DetailInfo label="重试次数" value={detail.retryCount} />
          <DetailInfo label="容错失败率" value={detail.failureRate} />
          <DetailInfo label="计划目标已生成" value={<span className="text-[#16a34a]">{detail.success}</span>} />
          <DetailInfo label="计划目标生成失败" value={<span className="text-[#ff4d4f]">{detail.failed}</span>} />
          <DetailInfo label="跳过" value={<span className="text-[#f59e0b]">{detail.skipped}</span>} />
          <DetailInfo label="创建时间" value={task.createTime} />
          <DetailInfo label={task.type === "节点升级" ? "升级版本" : "镜像数量"} value={task.version || "1"} />
          <DetailInfo label="超时时间" value={detail.timeout} />
          <DetailInfo label="资源检查" value={detail.resourceCheck} />
          <DetailInfo label="执行模式" value={task.executionMode === "planOnly" ? "计划态，不执行真实节点操作" : task.executionMode || "-"} />
        </div>
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <DetailInfo label="描述" value={task.description || "-"} />
        </div>
      </section>

      <section className="flex items-center gap-3">
        <DetailTab active={activeTab === "detail"} icon={<ServerIcon />} label="任务详情" onClick={() => setActiveTab("detail")} />
        <DetailTab active={activeTab === "progress"} icon={<Activity className="h-4 w-4" />} label="执行进度" onClick={() => setActiveTab("progress")} />
        <DetailTab active={activeTab === "events"} icon={<AlertTriangle className="h-4 w-4" />} label="事件" onClick={() => setActiveTab("events")} />
        <DetailTab active={activeTab === "audit"} icon={<ClipboardList className="h-4 w-4" />} label="审计" onClick={() => setActiveTab("audit")} />
      </section>

      {activeTab === "detail" && <TaskStatusTable task={task} />}
      {activeTab === "progress" && <ExecutionProgressPanel task={task} />}
      {activeTab === "events" && <TaskEventsPanel />}
      {activeTab === "audit" && <TaskAuditPanel task={task} />}

    </div>
  );
}

function ServerIcon() {
  return <span className="inline-block h-4 w-4 rounded-[3px] border-2 border-current before:mt-[3px] before:block before:h-[2px] before:bg-current after:mt-[3px] after:block after:h-[2px] after:bg-current" />;
}

function getTaskDetail(task: BatchTask) {
  const raw = task.raw;
  return {
    concurrency: String(raw?.concurrency ?? "-"),
    retryCount: String(raw?.retryCount ?? "0"),
    failureRate: raw?.failurePolicy === "stop" ? "失败即停止" : "失败继续",
    skipped: "0",
    success: String(raw?.successCount ?? 0),
    failed: String(raw?.failedCount ?? 0),
    timeout: raw?.timeoutSeconds ? `${raw.timeoutSeconds} 秒` : "-",
    resourceCheck: "第一阶段仅生成计划",
  };
}

function DetailInfo({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm text-[var(--color-text-tertiary)]">{label}</p>
      <div className="text-base font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

function DetailTab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-11 items-center gap-2 rounded-xl border px-5 text-sm font-semibold transition-colors", active ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]")}>
      {icon}
      {label}
    </button>
  );
}

function stepStatusText(status: string): UpgradeStatus {
  if (status === "running") return "计划已生成";
  if (status === "succeeded" || status === "success") return "计划已完成";
  if (status === "failed") return "计划生成失败";
  if (status === "cancelled") return "计划已取消";
  return "计划待生成";
}

function TaskStatusTable({ task }: { task: BatchTask }) {
  const rows = task.raw?.targetResults && task.raw.targetResults.length > 0
    ? task.raw.targetResults
    : (task.raw?.targetRefs || []).map((target) => ({ target, status: "pending", message: "planOnly: waiting for execution plan" }));
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--color-text-primary)]">{task.type === "节点升级" ? "节点升级计划状态" : "镜像预热计划状态"}</h2>
        <button type="button" className="action-button h-10 w-10 bg-white"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">节点名称</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">当前事件</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">升级前版本</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">升级后版本</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">开始时间</TableHead>
              <TableHead className="px-6 text-xs text-[var(--color-text-tertiary)]">结束时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.target} className="h-[76px]">
                <TableCell className="px-6 text-sm font-semibold text-[#1e6bff]">{row.target}</TableCell>
                <TableCell className="px-6"><StatusPill status={stepStatusText(row.status)} variant="upgrade" /></TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-secondary)]">{row.message || "计划态，尚未执行真实节点操作"}</TableCell>
                <TableCell className="px-6 font-mono text-sm text-[var(--color-text-primary)]">-</TableCell>
                <TableCell className="px-6 font-mono text-sm text-[var(--color-text-primary)]">{task.version || "-"}</TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-tertiary)]">{task.raw?.startedAt || "-"}</TableCell>
                <TableCell className="px-6 text-sm text-[var(--color-text-tertiary)]">{task.raw?.finishedAt || "-"}</TableCell>
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
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <h2 className="mb-6 text-base font-bold text-[var(--color-text-primary)]">执行概览</h2>
        <div className="grid grid-cols-[140px_140px_140px_140px_1fr] items-center gap-6">
          <ProgressMetric label="目标节点" value={String(task.targetNodes)} />
          <ProgressMetric label="成功" value={detail.success} tone="success" />
          <ProgressMetric label="失败" value={detail.failed} tone="danger" />
          <ProgressMetric label="跳过" value={detail.skipped} tone="warning" />
          <div>
            <div className="h-2 rounded-full bg-[#e5e7eb]">
              <div className="h-2 rounded-full bg-[#20c77a]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-3 text-right text-sm text-[var(--color-text-tertiary)]">{progress}% 完成</p>
          </div>
        </div>
      </section>
      <section className="rounded-2xl bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
        <h2 className="mb-6 text-base font-bold text-[var(--color-text-primary)]">执行步骤</h2>
        <div className="space-y-4">
          {steps.map((row, index) => (
            <div key={row.name} className="flex items-center justify-between rounded-2xl bg-[#f8fafc] px-5 py-4">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e0f2fe] text-sm font-bold text-[#2563eb]">{index + 1}</span>
                <div>
                  <div className="flex items-center gap-3">
                    <p className="text-base font-bold text-[var(--color-text-primary)]">{row.name}</p>
                    <StatusPill status={stepStatusText(row.status)} variant="upgrade" />
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">{row.message || "计划步骤，尚未接入真实执行器"}</p>
                </div>
              </div>
              <span className="rounded-md bg-[#eef2f7] px-3 py-1 font-mono text-sm font-semibold text-[var(--color-text-secondary)]">planOnly</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProgressMetric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "warning" }) {
  return (
    <div className="border-r border-[var(--color-border)] text-center last:border-r-0">
      <p className={cn("text-4xl font-bold text-[var(--color-text-primary)]", tone === "success" && "text-[#16a34a]", tone === "danger" && "text-[#ff4d4f]", tone === "warning" && "text-[#f59e0b]")}>{value}</p>
      <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{label}</p>
    </div>
  );
}

function TaskEventsPanel() {
  return (
    <section className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl bg-white text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <AlertTriangle className="mb-4 h-12 w-12 text-[var(--color-text-tertiary)]" />
      <p className="text-base font-semibold text-[var(--color-text-secondary)]">暂无事件</p>
      <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">第一阶段仅持久化任务计划，尚未接入真实执行事件</p>
    </section>
  );
}

function TaskAuditPanel({ task }: { task: BatchTask }) {
  return (
    <section className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl bg-white text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <ClipboardList className="mb-4 h-12 w-12 text-[var(--color-text-tertiary)]" />
      <p className="text-base font-semibold text-[var(--color-text-secondary)]">暂无审计记录</p>
      <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{task.name} 当前为计划态任务，真实执行审计待后续执行器接入</p>
    </section>
  );
}

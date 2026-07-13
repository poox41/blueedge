import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
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
import { createBatchWorkloadTask, deleteBatchTask, listBatchTasks } from "@/api/services/product";
import { cn } from "@/lib/utils";

type BatchWorkload = {
  id: string;
  name: string;
  namespace: string;
  image: string;
  targetGroups: string[];
  status: "部署计划已生成" | "部署计划生成失败" | "部署计划待生成" | "部署计划已取消";
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
  name: `container-${index + 1}`,
  image: index === 0 ? "nginx:1.25-alpine" : "",
  pullPolicy: "IfNotPresent",
  privileged: false,
  cpuRequest: "100m",
  cpuLimit: "500m",
  memoryRequest: "128Mi",
  memoryLimit: "512Mi",
  lifecyclePostStart: "",
  lifecyclePreStop: "",
  startupProbe: false,
  readinessProbe: false,
  livenessProbe: false,
  envs: [{ id: `env-${Date.now()}-${index}`, key: "", value: "" }],
  volumes: [],
  runAsUser: "1000",
  runAsGroup: "1000",
  readOnlyRootFilesystem: false,
  allowPrivilegeEscalation: false,
});

const defaultBatchImageForm = (): BatchImageCreateForm => ({
  name: "",
  namespace: "",
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

const defaultBatchYaml = `apiVersion: batch/v1
kind: BatchDeployment
metadata:
  name: batch-app
  namespace: default
spec:
  image: nginx:1.25-alpine
  targetGroups:
    - riscv-production
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

const batchWorkloadYaml = (item: BatchWorkload) => `apiVersion: batch/v1
kind: BatchDeployment
metadata:
  name: ${item.name}
  namespace: ${item.namespace}
spec:
  image: ${item.image}
  targetGroups:
${item.targetGroups.map((group) => `    - ${group}`).join("\n")}
  rolloutPolicy: ${item.rolloutPolicy}
  rollbackPolicy: ${item.rollbackPolicy}
`;

export function BatchWorkloads() {
  const [items, setItems] = useState<BatchWorkload[]>([]);
  const [search, setSearch] = useState("");
  const [yamlOpen, setYamlOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [definitionTarget, setDefinitionTarget] = useState<BatchWorkload | null>(null);
  const [yamlTarget, setYamlTarget] = useState<BatchWorkload | null>(null);
  const [deployTarget, setDeployTarget] = useState<BatchWorkload | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BatchWorkload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadItems = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listBatchTasks();
      setItems(data.items.filter((item) => item.type === "batchWorkload").map((item) => toBatchWorkloadRow(item) as BatchWorkload));
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "批量工作负载加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => [item.name, item.namespace, item.image].some((value) => value.toLowerCase().includes(keyword)));
  }, [items, search]);

  const createFromYaml = async (yaml: string) => {
    const name = yaml.match(/\n\s*name:\s*([^\n]+)/)?.[1]?.trim() || `batch-workload-${Date.now().toString().slice(-5)}`;
    const namespace = yaml.match(/\n\s*namespace:\s*([^\n]+)/)?.[1]?.trim() || "default";
    const image = yaml.match(/\n\s*image:\s*([^\n]+)/)?.[1]?.trim() || "nginx:1.25-alpine";
    const targetGroups = Array.from(yaml.matchAll(/^\s*-\s*([A-Za-z0-9_.-]+)\s*$/gm)).map((match) => match[1]).filter(Boolean);
    try {
      await createBatchWorkloadTask({
        name,
        targetType: "deployment",
        targetRefs: targetGroups.length ? targetGroups : ["default"],
        image,
        failurePolicy: "continue",
        description: "YAML 批量工作负载计划",
        targets: [{ namespace, image, yaml }],
      });
      setYamlOpen(false);
      setYamlTarget(null);
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
        targetRefs: [form.namespace || "default"],
        image: primaryImage,
        failurePolicy: "continue",
        description: form.description || "镜像批量工作负载计划",
        targets: [{ namespace: form.namespace || "default", image: primaryImage, replicas: Number(form.replicas || 1), containers: form.containers }],
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
      await deleteBatchTask(deleteTarget.id);
      setDeleteTarget(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除批量工作负载失败");
    }
  };

  if (definitionTarget) {
    return (
      <div className="blueedge-page">
        <BatchWorkloadDefinitionPage
          item={definitionTarget}
          onBack={() => setDefinitionTarget(null)}
          onEditYaml={() => setYamlTarget(definitionTarget)}
          onEditSection={() => setImageOpen(true)}
        />
        <BatchYamlEditor
          open={!!yamlTarget}
          title="编辑 YAML"
          defaultValue={yamlTarget ? batchWorkloadYaml(yamlTarget) : defaultBatchYaml}
          onSubmit={(yaml) => {
            if (!yamlTarget) return;
            void yaml;
            setError("第一阶段批量工作负载仅支持创建计划和删除，不支持本地编辑假保存");
            setYamlTarget(null);
          }}
          onCancel={() => setYamlTarget(null)}
        />
        <ImageCreateDialog open={imageOpen} onOpenChange={setImageOpen} onCreate={createFromImage} />
      </div>
    );
  }

  return (
    <div className="blueedge-page space-y-5">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">批量工作负载</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">创建批量工作负载部署计划；当前不会向 Kubernetes 下发 Deployment</p>
      </section>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}

      <section className="page-toolbar">
        <div className="relative w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索批量工作负载名称..."
            className="h-10 rounded-xl border-[var(--color-input-border)] bg-white pl-9 text-sm shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadItems()} className="action-button h-10 w-10" title="刷新">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Button variant="outline" onClick={() => setYamlOpen(true)} className="h-10 rounded-xl bg-white px-5 text-sm font-semibold">
            YAML 创建
          </Button>
          <Button onClick={() => setImageOpen(true)} className="h-10 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033]">
            <Plus className="h-4 w-4" />
            镜像创建
          </Button>
        </div>
      </section>

      <section className="table-card overflow-visible">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="w-[24%] px-5 text-xs text-[var(--color-text-tertiary)]">工作负载名称</TableHead>
              <TableHead className="w-[14%] px-5 text-xs text-[var(--color-text-tertiary)]">命名空间</TableHead>
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">镜像</TableHead>
              <TableHead className="w-[18%] px-5 text-xs text-[var(--color-text-tertiary)]">创建时间</TableHead>
              <TableHead className="w-[90px] px-5 text-right text-xs text-[var(--color-text-tertiary)]">操作</TableHead>
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
                <TableRow key={item.id} className="h-[72px] hover:bg-[var(--color-bg-hover)]">
                  <TableCell className="px-5">
                    <button type="button" onClick={() => setDefinitionTarget(item)} className="text-left text-sm font-semibold text-[#1e6bff] hover:underline">
                      {item.name}
                    </button>
                  </TableCell>
                  <TableCell className="px-5 text-sm text-[#111827]">{item.namespace}</TableCell>
                  <TableCell className="px-5">
                    <span className="inline-block max-w-[360px] truncate rounded-lg bg-[var(--color-bg-soft)] px-2.5 py-1 font-mono text-sm text-[#111827]">{item.image}</span>
                  </TableCell>
                  <TableCell className="px-5 text-sm text-[var(--color-text-tertiary)]">{item.createTime}</TableCell>
                  <TableCell className="relative px-5 text-right">
                    <BatchWorkloadActions
                      open={menuOpenId === item.id}
                      onOpenChange={(open) => setMenuOpenId(open ? item.id : null)}
                      onView={() => {
                        setDefinitionTarget(item);
                        setMenuOpenId(null);
                      }}
                      onEditYaml={() => {
                        setYamlTarget(item);
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
        open={!!yamlTarget}
        title="编辑 YAML"
        defaultValue={yamlTarget ? batchWorkloadYaml(yamlTarget) : defaultBatchYaml}
        onSubmit={(yaml) => {
          if (!yamlTarget) return;
          void yaml;
          setError("第一阶段批量工作负载仅支持创建计划和删除，不支持本地编辑假保存");
          setYamlTarget(null);
        }}
        onCancel={() => setYamlTarget(null)}
      />
      <ImageCreateDialog open={imageOpen} onOpenChange={setImageOpen} onCreate={createFromImage} />
      <DeployDialog
        item={deployTarget}
        onOpenChange={(open) => !open && setDeployTarget(null)}
        onCreatePlan={async ({ targetGroups, replicas, containers }) => {
          if (!deployTarget) return;
          await createBatchWorkloadTask({
            name: `${deployTarget.name}-deploy-plan-${Date.now().toString(36)}`,
            targetType: "deployment",
            targetRefs: targetGroups,
            image: containers[0]?.image || deployTarget.image,
            failurePolicy: "continue",
            description: `部署计划：${deployTarget.name}，仅生成计划，不创建 Kubernetes Deployment`,
            targets: [{
              namespace: deployTarget.namespace,
              sourceTaskId: deployTarget.id,
              replicas,
              containers,
              targetGroups,
              executionMode: "planOnly",
            }],
          });
          await loadItems();
          setDeployTarget(null);
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除批量工作负载？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除 <span className="font-medium text-[var(--color-text-primary)]">{deleteTarget?.name}</span> 的 BatchTask ConfigMap，底层 Deployment 不会被删除。
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
      const menuWidth = 164;
      const menuHeight = 178;
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
      <button ref={buttonRef} type="button" className="action-button h-10 w-10" onClick={toggleMenu} title="更多操作">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={() => onOpenChange(false)} aria-label="关闭菜单" />
          <div className="fixed z-40 w-[164px] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white py-2 text-left shadow-[0_18px_45px_rgba(15,23,42,0.18)]" style={{ top: menuPosition.top, left: menuPosition.left }}>
            <BatchActionMenuItem icon={<Eye className="h-4 w-4" />} label="查看定义" onClick={onView} />
            <BatchActionMenuItem icon={<Pencil className="h-4 w-4" />} label="编辑 YAML" onClick={onEditYaml} />
            <BatchActionMenuItem icon={<Upload className="h-4 w-4" />} label="创建部署计划" onClick={onDeploy} />
            <div className="my-2 border-t border-[#eef2f7]" />
            <BatchActionMenuItem danger icon={<Trash2 className="h-4 w-4" />} label="删除" onClick={onDelete} />
          </div>
        </>
      )}
    </div>
  );
}

function BatchActionMenuItem({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-3 px-5 text-sm font-medium hover:bg-[#f8fafc]",
        danger ? "text-[#ff4d4f]" : "text-[#374151]",
      )}
    >
      <span className={cn("text-[#94a3b8]", danger && "text-[#ff4d4f]")}>{icon}</span>
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
  const [step, setStep] = useState(0);
  const [advancedTab, setAdvancedTab] = useState(0);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [form, setForm] = useState<BatchImageCreateForm>(() => defaultBatchImageForm());

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setAdvancedTab(0);
    setActiveContainerIndex(0);
    setForm(defaultBatchImageForm());
  }, [open]);

  const close = () => onOpenChange(false);
  const activeContainer = form.containers[activeContainerIndex] || form.containers[0];
  const isBasicValid = form.name.trim() !== "" && form.namespace.trim() !== "" && Number(form.replicas) > 0;
  const isContainerValid = form.containers.length > 0 && form.containers.every((container) => container.name.trim() && container.image.trim());
  const canGoNext = step === 0 ? isBasicValid : step === 1 ? isContainerValid : true;

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
      <DialogContent className="!flex max-h-[min(800px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]" showCloseButton={false}>
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-6 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">创建批量工作负载</DialogTitle>
            <button type="button" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e7eb] text-[#64748b] hover:bg-[#f8fafc]">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </DialogHeader>

        <BatchWizardSteps step={step} />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="space-y-4">
              <CreateField label="名称" required>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="batch-nginx" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">最长 63 个字符，必须由小写字母、数字字符、"-"或"."组成，且以字母或数字开头及结尾。</p>
              </CreateField>
              <CreateField label="命名空间" required>
                <div className="flex gap-2">
                  <select value={form.namespace} onChange={(event) => setForm({ ...form, namespace: event.target.value })} className="blueedge-native-select h-10 flex-1 rounded-[10px] border-2 text-sm">
                    <option value="">请选择命名空间</option>
                    <option value="riscv">riscv</option>
                    <option value="default">default</option>
                    <option value="kube-system">kube-system</option>
                    <option value="production">production</option>
                  </select>
                  <button type="button" className="action-button h-10 w-10"><RefreshCw className="h-[15px] w-[15px]" /></button>
                </div>
              </CreateField>
              <CreateField label="实例" required>
                <Input type="number" min={1} value={form.replicas} onChange={(event) => setForm({ ...form, replicas: event.target.value })} className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">任务完成可以容忍拉取镜像失败的节点数量占比</p>
              </CreateField>
              <CreateField label="描述">
                <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="批量工作负载用途描述（可选）" className="h-[120px] min-h-[120px] rounded-[10px] border-2 border-[#e2e8f0] px-3 py-2 text-sm shadow-sm focus-visible:ring-0" />
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
                  <CreateField label="容器名称" required compact>
                    <Input value={activeContainer.name} onChange={(event) => updateContainer({ name: event.target.value })} placeholder="container-1" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
                  </CreateField>
                  <CreateField label="容器镜像" required compact>
                    <Input value={activeContainer.image} onChange={(event) => updateContainer({ image: event.target.value })} placeholder="nginx:1.21" className="h-10 rounded-[10px] border-2 border-[#e2e8f0] px-3 text-sm shadow-sm focus-visible:ring-0" />
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
              {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">上一步</button>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={close} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">取消</button>
              {step < 2 ? (
                <button type="button" onClick={() => canGoNext && setStep((current) => current + 1)} disabled={!canGoNext} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033] disabled:cursor-not-allowed disabled:bg-[#9ca3af]">下一步</button>
              ) : (
                <button type="button" onClick={() => onCreate(form)} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">创建</button>
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

function BatchWorkloadDefinitionPage({ item, onBack, onEditYaml, onEditSection }: { item: BatchWorkload; onBack: () => void; onEditYaml: () => void; onEditSection: () => void }) {
  const [activeTab, setActiveTab] = useState<"containers" | "labels" | "access">("containers");
  const [containerTab, setContainerTab] = useState<"base" | "lifecycle" | "health" | "env" | "storage" | "security">("base");
  const containerTabs = [
    { id: "base", label: "基本信息" },
    { id: "lifecycle", label: "生命周期" },
    { id: "health", label: "健康检查" },
    { id: "env", label: "环境变量" },
    { id: "storage", label: "数据储存" },
    { id: "security", label: "安全设置" },
  ] as const;

  const renderContainerDefinition = () => {
    if (containerTab === "lifecycle") return <DefinitionGrid items={[["启动后处理", "未配置"], ["停止前处理", "未配置"], ["启动命令", "默认"], ["工作目录", "/"]]} />;
    if (containerTab === "health") return <DefinitionGrid items={[["存活检查", "HTTP /healthz"], ["就绪检查", "HTTP /ready"], ["初始延迟", "10s"], ["检查周期", "5s"]]} />;
    if (containerTab === "env") return <DefinitionGrid items={[["ENV", "production"], ["EDGE_MODE", "batch"], ["CONFIG_SOURCE", "configmap"], ["SECRET_REF", "未配置"]]} />;
    if (containerTab === "storage") return <DefinitionGrid items={[["挂载卷", "config-volume"], ["挂载路径", "/etc/config"], ["存储类型", "ConfigMap"], ["读写权限", "只读"]]} />;
    if (containerTab === "security") return <DefinitionGrid items={[["特权模式", "关闭"], ["只读根文件系统", "关闭"], ["运行用户", "默认"], ["权限提升", "禁止"]]} />;
    return <DefinitionGrid items={[["容器镜像", item.image], ["资源配额", "CPU 100m / Memory 128Mi"], ["环境变量", "3 项"], ["启动命令", "默认"]]} />;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="action-button h-12 w-12 rounded-2xl"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="text-lg font-semibold text-[#111827]">查看定义</h1>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.name}</p>
          </div>
        </div>
        <button type="button" onClick={onEditYaml} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">
          <Pencil className="h-4 w-4" />
          编辑YAML
        </button>
      </div>

      <DefinitionSection title="基本信息" onEdit={onEditSection}>
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
        <DefinitionSection title="容器配置" onEdit={onEditSection}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {containerTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setContainerTab(tab.id)}
                className={cn("h-10 rounded-xl border px-4 text-sm font-semibold", containerTab === tab.id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#e2e8f0] bg-white text-[#64748b]")}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-[#f0f1f3] bg-[#f8f9fb] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111827]">{containerTabs.find((tab) => tab.id === containerTab)?.label}</span>
              <ImageChip text={item.image} />
            </div>
            {renderContainerDefinition()}
          </div>
        </DefinitionSection>
      )}

      {activeTab === "labels" && (
        <DefinitionSection title="标签与注解" onEdit={onEditSection}>
          <div className="grid grid-cols-2 gap-4">
            {["工作负载标签", "容器组标签", "工作负载注释", "容器组注释"].map((label) => (
              <div key={label} className="rounded-2xl border border-[#f0f1f3] bg-[#f8f9fb] p-4">
                <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
                <span className="inline-flex rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs text-[#374151]">app={item.name}</span>
              </div>
            ))}
          </div>
        </DefinitionSection>
      )}

      {activeTab === "access" && (
        <DefinitionSection title="访问配置" onEdit={onEditSection}>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="网络类型" value="PortMapping" />
            <InfoField label="服务端口" value="80 -> 30080" />
            <InfoField label="协议" value="TCP" />
            <InfoField label="负载均衡" value="NodePort" />
          </div>
        </DefinitionSection>
      )}
    </div>
  );
}

function DefinitionSection({ title, children, onEdit }: { title: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <section className="rounded-3xl border border-[#f0f1f3] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[#111827]">{title}</h3>
        {onEdit && <button type="button" onClick={onEdit} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]"><Pencil className="h-4 w-4" />编辑</button>}
      </div>
      {children}
    </section>
  );
}

function DefinitionTab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-12 items-center gap-2 rounded-xl border px-5 text-sm font-semibold", active ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#e2e8f0] bg-white text-[#64748b]")}>
      {icon}
      {label}
    </button>
  );
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <div className="break-all text-sm font-semibold text-[#111827]">{value}</div>
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
        <div key={label} className="rounded-xl border border-[#eef1f5] bg-white px-4 py-3">
          <p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p>
          <div className="text-sm font-semibold text-[#111827]">{value}</div>
        </div>
      ))}
    </div>
  );
}

function DeployDialog({ item, onOpenChange, onCreatePlan }: {
  item: BatchWorkload | null;
  onOpenChange: (open: boolean) => void;
  onCreatePlan: (payload: { targetGroups: string[]; replicas: number; containers: Array<{ name: string; image: string }> }) => Promise<void>;
}) {
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [replicas, setReplicas] = useState("2");
  const [replicaEditable, setReplicaEditable] = useState(false);
  const [activeContainerIndex, setActiveContainerIndex] = useState(0);
  const [containers, setContainers] = useState([{ id: "container-1", name: "container-1", image: "" }]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [yamlPreview, setYamlPreview] = useState<{ title: string; yaml: string } | null>(null);

  useEffect(() => {
    if (!item) return;
    setSelectedGroups(item.targetGroups);
    setReplicas("2");
    setReplicaEditable(false);
    setActiveContainerIndex(0);
    setContainers([
      { id: "container-1", name: "container-1", image: item.image },
      { id: "container-2", name: "container-2", image: "envoyproxy/envoy:v1.30-latest" },
    ]);
    setSubmitted(false);
    setSubmitting(false);
    setSubmitError("");
    setYamlPreview(null);
  }, [item]);

  if (!item) return null;

  const availableNodeGroups = item.targetGroups.map((name) => ({ id: name, name, nodes: [], description: "来自批量任务目标" }));
  const selectedNodeGroups = availableNodeGroups.filter((group) => selectedGroups.includes(group.name));
  const activeContainer = containers[activeContainerIndex] || containers[0];
  const showErrors = submitted;
  const toggleGroup = (name: string) => setSelectedGroups((current) => current.includes(name) ? current.filter((group) => group !== name) : [...current, name]);
  const addContainer = () => {
    const nextIndex = containers.length + 1;
    setContainers((current) => [...current, { id: `container-${Date.now()}`, name: `container-${nextIndex}`, image: "" }]);
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
    if (selectedGroups.length === 0 || !Number.isInteger(count) || count <= 0 || !activeContainer?.image) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onCreatePlan({
        targetGroups: selectedGroups,
        replicas: count,
        containers: containers.map((container) => ({ name: container.name, image: container.image })),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "创建部署计划失败");
    } finally {
      setSubmitting(false);
    }
  };
  const buildDeployPatchYaml = (moduleTitle: string) => `apiVersion: apps.kubeedge.io/v1
kind: BatchWorkloadDeployPatch
metadata:
  name: ${item.name}
  namespace: ${item.namespace}
spec:
  targetGroups:
${selectedGroups.length ? selectedGroups.map((group) => `    - ${group}`).join("\n") : "    []"}
  replicas: ${replicas || 0}
  container:
    name: ${activeContainer?.name || ""}
    image: ${activeContainer?.image || ""}
  patchModule: ${moduleTitle}
`;

  return (
    <>
      <Dialog open={!!item} onOpenChange={onOpenChange}>
        <DialogContent className="!flex max-h-[min(800px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.14)]" showCloseButton={false}>
          <DialogHeader className="h-[68px] shrink-0 border-b border-[#eef1f5] px-6 py-0">
            <div className="flex h-full items-center justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-[#111827]">创建部署计划</DialogTitle>
                <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{item.name}</p>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} className="action-button h-9 w-9"><X className="h-4 w-4" /></button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <div className="rounded-xl border border-[#facc15]/40 bg-[#fffbeb] px-4 py-3 text-sm leading-6 text-[#92400e]">
              当前仅生成部署计划，不会向 Kubernetes 创建 Deployment。
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
                  <button type="button" disabled={!replicaEditable} onClick={() => setReplicas(String(Math.max(1, Number(replicas || 1) - 1)))} className="h-10 w-10 rounded-xl border border-[#e2e8f0] bg-white text-sm disabled:opacity-50">-</button>
                  <Input type="number" min={1} disabled={!replicaEditable} value={replicas} onChange={(event) => setReplicas(event.target.value)} className="h-10 flex-1 rounded-xl border-2 border-[#e2e8f0] bg-white px-3 text-sm disabled:bg-[#f8fafc]" />
                  <button type="button" disabled={!replicaEditable} onClick={() => setReplicas(String(Math.max(1, Number(replicas || 0) + 1)))} className="h-10 w-10 rounded-xl border border-[#e2e8f0] bg-white text-sm disabled:opacity-50">+</button>
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
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <DeploySelectField label="操作行为" value="替换" options={["替换", "添加", "删除"]} />
                    <DeploySelectField label="目标" value="镜像" options={["镜像", "镜像仓", "版本"]} />
                  </div>
                  <div>
                    <DeployFieldLabel label="期望值" />
                    <div className="grid grid-cols-[1fr_48px] gap-3">
                      <DeployTextField value={activeContainer?.image || ""} placeholder="请输入期望值" error={showErrors && !activeContainer?.image} />
                      <button type="button" className="action-button h-12 w-12 rounded-xl"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <DeployAddButton>新增镜像规则</DeployAddButton>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="资源配额" onViewYaml={() => setYamlPreview({ title: "资源配额 YAML", yaml: buildDeployPatchYaml("资源配额") })}>
                <div className="space-y-5">
                  <div className="rounded-xl border border-[#e5e7eb] bg-[#f8fafc] px-4 py-3">
                    <p className="text-sm font-semibold text-[#111827]">CPU / 内存配置说明</p>
                    <p className="mt-2 text-sm leading-7 text-[var(--color-text-secondary)]">建议根据实际使用情况设置请求值和限制值，防止因计算或内存资源不足导致应用不可用或无法调度。</p>
                  </div>
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-[#111827]">CPU 配额</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <DeployTextField label="请求值" value="100" />
                      <DeployTextField label="限制值" value="500" />
                      <DeploySelectField label="单位" value="m" options={["m", "Core"]} />
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-[#111827]">内存配额</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <DeployTextField label="请求值" value="128" />
                      <DeployTextField label="限制值" value="256" />
                      <DeploySelectField label="单位" value="Mi" options={["Mi", "Gi"]} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[#92400e]">GPU 配额</p>
                        <p className="mt-2 text-sm leading-7 text-[#92400e]">集群未启用 GPU 卡，如需使用 GPU 算力，请前往集群启用 GPU。</p>
                      </div>
                      <button type="button" className="shrink-0 text-sm font-semibold text-[#2563eb]">启用 GPU</button>
                    </div>
                  </div>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="环境变量" onViewYaml={() => setYamlPreview({ title: "环境变量 YAML", yaml: buildDeployPatchYaml("环境变量") })}>
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <DeploySelectField label="类型" value="键值对" options={["键值对", "资源引用", "配置项键值导入", "密钥键值导入", "变量引用"]} />
                    <DeploySelectField label="目标" value="替换" options={["替换", "添加", "删除"]} />
                    <DeployTextField label="变量名" value="ENV" placeholder="请选择或输入变量名" />
                    <DeployTextField label="值" value="production" placeholder="请输入值" />
                  </div>
                  <DeployAddButton>新增环境变量</DeployAddButton>
                </div>
              </DeployDiffModule>

              <DeployDiffModule title="启动命令" onViewYaml={() => setYamlPreview({ title: "启动命令 YAML", yaml: buildDeployPatchYaml("启动命令") })}>
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-[#111827]">运行命令</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <DeploySelectField label="操作行为" value="添加" options={["添加", "删除"]} />
                      <DeployTextField label="修改对象" value="/bin/sh" placeholder="请选择或输入命令对象" />
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-[#111827]">运行参数</h4>
                    <div className="grid grid-cols-[1fr_1fr_48px] gap-4">
                      <DeploySelectField label="操作行为" value="添加" options={["添加", "删除"]} />
                      <DeployTextField label="期望值" value="-c echo start" placeholder="请输入运行参数" />
                      <div className="flex items-end"><button type="button" className="action-button h-12 w-12 rounded-xl"><Trash2 className="h-4 w-4" /></button></div>
                    </div>
                  </div>
                  <DeployAddButton>新增命令或参数</DeployAddButton>
                </div>
              </DeployDiffModule>
            </section>
          </div>

          <DialogFooter className="h-[68px] shrink-0 border-t border-[#eef1f5] px-6 py-0">
            <div className="flex w-full justify-end gap-3">
              <button type="button" disabled={submitting} onClick={() => onOpenChange(false)} className="h-9 rounded-xl border border-[#e2e8f0] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc] disabled:opacity-50">取消</button>
              <button type="button" disabled={submitting} onClick={() => void handleSubmit()} className="h-9 rounded-xl bg-[#0f172a] px-5 text-sm font-semibold text-white hover:bg-[#172033] disabled:opacity-50">{submitting ? "正在创建计划..." : "创建部署计划"}</button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupPickerOpen} onOpenChange={setGroupPickerOpen}>
        <DialogContent className="!flex max-h-[min(720px,calc(100vh-64px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-[20px] p-0 shadow-[0_24px_60px_rgba(16,24,40,0.18)]" showCloseButton={false}>
          <DialogHeader className="h-16 shrink-0 border-b border-[#eef1f5] px-6 py-0">
            <div className="flex h-full items-center justify-between">
              <DialogTitle className="text-base font-semibold text-[#111827]">选择边缘节点组</DialogTitle>
              <button type="button" onClick={() => setGroupPickerOpen(false)} className="action-button h-9 w-9"><X className="h-4 w-4" /></button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2">
              <p className="text-xs leading-5 text-[#1d4ed8]">可多选边缘节点组生成部署计划；当前不会执行真实工作负载下发。</p>
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
                  {availableNodeGroups.map((group) => (
                    <tr key={group.id} onClick={() => toggleGroup(group.name)} className={cn("cursor-pointer border-t border-[#f3f4f6]", selectedGroups.includes(group.name) && "bg-[#f0f6ff]")}>
                      <td className="px-3 py-3"><input type="checkbox" checked={selectedGroups.includes(group.name)} onChange={() => toggleGroup(group.name)} onClick={(event) => event.stopPropagation()} /></td>
                      <td className="px-3 py-3 text-sm font-semibold text-[#1e6bff]">{group.name}</td>
                      <td className="truncate px-3 py-3 text-xs text-[#374151]">{group.nodes.length ? group.nodes.join("、") : "-"}</td>
                      <td className="truncate px-3 py-3 text-xs text-[var(--color-text-secondary)]">{group.description}</td>
                    </tr>
                  ))}
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
    <div className={cn("overflow-hidden rounded-2xl border bg-white", error ? "border-[#ef4444]" : "border-[#e5e7eb]")}>
      <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-[#eef1f5] px-5 py-4">
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 items-center gap-4 text-left">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#64748b] transition-transform", open && "rotate-180")} />
          <span className="truncate text-lg font-semibold text-[#111827]">{title}</span>
        </button>
        {onViewYaml && (
          <button type="button" onClick={onViewYaml} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">
            <FileCode2 className="h-4 w-4" />
            查看 YAML
          </button>
        )}
      </div>
      {error && <p className="-mt-1 px-4 pb-2 text-xs text-[#ef4444]">{error}</p>}
      {open && <div className="px-5 pb-8 pt-4">{children}<div className="mt-8 flex justify-end"><button type="button" className="h-12 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white">确认</button></div></div>}
    </div>
  );
}

function DeployFieldLabel({ label }: { label: string }) {
  return <Label className="mb-2 block text-sm font-medium text-[#4b5563]">{label}</Label>;
}

function DeployTextField({ label, value, placeholder, error = false }: { label?: string; value: string; placeholder?: string; error?: boolean }) {
  return (
    <div>
      {label && <DeployFieldLabel label={label} />}
      <Input defaultValue={value} placeholder={placeholder} className={cn("h-12 rounded-xl border-2 border-[#e2e8f0] px-4 text-sm shadow-sm focus-visible:ring-0", error && "border-[#ef4444]")} />
      {error && <p className="mt-1 text-xs text-[#ef4444]">值不能为空</p>}
    </div>
  );
}

function DeploySelectField({ label, value, options }: { label: string; value: string; options: string[] }) {
  return (
    <div>
      <DeployFieldLabel label={label} />
      <select defaultValue={value} className="blueedge-native-select h-12 w-full rounded-xl border-2 border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#111827] shadow-sm">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function DeployAddButton({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe5ee] bg-white px-4 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">
      <Plus className="h-4 w-4" />
      {children}
    </button>
  );
}

function CreateField({ label, required, children, compact = false }: { label: string; required?: boolean; children: ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <Label className={cn("font-semibold text-[#111827]", compact ? "text-xs text-[var(--color-text-secondary)]" : "text-base")}>
        {label}
        {required && <span className="ml-1 text-[#ff4d4f]">*</span>}
      </Label>
      {children}
    </div>
  );
}

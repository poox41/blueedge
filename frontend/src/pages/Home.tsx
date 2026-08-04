import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Box,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Pencil,
  AlertTriangle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { UserMenu } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toHomeEdgeUnit, type EdgeUnitUiModel, type EdgeUnitWarning } from "@/api/adapters/edge-unit.adapter";
import { createEdgeUnit, deleteEdgeUnit, enableCloudCoreIncrementalSync, listConnectedClusters, listEdgeUnits, updateEdgeUnit, type EdgeUnitCreatePayload, type EdgeUnitUpdatePayload } from "@/api/services/product";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";
import { cn } from "@/lib/utils";

type EdgeUnit = EdgeUnitUiModel;

type ClusterOption = {
  name: string;
  edgeUnitName?: string;
};

type CreateForm = {
  unitType: "专有" | "外接";
  name: string;
  description: string;
  cluster: string;
  version: string;
  insightStatus: "installed" | "notInstalled" | "unknown";
  monitorStatus: "installed" | "notInstalled" | "unknown";
  nodeScale: "小型" | "中型" | "大型";
  mqttEnabled: boolean;
  protocols: string[];
  accessAddresses: string[];
  ports: {
    websocket: string;
    quic: string;
    https: string;
    cloudStream: string;
    tunnel: string;
  };
  uninstallPolicy: "保留相关命名空间" | "删除相关命名空间";
};

const versions = ["v1.22.1", "v1.21.0", "v1.20.0", "v1.19.0"];
const PAAS_CONSOLE_URL = import.meta.env.VITE_PAAS_CONSOLE_URL || "https://183.95.195.121:31417/";

const defaultCreateForm: CreateForm = {
  unitType: "专有",
  name: "",
  description: "",
  cluster: "",
  version: "v1.22.1",
  insightStatus: "unknown",
  monitorStatus: "unknown",
  nodeScale: "小型",
  mqttEnabled: true,
  protocols: ["WebSocket"],
  accessAddresses: [""],
  ports: {
    websocket: "30000",
    quic: "30001",
    https: "30002",
    cloudStream: "30003",
    tunnel: "30004",
  },
  uninstallPolicy: "保留相关命名空间",
};

function accessTypeFromUnitType(value: CreateForm["unitType"]): EdgeUnitCreatePayload["accessType"] {
  return value === "外接" ? "external" : "dedicated";
}

function unitTypeFromAccessType(value: EdgeUnit["accessType"]): CreateForm["unitType"] {
  return value === "external" ? "外接" : "专有";
}

function messageOfError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

const scaleTips = {
  小型: "适用于小规模边缘场景，节点数不超过 10 个。",
  中型: "适用于中等规模边缘场景，节点数不超过 100 个。",
  大型: "适用于大规模边缘场景，节点数不超过 1000 个。",
} satisfies Record<CreateForm["nodeScale"], string>;

const statusMeta = {
  running: { label: "运行中", className: "bg-[var(--color-success-soft)] text-[var(--color-success)]" },
  abnormal: { label: "异常", className: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" },
  unknown: { label: "未知", className: "bg-[var(--color-info-soft)] text-[var(--color-info)]" },
} satisfies Record<EdgeUnit["status"], { label: string; className: string }>;

function BrandMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-text-primary)]">
      <Box className="h-4 w-4 text-white" />
    </div>
  );
}

function UnitBadge({ children, tone = "warning" }: { children: React.ReactNode; tone?: "warning" | "success" | "info" | "danger" }) {
  const toneClass = {
    warning: "bg-[var(--color-warning-soft)] text-[#ff8a00]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  }[tone];
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold", toneClass)}>{children}</span>;
}

function InfoCell({ icon: Icon, label, value, extra }: { icon: React.ElementType; label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--color-bg-soft)] px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--color-text-tertiary)]">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          <span className="truncate">{value}</span>
          {extra}
        </div>
      </div>
    </div>
  );
}

function Metric({ type, label, value }: { type: "nodes" | "workloads" | "apps"; label: string; value: [number, number] }) {
  const meta = {
    nodes: { icon: Server, color: "text-[var(--color-success)]", bg: "bg-[var(--color-success-soft)]" },
    workloads: { icon: SlidersHorizontal, color: "text-[#ff8a00]", bg: "bg-[var(--color-warning-soft)]" },
    apps: { icon: Box, color: "text-[var(--color-info)]", bg: "bg-[var(--color-info-soft)]" },
  }[type];
  const Icon = meta.icon;

  return (
    <div className="flex min-w-0 items-center gap-3 border-r border-[var(--color-border)] last:border-r-0">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", meta.bg, meta.color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</div>
        <div className="mt-0.5 flex items-end gap-1">
          <span className={cn("text-2xl font-bold leading-none", meta.color)}>{value[0]}</span>
          <span className="pb-0.5 text-xl font-semibold leading-none text-[var(--color-text-tertiary)]">/</span>
          <span className="pb-0.5 text-xl font-semibold leading-none text-[var(--color-text-secondary)]">{value[1]}</span>
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">正常 / 总数</div>
      </div>
    </div>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  const Icon = enabled ? CheckCircle2 : XCircle;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", enabled ? "text-[var(--color-success)]" : "text-[var(--color-text-tertiary)]")}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function CreateStepper({ step }: { step: number }) {
  const labels = ["选择类型", "基本信息", "高级设置"];
  return (
    <div className="flex items-center justify-center">
      {labels.map((label, index) => {
        const current = step === index + 1;
        const active = step >= index + 1;
        return (
          <div key={label} className="flex items-center">
            {index > 0 && <div className={cn("mx-1 h-0.5 w-8", step > index ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  active
                    ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                    : "border-[var(--color-bg-soft)] bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]",
                  current && "border-[var(--color-brand)]"
                )}
              >
                {index + 1}
              </span>
              <span className={cn("text-sm font-medium", active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TypeOption({
  selected,
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  selected: boolean;
  icon: React.ElementType;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-[174px] flex-col items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all",
        selected ? "border-[var(--color-text-primary)] bg-[var(--color-bg-hover)]" : "border-[var(--color-input-border)] bg-white hover:border-[var(--color-input-border-hover)]"
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand-light)] text-[var(--color-brand)]">
        <Icon className="h-7 w-7" />
      </div>
      <div className="pr-6">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{desc}</p>
      </div>
      <span className={cn("absolute right-4 top-4 flex h-4 w-4 items-center justify-center rounded-full border-2", selected ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-strong)]")}>
        {selected && <span className="h-2 w-2 rounded-full bg-[var(--color-text-primary)]" />}
      </span>
    </button>
  );
}

function FormField({
  label,
  required,
  error,
  remark,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  remark?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-[var(--color-text-primary)]">
        {label}
        {required && <span className="text-[var(--color-danger)]">*</span>}
      </label>
      {children}
      {remark && <p className="mt-1.5 text-[11px] leading-5 text-[var(--color-text-tertiary)]">{remark}</p>}
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function SegmentButton({ selected, children, onClick, showCheck = false }: { selected: boolean; children: React.ReactNode; onClick: () => void; showCheck?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] border-2 px-4 text-sm font-medium transition-all",
        selected ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-input-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-input-border-hover)]"
      )}
    >
      {selected && showCheck && <CheckCircle2 className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function CreateEdgeUnitDialog({
  open,
  onOpenChange,
  clusterOptions,
  isSubmitting,
  operationMessage,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterOptions: ClusterOption[];
  isSubmitting: boolean;
  operationMessage: string;
  onCreate: (form: CreateForm) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CreateForm>(defaultCreateForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showScaleTip, setShowScaleTip] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const accessAddressListRef = useRef<HTMLDivElement>(null);
  const availableClusterCount = clusterOptions.filter((cluster) => !cluster.edgeUnitName).length;

  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0 });
  }, [open, step]);

  const updateForm = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const selectUnitType = (unitType: CreateForm["unitType"]) => {
    setForm((prev) => ({
      ...prev,
      unitType,
      version: prev.unitType === unitType ? prev.version : unitType === "外接" ? "" : versions[0],
    }));
    setErrors((prev) => {
      if (!prev.version) return prev;
      const next = { ...prev };
      delete next.version;
      return next;
    });
  };

  const addAccessAddress = () => {
    updateForm("accessAddresses", [...form.accessAddresses, ""]);
    window.requestAnimationFrame(() => {
      const list = accessAddressListRef.current;
      list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    });
  };

  const validateBasic = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) {
      nextErrors.name = "请输入边缘单元名称";
    } else if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(form.name.trim())) {
      nextErrors.name = "名称只能包含小写字母、数字、中划线和点，且需以字母或数字开头、结尾";
    }
    if (!form.cluster) nextErrors.cluster = "请选择工作集群";
    else if (clusterOptions.some((cluster) => cluster.name === form.cluster && cluster.edgeUnitName)) nextErrors.cluster = "该工作集群已安装边缘单元";
    if (!form.version.trim()) nextErrors.version = form.unitType === "外接" ? "请输入外接集群的实际 KubeEdge 版本" : "请选择 KubeEdge 版本";
    setErrors(nextErrors);
    const firstInvalid = (["name", "cluster", "version"] as const).find((field) => nextErrors[field]);
    if (firstInvalid) {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`edge-unit-create-${firstInvalid}`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
      return false;
    }
    return true;
  };

  const resetAndClose = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setStep(1);
      setForm(defaultCreateForm);
      setErrors({});
      setShowScaleTip(false);
    }, 180);
  };

  const next = () => {
    if (step === 1) setStep(2);
    if (step === 2 && validateBasic()) setStep(3);
  };

  const create = async () => {
    if (!validateBasic()) return;
    if (form.unitType === "专有") {
      if (!form.accessAddresses.some((item) => item.trim())) {
        setErrors({ submit: "专有边缘单元必须填写至少一个边缘节点可访问的 CloudCore 地址" });
        return;
      }
      if (form.protocols.length === 0) {
        setErrors({ submit: "请至少启用 WebSocket 或 QUIC 一种组件通信协议" });
        return;
      }
      const invalidPort = Object.entries(form.ports).find(([, value]) => {
        const port = Number(value);
        return !Number.isInteger(port) || port < 30000 || port > 32767;
      });
      if (invalidPort) {
        setErrors({ submit: `${invalidPort[0]} NodePort 必须在 30000-32767 范围内` });
        return;
      }
    }
    try {
      await onCreate(form);
      resetAndClose();
    } catch (err) {
      setErrors({ submit: messageOfError(err, "边缘单元创建失败") });
    }
  };

  const toggleProtocol = (protocol: string) => {
    updateForm(
      "protocols",
      form.protocols.includes(protocol) ? form.protocols.filter((item) => item !== protocol) : [...form.protocols, protocol]
    );
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="!flex max-h-[92vh] w-[calc(100%-2rem)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-2xl p-0" showCloseButton>
        <DialogHeader className="shrink-0 border-b border-[var(--color-border)] px-6 py-4">
          <DialogTitle className="text-base font-semibold">创建边缘单元</DialogTitle>
        </DialogHeader>
        <div className="shrink-0 px-6 py-4">
          <CreateStepper step={step} />
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {step === 1 && (
            <div className="space-y-5 pb-2">
              <p className="text-center text-sm text-[var(--color-text-secondary)]">请选择要创建的边缘单元类型</p>
              <div className="grid grid-cols-2 gap-3">
                <TypeOption selected={form.unitType === "专有"} onClick={() => selectUnitType("专有")} icon={Server} title="专有边缘单元" desc="在指定集群上部署完整的 KubeEdge 云端组件，适用于需要独立控制的场景。" />
                <TypeOption selected={form.unitType === "外接"} onClick={() => selectUnitType("外接")} icon={ExternalLink} title="外接边缘单元" desc="接入已有的 KubeEdge 集群，无需重复部署云端组件。" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <FormField label="边缘单元名称" required error={errors.name} remark="最长 253 个字符，只能是小写字母、数字、中划线(-)、点(.)的组合。">
                <Input id="edge-unit-create-name" value={form.name} onChange={(event) => updateForm("name", event.target.value)} aria-invalid={Boolean(errors.name)} placeholder="请输入边缘单元名称" />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="工作集群" required error={errors.cluster}>
                  <Select value={form.cluster || undefined} onValueChange={(value) => updateForm("cluster", value)} disabled={clusterOptions.length === 0}>
                    <SelectTrigger id="edge-unit-create-cluster" aria-invalid={Boolean(errors.cluster)} className="h-9 w-full rounded-xl px-3 pr-5 text-sm shadow-none">
                      <SelectValue placeholder={clusterOptions.length === 0 ? "未发现已连接集群" : availableClusterCount === 0 ? "暂无可用集群" : "请选择集群"} />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start" sideOffset={0} viewportClassName="!h-auto p-0" className="w-[var(--radix-select-trigger-width)] rounded-xl p-2 shadow-[0_10px_28px_rgba(15,23,42,0.14)]">
                      <SelectGroup>
                        <SelectLabel className="px-3 py-2 text-xs font-medium text-[var(--color-text-tertiary)]">选择集群</SelectLabel>
                        {clusterOptions.map((cluster) => (
                          <SelectItem key={cluster.name} value={cluster.name} disabled={Boolean(cluster.edgeUnitName)} className="min-h-9 px-3 pr-8 text-sm">
                            <span>{cluster.name}</span>
                            {cluster.edgeUnitName && <span className="ml-2 text-xs text-[var(--color-warning)]">已安装边缘单元</span>}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {availableClusterCount === 0 && clusterOptions.length > 0 && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">每个工作集群只能创建一个边缘单元；请先连接新集群或删除原边缘单元。</p>}
                </FormField>
                <FormField label="KubeEdge 版本" required error={errors.version} remark={form.unitType === "外接" ? "请输入外接集群当前实际运行的 KubeEdge 版本。" : undefined}>
                  {form.unitType === "外接" ? (
                    <Input
                      id="edge-unit-create-version"
                      value={form.version}
                      onChange={(event) => updateForm("version", event.target.value)}
                      aria-invalid={Boolean(errors.version)}
                      placeholder="例如 v1.23.0"
                    />
                  ) : (
                    <Select value={form.version} onValueChange={(value) => updateForm("version", value)}>
                      <SelectTrigger id="edge-unit-create-version" aria-invalid={Boolean(errors.version)} className="h-9 w-full rounded-xl px-3 pr-5 text-sm shadow-none"><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" align="start" sideOffset={0} viewportClassName="!h-auto p-0" className="w-[var(--radix-select-trigger-width)] rounded-xl p-2 shadow-[0_10px_28px_rgba(15,23,42,0.14)]">
                        {versions.map((version) => <SelectItem key={version} value={version} className="h-9 px-3 pr-8 text-sm">{version}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>
              <FormField label="边缘节点规模">
                <button type="button" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-tertiary)]" onClick={() => setShowScaleTip(!showScaleTip)}>
                  <HelpCircle className="h-3.5 w-3.5" />
                  {showScaleTip ? scaleTips[form.nodeScale] : "查看规模说明"}
                </button>
                <div className="flex gap-3">
                  {(["小型", "中型", "大型"] as const).map((scale) => (
                    <SegmentButton key={scale} selected={form.nodeScale === scale} onClick={() => updateForm("nodeScale", scale)}>{scale}</SegmentButton>
                  ))}
                </div>
              </FormField>
              <FormField label="MQTT 服务">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => updateForm("mqttEnabled", !form.mqttEnabled)} className={cn("relative h-6 w-11 rounded-full transition-colors", form.mqttEnabled ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")}>
                    <span className={cn("absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white transition-all", form.mqttEnabled ? "left-[22px]" : "left-[3px]")} />
                  </button>
                  <span className={cn("text-sm", form.mqttEnabled ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{form.mqttEnabled ? "已启用" : "未启用"}</span>
                </div>
              </FormField>
              <FormField label="描述">
                <Textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="请输入描述信息" rows={3} />
              </FormField>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <FormField label="组件通信协议" remark="云边信令通道通信协议，云边网络经常不稳定时，推荐使用 QUIC 协议">
                <div className="grid grid-cols-2 gap-3">
                  {["WebSocket", "QUIC"].map((protocol) => (
                    <SegmentButton key={protocol} selected={form.protocols.includes(protocol)} onClick={() => toggleProtocol(protocol)} showCheck>{protocol}</SegmentButton>
                  ))}
                </div>
              </FormField>
              <FormField label="云端节点访问地址" required={form.unitType === "专有"} remark="填写边缘节点能够访问的云端 IP 或域名；该地址会写入 CloudCore 证书 SAN。">
                <div className="space-y-2">
                  <div ref={accessAddressListRef} className="max-h-[132px] space-y-2 overflow-y-auto pr-1">
                    {form.accessAddresses.map((address, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={address} onChange={(event) => updateForm("accessAddresses", form.accessAddresses.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="请输入访问地址，例如 10.6.222.21" />
                        {form.accessAddresses.length > 1 && (
                          <button type="button" className="action-button is-danger" aria-label="删除访问地址" onClick={() => updateForm("accessAddresses", form.accessAddresses.filter((_, itemIndex) => itemIndex !== index))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)]" onClick={addAccessAddress}>
                    <Plus className="h-3.5 w-3.5" />
                    添加访问地址
                  </button>
                </div>
              </FormField>
              <FormField label="端口设置" remark="CloudCore 对边端开放的 NodePort；如有冲突请修改，合法范围 30000-32767。">
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  {([
                    ["websocket", "WebSocket"],
                    ["quic", "QUIC"],
                    ["https", "HTTPS"],
                    ["cloudStream", "CloudStream"],
                    ["tunnel", "Tunnel"],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</label>
                      <Input type="number" min="0" max="65535" className="text-center" value={form.ports[key]} onChange={(event) => updateForm("ports", { ...form.ports, [key]: event.target.value })} />
                    </div>
                  ))}
                </div>
              </FormField>
              <FormField label="卸载策略">
                <div className="grid grid-cols-2 gap-3">
                  {(["保留相关命名空间", "删除相关命名空间"] as const).map((policy) => (
                    <button key={policy} type="button" onClick={() => updateForm("uninstallPolicy", policy)} className={cn("flex h-12 items-center gap-3 rounded-xl border-2 px-4 text-left text-sm font-semibold transition-all", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)] bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "border-[var(--color-input-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-input-border-hover)]")}>
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-strong)]")}>
                        {form.uninstallPolicy === policy && <span className="h-2 w-2 rounded-full bg-[var(--color-text-primary)]" />}
                      </span>
                      {policy}
                    </button>
                  ))}
                </div>
              </FormField>
              {errors.submit && <p className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#c2410c]">{errors.submit}</p>}
              {isSubmitting && operationMessage && <p className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs text-[#2563eb]">{operationMessage}</p>}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
          <Button variant="outline" onClick={resetAndClose}>取消</Button>
          {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="h-3.5 w-3.5" />上一步</Button>}
          {step < 3 ? (
            <Button onClick={next}>下一步<ChevronRight className="h-3.5 w-3.5" /></Button>
          ) : (
            <Button onClick={() => void create()} disabled={isSubmitting}>{isSubmitting ? "任务执行中…" : "确定"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEdgeUnitDialog({
  unit,
  clusterOptions,
  onOpenChange,
  isSubmitting,
  onSave,
}: {
  unit: EdgeUnit | null;
  clusterOptions: ClusterOption[];
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSave: (unit: EdgeUnit, payload: EdgeUnitUpdatePayload) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [showScaleTip, setShowScaleTip] = useState(false);
  const [showCommWarning, setShowCommWarning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    unitType: "专有" as CreateForm["unitType"],
    cluster: "",
    version: "",
    insightStatus: "unknown" as CreateForm["insightStatus"],
    monitorStatus: "unknown" as CreateForm["monitorStatus"],
    description: "",
    nodeScale: "小型" as CreateForm["nodeScale"],
    mqttEnabled: true,
    protocols: ["WebSocket"] as string[],
    accessAddresses: [""] as string[],
    ports: defaultCreateForm.ports,
    uninstallPolicy: "保留相关命名空间" as CreateForm["uninstallPolicy"],
  });

  useEffect(() => {
    if (!unit) return;
    setForm({
      unitType: unitTypeFromAccessType(unit.accessType),
      cluster: unit.cluster === "未配置" ? "" : unit.cluster,
      version: unit.version === "未配置" ? "" : unit.version,
      insightStatus: unit.insightStatus,
      monitorStatus: unit.monitorStatus,
      description: unit.description ?? `${unit.cluster} ${unit.access}边缘单元`,
      nodeScale: unit.nodeScale ?? "小型",
      mqttEnabled: unit.mqttEnabled ?? true,
      protocols: unit.protocols ?? ["WebSocket"],
      accessAddresses: unit.accessAddresses?.length ? unit.accessAddresses : [""],
      ports: unit.ports ?? defaultCreateForm.ports,
      uninstallPolicy: unit.uninstallPolicy ?? "保留相关命名空间",
    });
    setStep(1);
    setShowScaleTip(false);
    setShowCommWarning(false);
    setShowConfirm(false);
  }, [unit]);

  const save = () => {
    if (!unit) return;
    const payload: EdgeUnitUpdatePayload = {
      clusterName: form.cluster,
      accessType: accessTypeFromUnitType(form.unitType),
      kubeEdgeVersion: form.version,
      insightStatus: form.insightStatus,
      monitorStatus: form.monitorStatus,
      description: form.description,
      nodeScale: form.nodeScale,
      mqttEnabled: form.mqttEnabled,
      protocols: form.protocols,
      accessAddresses: form.accessAddresses,
      ports: form.ports,
      uninstallPolicy: form.uninstallPolicy,
    };
    void onSave(unit, payload)
      .then(() => {
        setShowConfirm(false);
        onOpenChange(false);
      })
      .catch(() => {
        setShowConfirm(false);
      });
  };

  const toggleProtocol = (protocol: string) => {
    setShowCommWarning(true);
    setForm((prev) => ({
      ...prev,
      protocols: prev.protocols.includes(protocol) ? prev.protocols.filter((item) => item !== protocol) : [...prev.protocols, protocol],
    }));
  };

  return (
    <Dialog open={!!unit} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[860px] max-h-[92vh] max-w-[680px] flex-col gap-0 overflow-hidden p-0" showCloseButton>
        <DialogHeader className="border-b border-[var(--color-border)] px-6 py-4">
          <DialogTitle>编辑边缘单元 — {unit?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", step >= 1 ? "bg-[var(--color-text-primary)] text-white ring-2 ring-[var(--color-brand)] ring-offset-2" : "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]")}>1</span>
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">基本信息</span>
            </div>
            <div className={cn("h-0.5 w-10 rounded-full", step === 2 ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />
            <div className="flex items-center gap-2">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", step === 2 ? "bg-[var(--color-text-primary)] text-white ring-2 ring-[var(--color-brand)] ring-offset-2" : "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]")}>2</span>
              <span className={cn("text-sm font-semibold", step === 2 ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>高级设置</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {step === 1 && (
            <div className="space-y-5">
              <FormField label="边缘单元名称">
                <Input value={unit?.name ?? ""} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" />
                <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">边缘单元名称不可修改</p>
              </FormField>
              <FormField label="接入方式">
                <select className="blueedge-native-select" value={form.unitType} onChange={(event) => setForm((prev) => ({ ...prev, unitType: event.target.value as CreateForm["unitType"] }))}>
                  <option value="专有">专有</option>
                  <option value="外接">外接</option>
                </select>
              </FormField>
              <FormField label="工作集群">
                <Select value={form.cluster || undefined} onValueChange={(value) => setForm((prev) => ({ ...prev, cluster: value }))}>
                  <SelectTrigger className="h-9 w-full rounded-xl px-3 pr-5 text-sm shadow-none">
                    <SelectValue placeholder="请选择集群" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start" sideOffset={0} viewportClassName="!h-auto p-0" className="w-[var(--radix-select-trigger-width)] rounded-xl p-2 shadow-[0_10px_28px_rgba(15,23,42,0.14)]">
                    <SelectGroup>
                      <SelectLabel className="px-3 py-2 text-xs font-medium text-[var(--color-text-tertiary)]">选择集群</SelectLabel>
                      {clusterOptions.map((cluster) => {
                        const occupiedByOther = Boolean(cluster.edgeUnitName && cluster.edgeUnitName !== unit?.name);
                        return (
                          <SelectItem key={cluster.name} value={cluster.name} disabled={occupiedByOther} className="min-h-9 px-3 pr-8 text-sm">
                            <span>{cluster.name}</span>
                            {occupiedByOther && <span className="ml-2 text-xs text-[var(--color-warning)]">已安装边缘单元</span>}
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="KubeEdge 版本">
                <Input value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} placeholder="未配置" />
              </FormField>
              <FormField label="边缘节点规模">
                <button type="button" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-tertiary)]" onClick={() => setShowScaleTip(!showScaleTip)}>
                  <HelpCircle className="h-3.5 w-3.5" />
                  {showScaleTip ? scaleTips[form.nodeScale] : "查看说明"}
                </button>
                <div className="flex gap-3">
                  {(["小型", "中型", "大型"] as const).map((scale) => (
                    <SegmentButton key={scale} selected={form.nodeScale === scale} onClick={() => {
                      setForm((prev) => ({ ...prev, nodeScale: scale }));
                      setShowScaleTip(false);
                    }}>{scale}</SegmentButton>
                  ))}
                </div>
              </FormField>
              <FormField label="MQTT 服务">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, mqttEnabled: !prev.mqttEnabled }))} className={cn("relative h-6 w-11 rounded-full transition-colors", form.mqttEnabled ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")}>
                    <span className={cn("absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white transition-all", form.mqttEnabled ? "left-[22px]" : "left-[3px]")} />
                  </button>
                  <span className={cn("text-sm", form.mqttEnabled ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{form.mqttEnabled ? "已启用" : "未启用"}</span>
                </div>
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Insight 状态">
                  <select className="blueedge-native-select" value={form.insightStatus} onChange={(event) => setForm((prev) => ({ ...prev, insightStatus: event.target.value as CreateForm["insightStatus"] }))}>
                    <option value="unknown">未配置</option>
                    <option value="installed">已安装</option>
                    <option value="notInstalled">未安装</option>
                  </select>
                </FormField>
                <FormField label="Monitor 状态">
                  <select className="blueedge-native-select" value={form.monitorStatus} onChange={(event) => setForm((prev) => ({ ...prev, monitorStatus: event.target.value as CreateForm["monitorStatus"] }))}>
                    <option value="unknown">未配置</option>
                    <option value="installed">已安装</option>
                    <option value="notInstalled">未安装</option>
                  </select>
                </FormField>
              </div>
              <FormField label="描述">
                <Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="请输入描述信息" rows={4} />
              </FormField>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              {showCommWarning && (
                <div className="flex items-start gap-2 rounded-xl bg-[var(--color-warning-soft)] p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                  <div>
                    <p className="text-xs font-semibold text-[#b7791f]">可能影响边缘节点通信</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">修改访问地址、端口、通讯协议或卸载策略后，已接入的节点可能无法正常通信，请谨慎操作。</p>
                  </div>
                </div>
              )}
              <FormField label="组件通信协议" remark="云边信令通道通信协议，云边网络经常不稳定时，推荐使用 QUIC 协议">
                <div className="grid grid-cols-2 gap-3">
                  {["WebSocket", "QUIC"].map((protocol) => (
                    <SegmentButton key={protocol} selected={form.protocols.includes(protocol)} onClick={() => toggleProtocol(protocol)}>{protocol}</SegmentButton>
                  ))}
                </div>
              </FormField>
              <FormField label="云端节点访问地址" remark="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                <div className="space-y-2">
                  {form.accessAddresses.map((address, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input value={address} onChange={(event) => {
                        setShowCommWarning(true);
                        setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }));
                      }} placeholder="请输入访问地址，例如 10.6.222.21" />
                      {form.accessAddresses.length > 1 && (
                        <button type="button" className="action-button is-danger" aria-label="删除访问地址" onClick={() => {
                          setShowCommWarning(true);
                          setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.filter((_, itemIndex) => itemIndex !== index) }));
                        }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)]" onClick={() => {
                    setShowCommWarning(true);
                    setForm((prev) => ({ ...prev, accessAddresses: [...prev.accessAddresses, ""] }));
                  }}>
                    <Plus className="h-3.5 w-3.5" />
                    添加访问地址
                  </button>
                </div>
              </FormField>
              <FormField label="端口设置" remark="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  {([
                    ["websocket", "WebSocket"],
                    ["quic", "QUIC"],
                    ["https", "HTTPS"],
                    ["cloudStream", "CloudStream"],
                    ["tunnel", "Tunnel"],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
                      <Input className="h-10 text-center text-base" value={form.ports[key]} onChange={(event) => {
                        setShowCommWarning(true);
                        setForm((prev) => ({ ...prev, ports: { ...prev.ports, [key]: event.target.value } }));
                      }} />
                    </div>
                  ))}
                </div>
              </FormField>
              <FormField label="卸载策略">
                <div className="grid grid-cols-2 gap-3">
                  {(["保留相关命名空间", "删除相关命名空间"] as const).map((policy) => (
                    <button key={policy} type="button" onClick={() => {
                      setShowCommWarning(true);
                      setForm((prev) => ({ ...prev, uninstallPolicy: policy }));
                    }} className={cn("flex h-12 w-full items-center gap-3 rounded-xl border-2 px-4 text-left text-sm font-semibold transition-all", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)] bg-[var(--color-bg-hover)]" : "border-[var(--color-input-border)] bg-white hover:border-[var(--color-input-border-hover)]")}>
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-strong)]")}>
                        {form.uninstallPolicy === policy && <span className="h-2 w-2 rounded-full bg-[var(--color-text-primary)]" />}
                      </span>
                      {policy}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          {step === 2 && <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="h-3.5 w-3.5" />上一步</Button>}
          {step === 1 ? (
            <Button onClick={() => setStep(2)}>下一步<ChevronRight className="h-3.5 w-3.5" /></Button>
          ) : (
            <Button onClick={() => setShowConfirm(true)}>保存</Button>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
              确认修改边缘单元
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">确定要修改边缘单元 <strong className="text-[var(--color-text-primary)]">「{unit?.name}」</strong> 的配置吗？</p>
            <div className="rounded-xl bg-[var(--color-warning-soft)] p-3">
              <p className="text-xs font-semibold text-[#b7791f]">可能影响以下功能：</p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                <li>节点接入配置可能需要同步更新</li>
                <li>通信协议变更可能影响已接入节点连接</li>
                <li>端口变更需要确保网络策略允许</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>取消</Button>
            <Button onClick={save} disabled={isSubmitting}>{isSubmitting ? "保存中..." : "确认修改"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function UnitCard({
  unit,
  onEdit,
  onDelete,
  onEnableSync,
  syncMutating,
}: {
  unit: EdgeUnit;
  onEdit: (unit: EdgeUnit) => void;
  onDelete: (unitName: string) => void;
  onEnableSync: () => void;
  syncMutating: boolean;
}) {
  const navigate = useNavigate();
  const { selectEdgeUnit } = useEdgeUnits();
  const status = statusMeta[unit.status];
  const enterWorkbench = () => {
    selectEdgeUnit(unit.name);
    navigate("/dashboard");
  };

  return (
    <article className="rounded-2xl bg-white p-6 shadow-[0_18px_50px_rgba(16,24,40,0.06)] ring-1 ring-[var(--color-border)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-light)] text-[var(--color-brand)]">
            <Server className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-bold text-[var(--color-text-primary)]">{unit.name}</h2>
              <UnitBadge tone={unit.status === "running" ? "success" : unit.status === "abnormal" ? "danger" : "info"}>
                <span className="mr-1 h-1.5 w-1.5 rounded-full bg-current" />
                {status.label}
              </UnitBadge>
              <UnitBadge>{unit.access}</UnitBadge>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="blueedge-icon-button h-9 w-9 rounded-xl" aria-label={`${unit.name} 更多操作`}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="min-w-[156px] rounded-2xl border-[var(--color-border)] bg-white p-2 shadow-[0_18px_46px_rgba(16,24,40,0.16)]">
            <DropdownMenuItem className="h-9 cursor-pointer rounded-xl px-3 text-sm text-[var(--color-text-primary)] focus:bg-[var(--color-bg-hover)]" onSelect={enterWorkbench}>
              <ExternalLink className="h-4 w-4 text-[var(--color-text-tertiary)]" />
              进入工作台
            </DropdownMenuItem>
            <DropdownMenuItem className="h-9 cursor-pointer rounded-xl px-3 text-sm text-[var(--color-text-primary)] focus:bg-[var(--color-bg-hover)]" onSelect={() => onEdit(unit)}>
              <Pencil className="h-4 w-4 text-[var(--color-text-tertiary)]" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem className="h-9 cursor-pointer rounded-xl px-3 text-sm text-[var(--color-text-secondary)] focus:bg-[var(--color-bg-hover)] focus:text-[var(--color-text-primary)]" onSelect={() => onDelete(unit.name)}>
              <Trash2 className="h-4 w-4 text-[var(--color-text-tertiary)]" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <InfoCell icon={Box} label="集群" value={unit.cluster} />
        <InfoCell icon={SlidersHorizontal} label="KubeEdge 版本" value={unit.version} extra={<UnitBadge>{unit.access}</UnitBadge>} />
        <InfoCell icon={Calendar} label="创建时间" value={unit.createdAt} />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-5">
        <Metric type="nodes" label="边缘节点" value={unit.nodes} />
        <Metric type="workloads" label="工作负载" value={unit.workloads} />
        <Metric type="apps" label="应用实例" value={unit.apps} />
      </div>

      <div className="mt-7 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Capability label="增量同步" enabled={Boolean(unit.incrementalSync?.enabled)} />
          {!unit.incrementalSync?.enabled && unit.accessType === "dedicated" && (
            <button
              type="button"
              className="text-xs font-semibold text-[var(--color-brand)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              disabled={syncMutating || !unit.incrementalSync?.installed}
              title={unit.incrementalSync?.message || "未能读取 CloudCore 增量同步状态"}
              onClick={onEnableSync}
            >
              {unit.incrementalSync?.installed ? (syncMutating ? "正在启用…" : "启用增量同步") : "CloudCore 未安装"}
            </button>
          )}
          {!unit.incrementalSync?.enabled && unit.accessType === "external" && (
            <span className="text-xs text-[var(--color-text-tertiary)]" title="外接 CloudCore 由外部系统管理，请在原系统中启用增量同步">
              外接模式只读
            </span>
          )}
          <Capability label="Insight" enabled={unit.insight} />
          <Capability label="Monitor" enabled={unit.monitor} />
          <a href={PAAS_CONSOLE_URL} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--color-brand)] transition-colors hover:text-[var(--color-brand-hover)] hover:underline">边缘监控组件下载</a>
          <a href={PAAS_CONSOLE_URL} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[var(--color-brand)] transition-colors hover:text-[var(--color-brand-hover)] hover:underline">立即安装</a>
        </div>
        <Button className="h-9 rounded-xl px-5 text-xs" onClick={enterWorkbench}>
          进入工作台
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [edgeUnits, setEdgeUnits] = useState<EdgeUnit[]>([]);
  const [warnings, setWarnings] = useState<EdgeUnitWarning[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [syncMutating, setSyncMutating] = useState(false);
  const [operationMessage, setOperationMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<EdgeUnit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EdgeUnit | null>(null);
  const [clusterOptions, setClusterOptions] = useState<string[]>([]);
  const { refreshEdgeUnits } = useEdgeUnits();
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [result, clusters] = await Promise.all([
        listEdgeUnits(),
        listConnectedClusters().catch((err) => {
          setError(messageOfError(err, "真实集群加载失败"));
          return { items: [] };
        }),
      ]);
      setEdgeUnits(result.items.map(toHomeEdgeUnit));
      setWarnings(result.warnings || []);
      setClusterOptions(clusters.items.map((cluster) => cluster.name));
    } catch (err) {
      setError(messageOfError(err, "边缘单元加载失败"));
      setEdgeUnits([]);
      setWarnings([]);
      setClusterOptions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visibleUnits = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return edgeUnits;
    return edgeUnits.filter((unit) => unit.name.toLowerCase().includes(keyword) || unit.cluster.toLowerCase().includes(keyword));
  }, [edgeUnits, query]);

  const edgeUnitClusterOptions = useMemo<ClusterOption[]>(() => clusterOptions.map((name) => ({
    name,
    edgeUnitName: edgeUnits.find((unit) => unit.cluster === name)?.name,
  })), [clusterOptions, edgeUnits]);

  const handleCreate = async (form: CreateForm) => {
    setIsMutating(true);
    setNotice("");
    try {
      const payload: EdgeUnitCreatePayload = {
        name: form.name.trim(),
        clusterName: form.cluster,
        accessType: accessTypeFromUnitType(form.unitType),
        kubeEdgeVersion: form.version.trim(),
        insightStatus: form.insightStatus,
        monitorStatus: form.monitorStatus,
        description: form.description,
        nodeScale: form.nodeScale,
        mqttEnabled: form.mqttEnabled,
        protocols: form.protocols,
        accessAddresses: form.accessAddresses,
        ports: form.ports,
        uninstallPolicy: form.uninstallPolicy,
      };
      await createEdgeUnit(payload, (operation) => setOperationMessage(operation.message));
      await Promise.all([loadData(), refreshEdgeUnits()]);
      setNotice(`边缘单元 ${payload.name} 已创建。`);
    } catch (err) {
      const message = messageOfError(err, "边缘单元创建失败");
      setNotice(message);
      throw err;
    } finally {
      setIsMutating(false);
      setOperationMessage("");
    }
  };

  const handleUpdate = async (unit: EdgeUnit, payload: EdgeUnitUpdatePayload) => {
    setIsMutating(true);
    setNotice("");
    try {
      await updateEdgeUnit(unit.name, payload);
      await Promise.all([loadData(), refreshEdgeUnits()]);
      setNotice(`边缘单元 ${unit.name} 元数据已更新。`);
    } catch (err) {
      setNotice(messageOfError(err, "边缘单元更新失败"));
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsMutating(true);
    setNotice("");
    try {
      const result = await deleteEdgeUnit(deleteTarget.name, (operation) => setOperationMessage(operation.message));
      await Promise.all([loadData(), refreshEdgeUnits()]);
      setDeleteTarget(null);
      setNotice(result.warnings?.map((item) => item.message).join("；") || `边缘单元 ${deleteTarget.name} 元数据已删除。`);
    } catch (err) {
      setNotice(messageOfError(err, "边缘单元删除失败"));
    } finally {
      setIsMutating(false);
      setOperationMessage("");
    }
  };

  const handleEnableSync = async (edgeUnitName: string) => {
    setSyncMutating(true);
    setNotice("");
    try {
      const status = await enableCloudCoreIncrementalSync(edgeUnitName);
      await Promise.all([loadData(), refreshEdgeUnits()]);
      setNotice(status.message);
    } catch (err) {
      setNotice(messageOfError(err, "CloudCore 增量同步启用失败"));
    } finally {
      setSyncMutating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)]">
      <header className="flex h-[72px] items-center justify-between border-b border-[var(--color-border)] bg-white px-5">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-base font-bold text-[var(--color-text-primary)]">BlueEdge 云边协同平台</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="blueedge-icon-button" aria-label="刷新" onClick={() => void loadData()}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1380px] px-6 py-9">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-[320px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              className="h-11 w-full rounded-xl border border-[var(--color-input-border)] bg-white pl-11 pr-4 text-sm text-[var(--color-text-primary)] shadow-sm outline-none transition focus:border-[var(--color-text-primary)] focus:ring-4 focus:ring-[var(--color-text-primary)]/10"
              placeholder="搜索边缘单元或集群名称"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button className="h-11 rounded-xl px-5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            创建边缘单元
          </Button>
        </div>

        {notice && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#2563eb]">
            <span>{notice}</span>
            <button type="button" className="text-xs font-semibold" onClick={() => setNotice("")}>关闭</button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">
            {error}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 rounded-xl border border-[#fef3c7] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
            部分辅助数据加载失败：{warnings.map((item) => `${item.source}: ${item.message}`).join("；")}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white p-12 text-center shadow-[0_18px_50px_rgba(16,24,40,0.04)]">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-[var(--color-text-tertiary)]" />
            <p className="text-sm font-semibold text-[var(--color-text-secondary)]">正在加载边缘单元</p>
          </div>
        ) : visibleUnits.length === 0 ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white p-12 text-center shadow-[0_18px_50px_rgba(16,24,40,0.04)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]">
              <Server className="h-7 w-7" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-secondary)]">暂无边缘单元</p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">当前还没有创建 BlueEdge 边缘单元</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {visibleUnits.map((unit) => (
              <UnitCard
                key={unit.name}
                unit={unit}
                onEdit={setEditingUnit}
                onDelete={(unitName) => setDeleteTarget(edgeUnits.find((item) => item.name === unitName) || null)}
                onEnableSync={() => void handleEnableSync(unit.name)}
                syncMutating={syncMutating}
              />
            ))}
          </div>
        )}
      </main>
      <CreateEdgeUnitDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clusterOptions={edgeUnitClusterOptions}
        isSubmitting={isMutating}
        operationMessage={operationMessage}
        onCreate={handleCreate}
      />
      <EditEdgeUnitDialog
        unit={editingUnit}
        clusterOptions={edgeUnitClusterOptions}
        onOpenChange={(open) => {
          if (!open) setEditingUnit(null);
        }}
        isSubmitting={isMutating}
        onSave={handleUpdate}
      />
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除边缘单元元数据</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.accessType === "dedicated"
                ? `将卸载 BlueEdge 管理的 CloudCore，并按“${deleteTarget.uninstallPolicy || "保留相关命名空间"}”执行；边缘节点和工作负载将暂时不可用。`
                : "将只删除 BlueEdge EdgeUnit ConfigMap 元数据，不会卸载外接 CloudCore。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl bg-[var(--color-bg-soft)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
            {deleteTarget?.name}
          </div>
          {isMutating && operationMessage && <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#2563eb]">{operationMessage}</div>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }} disabled={isMutating}>
              {isMutating ? "删除中..." : "确认删除元数据"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

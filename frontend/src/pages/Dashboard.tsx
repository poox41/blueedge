import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCode,
  HelpCircle,
  Info,
  ExternalLink,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Route,
  Server,
  Settings2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toWorkbenchEdgeUnit, type WorkbenchEdgeUnitModel } from "@/api/adapters/edge-unit.adapter";
import { updateEdgeUnit, type EdgeUnitUpdatePayload } from "@/api/services/product";
import { useAuth } from "@/contexts/AuthContext";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";
import { cn } from "@/lib/utils";

type WorkbenchEdgeUnit = WorkbenchEdgeUnitModel;

function accessTypeFromWorkbench(value: WorkbenchEdgeUnit["type"]): EdgeUnitUpdatePayload["accessType"] {
  if (value === "外接") return "external";
  if (value === "专有") return "dedicated";
  return "unknown";
}

function messageOfError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type WorkbenchNavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href: string;
  active?: boolean;
};

const navGroups: Array<{ group: string; items: WorkbenchNavItem[] }> = [
  {
    group: "",
    items: [{ label: "概览", icon: LayoutDashboard, active: true, href: "/dashboard" }],
  },
  {
    group: "边缘资源",
    items: [
      { label: "边缘节点", icon: Server, href: "/nodes" },
      { label: "边缘节点组", icon: Settings2, href: "/nodegroups" },
      { label: "设备模型", icon: Cpu, href: "/devicemodels" },
      { label: "终端设备", icon: Box, href: "/deviceinstances" },
      { label: "批量任务", icon: Rocket, href: "/batchtasks" },
    ],
  },
  {
    group: "边缘应用",
    items: [
      { label: "工作负载", icon: Layers, href: "/deployments" },
      { label: "批量工作负载", icon: Layers, href: "/batchworkloads" },
      { label: "配置项与密钥", icon: FileCode, href: "/configmaps" },
    ],
  },
  {
    group: "边云消息",
    items: [
      { label: "消息端点", icon: MessageSquare, href: "/ruleendpoints" },
      { label: "消息路由", icon: Route, href: "/rules" },
    ],
  },
];

function StatusPill({ children, tone = "success" }: { children: React.ReactNode; tone?: "success" | "warning" }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold", tone === "success" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-warning-soft)] text-[#f57c00]")}>
      {tone === "success" && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function WorkbenchSidebar({ unit }: { unit: WorkbenchEdgeUnit }) {
  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-[#e8ecf3] bg-white">
      <div className="flex h-[72px] shrink-0 items-center border-b border-[#e8ecf3] px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-text-primary)]">
          <Box className="h-4 w-4 text-white" />
        </div>
        <span className="ml-3 text-sm font-bold text-[var(--color-text-primary)]">BlueEdge</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto py-3">
        {navGroups.map((group) => (
          <div key={group.group || "root"} className="px-3">
            {group.group && <div className="mb-2 mt-5 px-3 text-[11px] font-semibold text-[var(--color-text-tertiary)]">{group.group}</div>}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.href}
                  className={cn(
                    "relative mb-0.5 flex h-10 items-center rounded-[10px] px-3 text-sm font-medium transition-colors",
                    item.active ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[#5f6368] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  )}
                >
                  {item.active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-text-primary)]" />}
                  <Icon className="h-[18px] w-[18px]" />
                  <span className="ml-3">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 px-3 pb-3">
        <div className="rounded-[22px] border border-[#e8ecf3] bg-[#f6f7f9] p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="mb-3 flex items-center justify-between">
            <StatusPill tone={unit.status === "运行中" ? "success" : "warning"}>{unit.status}</StatusPill>
            <StatusPill tone="warning">{unit.type}</StatusPill>
          </div>
          <h3 className="mb-2 truncate text-sm font-bold text-[var(--color-text-primary)]">{unit.name}</h3>
          <div className="space-y-1 text-[11px] text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-1.5"><Server className="h-3 w-3 text-[var(--color-text-tertiary)]" />{unit.cluster}</div>
            <div className="flex items-center gap-1.5"><Box className="h-3 w-3 text-[var(--color-text-tertiary)]" />KubeEdge {unit.version}</div>
          </div>
          <div className="my-3 border-t border-[#e8ecf3]" />
          <Link to="/" className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-[#e8ecf3] bg-white text-xs font-semibold text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-text-primary)] hover:text-white">
            <ChevronLeft className="h-3.5 w-3.5" />
            返回列表
          </Link>
        </div>
      </div>
    </aside>
  );
}

function WorkbenchTopbar({
  unit,
  units,
  loading,
  onSelectUnit,
  onRefresh,
}: {
  unit: WorkbenchEdgeUnit;
  units: WorkbenchEdgeUnit[];
  loading: boolean;
  onSelectUnit: (name: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { logout } = useAuth();
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
          <ChevronLeft className="h-3.5 w-3.5" />
          边缘单元
        </Link>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]">
              <Server className="h-3.5 w-3.5 text-[var(--color-brand)]" />
              {unit.name}
              <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[224px] rounded-xl border-[var(--color-border)] p-2 shadow-xl">
            <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold text-[var(--color-text-tertiary)]">
              切换边缘单元
            </DropdownMenuLabel>
            {units.map((item) => {
              const active = item.name === unit.name;
              return (
                <DropdownMenuItem
                  key={item.name}
                  onClick={() => onSelectUnit(item.name)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)]",
                    active && "bg-[var(--color-brand-light)] text-[var(--color-brand)]",
                  )}
                >
                  <Server className={cn("h-4 w-4", active ? "text-[var(--color-brand)]" : "text-[var(--color-text-secondary)]")} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <span className="font-semibold text-[var(--color-text-primary)]">概览</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="blueedge-icon-button" aria-label="刷新边缘单元" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
        <button onClick={logout} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-white" aria-label="退出登录">
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function QuickStart() {
  const items = [
    { title: "接入节点", prefix: "在", link: "边缘节点", suffix: "模块，纳管边缘硬件设备", href: "/nodes" },
    { title: "部署边缘应用", prefix: "将", link: "工作负载", suffix: "部署到指定边缘节点或边缘节点组", href: "/deployments" },
    { title: "创建终端设备", prefix: "传感类或视频类", link: "设备创建", suffix: "，管理并采集设备数据", href: "/deviceinstances" },
  ];
  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">快速入门</h2>
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6">
        <div className="grid grid-cols-3 gap-6">
          {items.map((item, index) => (
            <div key={item.title} className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] text-sm font-bold text-[var(--color-text-tertiary)]">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <h3 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  {item.prefix}
                  <Link to={item.href} className="mx-0.5 inline-flex items-center gap-0.5 font-medium text-[var(--color-brand)] hover:underline">
                    {item.link}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                  {item.suffix}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OverviewCard({ unit, onEdit }: { unit: WorkbenchEdgeUnit; onEdit: () => void }) {
  const [activeTab, setActiveTab] = useState<"basic" | "advanced">("basic");
  const metrics = [
    { label: "边缘节点", value: unit.nodes, color: "var(--color-success)", bg: "var(--color-success-soft)", icon: Server },
    { label: "工作负载", value: unit.workloads, color: "var(--color-brand)", bg: "var(--color-info-soft)", icon: Layers },
    { label: "应用实例", value: unit.apps, color: "var(--color-warning)", bg: "var(--color-warning-soft)", icon: Box },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Server className="h-[18px] w-[18px] text-[var(--color-brand)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{unit.name}</h2>
          <StatusPill tone={unit.status === "运行中" ? "success" : "warning"}>{unit.status}</StatusPill>
          <StatusPill tone="warning">{unit.type}</StatusPill>
        </div>
        <Button size="sm" className="h-8 rounded-xl px-3 text-xs" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </Button>
      </div>

      <div className="p-5">
        <div className="mb-6 grid grid-cols-3 gap-6 border-b border-[var(--color-border)] pb-6">
          {metrics.map((item) => {
            const Icon = item.icon;
            const percent = item.value[1] > 0 ? (item.value[0] / item.value[1]) * 100 : 0;
            return (
              <div key={item.label} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: item.bg, color: item.color }}>
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--color-text-tertiary)]">{item.label}</p>
                  <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {item.value[0]}
                    <span className="text-xs font-normal text-[var(--color-text-tertiary)]">/{item.value[1]}</span>
                  </p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-soft)]">
                    <div className="h-full rounded-full" style={{ width: `${percent}%`, background: item.color }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-4 flex gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("basic")}
            className={cn(
              "border-b-2 pb-2 transition-colors",
              activeTab === "basic" ? "border-[var(--color-text-primary)] text-[var(--color-text-primary)]" : "border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            基本信息
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("advanced")}
            className={cn(
              "border-b-2 pb-2 transition-colors",
              activeTab === "advanced" ? "border-[var(--color-text-primary)] text-[var(--color-text-primary)]" : "border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            高级设置
          </button>
        </div>
        {activeTab === "basic" ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {[
              ["名称", unit.name],
              ["状态", <StatusPill key="status" tone={unit.status === "运行中" ? "success" : "warning"}>{unit.status}</StatusPill>],
              ["工作集群", unit.cluster],
              ["KubeEdge 版本", unit.version],
              ["边缘节点规模", unit.nodeScale],
              ["边缘单元类型", unit.type],
              ["MQTT 服务", unit.mqtt],
              ["通信协议", unit.protocols],
              ["接入地址", unit.access],
              ["创建时间", unit.createdAt],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-start gap-3">
                <span className="w-24 shrink-0 text-xs text-[var(--color-text-tertiary)]">{label}</span>
                <span className="text-sm text-[var(--color-text-primary)]">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">端口设置</p>
              <div className="grid grid-cols-5 gap-3">
                {[
                  ["WebSocket", unit.ports.websocket],
                  ["QUIC", unit.ports.quic],
                  ["HTTPS", unit.ports.https],
                  ["CloudStream", unit.ports.cloudStream],
                  ["Tunnel", unit.ports.tunnel],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-[var(--color-bg-soft)] p-2.5">
                    <span className="text-xs text-[var(--color-text-tertiary)]">{label}</span>
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">卸载策略</p>
              <p className="text-sm text-[var(--color-text-primary)]">{unit.uninstallPolicy}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FormField({ label, children, hint, tip, onTipToggle }: { label: string; children: React.ReactNode; hint?: string; tip?: string; onTipToggle?: () => void }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-[var(--color-text-primary)]">
        {label}
        {onTipToggle && <button type="button" className="text-[var(--color-text-tertiary)]" onClick={onTipToggle}><HelpCircle className="h-3.5 w-3.5" /></button>}
      </label>
      {tip && <div className="mb-2 rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-xs text-[var(--color-info)]">{tip}</div>}
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">{hint}</p>}
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

function OverviewEditDialog({
  open,
  unit,
  onOpenChange,
  isSubmitting,
  onSave,
}: {
  open: boolean;
  unit: WorkbenchEdgeUnit;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSave: (unit: WorkbenchEdgeUnit, payload: EdgeUnitUpdatePayload) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [showScaleTip, setShowScaleTip] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showCommWarning, setShowCommWarning] = useState(false);
  const formBodyRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    type: unit.type,
    cluster: unit.cluster === "未配置" ? "" : unit.cluster,
    version: unit.version === "未配置" ? "" : unit.version,
    insightStatus: unit.insightStatus,
    monitorStatus: unit.monitorStatus,
    nodeScale: unit.nodeScale,
    mqttEnabled: unit.mqtt === "已启用",
    description: unit.description,
    protocols: unit.protocolList,
    accessAddresses: unit.accessAddresses,
    ports: unit.ports,
    uninstallPolicy: unit.uninstallPolicy,
  });

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setShowScaleTip(false);
    setShowConfirm(false);
    setShowCloseConfirm(false);
    setShowCommWarning(false);
    setForm({
      type: unit.type,
      cluster: unit.cluster === "未配置" ? "" : unit.cluster,
      version: unit.version === "未配置" ? "" : unit.version,
      insightStatus: unit.insightStatus,
      monitorStatus: unit.monitorStatus,
      nodeScale: unit.nodeScale,
      mqttEnabled: unit.mqtt === "已启用",
      description: unit.description,
      protocols: unit.protocolList,
      accessAddresses: unit.accessAddresses,
      ports: unit.ports,
      uninstallPolicy: unit.uninstallPolicy,
    });
  }, [open, unit]);

  useEffect(() => {
    formBodyRef.current?.scrollTo({ top: 0 });
  }, [open, step]);

  const initialForm = {
    type: unit.type,
    cluster: unit.cluster === "未配置" ? "" : unit.cluster,
    version: unit.version === "未配置" ? "" : unit.version,
    insightStatus: unit.insightStatus,
    monitorStatus: unit.monitorStatus,
    nodeScale: unit.nodeScale,
    mqttEnabled: unit.mqtt === "已启用",
    description: unit.description,
    protocols: unit.protocolList,
    accessAddresses: unit.accessAddresses,
    ports: unit.ports,
    uninstallPolicy: unit.uninstallPolicy,
  };
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const requestClose = () => {
    if (isDirty) {
      setShowCloseConfirm(true);
      return;
    }
    onOpenChange(false);
  };

  const toggleProtocol = (protocol: string) => {
    setShowCommWarning(true);
    setForm((prev) => ({
      ...prev,
      protocols: prev.protocols.includes(protocol) ? prev.protocols.filter((item) => item !== protocol) : [...prev.protocols, protocol],
    }));
  };

  const save = () => {
    const payload: EdgeUnitUpdatePayload = {
      clusterName: form.cluster,
      accessType: accessTypeFromWorkbench(form.type),
      kubeEdgeVersion: form.version,
      insightStatus: form.insightStatus,
      monitorStatus: form.monitorStatus,
      description: form.description,
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

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}>
        <DialogContent className="!flex max-h-[92vh] max-w-[680px] flex-col gap-0 overflow-hidden p-0" showCloseButton>
          <DialogHeader className="shrink-0 border-b border-[var(--color-border)] px-6 py-4">
            <DialogTitle className="text-base font-semibold">编辑边缘单元 — {unit.name}</DialogTitle>
          </DialogHeader>
          <div className="flex shrink-0 items-center justify-center px-6 py-4">
            <div className="flex items-center gap-1">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", step === 1 ? "border-2 border-[var(--color-brand)] bg-[var(--color-text-primary)] text-white" : "bg-[var(--color-text-primary)] text-white")}>1</span>
              <span className="ml-1 text-sm font-medium text-[var(--color-text-primary)]">基本信息</span>
              <span className={cn("mx-1 h-0.5 w-8", step === 2 ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", step === 2 ? "border-2 border-[var(--color-brand)] bg-[var(--color-text-primary)] text-white" : "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]")}>2</span>
              <span className={cn("ml-1 text-sm font-medium", step === 2 ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>高级设置</span>
            </div>
          </div>
          <div ref={formBodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
            {step === 1 ? (
              <div className="space-y-5">
                <FormField label="边缘单元名称" hint="边缘单元名称不可修改"><Input value={unit.name} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" /></FormField>
                <FormField label="工作集群" hint="工作集群不可修改"><Input value={unit.cluster} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" /></FormField>
                <FormField label="KubeEdge 版本" hint="KubeEdge 版本不可修改"><Input value={unit.version} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" /></FormField>
                <FormField
                  label="边缘节点规模"
                  tip={showScaleTip ? ({ 小型: "适用于小规模边缘场景，节点数不超过 10 个", 中型: "适用于中等规模边缘场景，节点数不超过 100 个", 大型: "适用于大规模边缘场景，节点数不超过 1000 个" } as const)[form.nodeScale] : undefined}
                  onTipToggle={() => setShowScaleTip((visible) => !visible)}
                >
                  <div className="flex gap-3">{(["小型", "中型", "大型"] as const).map((scale) => <SegmentButton key={scale} selected={form.nodeScale === scale} onClick={() => setForm((prev) => ({ ...prev, nodeScale: scale }))}>{scale}</SegmentButton>)}</div>
                </FormField>
                <FormField label="MQTT 服务">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setForm((prev) => ({ ...prev, mqttEnabled: !prev.mqttEnabled }))} className={cn("relative h-6 w-11 rounded-full transition-colors", form.mqttEnabled ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")}>
                      <span className={cn("absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white transition-all", form.mqttEnabled ? "left-[22px]" : "left-[3px]")} />
                    </button>
                    <span className={cn("text-sm", form.mqttEnabled ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>{form.mqttEnabled ? "已启用" : "未启用"}</span>
                  </div>
                </FormField>
                <FormField label="描述"><Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="请输入描述信息" rows={3} /></FormField>
              </div>
            ) : (
              <div className="space-y-5">
                {showCommWarning && <div className="flex items-start gap-2 rounded-lg bg-[var(--color-warning-soft)] p-3"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" /><div><p className="text-xs font-medium text-[var(--color-warning)]">可能影响边缘节点通信</p><p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">修改访问地址、端口、通讯协议或卸载策略后，已接入的节点可能无法正常通信，请谨慎操作。</p></div></div>}
                <FormField label="组件通信协议" hint="云边信令通道通信协议，云边网络经常不稳定时，推荐使用 QUIC 协议">
                  <div className="grid grid-cols-2 gap-3">{["WebSocket", "QUIC"].map((protocol) => <SegmentButton key={protocol} selected={form.protocols.includes(protocol)} showCheck onClick={() => toggleProtocol(protocol)}>{protocol}</SegmentButton>)}</div>
                </FormField>
                <FormField label="云端节点访问地址" hint="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                  <div className="space-y-2">
                    {form.accessAddresses.map((address, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={address} onChange={(event) => {
                          setShowCommWarning(true);
                          setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }));
                        }} placeholder="请输入访问地址，例如 10.6.222.21" />
                        {form.accessAddresses.length > 1 && <button type="button" className="blueedge-icon-button shrink-0 text-[var(--color-danger)]" onClick={() => setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.filter((_, itemIndex) => itemIndex !== index) }))}><X className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                    <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)]" onClick={() => setForm((prev) => ({ ...prev, accessAddresses: [...prev.accessAddresses, ""] }))}><Plus className="h-3.5 w-3.5" />添加访问地址</button>
                  </div>
                </FormField>
                <FormField label="端口设置" hint="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries({ websocket: "WebSocket", quic: "QUIC", https: "HTTPS", cloudStream: "CloudStream", tunnel: "Tunnel" }).map(([key, label]) => (
                      <div key={key}><label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</label><Input className="text-center" type="number" value={form.ports[key as keyof typeof form.ports]} onChange={(event) => {
                        setShowCommWarning(true);
                        setForm((prev) => ({ ...prev, ports: { ...prev.ports, [key]: event.target.value } }));
                      }} /></div>
                    ))}
                  </div>
                </FormField>
                <FormField label="卸载策略">
                  <div className="space-y-2">{(["保留相关命名空间", "删除相关命名空间"] as const).map((policy) => <button key={policy} type="button" onClick={() => { setShowCommWarning(true); setForm((prev) => ({ ...prev, uninstallPolicy: policy })); }} className={cn("flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left text-sm font-medium", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)] bg-[var(--color-bg-hover)]" : "border-[var(--color-input-border)] bg-white")}><span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-strong)]")}>{form.uninstallPolicy === policy && <span className="h-2 w-2 rounded-full bg-[var(--color-text-primary)]" />}</span>{policy}</button>)}</div>
                </FormField>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
            <Button variant="outline" onClick={requestClose}>取消</Button>
            {step === 2 && <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="h-3.5 w-3.5" />上一步</Button>}
            {step === 1 ? <Button onClick={() => setStep(2)}>下一步<ChevronRight className="h-3.5 w-3.5" /></Button> : <Button onClick={() => setShowConfirm(true)}>保存</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-[480px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-[var(--color-border)] px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-[18px] w-[18px] text-[var(--color-warning)]" />确认修改边缘单元</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <p className="text-sm text-[var(--color-text-secondary)]">您确定要修改边缘单元 <strong className="text-[var(--color-text-primary)]">「{unit.name}」</strong> 的配置吗？</p>
            <div className="rounded-lg bg-[var(--color-warning-soft)] p-3">
              <p className="mb-1 text-xs font-medium text-[var(--color-warning)]">可能影响以下功能：</p>
              <ul className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                <li>• 节点接入配置可能需要同步更新</li>
                <li>• 通信协议变更可能影响已接入节点连接</li>
                <li>• 端口变更需要确保网络策略允许</li>
                <li>• 标签变更可能影响节点组匹配和调度</li>
              </ul>
            </div>
          </div>
          <DialogFooter className="border-t border-[var(--color-border)] px-6 py-4"><Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>取消</Button><Button onClick={save} disabled={isSubmitting}>{isSubmitting ? "保存中..." : "确认修改"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <DialogContent className="max-w-[400px] gap-0 overflow-hidden p-0">
          <DialogHeader className="px-6 py-5">
            <DialogTitle className="text-base">确认关闭</DialogTitle>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">您有未保存的修改，确定要关闭吗？</p>
          </DialogHeader>
          <DialogFooter className="border-t border-[var(--color-border)] px-6 py-4">
            <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>取消</Button>
            <Button variant="destructive" onClick={() => {
              setShowCloseConfirm(false);
              onOpenChange(false);
            }}>确认关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Dashboard() {
  const { edgeUnits, selectedEdgeUnit, loading: isLoading, error, warnings, refreshEdgeUnits, selectEdgeUnit } = useEdgeUnits();
  const units = edgeUnits.map(toWorkbenchEdgeUnit);
  const unit = selectedEdgeUnit ? toWorkbenchEdgeUnit(selectedEdgeUnit) : null;
  const [isMutating, setIsMutating] = useState(false);
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);

  useEffect(() => {
    void refreshEdgeUnits();
  }, [refreshEdgeUnits]);

  const handleSave = async (target: WorkbenchEdgeUnit, payload: EdgeUnitUpdatePayload) => {
    setIsMutating(true);
    setNotice("");
    try {
      await updateEdgeUnit(target.name, payload);
      await refreshEdgeUnits();
      setNotice(`边缘单元 ${target.name} 元数据已更新。`);
    } catch (err) {
      setNotice(messageOfError(err, "边缘单元更新失败"));
      throw err;
    } finally {
      setIsMutating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-page)]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-white px-10 py-8 text-center">
          <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-[var(--color-text-tertiary)]" />
          <p className="text-sm font-semibold text-[var(--color-text-secondary)]">正在加载边缘单元</p>
        </div>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-page)]">
        <div className="w-[460px] rounded-2xl border border-[var(--color-border)] bg-white px-10 py-8 text-center">
          <Server className="mx-auto mb-4 h-10 w-10 text-[var(--color-text-tertiary)]" />
          <p className="text-base font-semibold text-[var(--color-text-primary)]">暂无边缘单元</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{error || "当前没有可展示的 KubeEdge NodeGroup"}</p>
          <Button className="mt-5 h-10 rounded-xl px-5" onClick={() => void refreshEdgeUnits()}>
            <RefreshCw className="h-4 w-4" />
            重新加载
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg-page)]">
      <WorkbenchSidebar unit={unit} />
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkbenchTopbar unit={unit} units={units} loading={isLoading} onSelectUnit={selectEdgeUnit} onRefresh={refreshEdgeUnits} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1380px] space-y-6 px-8 py-8">
            {notice && (
              <div className="flex items-center justify-between rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#2563eb]">
                <span>{notice}</span>
                <button type="button" className="text-xs font-semibold" onClick={() => setNotice("")}>关闭</button>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-xl border border-[#fef3c7] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
                部分辅助数据加载失败：{warnings.join("；")}
              </div>
            )}
            {introVisible && (
              <div className="relative rounded-2xl border border-[var(--color-border)] bg-white p-4 opacity-85">
                <button
                  type="button"
                  aria-label="关闭概览介绍"
                  className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setIntroVisible(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-start gap-3 pr-6">
                  <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--color-brand)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      云边协同提供强大的云边协同能力，通过将容器化的工作负载从云端下放到边缘端进行统一管理，实现边缘节点的批量管理与业务分发，简化大规模异构设备接入的复杂性，满足物联网、工业互联等场景需求。
                    </p>
                    <div className="mt-2 flex gap-4 text-xs text-[var(--color-text-tertiary)]">
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />设备批量管理</span>
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />业务就近部署</span>
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />边缘自治运行</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <QuickStart />
            <OverviewCard unit={unit} onEdit={() => setEditOpen(true)} />
          </div>
        </main>
      </div>
      <OverviewEditDialog open={editOpen} unit={unit} onOpenChange={setEditOpen} isSubmitting={isMutating} onSave={handleSave} />
    </div>
  );
}

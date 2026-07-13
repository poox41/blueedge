import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCode,
  HelpCircle,
  Info,
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
  Trash2,
  User,
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
import { toWorkbenchEdgeUnit, type EdgeUnitWarning, type WorkbenchEdgeUnitModel } from "@/api/adapters/edge-unit.adapter";
import { listEdgeUnits, updateEdgeUnit, type EdgeUnitUpdatePayload } from "@/api/services/product";
import { useAuth } from "@/contexts/AuthContext";
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

function WorkbenchTopbar({ unit, units, onSelectUnit }: { unit: WorkbenchEdgeUnit; units: WorkbenchEdgeUnit[]; onSelectUnit: (unit: WorkbenchEdgeUnit) => void }) {
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
                  onClick={() => onSelectUnit(item)}
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
        <button className="blueedge-icon-button" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
        <button className="blueedge-icon-button relative" aria-label="通知">
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--color-danger)] ring-2 ring-white" />
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
    { title: "接入节点", desc: "在 边缘节点 模块，纳管边缘硬件设备", href: "/nodes" },
    { title: "部署边缘应用", desc: "将 工作负载 部署到指定边缘节点或边缘节点组", href: "/deployments" },
    { title: "创建终端设备", desc: "传感类或视频类 设备创建，管理并采集设备数据", href: "/deviceinstances" },
  ];
  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">快速入门</h2>
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6">
        <div className="grid grid-cols-3 gap-8">
          {items.map((item, index) => (
            <div key={item.title} className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] text-sm font-bold text-[var(--color-text-tertiary)]">{index + 1}</div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {item.desc.split(" ").map((part, partIndex) => partIndex === 1 ? <Link key={partIndex} to={item.href} className="font-semibold text-[var(--color-brand)]">{part}</Link> : `${part} `)}
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
    <section className="rounded-2xl border border-[var(--color-border)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-[var(--color-brand)]" />
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">{unit.name}</h2>
          <StatusPill tone={unit.status === "运行中" ? "success" : "warning"}>{unit.status}</StatusPill>
          <StatusPill tone="warning">{unit.type}</StatusPill>
        </div>
        <Button size="sm" className="h-8 rounded-xl px-3 text-xs" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-12 px-6 py-6">
        {metrics.map((item) => {
          const Icon = item.icon;
          const percent = item.value[1] > 0 ? (item.value[0] / item.value[1]) * 100 : 0;
          return (
            <div key={item.label} className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: item.bg, color: item.color }}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[var(--color-text-tertiary)]">{item.label}</p>
                <div className="mt-1 flex items-end gap-1">
                  <span className="text-xl font-bold text-[var(--color-text-primary)]">{item.value[0]}</span>
                  <span className="text-sm text-[var(--color-text-tertiary)]">/ {item.value[1]}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-soft)]">
                  <div className="h-full rounded-full" style={{ width: `${percent}%`, background: item.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[var(--color-border)] px-6 py-5">
        <div className="mb-4 flex gap-6 text-sm font-semibold">
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
          <div className="grid grid-cols-2 gap-x-24 gap-y-4 text-sm">
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
              <div key={String(label)} className="grid grid-cols-[120px_1fr]">
                <span className="text-[var(--color-text-tertiary)]">{label}</span>
                <span className="font-semibold text-[var(--color-text-primary)]">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <p className="mb-3 font-semibold text-[var(--color-text-secondary)]">端口设置</p>
              <div className="grid grid-cols-5 gap-3">
                {[
                  ["WebSocket", unit.ports.websocket],
                  ["QUIC", unit.ports.quic],
                  ["HTTPS", unit.ports.https],
                  ["CloudStream", unit.ports.cloudStream],
                  ["Tunnel", unit.ports.tunnel],
                ].map(([label, value]) => (
                  <div key={label} className="flex h-12 items-center justify-between rounded-xl bg-[var(--color-bg-soft)] px-4">
                    <span className="text-[var(--color-text-tertiary)]">{label}</span>
                    <span className="font-semibold text-[var(--color-text-primary)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-[var(--color-border)] pt-4">
              <p className="mb-2 font-semibold text-[var(--color-text-secondary)]">卸载策略</p>
              <p className="font-semibold text-[var(--color-text-primary)]">{unit.uninstallPolicy}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FormField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{hint}</p>}
    </div>
  );
}

function SegmentButton({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border-2 px-4 text-sm font-semibold transition-all",
        selected ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-input-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-input-border-hover)]"
      )}
    >
      {selected && <CheckCircle2 className="h-3.5 w-3.5" />}
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
  const [showCommWarning, setShowCommWarning] = useState(false);
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!flex h-[860px] max-h-[92vh] max-w-[680px] flex-col gap-0 overflow-hidden p-0" showCloseButton>
          <DialogHeader className="border-b border-[var(--color-border)] px-6 py-4">
            <DialogTitle>编辑边缘单元 — {unit.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center px-6 py-4">
            <div className="flex items-center gap-2">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", step === 1 ? "bg-[var(--color-text-primary)] text-white ring-2 ring-[var(--color-brand)] ring-offset-2" : "bg-[var(--color-text-primary)] text-white")}>1</span>
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">基本信息</span>
              <span className={cn("mx-2 h-0.5 w-10 rounded-full", step === 2 ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")} />
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", step === 2 ? "bg-[var(--color-text-primary)] text-white ring-2 ring-[var(--color-brand)] ring-offset-2" : "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]")}>2</span>
              <span className={cn("text-sm font-semibold", step === 2 ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>高级设置</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {step === 1 ? (
              <div className="space-y-5">
                <FormField label="边缘单元名称" hint="边缘单元名称不可修改"><Input value={unit.name} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" /></FormField>
                <FormField label="绑定 NodeGroup" hint="NodeGroup 绑定关系不可修改"><Input value={unit.nodeGroupRef || ""} disabled className="bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]" /></FormField>
                <FormField label="接入方式">
                  <select className="blueedge-native-select" value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as WorkbenchEdgeUnit["type"] }))}>
                    <option value="专有">专有</option>
                    <option value="外接">外接</option>
                    <option value="未配置">未配置</option>
                  </select>
                </FormField>
                <FormField label="工作集群"><Input value={form.cluster} onChange={(event) => setForm((prev) => ({ ...prev, cluster: event.target.value }))} placeholder="未配置" /></FormField>
                <FormField label="KubeEdge 版本"><Input value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} placeholder="未配置" /></FormField>
                <FormField label="边缘节点规模">
                  <button type="button" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-tertiary)]" onClick={() => setShowScaleTip(!showScaleTip)}>
                    <HelpCircle className="h-3.5 w-3.5" />{showScaleTip ? "适用于小规模边缘场景，节点数不超过 10 个" : "查看说明"}
                  </button>
                  <div className="flex gap-3">{(["小型", "中型", "大型"] as const).map((scale) => <SegmentButton key={scale} selected={form.nodeScale === scale} onClick={() => setForm((prev) => ({ ...prev, nodeScale: scale }))}>{scale}</SegmentButton>)}</div>
                </FormField>
                <FormField label="MQTT 服务">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setForm((prev) => ({ ...prev, mqttEnabled: !prev.mqttEnabled }))} className={cn("relative h-6 w-11 rounded-full transition-colors", form.mqttEnabled ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-border-strong)]")}>
                      <span className={cn("absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white transition-all", form.mqttEnabled ? "left-[22px]" : "left-[3px]")} />
                    </button>
                    <span className="text-sm text-[var(--color-text-primary)]">{form.mqttEnabled ? "已启用" : "未启用"}</span>
                  </div>
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Insight 状态">
                    <select className="blueedge-native-select" value={form.insightStatus} onChange={(event) => setForm((prev) => ({ ...prev, insightStatus: event.target.value as WorkbenchEdgeUnit["insightStatus"] }))}>
                      <option value="unknown">未配置</option>
                      <option value="installed">已安装</option>
                      <option value="notInstalled">未安装</option>
                    </select>
                  </FormField>
                  <FormField label="Monitor 状态">
                    <select className="blueedge-native-select" value={form.monitorStatus} onChange={(event) => setForm((prev) => ({ ...prev, monitorStatus: event.target.value as WorkbenchEdgeUnit["monitorStatus"] }))}>
                      <option value="unknown">未配置</option>
                      <option value="installed">已安装</option>
                      <option value="notInstalled">未安装</option>
                    </select>
                  </FormField>
                </div>
                <FormField label="描述"><Textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} rows={4} /></FormField>
              </div>
            ) : (
              <div className="space-y-5">
                {showCommWarning && <div className="flex items-start gap-2 rounded-xl bg-[var(--color-warning-soft)] p-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--color-warning)]" /><p className="text-xs leading-5 text-[var(--color-text-secondary)]">修改访问地址、端口、通讯协议或卸载策略后，已接入的节点可能无法正常通信，请谨慎操作。</p></div>}
                <FormField label="组件通信协议" hint="云边信令通道通信协议，云边网络经常不稳定时，推荐使用 QUIC 协议">
                  <div className="grid grid-cols-2 gap-3">{["WebSocket", "QUIC"].map((protocol) => <SegmentButton key={protocol} selected={form.protocols.includes(protocol)} onClick={() => toggleProtocol(protocol)}>{protocol}</SegmentButton>)}</div>
                </FormField>
                <FormField label="云端节点访问地址" hint="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                  <div className="space-y-2">
                    {form.accessAddresses.map((address, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={address} onChange={(event) => {
                          setShowCommWarning(true);
                          setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }));
                        }} placeholder="请输入访问地址，例如 10.6.222.21" />
                        {form.accessAddresses.length > 1 && <button type="button" className="action-button is-danger" onClick={() => setForm((prev) => ({ ...prev, accessAddresses: prev.accessAddresses.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                    <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)]" onClick={() => setForm((prev) => ({ ...prev, accessAddresses: [...prev.accessAddresses, ""] }))}><Plus className="h-3.5 w-3.5" />添加访问地址</button>
                  </div>
                </FormField>
                <FormField label="端口设置" hint="云端 CloudCore 开放给边端访问的 NodePort 端口，如有冲突，请修改。端口范围 0-65535">
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries({ websocket: "WebSocket", quic: "QUIC", https: "HTTPS", cloudStream: "CloudStream", tunnel: "Tunnel" }).map(([key, label]) => (
                      <div key={key}><label className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label><Input className="h-10 text-center text-base" value={form.ports[key as keyof typeof form.ports]} onChange={(event) => {
                        setShowCommWarning(true);
                        setForm((prev) => ({ ...prev, ports: { ...prev.ports, [key]: event.target.value } }));
                      }} /></div>
                    ))}
                  </div>
                </FormField>
                <FormField label="卸载策略">
                  <div className="grid grid-cols-2 gap-3">{(["保留相关命名空间", "删除相关命名空间"] as const).map((policy) => <button key={policy} type="button" onClick={() => setForm((prev) => ({ ...prev, uninstallPolicy: policy }))} className={cn("flex h-12 items-center gap-3 rounded-xl border-2 px-4 text-sm font-semibold", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)] bg-[var(--color-bg-hover)]" : "border-[var(--color-input-border)] bg-white")}><span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2", form.uninstallPolicy === policy ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-strong)]")}>{form.uninstallPolicy === policy && <span className="h-2 w-2 rounded-full bg-[var(--color-text-primary)]" />}</span>{policy}</button>)}</div>
                </FormField>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-[var(--color-border)] bg-white px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            {step === 2 && <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="h-3.5 w-3.5" />上一步</Button>}
            {step === 1 ? <Button onClick={() => setStep(2)}>下一步<ChevronRight className="h-3.5 w-3.5" /></Button> : <Button onClick={() => setShowConfirm(true)}>保存</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />确认修改边缘单元</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--color-text-secondary)]">确定要修改边缘单元 <strong className="text-[var(--color-text-primary)]">「{unit.name}」</strong> 的配置吗？</p>
          <DialogFooter><Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>取消</Button><Button onClick={save} disabled={isSubmitting}>{isSubmitting ? "保存中..." : "确认修改"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Dashboard() {
  const [units, setUnits] = useState<WorkbenchEdgeUnit[]>([]);
  const [unit, setUnit] = useState<WorkbenchEdgeUnit | null>(null);
  const [warnings, setWarnings] = useState<EdgeUnitWarning[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result = await listEdgeUnits();
      const nextUnits = result.items.map(toWorkbenchEdgeUnit);
      setUnits(nextUnits);
      setWarnings(result.warnings || []);
      setUnit((current) => nextUnits.find((item) => item.name === current?.name) || nextUnits[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "边缘单元加载失败");
      setUnits([]);
      setWarnings([]);
      setUnit(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async (target: WorkbenchEdgeUnit, payload: EdgeUnitUpdatePayload) => {
    setIsMutating(true);
    setNotice("");
    try {
      await updateEdgeUnit(target.name, payload);
      await loadData();
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
          <Button className="mt-5 h-10 rounded-xl px-5" onClick={() => void loadData()}>
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
        <WorkbenchTopbar unit={unit} units={units} onSelectUnit={setUnit} />
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
                部分辅助数据加载失败：{warnings.map((item) => `${item.source}: ${item.message}`).join("；")}
              </div>
            )}
            <div className="rounded-2xl border border-[var(--color-border)] bg-white px-5 py-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-brand)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                    云边协同提供强大的云边协同能力，通过将容器化的工作负载从云端下放到边缘端进行统一管理，实现边缘节点的批量管理与业务分发，简化大规模异构设备接入的复杂性，满足物联网、工业互联等场景需求。
                  </p>
                  <div className="mt-2 flex gap-5 text-xs text-[var(--color-text-tertiary)]">
                    <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />设备批量管理</span>
                    <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />业务就近部署</span>
                    <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />边缘自治运行</span>
                  </div>
                </div>
                <button className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">×</button>
              </div>
            </div>
            <QuickStart />
            <OverviewCard unit={unit} onEdit={() => setEditOpen(true)} />
          </div>
        </main>
      </div>
      <OverviewEditDialog open={editOpen} unit={unit} onOpenChange={setEditOpen} isSubmitting={isMutating} onSave={handleSave} />
    </div>
  );
}

import { NavLink } from "react-router-dom";
import {
  Box,
  Cloud,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCode,
  Group,
  HardDrive,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Route,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navGroups = [
  {
    group: "",
    items: [{ label: "概览", icon: LayoutDashboard, path: "/dashboard" }],
  },
  {
    group: "边缘资源",
    items: [
      { label: "边缘节点", icon: Server, path: "/nodes" },
      { label: "边缘节点组", icon: Group, path: "/nodegroups" },
      { label: "设备模型", icon: Cpu, path: "/devicemodels" },
      { label: "终端设备", icon: HardDrive, path: "/deviceinstances" },
      { label: "批量任务", icon: Rocket, path: "/batchtasks" },
    ],
  },
  {
    group: "边缘应用",
    items: [
      { label: "工作负载", icon: Layers, path: "/deployments" },
      { label: "批量工作负载", icon: Layers, path: "/batchworkloads" },
      { label: "配置项与密钥", icon: FileCode, path: "/configmaps" },
    ],
  },
  {
    group: "边云消息",
    items: [
      { label: "消息端点", icon: MessageSquare, path: "/ruleendpoints" },
      { label: "消息路由", icon: Route, path: "/rules" },
    ],
  },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { selectedEdgeUnit, loading, error } = useEdgeUnits();
  const status = selectedEdgeUnit?.status === "running" ? "运行中" : selectedEdgeUnit?.status === "abnormal" ? "异常" : "未知";
  const accessType = selectedEdgeUnit?.accessType === "external" ? "外接" : selectedEdgeUnit?.accessType === "dedicated" ? "专有" : "未配置";
  const cluster = !selectedEdgeUnit?.clusterName || selectedEdgeUnit.clusterName === "unknown" ? "未配置" : selectedEdgeUnit.clusterName;
  const version = !selectedEdgeUnit?.kubeEdgeVersion || selectedEdgeUnit.kubeEdgeVersion === "unknown" ? "未配置" : selectedEdgeUnit.kubeEdgeVersion;

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-[#e8ecf3] bg-white transition-all duration-200",
        collapsed ? "w-[72px]" : "w-[240px]"
      )}
    >
      <div className="flex h-[72px] shrink-0 items-center border-b border-[#e8ecf3] px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-text-primary)]">
          <Box className="h-[18px] w-[18px] text-white" />
        </div>
        {!collapsed && (
          <span className="ml-3 text-sm font-semibold tracking-tight text-[var(--color-text-primary)]">
            BlueEdge
          </span>
        )}
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        {navGroups.map((group) => (
          <div key={group.group || "root"}>
            {group.group && !collapsed && (
              <div className="mb-2 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {group.group}
              </div>
            )}
            {group.group && collapsed && <div className="mt-5" />}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={`${group.group}-${item.label}`}
                  to={item.path}
                  className={({ isActive }) => cn(
                    "relative mb-0.5 flex h-10 items-center rounded-[10px] px-3 text-sm font-medium transition-colors",
                    collapsed && "justify-center",
                    isActive ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[#5f6368] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-text-primary)]" />}
                      <Icon className="h-[18px] w-[18px]" />
                      {!collapsed && <span className="ml-3">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 px-3 pb-2 pt-2">
          <div className="rounded-[22px] border border-[#e8ecf3] bg-[#f6f7f9] p-[14px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3 items-center justify-center">
                  <span className={cn("absolute h-3 w-3 rounded-full opacity-20 blur-[3px]", status === "运行中" ? "bg-[#22c55e]" : status === "异常" ? "bg-[#ef4444]" : "bg-[#9ca3af]")} />
                  <span className={cn("relative h-[7px] w-[7px] rounded-full", status === "运行中" ? "bg-[#22c55e]" : status === "异常" ? "bg-[#ef4444]" : "bg-[#9ca3af]")} />
                </span>
                <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{loading ? "加载中" : status}</span>
              </div>
              <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", accessType === "专有" ? "bg-[#eaf2ff] text-[#2563eb]" : "bg-[#fef3c7] text-[#b45309]")}>{accessType}</span>
            </div>
            <div className="mb-3">
              <h3 className="mb-1.5 truncate text-sm font-bold tracking-[0.01em] text-[var(--color-text-primary)]">{selectedEdgeUnit?.name || "暂无边缘单元"}</h3>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]"><Cloud className="h-[11px] w-[11px] shrink-0 text-[var(--color-text-tertiary)]" />{cluster}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]"><Server className="h-[11px] w-[11px] shrink-0 text-[var(--color-text-tertiary)]" />KubeEdge {version}</div>
            </div>
            {error && <p className="mt-2 line-clamp-2 text-[11px] text-[var(--color-danger)]">{error}</p>}
            <div className="mb-2.5 border-t border-[#e8ecf3]" />
            <NavLink to="/" className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#e8ecf3] bg-white py-[7px] text-xs font-medium text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:border-[#111827] hover:bg-[#111827] hover:text-white">
              <ChevronLeft className="h-[13px] w-[13px]" />
              返回列表
            </NavLink>
          </div>
        </div>
      )}

      {collapsed && (
        <div className="flex shrink-0 justify-center pb-3">
          <button onClick={onToggle} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8ecf3] bg-[#f6f7f9]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
          </button>
        </div>
      )}

      <div className="flex h-[52px] shrink-0 items-center border-t border-[#eef1f5] px-5">
        <button
          onClick={onToggle}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
            collapsed ? "justify-center" : "justify-start px-2"
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">收起侧边栏</span>}
        </button>
      </div>
    </aside>
  );
}
